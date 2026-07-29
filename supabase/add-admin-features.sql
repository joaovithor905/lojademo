-- Vitta Fit Wear — edição de produtos, galeria e cupons
-- Execute uma única vez no SQL Editor do Supabase.

alter table public.products
add column if not exists image_urls text[] not null default array[]::text[];

update public.products
set image_urls = array[image_url]
where image_url is not null
  and image_url <> ''
  and coalesce(array_length(image_urls, 1), 0) = 0;

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  minimum_order numeric(10,2) not null default 0 check (minimum_order >= 0),
  max_discount numeric(10,2) check (max_discount is null or max_discount > 0),
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  times_used integer not null default 0 check (times_used >= 0),
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_percentage_value_check check (
    discount_type <> 'percentage' or discount_value < 100
  )
);

create unique index if not exists coupons_code_upper_idx
on public.coupons (upper(code));

create index if not exists coupons_active_idx
on public.coupons (active);

alter table public.orders
add column if not exists coupon_id uuid references public.coupons(id) on delete set null,
add column if not exists coupon_code text,
add column if not exists discount_amount numeric(10,2) not null default 0 check (discount_amount >= 0);

create index if not exists orders_coupon_id_idx on public.orders(coupon_id);

-- Padroniza códigos já existentes em letras maiúsculas.
update public.coupons set code = upper(trim(code));

create or replace function public.set_coupon_code_upper()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.code = upper(trim(new.code));
  return new;
end;
$$;

drop trigger if exists coupons_set_code_upper on public.coupons;
create trigger coupons_set_code_upper
before insert or update of code on public.coupons
for each row execute function public.set_coupon_code_upper();

drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at
before update on public.coupons
for each row execute function public.set_updated_at();

alter table public.coupons enable row level security;

drop policy if exists "authenticated manages coupons" on public.coupons;
create policy "authenticated manages coupons"
on public.coupons for all
to authenticated
using (true)
with check (true);

-- Confirma o pagamento, baixa estoque e contabiliza o uso do cupom.
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

  -- Trava e valida o estoque antes de realizar qualquer baixa.
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

      if v_order.coupon_id is not null then
        update public.coupons
        set times_used = times_used + 1
        where id = v_order.coupon_id;
      end if;

      return jsonb_build_object(
        'status', 'approved_stock_issue',
        'product_id', v_item.product_id,
        'size', v_item.size,
        'available', v_current,
        'requested', v_item.quantity
      );
    end if;
  end loop;

  -- Efetua as baixas após validar todos os itens.
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

  if v_order.coupon_id is not null then
    update public.coupons
    set times_used = times_used + 1
    where id = v_order.coupon_id;
  end if;

  return jsonb_build_object('status', 'approved', 'already_processed', false);
end;
$$;

revoke all on function public.confirm_order_payment(uuid, text, text, timestamptz) from public;
grant execute on function public.confirm_order_payment(uuid, text, text, timestamptz) to service_role;

-- Atualiza a proteção dos campos financeiros do pedido.
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
       or new.discount_amount is distinct from old.discount_amount
       or new.coupon_id is distinct from old.coupon_id
       or new.coupon_code is distinct from old.coupon_code
       or new.total is distinct from old.total then
      raise exception 'Os dados financeiros só podem ser alterados pelo servidor de pagamentos.';
    end if;
  end if;
  return new;
end;
$$;

-- Confirmação visual rápida.
select
  (select count(*) from public.products) as produtos,
  (select count(*) from public.coupons) as cupons,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'discount_amount'
  ) as estrutura_atualizada;
