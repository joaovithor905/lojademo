-- Loja Demo — nome da loja registrado em cada pedido
alter table public.orders
add column if not exists store_name text not null default 'Loja Demo';

select true as identidade_da_loja_configurada;
