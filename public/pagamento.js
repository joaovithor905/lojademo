const params =
  new URLSearchParams(location.search);

const order = params.get('order');
const token = params.get('token');
const result = params.get('result');

const paymentId =
  params.get('payment_id') ||
  params.get('collection_id');

const money = value =>
  new Intl.NumberFormat(
    'pt-BR',
    {
      style: 'currency',
      currency: 'BRL'
    }
  ).format(Number(value || 0));

const qs = selector =>
  document.querySelector(selector);

const paymentLabels = {
  pending: 'Aguardando pagamento',
  in_process: 'Em processamento',
  approved: 'Aprovado',
  approved_stock_issue:
    'Aprovado — conferindo estoque',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
  charged_back: 'Contestado',
  review: 'Em conferência',
  error: 'Erro na cobrança'
};

if (order && token) {
  const track = qs('#trackOrder');
  track.href =
    `pedido.html?order=${
      encodeURIComponent(order)
    }&token=${
      encodeURIComponent(token)
    }`;

  track.classList.remove('hidden');
}

function clearCompletedCart() {
  [
    'loja-demo-cart',
    'loja-demo-pending-order',
    'vitta-cart',
    'vitta-pending-order'
  ].forEach(key =>
    localStorage.removeItem(key)
  );
}

function updateVisual(data) {
  qs('#orderNumber').textContent =
    data.order_number
      ? `#${data.order_number}`
      : '—';

  qs('#orderTotal').textContent =
    money(data.total);

  qs('#paymentStatus').textContent =
    paymentLabels[
      data.payment_status
    ] ||
    data.payment_status ||
    'Consultando';

  const icon = qs('#statusIcon');

  if (
    [
      'approved',
      'approved_stock_issue'
    ].includes(
      data.payment_status
    )
  ) {
    icon.className =
      'icon success';

    icon.textContent = '✓';

    qs('#statusTitle').textContent =
      'Pagamento confirmado!';

    qs('#statusMessage').textContent =
      data.payment_status ===
      'approved_stock_issue'
        ? 'O pagamento foi aprovado. A loja fará uma conferência do estoque antes da separação.'
        : 'Seu pedido foi recebido e já pode seguir para separação.';

    clearCompletedCart();
    return true;
  }

  if (
    data.payment_status === 'review'
  ) {
    icon.className =
      'icon pending';

    icon.textContent = '…';

    qs('#statusTitle').textContent =
      'Pagamento recebido';

    qs('#statusMessage').textContent =
      'O Mercado Pago informou o pagamento e o sistema está concluindo a conferência. Esta página será atualizada automaticamente.';

    return false;
  }

  if (
    [
      'rejected',
      'cancelled',
      'error'
    ].includes(
      data.payment_status
    ) ||
    result === 'failure'
  ) {
    icon.className =
      'icon failure';

    icon.textContent = '×';

    qs('#statusTitle').textContent =
      'Pagamento não concluído';

    qs('#statusMessage').textContent =
      'O pagamento não foi aprovado. Você pode voltar à loja e tentar novamente.';

    return true;
  }

  icon.className =
    'icon pending';

  icon.textContent = '…';

  qs('#statusTitle').textContent =
    result === 'pending'
      ? 'Pagamento pendente'
      : 'Confirmando pagamento';

  qs('#statusMessage').textContent =
    'A confirmação ainda está sendo processada pelo Mercado Pago. Esta página será atualizada automaticamente.';

  return false;
}

async function reconcilePayment() {
  if (
    !order ||
    !token ||
    !paymentId
  ) {
    return;
  }

  const response =
    await fetch(
      '/api/reconcile-payment',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json'
        },
        body: JSON.stringify({
          orderId: order,
          publicToken: token,
          paymentId
        })
      }
    );

  if (!response.ok) {
    const data =
      await response
        .json()
        .catch(() => ({}));

    throw new Error(
      data.error ||
      'Não foi possível conferir o pagamento.'
    );
  }
}

async function checkStatus() {
  if (!order || !token) {
    qs('#statusTitle').textContent =
      'Pedido não identificado';

    qs('#statusMessage').textContent =
      'Não recebemos os dados necessários para consultar o pedido.';

    return true;
  }

  const response =
    await fetch(
      `/api/order-status?order=${
        encodeURIComponent(order)
      }&token=${
        encodeURIComponent(token)
      }`,
      {
        cache: 'no-store'
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
      'Não foi possível consultar o pedido.'
    );
  }

  return updateVisual(data);
}

async function runStatusCheck() {
  try {
    await reconcilePayment()
      .catch(error => {
        console.warn(
          'Conferência complementar:',
          error.message
        );
      });

    for (
      let attempt = 0;
      attempt < 40;
      attempt += 1
    ) {
      const finished =
        await checkStatus();

      if (finished) return;

      await new Promise(
        resolve =>
          setTimeout(resolve, 3000)
      );

      if (
        attempt === 9 &&
        paymentId
      ) {
        await reconcilePayment()
          .catch(() => {});
      }
    }

    qs('#statusMessage').textContent =
      'O pagamento ainda está sendo confirmado. Use o botão de atualização ou acompanhe o pedido pelo link abaixo.';
  } catch (error) {
    qs('#statusIcon').className =
      'icon failure';

    qs('#statusIcon').textContent =
      '!';

    qs('#statusTitle').textContent =
      'Não foi possível consultar';

    qs('#statusMessage').textContent =
      error.message;
  }
}

const retryButton =
  qs('#retryStatus');

if (retryButton) {
  retryButton.addEventListener(
    'click',
    async () => {
      retryButton.disabled = true;
      retryButton.textContent =
        'Atualizando...';

      try {
        await reconcilePayment()
          .catch(() => {});

        await checkStatus();
      } catch (error) {
        qs('#statusMessage')
          .textContent = error.message;
      } finally {
        retryButton.disabled = false;
        retryButton.textContent =
          'Atualizar confirmação';
      }
    }
  );
}

runStatusCheck();
