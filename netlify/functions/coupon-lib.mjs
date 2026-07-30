import { cleanText, roundMoney } from './lib.mjs';

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function calculateCart(supabase, rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) throw httpError('O carrinho está vazio.');
  if (items.length > 30) throw httpError('O carrinho contém itens demais.');

  const productIds = [...new Set(
    items.map(item => cleanText(item.productId, 60)).filter(Boolean)
  )];

  const { data: products, error } = await supabase
    .from('products')
    .select('id,name,price,sizes,stock_by_size,active')
    .in('id', productIds)
    .eq('active', true);

  if (error) throw error;
  if (!products || products.length !== productIds.length) {
    throw httpError('Um dos produtos não está mais disponível. Atualize a página.', 409);
  }

  const productMap = new Map(products.map(product => [product.id, product]));
  const normalizedItems = [];
  let subtotal = 0;

  for (const rawItem of items) {
    const product = productMap.get(cleanText(rawItem.productId, 60));
    const size = cleanText(rawItem.size, 20);
    const quantity = Number.parseInt(rawItem.quantity, 10);

    if (!product || !product.sizes?.includes(size)) {
      throw httpError('Produto ou tamanho inválido no carrinho.');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw httpError('Quantidade inválida no carrinho.');
    }

    const available = Number(product.stock_by_size?.[size] || 0);
    if (quantity > available) {
      throw httpError(`Estoque insuficiente para ${product.name}, tamanho ${size}.`, 409);
    }

    const unitPrice = roundMoney(product.price);
    const lineTotal = roundMoney(unitPrice * quantity);
    subtotal = roundMoney(subtotal + lineTotal);

    normalizedItems.push({
      product_id: product.id,
      product_name: product.name,
      size,
      quantity,
      unit_price: unitPrice,
      line_total: lineTotal
    });
  }

  return { normalizedItems, subtotal };
}

export async function resolveCoupon(supabase, rawCode, subtotal, deliveryFee = 0) {
  const code = cleanText(rawCode, 40).toUpperCase();
  if (!code) return { coupon: null, discountAmount: 0 };

  const { data: coupon, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (error) throw error;
  if (!coupon || !coupon.active) throw httpError('Cupom inválido ou inativo.');

  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now()) {
    throw httpError('Este cupom expirou.');
  }

  if (coupon.usage_limit !== null && Number(coupon.times_used) >= Number(coupon.usage_limit)) {
    throw httpError('Este cupom atingiu o limite de utilizações.');
  }

  if (subtotal < Number(coupon.minimum_order || 0)) {
    throw httpError(`Este cupom exige compra mínima de R$ ${Number(coupon.minimum_order).toFixed(2).replace('.', ',')}.`);
  }

  let discountAmount;
  if (coupon.discount_type === 'free_shipping') {
    discountAmount = roundMoney(Math.max(Number(deliveryFee || 0), 0));
  } else if (coupon.discount_type === 'percentage') {
    discountAmount = subtotal * (Number(coupon.discount_value) / 100);
    if (coupon.max_discount !== null) {
      discountAmount = Math.min(discountAmount, Number(coupon.max_discount));
    }
    // O Mercado Pago exige valor positivo para o item.
    discountAmount = roundMoney(Math.min(discountAmount, Math.max(subtotal - 0.01, 0)));
  } else {
    discountAmount = roundMoney(Math.min(
      Number(coupon.discount_value),
      Math.max(subtotal - 0.01, 0)
    ));
  }

  return {
    coupon,
    discountAmount
  };
}
