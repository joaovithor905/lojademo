import crypto from 'node:crypto';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import {
  cleanText,
  getSiteUrl,
  getSupabaseAdmin,
  json,
  roundMoney
} from './lib.mjs';

const DELIVERY_FEE = 10;

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  try {
    const accessToken = process.env.MP_ACCESS_TOKEN;
    const siteUrl = getSiteUrl();

    if (!accessToken) {
      return json(
        { error: 'Mercado Pago ainda não foi configurado.' },
        500
      );
    }

    if (!siteUrl || siteUrl.includes('localhost')) {
      return json(
        {
          error:
            'Configure SITE_URL com a URL pública HTTPS do Netlify.'
        },
        500
      );
    }

    const input = await request.json();
    const customer = input.customer || {};
    const items = Array.isArray(input.items) ? input.items : [];

    const name = cleanText(customer.name, 120);
    const email = cleanText(customer.email, 160).toLowerCase();
    const phone = cleanText(customer.phone, 30);
    const address = cleanText(customer.address, 180);
    const neighborhood = cleanText(customer.neighborhood, 100);
    const notes = cleanText(input.notes, 500);

    if (
      !name ||
      !email ||
      !phone ||
      !address ||
      !neighborhood ||
      !items.length
    ) {
      return json(
        {
          error:
            'Preencha nome, e-mail, WhatsApp, endereço, bairro e o carrinho.'
        },
        400
      );
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return json(
        { error: 'Informe um e-mail válido.' },
        400
      );
    }

    if (items.length > 30) {
      return json(
        { error: 'O carrinho contém itens demais.' },
        400
      );
    }

    const supabase = getSupabaseAdmin();

    const productIds = [
      ...new Set(
        items
          .map((item) => cleanText(item.productId, 60))
          .filter(Boolean)
      )
    ];

    const {
      data: products,
      error: productsError
    } = await supabase
      .from('products')
      .select(
        'id,name,price,sizes,stock_by_size,active'
      )
      .in('id', productIds)
      .eq('active', true);

    if (productsError) {
      throw productsError;
    }

    if (
      !products ||
      products.length !== productIds.length
    ) {
      return json(
        {
          error:
            'Um dos produtos não está mais disponível. Atualize a página.'
        },
        409
      );
    }

    const productMap = new Map(
      products.map((product) => [
        product.id,
        product
      ])
    );

    const normalizedItems = [];
    let subtotal = 0;

    for (const rawItem of items) {
      const product = productMap.get(
        cleanText(rawItem.productId, 60)
      );

      const size = cleanText(rawItem.size, 20);
      const quantity = Number.parseInt(
        rawItem.quantity,
        10
      );

      if (
        !product ||
        !product.sizes?.includes(size)
      ) {
        return json(
          {
            error:
              'Produto ou tamanho inválido no carrinho.'
          },
          400
        );
      }

      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 20
      ) {
        return json(
          {
            error:
              'Quantidade inválida no carrinho.'
          },
          400
        );
      }

      const available = Number(
        product.stock_by_size?.[size] || 0
      );

      if (quantity > available) {
        return json(
          {
            error:
              `Estoque insuficiente para ${product.name}, tamanho ${size}.`
          },
          409
        );
      }

      const unitPrice = roundMoney(
        product.price
      );

      const lineTotal = roundMoney(
        unitPrice * quantity
      );

      subtotal = roundMoney(
        subtotal + lineTotal
      );

      normalizedItems.push({
        product_id: product.id,
        product_name: product.name,
        size,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal
      });
    }

    const total = roundMoney(
      subtotal + DELIVERY_FEE
    );

    const {
      data: order,
      error: orderError
    } = await supabase
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
        total,
        status: 'pending_payment',
        payment_status: 'pending'
      })
      .select(
        'id,order_number,public_token,total'
      )
      .single();

    if (orderError) {
      throw orderError;
    }

    const { error: itemsError } =
      await supabase
        .from('order_items')
        .insert(
          normalizedItems.map((item) => ({
            ...item,
            order_id: order.id
          }))
        );

    if (itemsError) {
      await supabase
        .from('orders')
        .delete()
        .eq('id', order.id);

      throw itemsError;
    }

    const returnQuery =
      new URLSearchParams({
        order: order.id,
        token: order.public_token
      }).toString();

    const preferenceBody = {
      items: normalizedItems.map((item) => ({
        id: item.product_id,
        title:
          `${item.product_name} - Tam. ${item.size}`,
        quantity: item.quantity,
        unit_price: item.unit_price,
        currency_id: 'BRL'
      })),

      shipments: {
        cost: DELIVERY_FEE,
        mode: 'not_specified'
      },

      external_reference: order.id,

      metadata: {
        order_id: order.id,
        order_number: String(
          order.order_number
        )
      },

      statement_descriptor: 'VITTAFITWEAR',

      notification_url:
        `${siteUrl}/api/mercadopago-webhook`,

      back_urls: {
        success:
          `${siteUrl}/pagamento.html?result=success&${returnQuery}`,

        pending:
          `${siteUrl}/pagamento.html?result=pending&${returnQuery}`,

        failure:
          `${siteUrl}/pagamento.html?result=failure&${returnQuery}`
      },

      auto_return: 'approved'
    };

    const client = new MercadoPagoConfig({
      accessToken,
      options: {
        timeout: 10000
      }
    });

    const preference = new Preference(client);

    const result =
      await preference.create({
        body: preferenceBody,

        requestOptions: {
          idempotencyKey:
            order.id ||
            crypto.randomUUID()
        }
      });

    /*
      O ambiente de teste ou produção
      é definido pelo Access Token usado.
    */

    const checkoutUrl =
      result.init_point;

    if (!checkoutUrl) {
      throw new Error(
        'O Mercado Pago não retornou a URL do pagamento.'
      );
    }

    await supabase
      .from('orders')
      .update({
        preference_id: result.id,
        checkout_url: checkoutUrl
      })
      .eq('id', order.id);

    return json(
      {
        orderId: order.id,
        orderNumber:
          order.order_number,
        publicToken:
          order.public_token,
        checkoutUrl
      },
      201
    );
  } catch (error) {
    const detail =
      error?.cause?.[0]?.description ||
      error?.message ||
      'Erro desconhecido';

    console.error(
      'create-checkout:',
      {
        detail,
        status: error?.status,
        cause: error?.cause
      }
    );

    return json(
      {
        error:
          `Não foi possível iniciar o pagamento: ${detail}`
      },
      500
    );
  }
}
