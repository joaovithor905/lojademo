window.VITTA_CONFIG = {
  "storeName": "Vitta Fit Wear",
  "supabaseUrl": "COLE_AQUI_A_URL_DO_SUPABASE",
  "supabaseAnonKey": "COLE_AQUI_A_CHAVE_PUBLICA_DO_SUPABASE",
  "deliveryFee": 10,
  "whatsappNumber": "5564992886556",
  "instagram": "vitt.afitwear"
};

(() => {
  const CONFIG = window.VITTA_CONFIG || {};
  const BASE_STORE_NAME = 'Vitta Fit Wear';
  const BASE_SHORT_NAME = 'Vitta';
  const BASE_INSTAGRAM = 'vitt.afitwear';

  const storeName = String(CONFIG.storeName || BASE_STORE_NAME).trim() || BASE_STORE_NAME;
  const whatsappNumber = String(CONFIG.whatsappNumber || '').replace(/\D/g, '');
  const instagram = String(CONFIG.instagram || '').replace(/^@/, '').trim();

  const replaceBrandText = value => {
    if (typeof value !== 'string' || !value) return value;
    return value
      .replaceAll(BASE_STORE_NAME, storeName)
      .replaceAll(BASE_SHORT_NAME, storeName)
      .replaceAll(`@${BASE_INSTAGRAM}`, instagram ? `@${instagram}` : `@${BASE_INSTAGRAM}`);
  };

  function applyBrandElements(root = document) {
    const parts = storeName.split(/\s+/).filter(Boolean);
    const primary = parts.shift() || storeName;
    const secondary = parts.join(' ');
    const mark = (storeName.match(/[A-Za-zÀ-ÿ0-9]/)?.[0] || 'L').toUpperCase();

    root.querySelectorAll?.('.brand').forEach(brand => {
      const markElement = brand.querySelector('.brand-mark');
      const strong = brand.querySelector('strong');
      const small = brand.querySelector('small');
      if (markElement) markElement.textContent = mark;
      if (strong) strong.textContent = primary;
      if (small) {
        small.textContent = secondary;
        small.style.display = secondary ? '' : 'none';
      }
      const aria = brand.getAttribute('aria-label');
      if (aria) brand.setAttribute('aria-label', replaceBrandText(aria));
    });
  }

  function processTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style, .brand')) return;
    const next = replaceBrandText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function applyText(root = document) {
    if (root.nodeType === Node.TEXT_NODE) return processTextNode(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) processTextNode(node);
  }

  function applyAttributes(root = document) {
    const elements = root.querySelectorAll?.('[aria-label], [title], [placeholder], meta[content]') || [];
    elements.forEach(element => {
      for (const attribute of ['aria-label', 'title', 'placeholder', 'content']) {
        if (!element.hasAttribute(attribute)) continue;
        const current = element.getAttribute(attribute);
        const next = replaceBrandText(current);
        if (next !== current) element.setAttribute(attribute, next);
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
          if (message) url.searchParams.set('text', replaceBrandText(message));
          link.href = url.toString();
        } else if (
          instagram &&
          (url.hostname === 'instagram.com' || url.hostname === 'www.instagram.com')
        ) {
          url.pathname = `/${instagram}/`;
          link.href = url.toString();
        }
      } catch {}
    });
  }

  function applyAll(root = document) {
    if (document.title) document.title = replaceBrandText(document.title);
    applyBrandElements(root);
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

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
