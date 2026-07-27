import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CONFIG = window.VITTA_CONFIG || {};
const configured = CONFIG.supabaseUrl?.startsWith('https://') && !CONFIG.supabaseUrl.includes('COLE_AQUI') && CONFIG.supabaseAnonKey && !CONFIG.supabaseAnonKey.includes('COLE_AQUI');
const supabase = configured ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : null;

let orders = [];
let products = [];
let reportData = { summary: {}, orders: [] };
let realtimeChannel;

const qs = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const statusLabel = {
  pending_payment: 'Aguardando pagamento',
  paid: 'Pago',
  separating: 'Em separação',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  payment_failed: 'Pagamento recusado',
  stock_issue: 'Problema de estoque',
  refunded: 'Reembolsado'
};
const paymentLabel = {
  pending: 'Pagamento pendente', in_process: 'Em processamento', approved: 'Pagamento aprovado',
  approved_stock_issue: 'Pago — revisar estoque', rejected: 'Pagamento recusado', cancelled: 'Pagamento cancelado',
  refunded: 'Reembolsado', charged_back: 'Contestado', review: 'Revisão necessária', error: 'Erro na cobrança'
};

function showToast(message) {
  const element = qs('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3000);
}

async function init() {
  if (!configured) {
    showToast('Configure o Supabase no Netlify antes de usar o painel.');
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  setAuthenticated(Boolean(session));
  if (session) await startAdmin();

  supabase.auth.onAuthStateChange(async (_event, newSession) => {
    setAuthenticated(Boolean(newSession));
    if (newSession) await startAdmin();
    else stopRealtime();
  });
}

function setAuthenticated(isAuthenticated) {
  qs('#loginScreen').classList.toggle('hidden', isAuthenticated);
  qs('#adminApp').classList.toggle('hidden', !isAuthenticated);
}

async function startAdmin() {
  await loadAll();
  subscribeRealtime();
}

async function loadAll() {
  const [ordersResult, productsResult] = await Promise.all([
    supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }),
    supabase.from('products').select('*').order('created_at', { ascending: false })
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (productsResult.error) throw productsResult.error;
  orders = ordersResult.data || [];
  products = productsResult.data || [];
  renderDashboard();
  renderOrders();
  renderProducts();
  generateReport();
}

function renderDashboard() {
  const paid = orders.filter(order => order.payment_status === 'approved' || order.payment_status === 'approved_stock_issue');
  qs('#statPending').textContent = orders.filter(order => ['pending', 'in_process'].includes(order.payment_status)).length;
  qs('#statPaid').textContent = paid.length;
  qs('#statRevenue').textContent = money(paid.reduce((sum, order) => sum + Number(order.total), 0));
  qs('#statProducts').textContent = products.filter(product => product.active).length;
  qs('#recentOrders').innerHTML = orders.slice(0, 6).map(order => `
    <tr><td>#${order.order_number}</td><td>${escapeHtml(order.customer_name)}</td><td>${dateTime(order.created_at)}</td><td>${money(order.total)}</td><td><span class="status ${order.status}">${statusLabel[order.status] || order.status}</span></td></tr>`).join('') || '<tr><td colspan="5">Nenhum pedido registrado.</td></tr>';
}

function workflowOptions(order) {
  if (order.payment_status === 'approved') return ['paid', 'separating', 'out_for_delivery', 'completed', 'cancelled'];
  if (order.payment_status === 'approved_stock_issue') return ['stock_issue', 'cancelled'];
  if (order.payment_status === 'refunded' || order.payment_status === 'charged_back') return ['refunded'];
  if (order.payment_status === 'rejected') return ['payment_failed', 'cancelled'];
  return ['pending_payment', 'cancelled'];
}

function renderOrders() {
  const filter = qs('#orderStatusFilter').value;
  const list = filter ? orders.filter(order => order.status === filter) : orders;
  qs('#ordersList').innerHTML = list.map(order => `
    <article class="order-card">
      <div class="order-top">
        <div><span class="eyebrow">Pedido #${order.order_number}</span><h3>${escapeHtml(order.customer_name)}</h3>
          <div class="order-meta">Criado em ${dateTime(order.created_at)} ${order.payment_date ? `· Pago em ${dateTime(order.payment_date)}` : ''}</div>
          <div class="payment-line"><span class="payment-chip">${paymentLabel[order.payment_status] || order.payment_status}</span>${order.payment_method ? `<span class="payment-chip">${escapeHtml(order.payment_method)}</span>` : ''}</div>
        </div>
        <span class="status ${order.status}">${statusLabel[order.status] || order.status}</span>
      </div>
      <div class="order-items">
        ${(order.order_items || []).map(item => `<div><span>${item.quantity}x ${escapeHtml(item.product_name)} · Tam. ${escapeHtml(item.size)}</span><strong>${money(item.line_total)}</strong></div>`).join('')}
        <div><span>Entrega</span><strong>${money(order.delivery_fee)}</strong></div>
        <div><strong>Total</strong><strong>${money(order.total)}</strong></div>
      </div>
      <div class="order-footer">
        <div class="order-customer"><strong>${escapeHtml(order.customer_phone)}</strong><br>${escapeHtml(order.customer_email)}<br>${escapeHtml(order.address)} - ${escapeHtml(order.neighborhood)}<br>Rio Verde - GO${order.notes ? `<br>Obs.: ${escapeHtml(order.notes)}` : ''}</div>
        <div class="order-actions"><select onchange="updateOrderStatus('${order.id}',this.value)">${workflowOptions(order).map(value => `<option value="${value}" ${order.status === value ? 'selected' : ''}>${statusLabel[value]}</option>`).join('')}</select></div>
      </div>
    </article>`).join('') || '<div class="panel">Nenhum pedido encontrado.</div>';
}

function renderProducts() {
  qs('#adminProducts').innerHTML = products.map(product => {
    const stock = Object.values(product.stock_by_size || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    return `<article class="admin-product ${product.active ? '' : 'paused'}">
      <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">
      <div class="admin-product-content"><span class="eyebrow">${escapeHtml(product.category)} · Estoque ${stock}</span><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p>
        <div class="image-preview-note">${Object.entries(product.stock_by_size || {}).map(([size, qty]) => `${escapeHtml(size)}: ${qty}`).join(' · ')}</div>
        <div class="admin-product-footer"><strong>${money(product.price)}</strong><div class="product-actions"><button class="small-button" onclick="toggleProduct('${product.id}',${!product.active})">${product.active ? 'Pausar' : 'Reativar'}</button><button class="small-button danger" onclick="deleteProduct('${product.id}')">Excluir</button></div></div>
      </div>
    </article>`;
  }).join('') || '<div class="panel">Nenhum produto cadastrado.</div>';
}

async function updateOrderStatus(id, status) {
  const { error } = await supabase.from('orders').update({ status }).eq('id', id);
  if (error) return showToast(error.message);
  showToast('Andamento do pedido atualizado.');
  await loadAll();
}

async function toggleProduct(id, active) {
  const { error } = await supabase.from('products').update({ active }).eq('id', id);
  if (error) return showToast(error.message);
  showToast(active ? 'Anúncio reativado.' : 'Anúncio pausado.');
  await loadAll();
}

async function deleteProduct(id) {
  if (!confirm('Excluir este anúncio? Produtos já vendidos serão apenas pausados para preservar o histórico.')) return;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) {
    const fallback = await supabase.from('products').update({ active: false }).eq('id', id);
    if (fallback.error) return showToast(fallback.error.message);
    showToast('O produto possui histórico de vendas e foi arquivado.');
  } else {
    showToast('Anúncio excluído.');
  }
  await loadAll();
}

function generateReport() {
  const from = qs('#reportFrom').value;
  const to = qs('#reportTo').value;
  const start = from ? new Date(`${from}T00:00:00-03:00`) : null;
  const end = to ? new Date(`${to}T23:59:59-03:00`) : null;
  const paidOrders = orders.filter(order => {
    if (!['approved', 'approved_stock_issue'].includes(order.payment_status) || !order.payment_date) return false;
    const date = new Date(order.payment_date);
    return (!start || date >= start) && (!end || date <= end);
  });
  const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const totalItems = paidOrders.reduce((sum, order) => sum + (order.order_items || []).reduce((subtotal, item) => subtotal + Number(item.quantity), 0), 0);
  reportData = {
    summary: { paidOrders: paidOrders.length, totalRevenue, totalItems, averageTicket: paidOrders.length ? totalRevenue / paidOrders.length : 0 },
    orders: paidOrders
  };
  qs('#reportPaidOrders').textContent = reportData.summary.paidOrders;
  qs('#reportRevenue').textContent = money(reportData.summary.totalRevenue);
  qs('#reportItems').textContent = reportData.summary.totalItems;
  qs('#reportAverage').textContent = money(reportData.summary.averageTicket);
  qs('#reportTable').innerHTML = paidOrders.map(order => `<tr><td>${dateTime(order.payment_date)}</td><td>#${order.order_number}</td><td>${escapeHtml(order.customer_name)}</td><td>${(order.order_items || []).reduce((sum, item) => sum + Number(item.quantity), 0)}</td><td>${money(order.total)}</td></tr>`).join('') || '<tr><td colspan="5">Nenhum pagamento no período.</td></tr>';
}

function exportCsv() {
  if (!reportData.orders.length) return showToast('Não há vendas para exportar.');
  const rows = [
    ['Data do pagamento', 'Pedido', 'Cliente', 'E-mail', 'Telefone', 'Itens', 'Subtotal', 'Entrega', 'Total', 'ID Mercado Pago'],
    ...reportData.orders.map(order => [dateTime(order.payment_date), order.order_number, order.customer_name, order.customer_email, order.customer_phone, (order.order_items || []).map(item => `${item.quantity}x ${item.product_name} Tam ${item.size}`).join(' | '), order.subtotal, order.delivery_fee, order.total, order.payment_id || ''])
  ];
  const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `relatorio-vitta-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function parseStock(text, sizes) {
  const result = {};
  for (const part of String(text).split(',')) {
    const [rawSize, rawQty] = part.split(':');
    const size = rawSize?.trim();
    const qty = Number.parseInt(rawQty, 10);
    if (size && Number.isInteger(qty) && qty >= 0) result[size] = qty;
  }
  for (const size of sizes) if (!(size in result)) result[size] = 0;
  return result;
}

async function uploadImage(file) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('product-images').upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

qs('#productForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = qs('#publishButton');
  button.disabled = true;
  button.textContent = 'Publicando...';
  try {
    const form = new FormData(event.target);
    const sizes = String(form.get('sizes')).split(',').map(value => value.trim()).filter(Boolean);
    if (!sizes.length) throw new Error('Informe ao menos um tamanho.');
    const stockBySize = parseStock(form.get('stock'), sizes);
    const file = form.get('imageFile');
    let imageUrl = String(form.get('imageUrl') || '').trim();
    if (file instanceof File && file.size) imageUrl = await uploadImage(file);
    if (!imageUrl) throw new Error('Envie uma foto ou informe a URL da imagem.');

    const payload = {
      name: String(form.get('name')).trim(),
      category: form.get('category'),
      price: Number(form.get('price')),
      sizes,
      stock_by_size: stockBySize,
      image_url: imageUrl,
      description: String(form.get('description')).trim(),
      active: true,
      featured: form.get('featured') === 'on'
    };
    const { error } = await supabase.from('products').insert(payload);
    if (error) throw error;
    event.target.reset();
    qs('#productModal').classList.add('hidden');
    showToast('Novo anúncio publicado.');
    await loadAll();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Publicar anúncio';
  }
});

function subscribeRealtime() {
  stopRealtime();
  realtimeChannel = supabase.channel('admin-orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async payload => {
      showToast(payload.eventType === 'INSERT' ? 'Novo pedido recebido.' : 'Pedido atualizado.');
      await loadAll();
    })
    .subscribe();
}
function stopRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

qs('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase) return showToast('Supabase não configurado.');
  const form = new FormData(event.target);
  const button = qs('#loginButton');
  button.disabled = true;
  button.textContent = 'Entrando...';
  const { error } = await supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
  if (error) showToast('E-mail ou senha inválidos.');
  button.disabled = false;
  button.textContent = 'Entrar';
});
qs('#logoutButton').onclick = () => supabase.auth.signOut();

document.querySelectorAll('.nav-item').forEach(button => button.onclick = () => switchView(button.dataset.view));
document.querySelectorAll('[data-go]').forEach(button => button.onclick = () => switchView(button.dataset.go));
function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view').forEach(element => element.classList.remove('active'));
  qs(`#${view}View`).classList.add('active');
  qs('#pageTitle').textContent = { dashboard: 'Visão geral', orders: 'Pedidos', products: 'Produtos', reports: 'Relatórios' }[view];
}

qs('#orderStatusFilter').onchange = renderOrders;
qs('#refreshOrders').onclick = () => loadAll().catch(error => showToast(error.message));
qs('#generateReport').onclick = generateReport;
qs('#exportCsv').onclick = exportCsv;
qs('#openProductModal').onclick = () => qs('#productModal').classList.remove('hidden');
qs('#closeProductModal').onclick = () => qs('#productModal').classList.add('hidden');
qs('#productModal').onclick = event => { if (event.target.id === 'productModal') event.currentTarget.classList.add('hidden'); };
qs('#today').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date());

window.updateOrderStatus = updateOrderStatus;
window.toggleProduct = toggleProduct;
window.deleteProduct = deleteProduct;

init().catch(error => {
  console.error(error);
  showToast(error.message || 'Não foi possível abrir o painel.');
});
