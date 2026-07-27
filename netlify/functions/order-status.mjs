import { getSupabaseAdmin, json } from './lib.mjs';

export default async function handler(request) {
  if (request.method !== 'GET') return json({ error: 'Método não permitido.' }, 405);

  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get('order');
    const token = url.searchParams.get('token');
    if (!orderId || !token) return json({ error: 'Identificação do pedido ausente.' }, 400);

    const supabase = getSupabaseAdmin();
    const { data: order, error } = await supabase
      .from('orders')
      .select('order_number,status,payment_status,total,payment_date,created_at')
      .eq('id', orderId)
      .eq('public_token', token)
      .maybeSingle();

    if (error) throw error;
    if (!order) return json({ error: 'Pedido não encontrado.' }, 404);

    return json(order);
  } catch (error) {
    console.error('order-status:', error);
    return json({ error: 'Não foi possível consultar o pedido.' }, 500);
  }
}
