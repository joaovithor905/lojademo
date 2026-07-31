window.STORE_CONFIG = {
  "storeName": "Loja Demo",
  "slogan": "Sua loja online, do seu jeito.",
  "supabaseUrl": "COLE_AQUI_A_URL_DO_SUPABASE",
  "supabaseAnonKey": "COLE_AQUI_A_CHAVE_PUBLICA_DO_SUPABASE",
  "deliveryFee": 10,
  "whatsappNumber": "5564999999999",
  "instagram": "sualoja",
  "city": "Rio Verde - GO"
};

/*
  PERSONALIZAÇÃO DA LOJA
  ----------------------
  Para adaptar esta demonstração a um cliente, comece alterando os campos acima.

  Exemplo:
    "storeName": "Bella Moda",
    "whatsappNumber": "5564999999999",
    "instagram": "bellamoda"

  O nome é aplicado no cabeçalho, rodapé, títulos, textos, mensagens e links
  de WhatsApp. O checkout também envia o nome configurado ao servidor para
  registrar a marca usada no pedido e nas notificações automáticas.
*/
(() => {
  const CONFIG = window.STORE_CONFIG || {};
  const DEFAULT_NAME = 'Loja Demo';
  const DEFAULT_SLOGAN = 'Sua loja online, do seu jeito.';
  const LEGACY_SLOGAN = 'Performance e estilo no seu treino.';

  const storeName = String(CONFIG.storeName || DEFAULT_NAME).trim() || DEFAULT_NAME;
  const slogan = String(CONFIG.slogan || DEFAULT_SLOGAN).trim() || DEFAULT_SLOGAN;
  const whatsappNumber = String(CONFIG.whatsappNumber || '').replace(/\D/g, '');
  const instagram = String(CONFIG.instagram || '').replace(/^@/, '').trim();
  const city = String(CONFIG.city || '').trim();

  const replaceIdentity = value => {
    if (typeof value !== 'string' || !value) return value;
    let result = value;
    result = result.replaceAll(DEFAULT_NAME, storeName);
    result = result.replaceAll(LEGACY_SLOGAN, slogan).replaceAll(DEFAULT_SLOGAN, slogan);
    result = result.replaceAll('@sualoja', instagram ? `@${instagram}` : '@sualoja');
    return result;
  };

  function brandParts() {
    const parts = storeName.split(/\s+/).filter(Boolean);
    const primary = parts.shift() || storeName;
    const secondary = parts.join(' ');
    const mark = (storeName.match(/[A-Za-zÀ-ÿ0-9]/)?.[0] || 'L').toUpperCase();
    return { primary, secondary, mark };
  }

  function processTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style, .brand')) return;
    const next = replaceIdentity(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function applyBrand(root = document) {
    const { primary, secondary, mark } = brandParts();
    root.querySelectorAll?.('.brand').forEach(brand => {
      const markEl = brand.querySelector('.brand-mark');
      const strong = brand.querySelector('strong');
      const small = brand.querySelector('small');
      if (markEl) markEl.textContent = mark;
      if (strong) strong.textContent = primary;
      if (small) {
        small.textContent = secondary;
        small.style.display = secondary ? '' : 'none';
      }
      const aria = brand.getAttribute('aria-label');
      if (aria) brand.setAttribute('aria-label', replaceIdentity(aria));
    });
  }

  function applyText(root = document) {
    if (root.nodeType === Node.TEXT_NODE) return processTextNode(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) processTextNode(node);
  }

  function applyAttributes(root = document) {
    const nodes = root.querySelectorAll?.('[aria-label], [title], [placeholder], meta[content], input[value]') || [];
    nodes.forEach(element => {
      for (const attr of ['aria-label', 'title', 'placeholder', 'content', 'value']) {
        if (!element.hasAttribute(attr)) continue;
        const current = element.getAttribute(attr);
        let next = replaceIdentity(current);
        if (city && current === 'Rio Verde - GO') next = city;
        if (next !== current) element.setAttribute(attr, next);
      }
    });
  }

  function applyLinks(root = document) {
    const links = root.querySelectorAll?.('a[href]') || [];
    links.forEach(link => {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        if (url.hostname === 'wa.me' || url.hostname.endsWith('.wa.me')) {
          if (whatsappNumber) url.pathname = `/${whatsappNumber}`;
          const message = url.searchParams.get('text');
          if (message) url.searchParams.set('text', replaceIdentity(message));
          link.href = url.toString();
        } else if (instagram && (url.hostname === 'instagram.com' || url.hostname === 'www.instagram.com')) {
          url.pathname = `/${instagram}/`;
          link.href = url.toString();
        }
      } catch {}
    });
  }

  function applyAll(root = document) {
    if (document.title) document.title = replaceIdentity(document.title);
    applyBrand(root);
    applyText(root);
    applyAttributes(root);
    applyLinks(root);
  }

  function start() {
    applyAll(document);
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          processTextNode(mutation.target);
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) processTextNode(node);
          else if (node.nodeType === Node.ELEMENT_NODE) applyAll(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
