/* store.js – localStorage "database": menu, orders, cart */
const Store = (() => {
  const KEYS = { menu: 'aurelia_menu', orders: 'aurelia_orders', cart: 'aurelia_cart' };

  const DEFAULTS = {
    menu: [
      { id: 'm1', cat: 'Starters', name: 'Hokkaido Scallop', price: 24, desc: 'Seared, cauliflower purée, brown butter, caper.', img: '', feat: true },
      { id: 'm2', cat: 'Starters', name: 'Beef Tartare', price: 22, desc: 'Hand-cut tenderloin, quail yolk, black garlic.', img: '', feat: false },
      { id: 'm3', cat: 'Mains', name: 'Wagyu Striploin', price: 68, desc: 'A5 wagyu, bone marrow jus, pommes aligot.', img: '', feat: true },
      { id: 'm4', cat: 'Mains', name: 'Saffron Lobster', price: 58, desc: 'Butter-poached lobster, saffron velouté, fennel.', img: '', feat: false },
      { id: 'm5', cat: 'Mains', name: 'Truffle Risotto', price: 42, desc: 'Carnaroli rice, aged parmesan, shaved black truffle.', img: '', feat: false },
      { id: 'm6', cat: 'Desserts', name: 'Gold Leaf Fondant', price: 18, desc: 'Warm dark chocolate, vanilla bean cream, 24k gold.', img: '', feat: true },
      { id: 'm7', cat: 'Desserts', name: 'Pistachio Soufflé', price: 17, desc: 'Sicilian pistachio, rose ice cream.', img: '', feat: false },
      { id: 'm8', cat: 'Drinks', name: 'Aurelia Old Fashioned', price: 19, desc: 'Barrel-aged bourbon, smoked orange, demerara.', img: '', feat: false },
      { id: 'm9', cat: 'Drinks', name: 'Champagne, Brut Reserve', price: 24, desc: 'By the glass, served at 8°C.', img: '', feat: false }
    ],
    orders: [],
    cart: {} // { dishId: quantity }
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** Read a collection (localStorage first, then defaults) */
  function get(name) {
    try {
      const raw = localStorage.getItem(KEYS[name]);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.warn('Store read failed', e); }
    return clone(DEFAULTS[name]);
  }

  /** Save a collection; returns false if storage is full */
  function set(name, data) {
    try {
      localStorage.setItem(KEYS[name], JSON.stringify(data));
      window.dispatchEvent(new CustomEvent('store:update', { detail: name }));
      return true;
    } catch (e) {
      alert('Browser storage is full. Remove some photos or export your data.');
      return false;
    }
  }

  /** If no menu is saved locally, try data/menu.json (published by the host) */
  async function init() {
    if (localStorage.getItem(KEYS.menu)) return;
    try {
      const res = await fetch('data/menu.json', { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) DEFAULTS.menu = data;
      }
    } catch (e) { /* no published file – keep built-in defaults */ }
  }

  /* ----- Cart helpers ----- */
  function cartAdd(id) {
    const cart = get('cart');
    cart[id] = (cart[id] || 0) + 1;
    set('cart', cart);
  }
  function cartSet(id, qty) {
    const cart = get('cart');
    if (qty <= 0) delete cart[id]; else cart[id] = Math.min(qty, 99);
    set('cart', cart);
  }
  const cartCount = () => Object.values(get('cart')).reduce((a, b) => a + b, 0);
  const cartClear = () => set('cart', {});

  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const money = (n) => '$' + Number(n).toFixed(2);

  /** Download data as a JSON file */
  function download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return { get, set, init, uid, money, download, cartAdd, cartSet, cartCount, cartClear };
})();

