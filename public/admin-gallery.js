import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CONFIG = window.VITTA_CONFIG || {};
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
const form = document.querySelector('#productForm');
const button = document.querySelector('#publishButton');

async function uploadImage(file) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('product-images').upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
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

form.addEventListener('submit', async event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  button.disabled = true;
  button.textContent = 'Publicando...';
  try {
    const data = new FormData(form);
    const sizes = String(data.get('sizes')).split(',').map(v => v.trim()).filter(Boolean);
    const files = Array.from(data.getAll('imageFiles')).filter(file => file instanceof File && file.size);
    const urlsTyped = String(data.get('imageUrls') || '').split(/\n|,/).map(v => v.trim()).filter(Boolean);
    const uploaded = [];
    for (const file of files) uploaded.push(await uploadImage(file));
    const imageUrls = [...uploaded, ...urlsTyped];
    if (!imageUrls.length) throw new Error('Envie ao menos uma foto ou informe uma URL.');

    const payload = {
      name: String(data.get('name')).trim(),
      category: data.get('category'),
      price: Number(data.get('price')),
      sizes,
      stock_by_size: parseStock(data.get('stock'), sizes),
      image_url: imageUrls[0],
      image_urls: imageUrls,
      description: String(data.get('description')).trim(),
      active: true,
      featured: data.get('featured') === 'on'
    };
    const { error } = await supabase.from('products').insert(payload);
    if (error) throw error;
    form.reset();
    document.querySelector('#productModal').classList.add('hidden');
    location.reload();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Publicar anúncio';
  }
}, true);
