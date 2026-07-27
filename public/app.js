import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CONFIG = window.VITTA_CONFIG || {};
const DELIVERY_FEE = Number(CONFIG.deliveryFee || 10);
const hasConfig = CONFIG.supabaseUrl?.startsWith('https://') && !CONFIG.supabaseUrl.includes('COLE_AQUI') && CONFIG.supabaseAnonKey && !CONFIG.supabaseAnonKey.includes('COLE_AQUI');
const supabase = hasConfig ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : null;

let products = [];
let cart = JSON.parse(localStorage.getItem('vitta-cart') || '[]');
let currentCategory = 'Todos';

const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const qs = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const stockFor = (product, size) => Number(product.stock_by_size?.[size] || 0);
const totalStock = product => Object.values(product.stock_by_size || {}).reduce((sum, value) => sum + Number(value || 0), 0);

async function loadProducts() {
  if (!supabase) {
    qs('#productGrid').innerHTML = '<div class="config-warning"><strong>Projeto ainda não configurado.</strong><br>Conecte o Supabase conforme o README para carregar o catálogo.</div>';
    return;
  }
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  products = data || [];
  cart = cart.filter(item => products.some(product => product.id === item.productId));
  persistCart(false);
  renderProducts();
  renderCart();
}

function renderProducts() {
  const filtered = currentCategory === 'Todos' ? products : products.filter(product => product.category === currentCategory);
  qs('#productGrid').innerHTML = filtered.map(product => {
    const availableSizes = (product.sizes || []).filter(size => stockFor(product, size) > 0);
    const stock = totalStock(product);
    return `
      <article class="product-card ${stock ? '' : 'out-of-stock'}">
        <div class="product-image">
          <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy">
          <span class="product-badge">${product.featured ? 'DESTAQUE' : escapeHtml(product.category.toUpperCase())}</span>
        </div>
        <div class="product-content">
          <span class="product-category">${escapeHtml(product.category)}</span>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description)}</p>
          <div class="product-price">${money(product.price)}</div>
          <div class="product-controls">
            <select id="size-${product.id}" aria-label="Tamanho" ${availableSizes.length ? '' : 'disabled'}>
              ${availableSizes.length ? availableSizes.map(size => `<option value="${escapeHtml(size)}">${escapeHtml(size)} — ${stockFor(product, size)} disp.</option>`).join('') : '<option>Esgotado</option>'}
            </select>
            <button class="add-cart" onclick="addToCart('${product.id}')" ${availableSizes.length ? '' : 'disabled'}>${availableSizes.length ? 'Adicionar' : 'Esgotado'}</button>
          </div>
          <small class="stock-info"><strong>${stock}</strong> unidade(s) disponível(is)</small>
        </div>
      </article>`;
  }).join('');
  qs('#emptyProducts').classList.toggle('hidden', filtered.length > 0);
}

function addToCart(productId) {
  const product = products.find(item => item.id === productId);
  const sizeInput = qs(`#size-${productId}`);
  if (!product || !sizeInput || sizeInput.disabled) return;
  const size = sizeInput.value;
  const existing = cart.find(item => item.productId === productId && item.size === size);
  const current = existing?.quantity || 0;
  if (current >= stockFor(product, size)) return showToast('Quantidade máxima disponível nesse tamanho.');
  if (existing) existing.quantity += 1;
  else cart.push({ productId, size, quantity: 1 });
  persistCart();
  showToast(`${product.name} adicionado ao carrinho.`);
  openCart();
}

function persistCart(render = true) {
  localStorage.setItem('vitta-cart', JSON.stringify(cart));
  if (render) renderCart();
}

function cartDetailed() {
  return cart.map(item => ({ ...item, product: products.find(product => product.id === item.productId) })).filter(item => item.product);
}

function renderCart() {
  const detailed = cartDetailed();
  const count = detailed.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = detailed.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  qs('#cartCount').textContent = count;
  qs('#cartItems').innerHTML = detailed.map(item => `
    <div class="cart-item">
      <img src="${escapeHtml(item.product.image_url)}" alt="${escapeHtml(item.product.name)}">
      <div><h4>${escapeHtml(item.product.name)}</h4><small>Tamanho ${escapeHtml(item.size)} · ${money(item.product.price)}</small>
        <div class="qty-row"><button onclick="changeQty('${item.productId}','${escapeHtml(item.size)}',-1)">−</button><strong>${item.quantity}</strong><button onclick="changeQty('${item.productId}','${escapeHtml(item.size)}',1)">+</button></div>
      </div>
      <button class="remove-item" onclick="removeItem('${item.productId}','${escapeHtml(item.size)}')">×</button>
    </div>`).join('');
  qs('#cartEmpty').classList.toggle('hidden', detailed.length > 0);
  qs('#cartItems').classList.toggle('hidden', detailed.length === 0);
  qs('#cartSubtotal').textContent = money(subtotal);
  qs('#cartTotal').textContent = money(detailed.length ? subtotal + DELIVERY_FEE : 0);
  qs('#goCheckout').disabled = detailed.length === 0;
}

function changeQty(productId, size, delta) {
  const item = cart.find(current => current.productId === productId && current.size === size);
  const product = products.find(current => current.id === productId);
  if (!item || !product) return;
  if (delta > 0 && item.quantity >= stockFor(product, size)) return showToast('Estoque máximo atingido nesse tamanho.');
  item.quantity += delta;
  if (item.quantity <= 0) removeItem(productId, size);
  else persistCart();
}

function removeItem(productId, size) {
  cart = cart.filter(item => !(item.productId === productId && item.size === size));
  persistCart();
}

function openCart() {
  qs('#cartDrawer').classList.add('open');
  qs('#cartBackdrop').classList.remove('hidden');
}
function closeCart() {
  qs('#cartDrawer').classList.remove('open');
  qs('#cartBackdrop').classList.add('hidden');
}
function showToast(message) {
  const element = qs('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3200);
}

qs('#checkoutForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!hasConfig) return showToast('Configure o Supabase antes de iniciar pagamentos.');
  if (!cart.length) return showToast('Seu carrinho está vazio.');

  const button = qs('#payButton');
  const buttonText = qs('#payButtonText');
  button.disabled = true;
  buttonText.textContent = 'Criando pagamento...';

  const form = new FormData(event.target);
  const payload = {
    customer: {
      name: form.get('name'),
      email: form.get('email'),
      phone: form.get('phone'),
      address: form.get('address'),
      neighborhood: form.get('neighborhood')
    },
    notes: form.get('notes'),
    items: cart.map(item => ({ productId: item.productId, size: item.size, quantity: item.quantity }))
  };

  try {
    const response = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível iniciar o pagamento.');

    localStorage.setItem('vitta-pending-order', JSON.stringify({
      orderId: result.orderId,
      token: result.publicToken,
      orderNumber: result.orderNumber
    }));
    window.location.assign(result.checkoutUrl);
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    buttonText.textContent = 'Pagar com Mercado Pago';
  }
});

qs('#categoryFilters').addEventListener('click', event => {
  if (!event.target.matches('.filter')) return;
  document.querySelectorAll('.filter').forEach(button => button.classList.remove('active'));
  event.target.classList.add('active');
  currentCategory = event.target.dataset.category;
  renderProducts();
});
qs('#openCart').onclick = openCart;
qs('#closeCart').onclick = closeCart;
qs('#cartBackdrop').onclick = closeCart;
qs('#goCheckout').onclick = () => { if (cart.length) { qs('#checkoutModal').classList.remove('hidden'); closeCart(); } };
qs('#closeCheckout').onclick = () => qs('#checkoutModal').classList.add('hidden');
qs('#checkoutModal').addEventListener('click', event => { if (event.target.id === 'checkoutModal') event.currentTarget.classList.add('hidden'); });

window.addToCart = addToCart;
window.changeQty = changeQty;
window.removeItem = removeItem;

renderCart();
loadProducts().catch(error => {
  console.error(error);
  showToast('Não foi possível carregar os produtos.');
});
