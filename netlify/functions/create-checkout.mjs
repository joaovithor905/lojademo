import crypto from 'node:crypto';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import {
  cleanText,
  getSiteUrl,
  getSupabaseAdmin,
  json,
  roundMoney
} from './lib.mjs';
import { calculateCart, resolveCoupon } from './coupon-lib.mjs';

const DELIVERY_FEE = 10;

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const accessToken = process.env.MP_ACCESS_TOKEN;
    const siteUrl = getSiteUrl();

    if (!accessToken) return json({ error: 'Mercado Pago ainda não foi configurado.' }, 500);
    if (!siteUrl || siteUrl.includes('localhost')) {
      return json({ error: 'Configure SITE_URL com a URL pública HTTPS do Netlify.' }, 500);
    }

    const input = await request.json();
    const customer = input.customer || {};
    const name = cleanText(customer.name, 120);
    const email = cleanText(customer.email, 160).toLowerCase();
    const phone = cleanText(customer.phone, 30);
    const address = cleanText(customer.address, 180);
    const neighborhood = cleanText(customer.neighborhood, 100);
    const notes = cleanText(input.notes, 500);
    const couponCode = cleanText(input.couponCode, 40).toUpperCase();
    const whatsappOptIn = input.whatsappOptIn === true;

    if (!name || !email || !phone || !address || !neighborhood) {
      return json({ error: 'Preencha nome, e-mail, WhatsApp, endereço e bairro.' }, 400);
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400);

    const supabase = getSupabaseAdmin();
    const { normalizedItems, subtotal } = await calculateCart(supabase, input.items);
    const { coupon, discountAmount } = await resolveCoupon(supabase, couponCode, subtotal, DELIVERY_FEE);
    const freeShipping = coupon?.discount_type === 'free_shipping';
    const merchandiseDiscount = freeShipping ? 0 : discountAmount;
    const shippingCost = freeShipping ? 0 : DELIVERY_FEE;
    const merchandiseTotal = roundMoney(subtotal - merchandiseDiscount);
    const total = roundMoney(merchandiseTotal + shippingCost);

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        address,
        neighborhood,
        city: 'Rio Verde - GO',
        notes,
        subtotal,
        delivery_fee: DELIVERY_FEE,
        discount_amount: discountAmount,
        coupon_id: coupon?.id || null,
        coupon_code: coupon?.code || null,
        whatsapp_opt_in: whatsappOptIn,
        total,
        status: 'pending_payment',
        payment_status: 'pending'
      })
      .select('id,order_number,public_token,total')
      .single();

    if (orderError) throw orderError;

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(normalizedItems.map(item => ({ ...item, order_id: order.id })));

    if (itemsError) {
      await supabase.from('orders').delete().eq('id', order.id);
      throw itemsError;
    }

    const returnQuery = new URLSearchParams({
      order: order.id,
      token: order.public_token
    }).toString();

    const paymentItems = merchandiseDiscount > 0
      ? [{
          id: `pedido-${order.order_number}`,
          title: `Pedido Vitta Fit Wear #${order.order_number}`,
          description: `${normalizedItems.map(item => `${item.quantity}x ${item.product_name} Tam. ${item.size}`).join(' | ')} · Cupom ${coupon.code}`.slice(0, 250),
          quantity: 1,
          unit_price: merchandiseTotal,
          currency_id: 'BRL'
        }]
      : normalizedItems.map(item => ({
          id: item.product_id,
          title: `${item.product_name} - Tam. ${item.size}`,
          quantity: item.quantity,
          unit_price: item.unit_price,
          currency_id: 'BRL'
        }));

    const preferenceBody = {
      items: paymentItems,
      external_reference: order.id,
      metadata: {
        order_id: order.id,
        order_number: String(order.order_number),
        coupon_code: coupon?.code || '',
        discount_amount: String(discountAmount)
      },
      additional_info: coupon
        ? (freeShipping
            ? `Cupom ${coupon.code}: frete grátis`
            : `Cupom ${coupon.code}: desconto de R$ ${discountAmount.toFixed(2)}`)
        : 'Pedido sem cupom',
      statement_descriptor: 'VITTAFITWEAR',
      notification_url: `${siteUrl}/api/mercadopago-webhook`,
      back_urls: {
        success: `${siteUrl}/pagamento.html?result=success&${returnQuery}`,
        pending: `${siteUrl}/pagamento.html?result=pending&${returnQuery}`,
        failure: `${siteUrl}/pagamento.html?result=failure&${returnQuery}`
      },
      auto_return: 'approved'
    };

    if (shippingCost > 0) {
      preferenceBody.shipments = {
        cost: shippingCost,
        mode: 'not_specified'
      };
    }

    const client = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const preference = new Preference(client);
    const result = await preference.create({
      body: preferenceBody,
      requestOptions: { idempotencyKey: order.id || crypto.randomUUID() }
    });

    const checkoutUrl = result.init_point;
    if (!checkoutUrl) throw new Error('O Mercado Pago não retornou a URL do pagamento.');

    const { error: updateError } = await supabase
      .from('orders')
      .update({ preference_id: result.id, checkout_url: checkoutUrl })
      .eq('id', order.id);

    if (updateError) throw updateError;

    return json({
      orderId: order.id,
      orderNumber: order.order_number,
      publicToken: order.public_token,
      checkoutUrl,
      subtotal,
      discountAmount,
      deliveryFeeCharged: shippingCost,
      total,
      couponCode: coupon?.code || null
    }, 201);
  } catch (error) {
    const detail = error?.cause?.[0]?.description || error?.message || 'Erro desconhecido';
    console.error('create-checkout:', { detail, status: error?.status, cause: error?.cause });
    return json({ error: `Não foi possível iniciar o pagamento: ${detail}` }, error.statusCode || 500);
  }
}
