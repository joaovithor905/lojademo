const money = value => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
}).format(Number(value || 0));

export function normalizeWhatsAppPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  if (digits.length < 12 || digits.length > 15) {
    throw new Error('Número de WhatsApp inválido para envio automático.');
  }
  return digits;
}

function buildOrderDetails(order) {
  const items = (order.order_items || []).slice(0, 12).map(item =>
    `${item.quantity}x ${item.product_name} · Tam. ${item.size}`
  );

  if ((order.order_items || []).length > 12) {
    items.push(`+ ${(order.order_items || []).length - 12} item(ns)`);
  }

  const lines = [...items, `Subtotal: ${money(order.subtotal)}`];
  if (Number(order.discount_amount || 0) > 0) {
    lines.push(`Desconto${order.coupon_code ? ` (${order.coupon_code})` : ''}: -${money(order.discount_amount)}`);
  }
  lines.push(`Entrega: ${money(order.delivery_fee)}`);
  return lines.join('\n').slice(0, 900);
}

async function releaseClaim(supabase, orderId, message) {
  await supabase
    .from('orders')
    .update({
      whatsapp_payment_sending_at: null,
      whatsapp_last_error: String(message || 'Falha ao enviar WhatsApp').slice(0, 500)
    })
    .eq('id', orderId);
}

export async function sendPaidOrderWhatsApp({ supabase, orderId }) {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(`
      id,
      order_number,
      customer_name,
      customer_phone,
      subtotal,
      delivery_fee,
      discount_amount,
      coupon_code,
      total,
      whatsapp_opt_in,
      whatsapp_payment_sent_at,
      whatsapp_payment_sending_at,
      order_items(product_name,size,quantity,line_total)
    `)
    .eq('id', orderId)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) return { skipped: 'order_not_found' };
  if (!order.whatsapp_opt_in) return { skipped: 'opt_out' };
  if (order.whatsapp_payment_sent_at) return { skipped: 'already_sent' };
  if (order.whatsapp_payment_sending_at) return { skipped: 'already_sending' };

  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('orders')
    .update({
      whatsapp_payment_sending_at: claimedAt,
      whatsapp_last_error: null
    })
    .eq('id', order.id)
    .is('whatsapp_payment_sent_at', null)
    .is('whatsapp_payment_sending_at', null)
    .select('id')
    .maybeSingle();

  if (claimError) throw claimError;
  if (!claimed) return { skipped: 'claim_not_acquired' };

  try {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const templateName = process.env.WHATSAPP_TEMPLATE_PAYMENT || 'pedido_pago_vitta';
    const languageCode = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR';
    const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';

    if (!accessToken || !phoneNumberId) {
      throw new Error('WhatsApp Cloud API ainda não foi configurada no Netlify.');
    }

    const recipient = normalizeWhatsAppPhone(order.customer_phone);
    const details = buildOrderDetails(order);

    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: order.customer_name },
                  { type: 'text', text: String(order.order_number) },
                  { type: 'text', text: details },
                  { type: 'text', text: money(order.total) }
                ]
              }
            ]
          }
        })
      }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result?.error?.message || `WhatsApp respondeu HTTP ${response.status}`;
      throw new Error(message);
    }

    const messageId = result?.messages?.[0]?.id || null;
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        whatsapp_payment_sent_at: new Date().toISOString(),
        whatsapp_payment_sending_at: null,
        whatsapp_payment_message_id: messageId,
        whatsapp_last_error: null
      })
      .eq('id', order.id);

    if (updateError) throw updateError;

    return { sent: true, messageId };
  } catch (error) {
    await releaseClaim(supabase, order.id, error.message);
    throw error;
  }
}
