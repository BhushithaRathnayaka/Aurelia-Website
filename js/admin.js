/* admin.js – host dashboard: login, menu CRUD, kitchen orders, 30-day auto-delete, backup
   NOTE: the password is checked in the browser, so it only deters casual visitors.
   It is not real security (anyone can read this file). */
(() => {
  const PASSWORD = 'aurelia2024';
  const SESSION_KEY = 'aurelia_admin';
  const MAX_PX = 800;                 // uploaded photos are shrunk to this size
  const RETENTION_DAYS = 30;          // orders older than this are deleted
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let pendingImg = '';        // Base64 photo for the dish being edited ('' = none)
  let lastCleanup = null;     // { time, removed }

  /* ===== Login / logout ===== */
  const isAuthed = () => sessionStorage.getItem(SESSION_KEY) === '1';

  function showScreen() {
    const ok = isAuthed();
    $('#login').hidden = ok;
    $('#dash').hidden = !ok;
    if (ok) { runCleanup(); renderAll(); }
  }

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('#pw').value === PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, '1');
      $('#pw').value = '';
      $('#loginErr').textContent = '';
      showScreen();
    } else {
      $('#loginErr').textContent = 'Incorrect password. Please try again.';
    }
  });
  $('#logout').addEventListener('click', () => { sessionStorage.removeItem(SESSION_KEY); showScreen(); });

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  /* ===== Tabs ===== */
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + b.dataset.tab; });
    renderAll();
  });

  /* ===== Tab 1: Menu Manager ===== */
  function renderMenu() {
    const items = Store.get('menu');
    $('#dCount').textContent = `Dishes (${items.length})`;
    $('#dishList').innerHTML = items.map((i) => `
      <div class="item">
        <div class="main">
          ${i.img ? `<img class="th" src="${esc(i.img)}" alt="">` : ''}
          <div><b>${esc(i.name)}</b> &middot; ${Store.money(i.price)}${i.feat ? ' &middot; &#9733;' : ''}
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

  /** Read a File, shrink it on a canvas to max 800px, return a Base64 JPEG data URL */
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
          resolve(c.toDataURL('image/jpeg', 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  $('#dImg').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { setPreview(await resizeImage(f)); }
    catch (err) { toast('Could not read that image'); }
    e.target.value = '';
  });
  $('#dImgRemove').addEventListener('click', () => setPreview(''));
  $('#dCancel').addEventListener('click', resetDishForm);

  $('#dishForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#dId').value;
    const dish = {
      id: id || Store.uid('m'),
      name: $('#dName').value.trim(),
      cat: $('#dCat').value,
      price: parseFloat($('#dPrice').value),
      desc: $('#dDesc').value.trim(),
      img: pendingImg,
      feat: $('#dFeat').checked
    };
    if (!dish.name || isNaN(dish.price) || dish.price < 0) { toast('Enter a name and a valid price'); return; }
    const items = Store.get('menu');
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) items[idx] = dish; else items.push(dish);
    if (Store.set('menu', items)) { toast(idx >= 0 ? 'Dish updated' : 'Dish added'); resetDishForm(); renderMenu(); }
  });

  $('#dishList').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (edit) {
      const d = Store.get('menu').find((i) => i.id === edit.dataset.edit);
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
      Store.set('menu', Store.get('menu').filter((i) => i.id !== del.dataset.del));
      renderMenu();
    }
  });

  /* ===== Tab 2: Kitchen Orders ===== */
  function renderOrders() {
    // New orders first, completed ones at the bottom
    const orders = Store.get('orders').slice()
      .sort((a, b) => (a.status === 'done') - (b.status === 'done') || new Date(b.created) - new Date(a.created));
    const open = orders.filter((o) => o.status !== 'done').length;
    $('#ordTab').textContent = open ? `Kitchen Orders (${open})` : 'Kitchen Orders';

    $('#orderList').innerHTML = orders.map((o) => `
      <div class="order ${o.status === 'done' ? 'done' : ''}">
        <div class="order-head">
          <div><b>${esc(o.name)}</b> &middot; <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a><br>
            <small class="note">${new Date(o.created).toLocaleString()} &middot; ${esc(o.where)}</small></div>
          <span class="tag">${o.status === 'done' ? 'Completed' : 'New'}</span>
        </div>
        <ul>${o.items.map((i) => `<li>${i.qty} &times; ${esc(i.name)} <small>(${Store.money(i.price * i.qty)})</small></li>`).join('')}</ul>
        ${o.notes ? `<p class="note">Notes: ${esc(o.notes)}</p>` : ''}
        <div class="order-head">
          <span class="total">${Store.money(o.total)}</span>
          <div class="act">
            <button class="btn sm ghost" data-toggle="${esc(o.id)}">${o.status === 'done' ? 'Reopen' : 'Mark completed'}</button>
            <button class="btn sm danger" data-delorder="${esc(o.id)}">Delete</button>
          </div>
        </div>
      </div>`).join('') || '<p class="empty">No orders yet.</p>';
  }

  $('#orderList').addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]'), d = e.target.closest('[data-delorder]');
    const orders = Store.get('orders');
    if (t) {
      const o = orders.find((x) => x.id === t.dataset.toggle);
      if (o) { o.status = o.status === 'done' ? 'new' : 'done'; Store.set('orders', orders); renderOrders(); }
    }
    if (d && confirm('Delete this order?')) {
      Store.set('orders', orders.filter((x) => x.id !== d.dataset.delorder));
      renderOrders();
    }
  });

  /* ===== Tab 3: 30-day auto-delete ===== */
  /** Delete every order whose timestamp is older than RETENTION_DAYS. Returns how many were removed. */
  function runCleanup() {
    const limit = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const all = Store.get('orders');
    const keep = all.filter((o) => {
      const t = new Date(o.created).getTime();
      return isNaN(t) || Date.now() - t <= limit; // keep orders with unreadable dates rather than guess
    });
    const removed = all.length - keep.length;
    if (removed) Store.set('orders', keep);
    lastCleanup = { time: new Date(), removed };
    return removed;
  }

  function renderCleanup() {
    const orders = Store.get('orders');
    const dates = orders.map((o) => new Date(o.created).getTime()).filter((t) => !isNaN(t));
    const oldest = dates.length ? Math.floor((Date.now() - Math.min(...dates)) / 864e5) : null;
    $('#cleanInfo').innerHTML = `
      <div class="stat"><b>${orders.length}</b><span>Orders stored</span></div>
      <div class="stat"><b>${oldest === null ? '–' : oldest + ' d'}</b><span>Age of oldest order</span></div>
      <div class="stat"><b>${lastCleanup ? lastCleanup.removed : 0}</b><span>Deleted at last check${lastCleanup ? ' (' + lastCleanup.time.toLocaleTimeString() + ')' : ''}</span></div>`;
  }

  $('#cleanNow').addEventListener('click', () => {
    const n = runCleanup();
    toast(n ? `${n} old order${n > 1 ? 's' : ''} deleted` : 'No orders older than 30 days');
    renderAll();
  });
  setInterval(() => { if (isAuthed()) { runCleanup(); renderAll(); } }, 10 * 60 * 1000);

  /* ===== Tab 4: Data Backup ===== */
  document.querySelectorAll('[data-export]').forEach((b) =>
    b.addEventListener('click', () => Store.download(`${b.dataset.export}.json`, Store.get(b.dataset.export))));

  $('#iFile').addEventListener('change', (e) => {
    [...e.target.files].forEach((f) => {
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          if (!Array.isArray(data)) throw new Error('file must contain a list');
          const name = /order/i.test(f.name) ? 'orders' : 'menu';
          if (name === 'menu' && !data.every((x) => x.name && x.price !== undefined)) throw new Error('dishes need "name" and "price"');
          if (name === 'orders' && !data.every((x) => Array.isArray(x.items) && x.created)) throw new Error('orders need "items" and "created"');
          data.forEach((x) => { if (!x.id) x.id = Store.uid(name[0]); });
          if (Store.set(name, data)) toast(`Imported ${f.name}`);
          renderAll();
        } catch (err) { alert(`Import failed for ${f.name}: ${err.message}`); }
      };
      r.readAsText(f);
    });
    e.target.value = '';
  });

  /* ===== Init & live refresh ===== */
  function renderAll() { renderMenu(); renderOrders(); renderCleanup(); }

  // Refresh when orders arrive from another tab, and poll as a fallback
  window.addEventListener('storage', () => { if (isAuthed()) renderAll(); });
  setInterval(() => { if (isAuthed()) renderOrders(); }, 15000);

  Store.init().then(showScreen);
})();

