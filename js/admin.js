/* admin.js – host dashboard (ES module): Firebase Auth + Firestore */
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp, Timestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* >>> Set this to the email of the admin user you created in Firebase Authentication <<< */
const ADMIN_EMAIL = "admin@aurelia.com";

const MAX_PX = 800;          // uploaded photos are shrunk to this size
const RETENTION_DAYS = 30;   // orders older than this are deleted
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n).toFixed(2);

let menuItems = [], orders = [], unsubs = [], pendingImg = '', lastCleanup = null;

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

/* ===== Authentication ===== */
onAuthStateChanged(auth, (user) => {
  $('#login').hidden = !!user;
  $('#dash').hidden = !user;
  unsubs.forEach((u) => u());
  unsubs = [];
  if (user) startListeners(); else { menuItems = []; orders = []; }
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]'), err = $('#loginErr');
  err.textContent = '';
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, $('#pw').value);
    $('#pw').value = '';
  } catch (ex) {
    const wrong = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'];
    err.textContent = wrong.includes(ex.code) ? 'Incorrect password. Please try again.'
      : ex.code === 'auth/too-many-requests' ? 'Too many attempts. Please wait a few minutes.'
      : `Sign-in failed (${ex.code || 'unknown error'}).`;
  } finally { btn.disabled = false; }
});

$('#logout').addEventListener('click', () => signOut(auth));

/* ===== Live listeners (start after sign-in) ===== */
function startListeners() {
  const fail = (what) => (e) => { console.error(what, e); toast(`Could not load ${what}: ${e.code || e.message}`); };

  unsubs.push(onSnapshot(collection(db, 'menu'), (snap) => {
    menuItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.cat).localeCompare(String(b.cat)) || String(a.name).localeCompare(String(b.name)));
    renderMenu();
  }, fail('menu')));

  unsubs.push(onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    purgeOld();
    renderOrders();
    renderCleanup();
  }, fail('orders')));
}

/* ===== Tabs ===== */
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + b.dataset.tab; });
});

/* ===== Tab 1: Menu Manager ===== */
function renderMenu() {
  $('#dCount').textContent = `Dishes (${menuItems.length})`;
  $('#dishList').innerHTML = menuItems.map((i) => `
    <div class="item">
      <div class="main">
        ${i.img ? `<img class="th" src="${esc(i.img)}" alt="">` : ''}
        <div><b>${esc(i.name)}</b> &middot; ${money(i.price)}${i.feat ? ' &middot; &#9733;' : ''}
          <small>${esc(i.cat)} &mdash; ${esc(i.desc || '')}</small></div>
      </div>
      <div class="act">
        <button class="btn sm ghost" data-edit="${esc(i.id)}">Edit</button>
        <button class="btn sm danger" data-del="${esc(i.id)}">Delete</button>
      </div>
    </div>`).join('') || '<p class="empty">No dishes yet. Add your first one above.</p>';
}

function setPreview(src) {
  pendingImg = src || '';
  $('#dPreview').hidden = !pendingImg;
  $('#dPrevImg').src = pendingImg;
}

function resetDishForm() {
  $('#dishForm').reset();
  $('#dId').value = '';
  setPreview('');
  $('#dSave').textContent = 'Add dish';
  $('#dCancel').hidden = true;
}

/** Read a File, shrink it on a canvas to max 800px, return a Base64 JPEG data URL (stored in the Firestore document) */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

$('#dImg').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { setPreview(await resizeImage(f)); } catch { toast('Could not read that image'); }
  e.target.value = '';
});
$('#dImgRemove').addEventListener('click', () => setPreview(''));
$('#dCancel').addEventListener('click', resetDishForm);

$('#dishForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#dId').value;
  const dish = {
    name: $('#dName').value.trim(),
    cat: $('#dCat').value,
    price: parseFloat($('#dPrice').value),
    desc: $('#dDesc').value.trim(),
    img: pendingImg,
    feat: $('#dFeat').checked
  };
  if (!dish.name || isNaN(dish.price) || dish.price < 0) { toast('Enter a name and a valid price'); return; }
  const btn = $('#dSave');
  btn.disabled = true;
  try {
    if (id) await updateDoc(doc(db, 'menu', id), dish);
    else await addDoc(collection(db, 'menu'), dish);
    toast(id ? 'Dish updated' : 'Dish added');
    resetDishForm();
  } catch (ex) {
    console.error(ex);
    toast(`Save failed: ${ex.code || ex.message}`);
  } finally { btn.disabled = false; }
});

$('#dishList').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
  if (edit) {
    const d = menuItems.find((i) => i.id === edit.dataset.edit);
    if (!d) return;
    $('#dId').value = d.id; $('#dName').value = d.name; $('#dCat').value = d.cat;
    $('#dPrice').value = d.price; $('#dDesc').value = d.desc || ''; $('#dFeat').checked = !!d.feat;
    setPreview(d.img);
    $('#dSave').textContent = 'Save changes';
    $('#dCancel').hidden = false;
    $('#dName').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (del && confirm('Delete this dish?')) {
    try { await deleteDoc(doc(db, 'menu', del.dataset.del)); toast('Dish deleted'); }
    catch (ex) { toast(`Delete failed: ${ex.code || ex.message}`); }
  }
});

/* ===== Tab 2: Kitchen Orders (live) ===== */
const orderMs = (o) => (o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : 0); // 0 = timestamp still pending

function renderOrders() {
  const list = orders.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || orderMs(b) - orderMs(a));
  const open = list.filter((o) => o.status !== 'done').length;
  $('#ordTab').textContent = open ? `Kitchen Orders (${open})` : 'Kitchen Orders';

  $('#orderList').innerHTML = list.map((o) => `
    <div class="order ${o.status === 'done' ? 'done' : ''}">
      <div class="order-head">
        <div><b>${esc(o.name)}</b> &middot; <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a><br>
          <small class="note">${orderMs(o) ? new Date(orderMs(o)).toLocaleString() : 'Just now'} &middot; ${esc(o.where || '')}</small></div>
        <span class="tag">${o.status === 'done' ? 'Completed' : 'New'}</span>
      </div>
      <ul>${(o.items || []).map((i) => `<li>${i.qty} &times; ${esc(i.name)} <small>(${money(i.price * i.qty)})</small></li>`).join('')}</ul>
      ${o.notes ? `<p class="note">Notes: ${esc(o.notes)}</p>` : ''}
      <div class="order-head">
        <span class="total">${money(o.total)}</span>
        <div class="act">
          <button class="btn sm ghost" data-toggle="${esc(o.id)}">${o.status === 'done' ? 'Reopen' : 'Mark completed'}</button>
          <button class="btn sm danger" data-delorder="${esc(o.id)}">Delete</button>
        </div>
      </div>
    </div>`).join('') || '<p class="empty">No orders yet.</p>';
}

$('#orderList').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-toggle]'), d = e.target.closest('[data-delorder]');
  try {
    if (t) {
      const o = orders.find((x) => x.id === t.dataset.toggle);
      if (o) await updateDoc(doc(db, 'orders', o.id), { status: o.status === 'done' ? 'new' : 'done' });
    }
    if (d && confirm('Delete this order?')) await deleteDoc(doc(db, 'orders', d.dataset.delorder));
  } catch (ex) { toast(`Action failed: ${ex.code || ex.message}`); }
});

/* ===== Tab 3: 30-day auto-delete ===== */
/** Deletes from Firestore every order older than RETENTION_DAYS. Runs on every orders fetch. Returns how many were removed. */
function purgeOld() {
  const limit = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const stale = orders.filter((o) => { const t = orderMs(o); return t && Date.now() - t > limit; });
  stale.forEach((o) => deleteDoc(doc(db, 'orders', o.id)).catch((e) => console.error('Auto-delete failed', e)));
  orders = orders.filter((o) => !stale.includes(o));
  if (stale.length || !lastCleanup) lastCleanup = { time: new Date(), removed: stale.length };
  return stale.length;
}

function renderCleanup() {
  const times = orders.map(orderMs).filter(Boolean);
  const oldest = times.length ? Math.floor((Date.now() - Math.min(...times)) / 864e5) : null;
  $('#cleanInfo').innerHTML = `
    <div class="stat"><b>${orders.length}</b><span>Orders stored</span></div>
    <div class="stat"><b>${oldest === null ? '–' : oldest + ' d'}</b><span>Age of oldest order</span></div>
    <div class="stat"><b>${lastCleanup ? lastCleanup.removed : 0}</b><span>Deleted at last check${lastCleanup ? ' (' + lastCleanup.time.toLocaleTimeString() + ')' : ''}</span></div>`;
}

$('#cleanNow').addEventListener('click', () => {
  const n = purgeOld();
  lastCleanup = { time: new Date(), removed: n };
  toast(n ? `${n} old order${n > 1 ? 's' : ''} deleted` : 'No orders older than 30 days');
  renderOrders();
  renderCleanup();
});
setInterval(() => { if (auth.currentUser) { purgeOld(); renderOrders(); renderCleanup(); } }, 10 * 60 * 1000);

/* ===== Tab 4: Data Backup ===== */
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

document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.export === 'menu') {
    download('menu.json', menuItems);
  } else {
    download('orders.json', orders.map(({ createdAt, ...rest }) => ({ ...rest, created: orderMs({ createdAt }) ? new Date(orderMs({ createdAt })).toISOString() : null })));
  }
}));

/** Import ADDS the file's records to Firestore (it never wipes existing data) */
$('#iFile').addEventListener('change', (e) => {
  [...e.target.files].forEach((f) => {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const data = JSON.parse(r.result);
        if (!Array.isArray(data)) throw new Error('file must contain a list');
        const name = /order/i.test(f.name) ? 'orders' : 'menu';
        if (name === 'menu' && !data.every((x) => x.name && x.price !== undefined)) throw new Error('dishes need "name" and "price"');
        if (name === 'orders' && !data.every((x) => Array.isArray(x.items))) throw new Error('orders need an "items" list');
        for (const x of data) {
          const { id, created, createdAt, ...rest } = x;
          if (name === 'orders') {
            const d = new Date(created || createdAt);
            rest.createdAt = isNaN(d) ? serverTimestamp() : Timestamp.fromDate(d);
          }
          await addDoc(collection(db, name), rest);
        }
        toast(`Imported ${data.length} record(s) from ${f.name}`);
      } catch (err) { alert(`Import failed for ${f.name}: ${err.message}`); }
    };
    r.readAsText(f);
  });
  e.target.value = '';
});
