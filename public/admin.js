import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CONFIG = window.VITTA_CONFIG || {};
const configured = CONFIG.supabaseUrl?.startsWith('https://') && !CONFIG.supabaseUrl.includes('COLE_AQUI') && CONFIG.supabaseAnonKey && !CONFIG.supabaseAnonKey.includes('COLE_AQUI');
const supabase = configured ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : null;

let orders = [];
let products = [];
let coupons = [];
let reportData = { summary: {}, orders: [] };
let realtimeChannel;
let editingProductId = null;
let editingCouponId = null;

const qs = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const dateOnly = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value)) : 'Sem validade';
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const productImages = product => {
  const images = Array.isArray(product?.image_urls) ? product.image_urls.filter(Boolean) : [];
  if (product?.image_url && !images.includes(product.image_url)) images.unshift(product.image_url);
  return images;
};
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
  pending: 'Pagamento pendente',
  in_process: 'Em processamento',
  approved: 'Pagamento aprovado',
  approved_stock_issue: 'Pago — revisar estoque',
  rejected: 'Pagamento recusado',
  cancelled: 'Pagamento cancelado',
  refunded: 'Reembolsado',
  charged_back: 'Contestado',
  review: 'Revisão necessária',
  error: 'Erro na cobrança'
};

function showToast(message) {
  const element = qs('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3200);
}

function normalizeWhatsApp(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55')) digits = `55${digits}`;
  return digits;
}

function whatsappUrl(order) {
  const phone = normalizeWhatsApp(order.customer_phone);
  if (!phone) return '#';
  const firstName = String(order.customer_name || '').trim().split(/\s+/)[0] || 'cliente';
  const status = statusLabel[order.status] || order.status;
  const message = `Olá, ${firstName}! Aqui é da Vitta Fit Wear. Estou entrando em contato sobre o seu pedido #${order.order_number}, que está como “${status}”.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
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
  const [ordersResult, productsResult, couponsResult] = await Promise.all([
    supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }),
    supabase.from('products').select('*').order('created_at', { ascending: false }),
    supabase.from('coupons').select('*').order('created_at', { ascending: false })
  ]);

  if (ordersResult.error) throw ordersResult.error;
  if (productsResult.error) throw productsResult.error;
  if (couponsResult.error) throw couponsResult.error;

  orders = ordersResult.data || [];
  products = productsResult.data || [];
  coupons = couponsResult.data || [];

  renderDashboard();
  renderOrders();
  renderProducts();
  renderCoupons();
  generateReport();
}

function renderDashboard() {
  const paid = orders.filter(order => ['approved', 'approved_stock_issue'].includes(order.payment_status));
  qs('#statPending').textContent = orders.filter(order => ['pending', 'in_process'].includes(order.payment_status)).length;
  qs('#statPaid').textContent = paid.length;
  qs('#statRevenue').textContent = money(paid.reduce((sum, order) => sum + Number(order.total), 0));
  qs('#statProducts').textContent = products.filter(product => product.active).length;

  qs('#recentOrders').innerHTML = orders.slice(0, 6).map(order => `
    <tr>
      <td>#${order.order_number}</td>
      <td>${escapeHtml(order.customer_name)}</td>
      <td>${dateTime(order.created_at)}</td>
      <td>${money(order.total)}</td>
      <td><span class="status ${order.status}">${statusLabel[order.status] || order.status}</span></td>
    </tr>`).join('') || '<tr><td colspan="5">Nenhum pedido registrado.</td></tr>';

  const activeProducts = products.filter(product => product.active);
  qs('#featuredProducts').innerHTML = activeProducts.map(product => `
    <div class="featured-item">
      <img src="${escapeHtml(productImages(product)[0] || product.image_url)}" alt="${escapeHtml(product.name)}">
      <div><strong>${escapeHtml(product.name)}</strong><small>${product.featured ? 'Aparece primeiro na vitrine' : 'Produto comum'}</small></div>
      <button class="feature-toggle ${product.featured ? 'active' : ''}" onclick="toggleFeatured('${product.id}', ${!product.featured})">${product.featured ? 'Em destaque' : 'Destacar'}</button>
    </div>`).join('') || '<p class="empty-copy">Nenhum produto ativo.</p>';
}

function workflowOptions(order) {
  if (order.payment_status === 'approved') return ['paid', 'separating', 'out_for_delivery', 'completed', 'cancelled'];
  if (order.payment_status === 'approved_stock_issue') return ['stock_issue', 'cancelled'];
  if (['refunded', 'charged_back'].includes(order.payment_status)) return ['refunded'];
  if (order.payment_status === 'rejected') return ['payment_failed', 'cancelled'];
  return ['pending_payment', 'cancelled'];
}

function renderOrders() {
  const filter = qs('#orderStatusFilter').value;
  const list = filter ? orders.filter(order => order.status === filter) : orders;

  qs('#ordersList').innerHTML = list.map(order => `
    <article class="order-card">
      <div class="order-top">
        <div>
          <span class="eyebrow">Pedido #${order.order_number}</span>
          <h3>${escapeHtml(order.customer_name)}</h3>
          <div class="order-meta">Criado em ${dateTime(order.created_at)} ${order.payment_date ? `· Pago em ${dateTime(order.payment_date)}` : ''}</div>
          <div class="payment-line">
            <span class="payment-chip">${paymentLabel[order.payment_status] || order.payment_status}</span>
            ${order.payment_method ? `<span class="payment-chip">${escapeHtml(order.payment_method)}</span>` : ''}
            ${order.coupon_code ? `<span class="payment-chip coupon-chip">Cupom ${escapeHtml(order.coupon_code)} · -${money(order.discount_amount)}</span>` : ''}
            ${order.whatsapp_opt_in ? `<span class="payment-chip whatsapp-auto-chip">${order.whatsapp_payment_sent_at ? 'WhatsApp automático enviado' : order.whatsapp_last_error ? 'WhatsApp automático pendente' : 'WhatsApp automático autorizado'}</span>` : ''}
          </div>
        </div>
        <span class="status ${order.status}">${statusLabel[order.status] || order.status}</span>
      </div>
      <div class="order-items">
        ${(order.order_items || []).map(item => `<div><span>${item.quantity}x ${escapeHtml(item.product_name)} · Tam. ${escapeHtml(item.size)}</span><strong>${money(item.line_total)}</strong></div>`).join('')}
        <div><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div>
        ${Number(order.discount_amount || 0) > 0 ? `<div class="order-discount"><span>Desconto</span><strong>- ${money(order.discount_amount)}</strong></div>` : ''}
        <div><span>Entrega</span><strong>${money(order.delivery_fee)}</strong></div>
        <div><strong>Total</strong><strong>${money(order.total)}</strong></div>
      </div>
      <div class="order-footer">
        <div class="order-customer"><strong>${escapeHtml(order.customer_phone)}</strong><br>${escapeHtml(order.customer_email)}<br>${escapeHtml(order.address)} - ${escapeHtml(order.neighborhood)}<br>Rio Verde - GO${order.notes ? `<br>Obs.: ${escapeHtml(order.notes)}` : ''}</div>
        <div class="order-actions">
          <a class="whatsapp-order" href="${whatsappUrl(order)}" target="_blank" rel="noopener"><img src="https://cdn.simpleicons.org/whatsapp/FFFFFF" alt="">Falar no WhatsApp</a>
          <select onchange="updateOrderStatus('${order.id}',this.value)">${workflowOptions(order).map(value => `<option value="${value}" ${order.status === value ? 'selected' : ''}>${statusLabel[value]}</option>`).join('')}</select>
        </div>
      </div>
    </article>`).join('') || '<div class="panel">Nenhum pedido encontrado.</div>';
}

function renderProducts() {
  qs('#adminProducts').innerHTML = products.map(product => {
    const stock = Object.values(product.stock_by_size || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const images = productImages(product);
    return `
      <article class="admin-product ${product.active ? '' : 'paused'}">
        <div class="admin-product-image">
          <img src="${escapeHtml(images[0] || product.image_url)}" alt="${escapeHtml(product.name)}">
          <span>${images.length || 1} foto${(images.length || 1) > 1 ? 's' : ''}</span>
        </div>
        <div class="admin-product-content">
          <div class="product-heading-row"><span class="eyebrow">${escapeHtml(product.category)} · Estoque ${stock}</span>${product.featured ? '<span class="featured-badge">Destaque</span>' : ''}</div>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description)}</p>
          <div class="image-preview-note">${Object.entries(product.stock_by_size || {}).map(([size, qty]) => `${escapeHtml(size)}: ${qty}`).join(' · ')}</div>
          <div class="admin-product-footer">
            <strong>${money(product.price)}</strong>
            <div class="product-actions">
              <button class="small-button" onclick="toggleFeatured('${product.id}', ${!product.featured})">${product.featured ? 'Remover destaque' : 'Destacar'}</button>
              <button class="small-button" onclick="openProductEditor('${product.id}')">Editar</button>
              <button class="small-button" onclick="toggleProduct('${product.id}', ${!product.active})">${product.active ? 'Pausar' : 'Reativar'}</button>
              <button class="small-button danger" onclick="deleteProduct('${product.id}')">Excluir</button>
            </div>
          </div>
        </div>
      </article>`;
  }).join('') || '<div class="panel">Nenhum produto cadastrado.</div>';
}

function renderCoupons() {
  qs('#adminCoupons').innerHTML = coupons.map(coupon => {
    const expired = coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now();
    const exhausted = coupon.usage_limit !== null && Number(coupon.times_used) >= Number(coupon.usage_limit);
    const active = coupon.active && !expired && !exhausted;
    const valueLabel = coupon.discount_type === 'percentage'
      ? `${Number(coupon.discount_value).toLocaleString('pt-BR')}%`
      : money(coupon.discount_value);
    const usageLabel = coupon.usage_limit === null
      ? `${coupon.times_used} uso(s) · ilimitado`
      : `${coupon.times_used} de ${coupon.usage_limit} uso(s)`;

    return `
      <article class="coupon-card ${active ? '' : 'coupon-inactive'}">
        <div class="coupon-code-row"><strong>${escapeHtml(coupon.code)}</strong><span class="status ${active ? 'paid' : 'cancelled'}">${active ? 'Ativo' : expired ? 'Expirado' : exhausted ? 'Esgotado' : 'Pausado'}</span></div>
        <div class="coupon-value">${valueLabel} OFF</div>
        <div class="coupon-details">
          <span>Compra mínima: ${money(coupon.minimum_order)}</span>
          <span>${coupon.max_discount ? `Desconto máximo: ${money(coupon.max_discount)}` : 'Sem teto adicional'}</span>
          <span>${usageLabel}</span>
          <span>Validade: ${dateOnly(coupon.expires_at)}</span>
        </div>
        <div class="coupon-actions">
          <button class="small-button" onclick="openCouponEditor('${coupon.id}')">Editar</button>
          <button class="small-button" onclick="toggleCoupon('${coupon.id}', ${!coupon.active})">${coupon.active ? 'Pausar' : 'Ativar'}</button>
          <button class="small-button danger" onclick="deleteCoupon('${coupon.id}')">Excluir</button>
        </div>
      </article>`;
  }).join('') || '<div class="panel">Nenhum cupom criado.</div>';
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

async function toggleFeatured(id, featured) {
  const { error } = await supabase.from('products').update({ featured }).eq('id', id);
  if (error) return showToast(error.message);
  showToast(featured ? 'Produto colocado em destaque.' : 'Produto removido dos destaques.');
  await loadAll();
}

async function deleteProduct(id) {
  if (!confirm('Excluir este anúncio? Produtos com histórico de venda serão apenas pausados.')) return;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) {
    const fallback = await supabase.from('products').update({ active: false }).eq('id', id);
    if (fallback.error) return showToast(fallback.error.message);
    showToast('O produto possui histórico e foi arquivado.');
  } else {
    showToast('Anúncio excluído.');
  }
  await loadAll();
}

function normalizeSizes(value) {
  return [...new Set(
    String(value)
      .split(',')
      .map(size => size.trim())
      .filter(Boolean)
  )];
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
  return Object.fromEntries(sizes.map(size => [size, result[size]]));
}

function applySizePreset(values) {
  const form = qs('#productForm');
  const sizes = normalizeSizes(values);
  const currentStock = {};

  for (const part of String(form.elements.stock.value || '').split(',')) {
    const [rawSize, rawQty] = part.split(':');
    const size = rawSize?.trim();
    const qty = Number.parseInt(rawQty, 10);
    if (size && Number.isInteger(qty) && qty >= 0) currentStock[size] = qty;
  }

  form.elements.sizes.value = sizes.join(', ');
  form.elements.stock.value = sizes.map(size => `${size}:${currentStock[size] ?? 0}`).join(', ');
  form.elements.stock.focus();
  showToast('Grade preenchida. Agora informe a quantidade de cada tamanho.');
}

async function uploadImage(file) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('product-images').upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

function openProductModal(productId = null) {
  editingProductId = productId;
  const form = qs('#productForm');
  form.reset();
  form.elements.productId.value = productId || '';
  qs('#existingImages').innerHTML = '';
  qs('#existingImagesWrap').classList.add('hidden');

  if (productId) {
    const product = products.find(item => item.id === productId);
    if (!product) return;
    form.elements.name.value = product.name;
    form.elements.category.value = product.category;
    form.elements.price.value = product.price;
    form.elements.sizes.value = (product.sizes || []).join(', ');
    form.elements.stock.value = Object.entries(product.stock_by_size || {}).map(([size, qty]) => `${size}:${qty}`).join(', ');
    form.elements.description.value = product.description;
    form.elements.featured.checked = Boolean(product.featured);
    qs('#productModalTitle').textContent = 'Editar anúncio';
    qs('#publishButton').textContent = 'Salvar alterações';

    const images = productImages(product);
    if (images.length) {
      qs('#existingImagesWrap').classList.remove('hidden');
      qs('#existingImages').innerHTML = images.map((url, index) => `
        <label class="existing-image">
          <img src="${escapeHtml(url)}" alt="Foto ${index + 1}">
          <span><input type="checkbox" name="removeImage" value="${escapeHtml(url)}"> Remover</span>
          ${index === 0 ? '<small>Capa atual</small>' : ''}
        </label>`).join('');
    }
  } else {
    qs('#productModalTitle').textContent = 'Novo anúncio';
    qs('#publishButton').textContent = 'Publicar anúncio';
  }

  qs('#productModal').classList.remove('hidden');
}

function closeProductModal() {
  editingProductId = null;
  qs('#productModal').classList.add('hidden');
}

qs('#productForm').addEventListener('submit', async event => {
  event.preventDefault();
  const wasEditing = Boolean(editingProductId);
  const button = qs('#publishButton');
  button.disabled = true;
  button.textContent = editingProductId ? 'Salvando...' : 'Publicando...';

  try {
    const form = new FormData(event.target);
    const sizes = normalizeSizes(form.get('sizes'));
    if (!sizes.length) throw new Error('Informe ao menos um tamanho.');

    const stockBySize = parseStock(form.get('stock'), sizes);
    const currentProduct = editingProductId ? products.find(item => item.id === editingProductId) : null;
    const removedImages = form.getAll('removeImage').map(String);
    const existingImages = currentProduct
      ? productImages(currentProduct).filter(url => !removedImages.includes(url))
      : [];

    const files = Array.from(form.getAll('imageFiles')).filter(file => file instanceof File && file.size);
    const uploadedImages = [];
    for (const file of files) uploadedImages.push(await uploadImage(file));

    const typedUrls = String(form.get('imageUrls') || '')
      .split(/\n|,/)
      .map(value => value.trim())
      .filter(Boolean);

    const imageUrls = [...new Set([...existingImages, ...uploadedImages, ...typedUrls])];
    if (!imageUrls.length) throw new Error('O produto precisa ter pelo menos uma foto.');

    const payload = {
      name: String(form.get('name')).trim(),
      category: form.get('category'),
      price: Number(form.get('price')),
      sizes,
      stock_by_size: stockBySize,
      image_url: imageUrls[0],
      image_urls: imageUrls,
      description: String(form.get('description')).trim(),
      featured: form.get('featured') === 'on'
    };

    const query = editingProductId
      ? supabase.from('products').update(payload).eq('id', editingProductId)
      : supabase.from('products').insert({ ...payload, active: true });

    const { error } = await query;
    if (error) throw error;

    showToast(wasEditing ? 'Produto atualizado.' : 'Novo anúncio publicado.');
    closeProductModal();
    await loadAll();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = wasEditing ? 'Salvar alterações' : 'Publicar anúncio';
  }
});

function openCouponModal(couponId = null) {
  editingCouponId = couponId;
  const form = qs('#couponForm');
  form.reset();
  form.elements.active.checked = true;
  form.elements.couponId.value = couponId || '';

  if (couponId) {
    const coupon = coupons.find(item => item.id === couponId);
    if (!coupon) return;
    form.elements.code.value = coupon.code;
    form.elements.discountType.value = coupon.discount_type;
    form.elements.discountValue.value = coupon.discount_value;
    form.elements.minimumOrder.value = coupon.minimum_order || 0;
    form.elements.maxDiscount.value = coupon.max_discount ?? '';
    form.elements.usageLimit.value = coupon.usage_limit ?? '';
    form.elements.expiresAt.value = coupon.expires_at ? new Date(coupon.expires_at).toISOString().slice(0, 10) : '';
    form.elements.active.checked = Boolean(coupon.active);
    qs('#couponModalTitle').textContent = 'Editar cupom';
    qs('#saveCouponButton').textContent = 'Salvar alterações';
  } else {
    qs('#couponModalTitle').textContent = 'Novo cupom';
    qs('#saveCouponButton').textContent = 'Criar cupom';
  }

  qs('#couponModal').classList.remove('hidden');
}

function closeCouponModal() {
  editingCouponId = null;
  qs('#couponModal').classList.add('hidden');
}

qs('#couponForm').addEventListener('submit', async event => {
  event.preventDefault();
  const wasEditing = Boolean(editingCouponId);
  const button = qs('#saveCouponButton');
  button.disabled = true;
  button.textContent = 'Salvando...';

  try {
    const form = new FormData(event.target);
    const discountType = form.get('discountType');
    const discountValue = Number(form.get('discountValue'));
    if (discountType === 'percentage' && discountValue >= 100) throw new Error('O desconto percentual deve ser menor que 100%.');

    const usageLimitRaw = String(form.get('usageLimit') || '').trim();
    const maxDiscountRaw = String(form.get('maxDiscount') || '').trim();
    const expiresRaw = String(form.get('expiresAt') || '').trim();
    const currentCoupon = editingCouponId ? coupons.find(item => item.id === editingCouponId) : null;
    const usageLimit = usageLimitRaw ? Number.parseInt(usageLimitRaw, 10) : null;

    if (currentCoupon && usageLimit !== null && usageLimit < Number(currentCoupon.times_used)) {
      throw new Error(`O limite não pode ser menor que os ${currentCoupon.times_used} usos já realizados.`);
    }

    const payload = {
      code: String(form.get('code')).trim().toUpperCase(),
      discount_type: discountType,
      discount_value: discountValue,
      minimum_order: Number(form.get('minimumOrder') || 0),
      max_discount: maxDiscountRaw ? Number(maxDiscountRaw) : null,
      usage_limit: usageLimit,
      expires_at: expiresRaw ? `${expiresRaw}T23:59:59-03:00` : null,
      active: form.get('active') === 'on'
    };

    const query = editingCouponId
      ? supabase.from('coupons').update(payload).eq('id', editingCouponId)
      : supabase.from('coupons').insert(payload);

    const { error } = await query;
    if (error) throw error;

    showToast(wasEditing ? 'Cupom atualizado.' : 'Cupom criado.');
    closeCouponModal();
    await loadAll();
  } catch (error) {
    showToast(error.message.includes('duplicate') ? 'Já existe um cupom com esse código.' : error.message);
  } finally {
    button.disabled = false;
    button.textContent = wasEditing ? 'Salvar alterações' : 'Criar cupom';
  }
});

async function toggleCoupon(id, active) {
  const { error } = await supabase.from('coupons').update({ active }).eq('id', id);
  if (error) return showToast(error.message);
  showToast(active ? 'Cupom ativado.' : 'Cupom pausado.');
  await loadAll();
}

async function deleteCoupon(id) {
  if (!confirm('Excluir este cupom? Os pedidos antigos continuarão mostrando o código e o desconto usados.')) return;
  const { error } = await supabase.from('coupons').delete().eq('id', id);
  if (error) return showToast(error.message);
  showToast('Cupom excluído.');
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
  const totalDiscount = paidOrders.reduce((sum, order) => sum + Number(order.discount_amount || 0), 0);
  reportData = {
    summary: {
      paidOrders: paidOrders.length,
      totalRevenue,
      totalDiscount,
      averageTicket: paidOrders.length ? totalRevenue / paidOrders.length : 0
    },
    orders: paidOrders
  };

  qs('#reportPaidOrders').textContent = reportData.summary.paidOrders;
  qs('#reportRevenue').textContent = money(reportData.summary.totalRevenue);
  qs('#reportDiscount').textContent = money(reportData.summary.totalDiscount);
  qs('#reportAverage').textContent = money(reportData.summary.averageTicket);
  qs('#reportTable').innerHTML = paidOrders.map(order => `
    <tr>
      <td>${dateTime(order.payment_date)}</td>
      <td>#${order.order_number}</td>
      <td>${escapeHtml(order.customer_name)}</td>
      <td>${escapeHtml(order.coupon_code || '—')}</td>
      <td>${money(order.discount_amount || 0)}</td>
      <td>${money(order.total)}</td>
    </tr>`).join('') || '<tr><td colspan="6">Nenhum pagamento no período.</td></tr>';
}

function exportCsv() {
  if (!reportData.orders.length) return showToast('Não há vendas para exportar.');
  const rows = [
    ['Data do pagamento', 'Pedido', 'Cliente', 'E-mail', 'Telefone', 'Itens', 'Subtotal', 'Cupom', 'Desconto', 'Entrega', 'Total', 'ID Mercado Pago'],
    ...reportData.orders.map(order => [
      dateTime(order.payment_date),
      order.order_number,
      order.customer_name,
      order.customer_email,
      order.customer_phone,
      (order.order_items || []).map(item => `${item.quantity}x ${item.product_name} Tam ${item.size}`).join(' | '),
      order.subtotal,
      order.coupon_code || '',
      order.discount_amount || 0,
      order.delivery_fee,
      order.total,
      order.payment_id || ''
    ])
  ];
  const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `relatorio-vitta-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

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
  qs('#pageTitle').textContent = {
    dashboard: 'Visão geral',
    orders: 'Pedidos',
    products: 'Produtos',
    coupons: 'Cupons',
    reports: 'Relatórios'
  }[view];
}

qs('#orderStatusFilter').onchange = renderOrders;
qs('#refreshOrders').onclick = () => loadAll().catch(error => showToast(error.message));
qs('#generateReport').onclick = generateReport;
qs('#exportCsv').onclick = exportCsv;
qs('#openProductModal').onclick = () => openProductModal();
qs('#closeProductModal').onclick = closeProductModal;
qs('#productModal').onclick = event => { if (event.target.id === 'productModal') closeProductModal(); };
qs('#openCouponModal').onclick = () => openCouponModal();
qs('#closeCouponModal').onclick = closeCouponModal;
qs('#couponModal').onclick = event => { if (event.target.id === 'couponModal') closeCouponModal(); };
qs('#today').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date());

document.querySelectorAll('[data-size-preset]').forEach(button => {
  button.addEventListener('click', () => applySizePreset(button.dataset.sizePreset));
});


document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!qs('#productModal').classList.contains('hidden')) closeProductModal();
  if (!qs('#couponModal').classList.contains('hidden')) closeCouponModal();
});

window.updateOrderStatus = updateOrderStatus;
window.toggleProduct = toggleProduct;
window.toggleFeatured = toggleFeatured;
window.deleteProduct = deleteProduct;
window.openProductEditor = openProductModal;
window.openCouponEditor = openCouponModal;
window.toggleCoupon = toggleCoupon;
window.deleteCoupon = deleteCoupon;

init().catch(error => {
  console.error(error);
  showToast(error.message || 'Não foi possível abrir o painel.');
});
