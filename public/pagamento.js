const params = new URLSearchParams(location.search);
const order = params.get('order');
const token = params.get('token');
const result = params.get('result');
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const qs = selector => document.querySelector(selector);
const paymentLabels = { pending:'Aguardando pagamento', in_process:'Em processamento', approved:'Aprovado', approved_stock_issue:'Aprovado — loja revisando estoque', rejected:'Recusado', cancelled:'Cancelado', refunded:'Reembolsado', charged_back:'Contestado', review:'Em revisão', error:'Erro na cobrança' };
if (order && token) { const track=qs('#trackOrder'); track.href=`pedido.html?order=${encodeURIComponent(order)}&token=${encodeURIComponent(token)}`; track.classList.remove('hidden'); }
function updateVisual(data){
  qs('#orderNumber').textContent=data.order_number?`#${data.order_number}`:'—'; qs('#orderTotal').textContent=money(data.total); qs('#paymentStatus').textContent=paymentLabels[data.payment_status]||data.payment_status;
  const icon=qs('#statusIcon');
  if(['approved','approved_stock_issue'].includes(data.payment_status)){ icon.className='icon success'; icon.textContent='✓'; qs('#statusTitle').textContent='Pagamento confirmado!'; qs('#statusMessage').textContent=data.payment_status==='approved_stock_issue'?'O pagamento foi aprovado. A loja fará uma conferência manual do estoque antes da separação.':'Seu pedido foi recebido. Você já pode acompanhar cada etapa até a entrega.'; localStorage.removeItem('loja-demo-cart'); localStorage.removeItem('loja-demo-pending-order'); return true; }
  if(['rejected','cancelled','error'].includes(data.payment_status)||result==='failure'){ icon.className='icon failure'; icon.textContent='×'; qs('#statusTitle').textContent='Pagamento não concluído'; qs('#statusMessage').textContent='O pagamento não foi aprovado. Você pode voltar à loja e tentar novamente.'; return true; }
  icon.className='icon pending'; icon.textContent='…'; qs('#statusTitle').textContent=result==='pending'?'Pagamento pendente':'Confirmando pagamento'; qs('#statusMessage').textContent='A confirmação ainda está sendo processada pelo Mercado Pago. Esta página será atualizada automaticamente.'; return false;
}
async function checkStatus(){ if(!order||!token){qs('#statusTitle').textContent='Pedido não identificado';qs('#statusMessage').textContent='Não recebemos os dados necessários para consultar o pedido.';return true;} const response=await fetch(`/api/order-status?order=${encodeURIComponent(order)}&token=${encodeURIComponent(token)}`,{cache:'no-store'}); const data=await response.json(); if(!response.ok) throw new Error(data.error||'Não foi possível consultar o pedido.'); return updateVisual(data); }
(async()=>{try{for(let attempt=0;attempt<8;attempt+=1){const finished=await checkStatus();if(finished)return;await new Promise(resolve=>setTimeout(resolve,3000));}qs('#statusMessage').textContent='O pagamento ainda está em processamento. Você pode acompanhar o pedido pelo botão abaixo; o sistema será atualizado assim que o Mercado Pago confirmar.';}catch(error){qs('#statusIcon').className='icon failure';qs('#statusIcon').textContent='!';qs('#statusTitle').textContent='Não foi possível consultar';qs('#statusMessage').textContent=error.message;}})();
