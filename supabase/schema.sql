-- Vitta Fit Wear — banco de dados Supabase
-- Execute este arquivo no SQL Editor de um projeto novo.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('Feminino', 'Masculino', 'Unissex')),
  price numeric(10,2) not null check (price > 0),
  image_url text not null,
  description text not null default '',
  sizes text[] not null default array['P','M','G']::text[],
  stock_by_size jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  public_token uuid not null default gen_random_uuid(),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  address text not null,
  neighborhood text not null,
  city text not null default 'Rio Verde - GO',
  notes text not null default '',
  subtotal numeric(10,2) not null check (subtotal >= 0),
  delivery_fee numeric(10,2) not null default 10 check (delivery_fee >= 0),
  total numeric(10,2) not null check (total >= 0),
  status text not null default 'pending_payment' check (status in (
    'pending_payment', 'paid', 'separating', 'out_for_delivery', 'completed',
    'cancelled', 'payment_failed', 'stock_issue', 'refunded'
  )),
  payment_status text not null default 'pending' check (payment_status in (
    'pending', 'in_process', 'approved', 'approved_stock_issue', 'rejected',
    'cancelled', 'refunded', 'charged_back', 'review', 'error'
  )),
  payment_method text,
  payment_id text unique,
  preference_id text,
  checkout_url text,
  payment_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  size text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  line_total numeric(10,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists orders_payment_date_idx on public.orders(payment_date desc);
create index if not exists orders_payment_status_idx on public.orders(payment_status);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists products_active_idx on public.products(active);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- Confirma o pagamento e baixa o estoque de forma atômica e idempotente.
create or replace function public.confirm_order_payment(
  p_order_id uuid,
  p_payment_id text,
  p_payment_method text,
  p_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_current integer;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado';
  end if;

  if v_order.payment_status in ('approved', 'approved_stock_issue') then
    return jsonb_build_object('status', v_order.payment_status, 'already_processed', true);
  end if;

  -- Primeiro trava e valida todos os produtos, sempre na mesma ordem.
  for v_item in
    select * from public.order_items
    where order_id = p_order_id
    order by product_id, size
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;

    v_current := coalesce((v_product.stock_by_size ->> v_item.size)::integer, 0);

    if v_current < v_item.quantity then
      update public.orders
      set payment_status = 'approved_stock_issue',
          status = 'stock_issue',
          payment_id = p_payment_id,
          payment_method = p_payment_method,
          payment_date = coalesce(p_paid_at, now())
      where id = p_order_id;

      return jsonb_build_object(
        'status', 'approved_stock_issue',
        'product_id', v_item.product_id,
        'size', v_item.size,
        'available', v_current,
        'requested', v_item.quantity
      );
    end if;
  end loop;

  -- Depois da validação, realiza todas as baixas.
  for v_item in
    select * from public.order_items
    where order_id = p_order_id
    order by product_id, size
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;

    v_current := coalesce((v_product.stock_by_size ->> v_item.size)::integer, 0);

    update public.products
    set stock_by_size = jsonb_set(
      stock_by_size,
      array[v_item.size],
      to_jsonb(v_current - v_item.quantity),
      true
    )
    where id = v_item.product_id;
  end loop;

  update public.orders
  set payment_status = 'approved',
      status = 'paid',
      payment_id = p_payment_id,
      payment_method = p_payment_method,
      payment_date = coalesce(p_paid_at, now())
  where id = p_order_id;

  return jsonb_build_object('status', 'approved', 'already_processed', false);
end;
$$;

revoke all on function public.confirm_order_payment(uuid, text, text, timestamptz) from public;
grant execute on function public.confirm_order_payment(uuid, text, text, timestamptz) to service_role;

-- Segurança: o catálogo ativo é público; todo o restante exige login administrativo.
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "public can read active products" on public.products;
create policy "public can read active products"
on public.products for select
to anon, authenticated
using (active = true or auth.role() = 'authenticated');

drop policy if exists "authenticated manages products" on public.products;
create policy "authenticated manages products"
on public.products for all
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated reads orders" on public.orders;
create policy "authenticated reads orders"
on public.orders for select
to authenticated
using (true);

drop policy if exists "authenticated updates order workflow" on public.orders;
create policy "authenticated updates order workflow"
on public.orders for update
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated reads order items" on public.order_items;
create policy "authenticated reads order items"
on public.order_items for select
to authenticated
using (true);

-- Bucket público para fotos cadastradas no painel.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "public reads product images" on storage.objects;
create policy "public reads product images"
on storage.objects for select
to public
using (bucket_id = 'product-images');

drop policy if exists "authenticated uploads product images" on storage.objects;
create policy "authenticated uploads product images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'product-images');

drop policy if exists "authenticated updates product images" on storage.objects;
create policy "authenticated updates product images"
on storage.objects for update
to authenticated
using (bucket_id = 'product-images')
with check (bucket_id = 'product-images');

drop policy if exists "authenticated deletes product images" on storage.objects;
create policy "authenticated deletes product images"
on storage.objects for delete
to authenticated
using (bucket_id = 'product-images');

-- Produtos iniciais para demonstração.
insert into public.products (name, category, price, image_url, description, sizes, stock_by_size, active, featured)
select * from (values
  ('Legging Vitta Sculpt', 'Feminino', 129.90::numeric, 'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?auto=format&fit=crop&w=900&q=80', 'Cintura alta, compressão confortável e tecido de secagem rápida.', array['P','M','G','GG']::text[], '{"P":4,"M":6,"G":5,"GG":3}'::jsonb, true, true),
  ('Top Vitta Power', 'Feminino', 89.90::numeric, 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=900&q=80', 'Sustentação média, alças reforçadas e toque macio.', array['P','M','G']::text[], '{"P":4,"M":6,"G":4}'::jsonb, true, true),
  ('Camiseta Dry Move', 'Masculino', 99.90::numeric, 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=80', 'Camiseta leve com tecnologia dry para treinos intensos.', array['P','M','G','GG']::text[], '{"P":4,"M":6,"G":6,"GG":4}'::jsonb, true, true),
  ('Short Vitta Performance', 'Masculino', 109.90::numeric, 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=900&q=80', 'Elasticidade, bolsos laterais e liberdade de movimento.', array['P','M','G','GG']::text[], '{"P":3,"M":5,"G":5,"GG":3}'::jsonb, true, false)
) as seed(name, category, price, image_url, description, sizes, stock_by_size, active, featured)
where not exists (select 1 from public.products);

-- Impede que um usuário do painel altere dados financeiros manualmente pelo navegador.
create or replace function public.protect_order_payment_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if new.payment_status is distinct from old.payment_status
       or new.payment_id is distinct from old.payment_id
       or new.payment_method is distinct from old.payment_method
       or new.payment_date is distinct from old.payment_date
       or new.preference_id is distinct from old.preference_id
       or new.checkout_url is distinct from old.checkout_url
       or new.subtotal is distinct from old.subtotal
       or new.delivery_fee is distinct from old.delivery_fee
       or new.total is distinct from old.total then
      raise exception 'Os dados financeiros só podem ser alterados pelo servidor de pagamentos.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_protect_payment_fields on public.orders;
create trigger orders_protect_payment_fields
before update on public.orders
for each row execute function public.protect_order_payment_fields();

-- Ativa atualizações em tempo real para o painel, quando ainda não estiver na publicação.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
