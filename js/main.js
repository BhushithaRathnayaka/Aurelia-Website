/* main.js – global logic: header/footer, mobile menu, menu rendering, cart, checkout */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const page = document.body.dataset.page;

  /* ===== Shared header & footer (injected so every page stays in sync) ===== */
  const LINKS = [['home', 'index.html', 'Home'], ['menu', 'menu.html', 'Menu'], ['order', 'order.html', 'Order'], ['contact', 'contact.html', 'Contact']];

  document.body.insertAdjacentHTML('afterbegin', `
    <header id="header">
      <a href="index.html" class="logo">Aurelia</a>
      <button id="burger" class="burger" aria-label="Toggle menu" aria-expanded="false"><span></span><span></span><span></span></button>
      <nav id="nav">${LINKS.map(([k, href, label]) =>
        `<a href="${href}" class="${k === page ? 'active' : ''}">${label}${k === 'order' ? '<span id="cartBadge" class="cart-badge zero">0</span>' : ''}</a>`).join('')}
      </nav>
    </header>`);

  document.body.insertAdjacentHTML('beforeend', `
    <footer>
      <p>&copy; ${new Date().getFullYear()} Aurelia. All rights reserved.</p>
      <p><a href="menu.html">Menu</a><a href="order.html">Order</a><a href="contact.html">Contact</a><a href="admin.html" class="host">Host Login</a></p>
    </footer>`);

  /* ===== Mobile nav ===== */
  const burger = $('#burger'), nav = $('#nav');
  const setNav = (open) => {
    nav.classList.toggle('open', open);
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open);
  };
  burger.addEventListener('click', () => setNav(!nav.classList.contains('open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });

  /* ===== Cart badge & toast ===== */
  function updateBadge() {
    const n = Store.cartCount(), b = $('#cartBadge');
    b.textContent = n;
    b.classList.toggle('zero', n === 0);
  }
  function toast(text) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  /* ===== Dish cards (home + menu) ===== */
  const dishCard = (i) => `
    <article class="dish">
      <div class="dish-img ${i.img ? '' : 'ph'}" ${i.img ? `style="background-image:url('${esc(i.img)}')"` : ''} role="img" aria-label="${esc(i.name)}"></div>
      <div class="dish-body">
        <div class="dish-top"><h3>${esc(i.name)}</h3><span class="price">${Store.money(i.price)}</span></div>
        <p>${esc(i.desc || '')}</p>
        <button class="btn sm" data-add="${esc(i.id)}">Add to order</button>
      </div>
    </article>`;

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    Store.cartAdd(b.dataset.add);
    const dish = Store.get('menu').find((m) => m.id === b.dataset.add);
    toast(`${dish ? dish.name : 'Item'} added to your order`);
  });

  function renderFeatured() {
    const menu = Store.get('menu');
    let items = menu.filter((i) => i.feat).slice(0, 3);
    if (!items.length) items = menu.slice(0, 3);
    $('#featured').innerHTML = items.map(dishCard).join('') || '<p class="empty">The menu is being updated.</p>';
  }

  let activeCat = 'all';
  function renderMenu() {
    const items = Store.get('menu').filter((i) => activeCat === 'all' || i.cat === activeCat);
    $('#menuGrid').innerHTML = items.map(dishCard).join('') || '<p class="empty">No dishes in this category yet.</p>';
  }
  if (page === 'menu') {
    $('#filters').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
      activeCat = chip.dataset.cat;
      renderMenu();
    });
  }

  /* ===== Order page: cart + checkout ===== */
  function renderCart() {
    const cart = Store.get('cart'), menu = Store.get('menu');
    const lines = Object.entries(cart)
      .map(([id, q]) => ({ item: menu.find((m) => m.id === id), q }))
      .filter((l) => l.item);

    $('#cartEmpty').hidden = lines.length > 0;
    $('#orderWrap').hidden = lines.length === 0;
    if (!lines.length) return;

    $('#cartLines').innerHTML = lines.map(({ item, q }) => `
      <div class="line">
        <div><b>${esc(item.name)}</b><small>${Store.money(item.price)} each</small></div>
        <div class="qty">
          <button data-act="dec" data-id="${esc(item.id)}" aria-label="Decrease">&minus;</button>
          <span>${q}</span>
          <button data-act="inc" data-id="${esc(item.id)}" aria-label="Increase">+</button>
        </div>
        <div class="sub">${Store.money(item.price * q)}</div>
      </div>`).join('');
    $('#cartTotal').textContent = Store.money(lines.reduce((s, l) => s + l.item.price * l.q, 0));
  }

  function initOrderPage() {
    $('#cartLines').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const q = Store.get('cart')[b.dataset.id] || 0;
      Store.cartSet(b.dataset.id, b.dataset.act === 'inc' ? q + 1 : q - 1);
    });

    const form = $('#checkoutForm'), err = $('#formErr');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      err.textContent = '';
      const menu = Store.get('menu'), cart = Store.get('cart');
      const items = Object.entries(cart)
        .map(([id, q]) => ({ item: menu.find((m) => m.id === id), q }))
        .filter((l) => l.item)
        .map((l) => ({ name: l.item.name, price: l.item.price, qty: l.q }));

      if (!items.length) { err.textContent = 'Your order is empty. Add dishes from the menu first.'; return; }
      const data = Object.fromEntries(new FormData(form));
      if (!data.name.trim() || !data.phone.trim() || !data.where.trim()) {
        err.textContent = 'Please fill in your name, phone and address or table number.';
        return;
      }
      if (!/^[+\d][\d\s().-]{5,}$/.test(data.phone.trim())) {
        err.textContent = 'Please enter a valid phone number.';
        return;
      }

      const orders = Store.get('orders');
      orders.push({
        id: Store.uid('o'),
        created: new Date().toISOString(),
        name: data.name.trim(), phone: data.phone.trim(), where: data.where.trim(), notes: (data.notes || '').trim(),
        items, total: items.reduce((s, i) => s + i.price * i.qty, 0),
        status: 'new'
      });
      if (!Store.set('orders', orders)) return;
      Store.cartClear();
      form.reset();
      const msg = $('#orderMsg');
      msg.textContent = `Thank you, ${data.name.trim()}. Your order has been sent to the kitchen.`;
      msg.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ===== Init ===== */
  window.addEventListener('store:update', (e) => {
    updateBadge();
    if (e.detail === 'cart' && page === 'order') renderCart();
  });
  window.addEventListener('storage', () => { updateBadge(); if (page === 'order') renderCart(); }); // other tabs

  Store.init().then(() => {
    updateBadge();
    if (page === 'home') renderFeatured();
    if (page === 'menu') renderMenu();
    if (page === 'order') { initOrderPage(); renderCart(); }
  });
})();

