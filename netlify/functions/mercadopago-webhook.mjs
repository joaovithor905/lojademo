import {
  InvalidWebhookSignatureError,
  MercadoPagoConfig,
  Payment,
  WebhookSignatureValidator
} from 'mercadopago';
import { getSupabaseAdmin, json, roundMoney } from './lib.mjs';

export default async function handler(request) {
  if (request.method !== 'POST') return json({ received: true });

  try {
    const url = new URL(request.url);
    const payload = await request.json().catch(() => ({}));
    const type = url.searchParams.get('type') || payload.type;
    const dataId = url.searchParams.get('data.id') || payload.data?.id;

    if (type !== 'payment' || !dataId) return json({ received: true });

    const webhookSecret = process.env.MP_WEBHOOK_SECRET;
    if (!webhookSecret) return json({ error: 'Webhook não configurado.' }, 500);

    WebhookSignatureValidator.validate({
      xSignature: request.headers.get('x-signature'),
      xRequestId: request.headers.get('x-request-id'),
      dataId: String(dataId),
      secret: webhookSecret
    });

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) return json({ error: 'Mercado Pago não configurado.' }, 500);

    const client = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const paymentClient = new Payment(client);
    const payment = await paymentClient.get({ id: String(dataId) });

    const orderId = payment.external_reference || payment.metadata?.order_id;
    if (!orderId) return json({ received: true });

    const supabase = getSupabaseAdmin();
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id,total,payment_status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) return json({ received: true });

    const receivedAmount = roundMoney(payment.transaction_amount || 0);
    if (Math.abs(receivedAmount - roundMoney(order.total)) > 0.01) {
      await supabase.from('orders').update({
        payment_status: 'review',
        payment_id: String(payment.id),
        payment_method: payment.payment_method_id || null
      }).eq('id', order.id);
      return json({ received: true, review: 'amount_mismatch' });
    }

    if (payment.status === 'approved') {
      const { error: rpcError } = await supabase.rpc('confirm_order_payment', {
        p_order_id: order.id,
        p_payment_id: String(payment.id),
        p_payment_method: payment.payment_method_id || payment.payment_type_id || 'Mercado Pago',
        p_paid_at: payment.date_approved || new Date().toISOString()
      });
      if (rpcError) throw rpcError;
    } else {
      const mapping = {
        pending: ['in_process', 'pending_payment'],
        in_process: ['in_process', 'pending_payment'],
        authorized: ['in_process', 'pending_payment'],
        rejected: ['rejected', 'payment_failed'],
        cancelled: ['cancelled', 'cancelled'],
        refunded: ['refunded', 'refunded'],
        partially_refunded: ['refunded', 'refunded'],
        charged_back: ['charged_back', 'refunded']
      };
      const [paymentStatus, orderStatus] = mapping[payment.status] || ['review', 'pending_payment'];
      await supabase.from('orders').update({
        payment_status: paymentStatus,
        status: orderStatus,
        payment_id: String(payment.id),
        payment_method: payment.payment_method_id || payment.payment_type_id || null
      }).eq('id', order.id);
    }

    return json({ received: true });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return json({ error: 'Assinatura inválida.' }, 401);
    }
    console.error('mercadopago-webhook:', error);
    return json({ error: 'Erro ao processar notificação.' }, 500);
  }
}
