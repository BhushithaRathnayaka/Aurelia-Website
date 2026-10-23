/* main.js – public site logic (ES module). Menu + orders live in Firestore; the cart stays in localStorage. */
import { db } from "./firebase-config.js";
import { collection, getDocs, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n).toFixed(2);
const page = document.body.dataset.page;

/* ===== Shared header & footer ===== */
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

/* ===== Cart (localStorage: { dishId: qty }) ===== */
const CART_KEY = 'aurelia_cart';
const getCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; } };
function setCart(cart) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { console.warn(e); }
  updateBadge();
  if (page === 'order') renderCart();
}
const cartCount = () => Object.values(getCart()).reduce((a, b) => a + b, 0);
function cartAdd(id) { const c = getCart(); c[id] = Math.min((c[id] || 0) + 1, 99); setCart(c); }
function cartSet(id, qty) { const c = getCart(); if (qty <= 0) delete c[id]; else c[id] = Math.min(qty, 99); setCart(c); }

function updateBadge() {
  const n = cartCount(), b = $('#cartBadge');
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

/* ===== Menu from Firestore ===== */
let MENU = [];
let menuFailed = false;

async function loadMenu() {
  try {
    const snap = await getDocs(collection(db, 'menu'));
    MENU = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } catch (e) {
    console.error('Could not load menu', e);
    menuFailed = true;
  }
}
const emptyMsg = () => `<p class="empty">${menuFailed ? 'The menu could not be loaded. Please refresh the page.' : 'The menu is being updated. Please check back soon.'}</p>`;

const dishCard = (i) => `
  <article class="dish">
    <div class="dish-img ${i.img ? '' : 'ph'}" ${i.img ? `style="background-image:url('${esc(i.img)}')"` : ''} role="img" aria-label="${esc(i.name)}"></div>
    <div class="dish-body">
      <div class="dish-top"><h3>${esc(i.name)}</h3><span class="price">${money(i.price)}</span></div>
      <p>${esc(i.desc || '')}</p>
      <button class="btn sm" data-add="${esc(i.id)}">Add to order</button>
    </div>
  </article>`;

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  cartAdd(b.dataset.add);
  const dish = MENU.find((m) => m.id === b.dataset.add);
  toast(`${dish ? dish.name : 'Item'} added to your order`);
});

function renderFeatured() {
  let items = MENU.filter((i) => i.feat).slice(0, 3);
  if (!items.length) items = MENU.slice(0, 3);
  $('#featured').innerHTML = items.map(dishCard).join('') || emptyMsg();
}

let activeCat = 'all';
function renderMenu() {
  const items = MENU.filter((i) => activeCat === 'all' || i.cat === activeCat);
  $('#menuGrid').innerHTML = items.map(dishCard).join('') || (MENU.length ? '<p class="empty">No dishes in this category yet.</p>' : emptyMsg());
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
function cartLines() {
  return Object.entries(getCart())
    .map(([id, q]) => ({ item: MENU.find((m) => m.id === id), q }))
    .filter((l) => l.item);
}

function renderCart() {
  const lines = cartLines();
  $('#cartEmpty').hidden = lines.length > 0;
  $('#orderWrap').hidden = lines.length === 0;
  if (!lines.length) return;
  $('#cartLines').innerHTML = lines.map(({ item, q }) => `
    <div class="line">
      <div><b>${esc(item.name)}</b><small>${money(item.price)} each</small></div>
      <div class="qty">
        <button data-act="dec" data-id="${esc(item.id)}" aria-label="Decrease">&minus;</button>
        <span>${q}</span>
        <button data-act="inc" data-id="${esc(item.id)}" aria-label="Increase">+</button>
      </div>
      <div class="sub">${money(item.price * q)}</div>
    </div>`).join('');
  $('#cartTotal').textContent = money(lines.reduce((s, l) => s + l.item.price * l.q, 0));
}

function initOrderPage() {
  $('#cartLines').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const q = getCart()[b.dataset.id] || 0;
    cartSet(b.dataset.id, b.dataset.act === 'inc' ? q + 1 : q - 1);
  });

  const form = $('#checkoutForm'), err = $('#formErr'), submit = form.querySelector('button[type=submit]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const items = cartLines().map((l) => ({ name: l.item.name, price: Number(l.item.price), qty: l.q }));
    if (!items.length) { err.textContent = 'Your order is empty. Add dishes from the menu first.'; return; }

    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim() || !data.phone.trim() || !data.where.trim()) {
      err.textContent = 'Please fill in your name, phone and address or table number.';
      return;
    }
    if (!/^[+\d][\d\s().-]{5,}$/.test(data.phone.trim())) { err.textContent = 'Please enter a valid phone number.'; return; }

    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      await addDoc(collection(db, 'orders'), {
        name: data.name.trim(),
        phone: data.phone.trim(),
        where: data.where.trim(),
        notes: (data.notes || '').trim(),
        items,
        total: items.reduce((s, i) => s + i.price * i.qty, 0),
        status: 'new',
        createdAt: serverTimestamp()
      });
      setCart({});
      form.reset();
      const msg = $('#orderMsg');
      msg.textContent = `Thank you, ${data.name.trim()}. Your order has been sent to the kitchen.`;
      msg.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (ex) {
      console.error('Order failed', ex);
      err.textContent = 'Sorry, we could not send your order. Please check your connection and try again.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Place order';
    }
  });
}

/* ===== Init ===== */
updateBadge();
window.addEventListener('storage', () => { updateBadge(); if (page === 'order') renderCart(); }); // cart changed in another tab

(async () => {
  if (page === 'home') $('#featured').innerHTML = '<p class="empty">Loading…</p>';
  if (page === 'menu') $('#menuGrid').innerHTML = '<p class="empty">Loading…</p>';
  if (page === 'order') initOrderPage();
  if (['home', 'menu', 'order'].includes(page)) await loadMenu();
  if (page === 'home') renderFeatured();
  if (page === 'menu') renderMenu();
  if (page === 'order') renderCart();
})();
