import { getSupabaseAdmin, json, roundMoney } from './lib.mjs';
import { calculateCart, resolveCoupon } from './coupon-lib.mjs';

const DELIVERY_FEE = 10;

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const input = await request.json();
    const supabase = getSupabaseAdmin();
    const { subtotal } = await calculateCart(supabase, input.items);
    const { coupon, discountAmount } = await resolveCoupon(supabase, input.code, subtotal, DELIVERY_FEE);

    if (!coupon) return json({ error: 'Informe um cupom.' }, 400);

    const freeShipping = coupon.discount_type === 'free_shipping';
    const deliveryFeeCharged = freeShipping ? 0 : DELIVERY_FEE;
    const merchandiseDiscount = freeShipping ? 0 : discountAmount;

    return json({
      valid: true,
      code: coupon.code,
      discountType: coupon.discount_type,
      discountValue: Number(coupon.discount_value),
      discountAmount,
      subtotal,
      deliveryFee: DELIVERY_FEE,
      deliveryFeeCharged,
      total: roundMoney(subtotal - merchandiseDiscount + deliveryFeeCharged),
      remainingUses: coupon.usage_limit === null
        ? null
        : Math.max(Number(coupon.usage_limit) - Number(coupon.times_used), 0)
    });
  } catch (error) {
    console.error('validate-coupon:', error);
    return json({ error: error.message || 'Não foi possível validar o cupom.' }, error.statusCode || 500);
  }
}
