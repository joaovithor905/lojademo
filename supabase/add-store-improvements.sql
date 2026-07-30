-- Vitta Fit Wear — melhorias de venda
-- Execute SOMENTE se a estrutura de cupons já foi criada anteriormente.
-- Esta migração adiciona o tipo de cupom "frete grátis".
-- Acompanhamento de pedido, produtos relacionados e alerta de estoque
-- não precisam de novas colunas no banco.

alter table public.coupons
drop constraint if exists coupons_discount_type_check;

alter table public.coupons
drop constraint if exists coupons_discount_value_check;

alter table public.coupons
drop constraint if exists coupons_percentage_value_check;

alter table public.coupons
add constraint coupons_discount_type_check
check (discount_type in ('percentage', 'fixed', 'free_shipping'));

alter table public.coupons
add constraint coupons_discount_value_check
check (
  (discount_type = 'free_shipping' and discount_value = 0)
  or
  (discount_type in ('percentage', 'fixed') and discount_value > 0)
);

alter table public.coupons
add constraint coupons_percentage_value_check
check (
  discount_type <> 'percentage'
  or discount_value < 100
);

select
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.coupons'::regclass
      and conname = 'coupons_discount_type_check'
  ) as cupom_frete_gratis_configurado;
