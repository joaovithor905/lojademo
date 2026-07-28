import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CONFIG = window.VITTA_CONFIG || {};
const DELIVERY_FEE = Number(CONFIG.deliveryFee || 10);
const hasConfig = CONFIG.supabaseUrl?.startsWith('https://') && !CONFIG.supabaseUrl.includes('COLE_AQUI') && CONFIG.supabaseAnonKey && !CONFIG.supabaseAnonKey.includes('COLE_AQUI');
const supabase = hasConfig ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : null;

let products = [];
let cart = JSON.parse(localStorage.getItem('vitta-cart') || '[]');
let currentCategory = 'Todos';
let currentProduct = null;
let appliedCoupon = null;

const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const qs = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const stockFor = (product, size) => Number(product.stock_by_size?.[size] || 0);
const totalStock = product => Object.values(product.stock_by_size || {}).reduce((sum, value) => sum + Number(value || 0), 0);
const productImages = product => {
  const images = Array.isArray(product?.image_urls) ? product.image_urls.filter(Boolean) : [];
  if (product?.image_url && !images.includes(product.image_url)) images.unshift(product.image_url);
  return images.length ? images : ['https://placehold.co/900x1100?text=Vitta+Fit+Wear'];
};

async function loadProducts() {
  if (!supabase) {
    qs('#productGrid').innerHTML = '<div class="config-warning"><strong>Projeto ainda não configurado.</strong><br>Conecte o Supabase para carregar o catálogo.</div>';
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
  const filtered = currentCategory === 'Todos'
    ? products
    : products.filter(product => product.category === currentCategory);

  qs('#productGrid').innerHTML = filtered.map(product => {
    const availableSizes = (product.sizes || []).filter(size => stockFor(product, size) > 0);
    const stock = totalStock(product);
    const images = productImages(product);

    return `
      <article class="product-card ${stock ? '' : 'out-of-stock'}">
        <button class="product-image product-open" type="button" onclick="openProduct('${product.id}')" aria-label="Ver detalhes de ${escapeHtml(product.name)}">
          <img src="${escapeHtml(images[0])}" alt="${escapeHtml(product.name)}" loading="lazy">
          <span class="product-badge">${product.featured ? 'DESTAQUE' : escapeHtml(product.category.toUpperCase())}</span>
          ${images.length > 1 ? `<span class="photo-badge">+${images.length - 1} foto${images.length > 2 ? 's' : ''}</span>` : ''}
        </button>
        <div class="product-content">
          <span class="product-category">${escapeHtml(product.category)}</span>
          <button class="product-title-button" type="button" onclick="openProduct('${product.id}')"><h3>${escapeHtml(product.name)}</h3></button>
          <p>${escapeHtml(product.description)}</p>
          <div class="product-price">${money(product.price)}</div>
          <button class="view-product" type="button" onclick="openProduct('${product.id}')">Ver detalhes e fotos</button>
          <div class="product-controls">
            <select id="size-${product.id}" aria-label="Tamanho" ${availableSizes.length ? '' : 'disabled'}>
              ${availableSizes.length
                ? availableSizes.map(size => `<option value="${escapeHtml(size)}">${escapeHtml(size)} — ${stockFor(product, size)} disp.</option>`).join('')
                : '<option>Esgotado</option>'}
            </select>
            <button class="add-cart" onclick="addToCart('${product.id}')" ${availableSizes.length ? '' : 'disabled'}>${availableSizes.length ? 'Adicionar' : 'Esgotado'}</button>
          </div>
          <small class="stock-info"><strong>${stock}</strong> unidade(s) disponível(is)</small>
        </div>
      </article>`;
  }).join('');

  qs('#emptyProducts').classList.toggle('hidden', filtered.length > 0);
}

function resetCoupon(showMessage = false) {
  if (!appliedCoupon) return;
  appliedCoupon = null;
  if (showMessage) showToast('O cupom foi removido porque o carrinho mudou. Aplique novamente.');
  qs('#couponMessage').textContent = '';
  qs('#couponMessage').className = '';
}

function addProductSizeToCart(product, size) {
  if (!product || !size) return;
  const existing = cart.find(item => item.productId === product.id && item.size === size);
  const current = existing?.quantity || 0;
  if (current >= stockFor(product, size)) return showToast('Quantidade máxima disponível nesse tamanho.');
  resetCoupon(Boolean(appliedCoupon));
  if (existing) existing.quantity += 1;
  else cart.push({ productId: product.id, size, quantity: 1 });
  persistCart();
  showToast(`${product.name} adicionado ao carrinho.`);
  closeProduct();
  openCart();
}

function addToCart(productId) {
  const product = products.find(item => item.id === productId);
  const sizeInput = qs(`#size-${productId}`);
  if (!product || !sizeInput || sizeInput.disabled) return;
  addProductSizeToCart(product, sizeInput.value);
}

function openProduct(productId) {
  const product = products.find(item => item.id === productId);
  if (!product) return;
  currentProduct = product;
  const images = productImages(product);
  const availableSizes = (product.sizes || []).filter(size => stockFor(product, size) > 0);

  qs('#productModalCategory').textContent = product.category;
  qs('#productModalName').textContent = product.name;
  qs('#productModalDescription').textContent = product.description;
  qs('#productModalPrice').textContent = money(product.price);
  qs('#productModalMainImage').src = images[0];
  qs('#productModalMainImage').alt = product.name;
  qs('#productModalThumbnails').innerHTML = images.map((image, index) => `
    <button class="product-thumb ${index === 0 ? 'active' : ''}" type="button" onclick="selectProductImage(${index})">
      <img src="${escapeHtml(image)}" alt="Foto ${index + 1} de ${escapeHtml(product.name)}">
    </button>`).join('');

  const sizeSelect = qs('#productModalSize');
  sizeSelect.disabled = !availableSizes.length;
  sizeSelect.innerHTML = availableSizes.length
    ? availableSizes.map(size => `<option value="${escapeHtml(size)}">${escapeHtml(size)} — ${stockFor(product, size)} disponível(is)</option>`).join('')
    : '<option>Esgotado</option>';

  const addButton = qs('#productModalAdd');
  addButton.disabled = !availableSizes.length;
  addButton.textContent = availableSizes.length ? 'Adicionar ao carrinho' : 'Produto esgotado';
  qs('#productDetailModal').classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function selectProductImage(index) {
  if (!currentProduct) return;
  const images = productImages(currentProduct);
  if (!images[index]) return;
  qs('#productModalMainImage').src = images[index];
  document.querySelectorAll('.product-thumb').forEach((button, i) => button.classList.toggle('active', i === index));
}

function closeProduct() {
  qs('#productDetailModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  currentProduct = null;
}

function persistCart(render = true) {
  localStorage.setItem('vitta-cart', JSON.stringify(cart));
  if (render) renderCart();
}

function cartDetailed() {
  return cart
    .map(item => ({ ...item, product: products.find(product => product.id === item.productId) }))
    .filter(item => item.product);
}

function renderCart() {
  const detailed = cartDetailed();
  const count = detailed.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = detailed.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const discount = appliedCoupon ? Number(appliedCoupon.discountAmount || 0) : 0;
  const total = detailed.length ? Math.max(subtotal - discount, 0) + DELIVERY_FEE : 0;

  qs('#cartCount').textContent = count;
  qs('#cartItems').innerHTML = detailed.map(item => `
    <div class="cart-item">
      <img src="${escapeHtml(productImages(item.product)[0])}" alt="${escapeHtml(item.product.name)}">
      <div>
        <h4>${escapeHtml(item.product.name)}</h4>
        <small>Tamanho ${escapeHtml(item.size)} · ${money(item.product.price)}</small>
        <div class="qty-row">
          <button onclick="changeQty('${item.productId}','${escapeHtml(item.size)}',-1)">−</button>
          <strong>${item.quantity}</strong>
          <button onclick="changeQty('${item.productId}','${escapeHtml(item.size)}',1)">+</button>
        </div>
      </div>
      <button class="remove-item" onclick="removeItem('${item.productId}','${escapeHtml(item.size)}')">×</button>
    </div>`).join('');

  qs('#cartEmpty').classList.toggle('hidden', detailed.length > 0);
  qs('#cartItems').classList.toggle('hidden', detailed.length === 0);
  qs('#cartSubtotal').textContent = money(subtotal);
  qs('#cartDiscountRow').classList.toggle('hidden', !appliedCoupon);
  qs('#cartDiscount').textContent = `- ${money(discount)}`;
  qs('#cartCouponCode').textContent = appliedCoupon ? `(${appliedCoupon.code})` : '';
  qs('#cartTotal').textContent = money(total);
  qs('#goCheckout').disabled = detailed.length === 0;
  qs('#couponCode').disabled = detailed.length === 0;
  qs('#applyCoupon').disabled = detailed.length === 0;
}

function changeQty(productId, size, delta) {
  const item = cart.find(current => current.productId === productId && current.size === size);
  const product = products.find(current => current.id === productId);
  if (!item || !product) return;
  if (delta > 0 && item.quantity >= stockFor(product, size)) return showToast('Estoque máximo atingido nesse tamanho.');
  resetCoupon(Boolean(appliedCoupon));
  item.quantity += delta;
  if (item.quantity <= 0) cart = cart.filter(current => current !== item);
  persistCart();
}

function removeItem(productId, size) {
  resetCoupon(Boolean(appliedCoupon));
  cart = cart.filter(item => !(item.productId === productId && item.size === size));
  persistCart();
}

async function applyCoupon() {
  if (!cart.length) return showToast('Adicione produtos antes de aplicar um cupom.');
  const code = qs('#couponCode').value.trim().toUpperCase();
  if (!code) return showToast('Digite o código do cupom.');

  const button = qs('#applyCoupon');
  button.disabled = true;
  button.textContent = 'Validando...';
  qs('#couponMessage').textContent = '';

  try {
    const response = await fetch('/api/validate-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, items: cart })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Cupom inválido.');

    appliedCoupon = result;
    qs('#couponCode').value = result.code;
    qs('#couponMessage').textContent = `Cupom aplicado: você economizou ${money(result.discountAmount)}.`;
    qs('#couponMessage').className = 'coupon-success';
    renderCart();
  } catch (error) {
    appliedCoupon = null;
    qs('#couponMessage').textContent = error.message;
    qs('#couponMessage').className = 'coupon-error';
    renderCart();
  } finally {
    button.disabled = false;
    button.textContent = 'Aplicar';
  }
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
    couponCode: appliedCoupon?.code || '',
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
qs('#applyCoupon').onclick = applyCoupon;
qs('#couponCode').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyCoupon(); } });
qs('#goCheckout').onclick = () => { if (cart.length) { qs('#checkoutModal').classList.remove('hidden'); closeCart(); } };
qs('#closeCheckout').onclick = () => qs('#checkoutModal').classList.add('hidden');
qs('#checkoutModal').addEventListener('click', event => { if (event.target.id === 'checkoutModal') event.currentTarget.classList.add('hidden'); });
qs('#closeProductDetail').onclick = closeProduct;
qs('#productDetailModal').addEventListener('click', event => { if (event.target.id === 'productDetailModal') closeProduct(); });
qs('#productModalAdd').onclick = () => { if (currentProduct) addProductSizeToCart(currentProduct, qs('#productModalSize').value); };
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !qs('#productDetailModal').classList.contains('hidden')) closeProduct(); });

window.addToCart = addToCart;
window.changeQty = changeQty;
window.removeItem = removeItem;
window.openProduct = openProduct;
window.selectProductImage = selectProductImage;

renderCart();
loadProducts().catch(error => {
  console.error(error);
  showToast('Não foi possível carregar os produtos.');
});
