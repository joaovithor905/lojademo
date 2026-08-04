import {
  MercadoPagoConfig,
  Payment
} from 'mercadopago';
import {
  cleanText,
  getSupabaseAdmin,
  json,
  roundMoney
} from './lib.mjs';

function getPaidAmount(payment) {
  const transactionAmount = Number(
    payment.transaction_amount || 0
  );
  const shippingAmount = Number(
    payment.shipping_amount || 0
  );
  const totalPaidAmount = Number(
    payment.transaction_details?.total_paid_amount || 0
  );

  return roundMoney(
    totalPaidAmount > 0
      ? totalPaidAmount
      : transactionAmount + shippingAmount
  );
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json(
      { error: 'Método não permitido.' },
      405
    );
  }

  try {
    const input = await request.json();
    const orderId = cleanText(input.orderId, 80);
    const publicToken = cleanText(
      input.publicToken,
      120
    );
    const paymentId = cleanText(
      input.paymentId,
      80
    );

    if (
      !orderId ||
      !publicToken ||
      !paymentId
    ) {
      return json(
        {
          error:
            'Dados de confirmação incompletos.'
        },
        400
      );
    }

    const accessToken =
      process.env.MP_ACCESS_TOKEN;

    if (!accessToken) {
      return json(
        {
          error:
            'Mercado Pago não configurado.'
        },
        500
      );
    }

    const supabase = getSupabaseAdmin();

    const {
      data: order,
      error: orderError
    } = await supabase
      .from('orders')
      .select(
        'id,total,public_token,payment_status,status'
      )
      .eq('id', orderId)
      .eq('public_token', publicToken)
      .maybeSingle();

    if (orderError) throw orderError;

    if (!order) {
      return json(
        { error: 'Pedido não encontrado.' },
        404
      );
    }

    if (
      order.payment_status === 'approved' ||
      order.payment_status ===
        'approved_stock_issue'
    ) {
      return json({
        confirmed: true,
        paymentStatus:
          order.payment_status,
        orderStatus: order.status
      });
    }

    const client =
      new MercadoPagoConfig({
        accessToken,
        options: { timeout: 10000 }
      });

    const paymentClient =
      new Payment(client);

    const payment =
      await paymentClient.get({
        id: String(paymentId)
      });

    const paymentOrderId =
      payment.external_reference ||
      payment.metadata?.order_id;

    if (
      String(paymentOrderId || '') !==
      String(order.id)
    ) {
      return json(
        {
          error:
            'O pagamento não pertence a este pedido.'
        },
        409
      );
    }

    const receivedAmount =
      getPaidAmount(payment);

    const orderTotal =
      roundMoney(order.total);

    if (
      Math.abs(
        receivedAmount - orderTotal
      ) > 0.01
    ) {
      await supabase
        .from('orders')
        .update({
          payment_status: 'review',
          payment_id:
            String(payment.id),
          payment_method:
            payment.payment_method_id ||
            payment.payment_type_id ||
            null
        })
        .eq('id', order.id);

      return json({
        confirmed: false,
        review: true,
        paymentStatus: 'review'
      });
    }

    if (payment.status === 'approved') {
      const { error: rpcError } =
        await supabase.rpc(
          'confirm_order_payment',
          {
            p_order_id: order.id,
            p_payment_id:
              String(payment.id),
            p_payment_method:
              payment.payment_method_id ||
              payment.payment_type_id ||
              'Mercado Pago',
            p_paid_at:
              payment.date_approved ||
              new Date().toISOString()
          }
        );

      if (rpcError) throw rpcError;

      return json({
        confirmed: true,
        paymentStatus: 'approved',
        orderStatus: 'paid'
      });
    }

    const mapping = {
      pending: [
        'in_process',
        'pending_payment'
      ],
      in_process: [
        'in_process',
        'pending_payment'
      ],
      authorized: [
        'in_process',
        'pending_payment'
      ],
      rejected: [
        'rejected',
        'payment_failed'
      ],
      cancelled: [
        'cancelled',
        'cancelled'
      ],
      refunded: [
        'refunded',
        'refunded'
      ],
      partially_refunded: [
        'refunded',
        'refunded'
      ],
      charged_back: [
        'charged_back',
        'refunded'
      ]
    };

    const [
      paymentStatus,
      orderStatus
    ] =
      mapping[payment.status] ||
      ['review', 'pending_payment'];

    await supabase
      .from('orders')
      .update({
        payment_status: paymentStatus,
        status: orderStatus,
        payment_id: String(payment.id),
        payment_method:
          payment.payment_method_id ||
          payment.payment_type_id ||
          null
      })
      .eq('id', order.id);

    return json({
      confirmed: false,
      paymentStatus,
      orderStatus
    });
  } catch (error) {
    console.error(
      'reconcile-payment:',
      error
    );

    return json(
      {
        error:
          'Não foi possível confirmar o pagamento.'
      },
      500
    );
  }
}
