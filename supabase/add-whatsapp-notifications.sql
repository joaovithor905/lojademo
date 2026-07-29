-- Vitta Fit Wear — notificações automáticas de pagamento via WhatsApp
-- Execute DEPOIS de add-admin-features.sql.

alter table public.orders
add column if not exists whatsapp_opt_in boolean not null default false,
add column if not exists whatsapp_payment_sent_at timestamptz,
add column if not exists whatsapp_payment_sending_at timestamptz,
add column if not exists whatsapp_payment_message_id text,
add column if not exists whatsapp_last_error text;

-- Os campos abaixo são controlados pelo servidor, não pelo navegador do painel.
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
       or new.total is distinct from old.total
       or new.whatsapp_opt_in is distinct from old.whatsapp_opt_in
       or new.whatsapp_payment_sent_at is distinct from old.whatsapp_payment_sent_at
       or new.whatsapp_payment_sending_at is distinct from old.whatsapp_payment_sending_at
       or new.whatsapp_payment_message_id is distinct from old.whatsapp_payment_message_id
       or new.whatsapp_last_error is distinct from old.whatsapp_last_error then
      raise exception 'Os dados financeiros e de notificações só podem ser alterados pelo servidor.';
    end if;
  end if;
  return new;
end;
$$;

-- Confirmação visual.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'whatsapp_opt_in'
  ) as whatsapp_configurado,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'whatsapp_payment_sent_at'
  ) as rastreamento_configurado;
