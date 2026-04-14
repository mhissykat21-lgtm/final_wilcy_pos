// ─── WILCY POS — app.js ──────────────────────────────────────────────────────

let editingId = null;
let deleteId  = null;
let restockId = null;
let cart      = [];   // [{ itemId, name, sku, qty, price, origPrice }]

// ── HELPERS ──────────────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n) {
  return '₱' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// ── INIT ─────────────────────────────────────────────────────────────────────

async function init() {
  const el = document.getElementById('dateBadge');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  await initDB();
  renderAll();
  bindEvents();
}

function renderAll() {
  renderDashboard();
  renderTable();
  renderSalesLog();
  populateSellSelect();
  renderLowStockAlert();
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────

function renderDashboard() {
  const today      = todayStr();
  const todaySales = db.sales.filter(s => s.date === today);
  const totalItems = todaySales.reduce((a, s) => a + s.qty, 0);
  const totalRev   = todaySales.reduce((a, s) => a + s.revenue, 0);

  setText('totalTxns',     todaySales.length);
  setText('totalItemsSub', `${totalItems} item${totalItems !== 1 ? 's' : ''} sold today`);
  setText('totalRevenue',  fmt(totalRev));
  setText('totalRevSub',   `from ${todaySales.length} transaction${todaySales.length !== 1 ? 's' : ''}`);

  const qtyMap = {};
  db.sales.forEach(s => { qtyMap[s.itemId] = (qtyMap[s.itemId] || 0) + s.qty; });
  let bestId = null, bestQty = 0;
  for (const [id, q] of Object.entries(qtyMap)) {
    if (q > bestQty) { bestQty = q; bestId = id; }
  }
  if (bestId) {
    const item = db.items.find(i => i.id === bestId);
    setText('bestSellerName', item ? item.name : 'Unknown');
    setText('bestSellerSub',  `${bestQty} units sold total`);
  } else {
    setText('bestSellerName', '—');
    setText('bestSellerSub',  'no sales recorded yet');
  }

  const stockVal = db.items.reduce((a, i) => a + (i.qty * i.price), 0);
  setText('stockValue',    fmt(stockVal));
  setText('stockValueSub', `${db.items.reduce((a,i)=>a+i.qty,0)} units across ${db.items.length} items`);
}

// ── LOW STOCK ALERT ──────────────────────────────────────────────────────────

function renderLowStockAlert() {
  const strip = document.getElementById('lowStockAlert');
  if (!strip) return;
  const low = db.items.filter(i => i.qty > 0 && i.qty <= (i.threshold || 5));
  const out = db.items.filter(i => i.qty === 0);
  if (!low.length && !out.length) { strip.style.display = 'none'; return; }
  const parts = [];
  if (out.length) parts.push(`<strong>${out.length} item${out.length!==1?'s':''} out of stock</strong>`);
  if (low.length) parts.push(`${low.length} item${low.length!==1?'s':''} running low`);
  strip.innerHTML = `<span class="alert-ico">⚠</span> ${parts.join(' · ')} — 
    ${[...out,...low].slice(0,4).map(i=>`<em>${escHtml(i.name)}</em>`).join(', ')}
    ${(out.length+low.length)>4?` and ${(out.length+low.length)-4} more`:''}`;
  strip.style.display = 'flex';
}

// ── INVENTORY TABLE ──────────────────────────────────────────────────────────

function renderTable() {
  const q      = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const filter = document.getElementById('stockFilter')?.value || 'all';
  const body   = document.getElementById('inventoryBody');
  if (!body) return;

  let filtered = db.items.filter(i =>
    i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
  );
  if (filter === 'out') filtered = filtered.filter(i => i.qty === 0);
  else if (filter === 'low') filtered = filtered.filter(i => i.qty > 0 && i.qty <= (i.threshold || 5));
  else if (filter === 'ok')  filtered = filtered.filter(i => i.qty > (i.threshold || 5));

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📦</div>
      <p>${db.items.length ? 'No items match your search.' : 'No items yet. Click "Add Item" to get started.'}</p></div></td></tr>`;
    return;
  }

  const qtyMap = {};
  db.sales.forEach(s => { qtyMap[s.itemId] = (qtyMap[s.itemId] || 0) + s.qty; });
  const maxSold = Math.max(0, ...Object.values(qtyMap));

  const isAdmin = window.currentSession?.role === 'Admin';

  body.innerHTML = filtered.map(item => {
    const margin    = item.price - item.origPrice;
    const isBest    = maxSold > 0 && (qtyMap[item.id] || 0) === maxSold;
    const thresh    = item.threshold || 5;
    const totalSold = qtyMap[item.id] || 0;
    let qtyClass = 'qty-ok', badge = '';
    if (item.qty === 0) { qtyClass = 'qty-out'; badge = '<span class="badge badge-out">Out of Stock</span>'; }
    else if (item.qty <= thresh) { qtyClass = 'qty-low'; badge = '<span class="badge badge-low">⚠ Low</span>'; }
    const bestBadge = isBest ? '<span class="badge badge-best">🏆 Best</span>' : '';

    return `<tr>
      <td>
        <div class="td-sku">${escHtml(item.sku)}</div>
        <div class="td-name">${escHtml(item.name)}${bestBadge}${badge}</div>
      </td>
      <td><span class="${qtyClass}">${item.qty}</span></td>
      <td class="td-mono">${fmt(item.origPrice)}</td>
      <td class="td-mono">${fmt(item.price)}</td>
      <td class="${margin >= 0 ? 'margin-pos' : 'margin-neg'}">${margin >= 0 ? '+' : ''}${fmt(margin)}</td>
      <td class="td-mono" style="color:var(--text3);">${totalSold}</td>
      <td>
        <div class="td-actions">
          <button class="btn btn-sm btn-sell"    onclick="addItemToCartById('${item.id}')">+ Cart</button>
          ${isAdmin ? `<button class="btn btn-sm btn-restock" onclick="openRestockModal('${item.id}')">+Stock</button>
          <button class="btn btn-sm btn-edit"    onclick="openEditModal('${item.id}')">Edit</button>
          <button class="btn btn-sm btn-del"     onclick="openConfirm('${item.id}')">Delete</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── CART ─────────────────────────────────────────────────────────────────────

function populateSellSelect() {
  const sel = document.getElementById('sellItem');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— select item —</option>' +
    db.items.map(i =>
      `<option value="${i.id}"${i.qty === 0 ? ' disabled' : ''}>
        ${escHtml(i.sku)} · ${escHtml(i.name)} (${i.qty} left)
      </option>`
    ).join('');
  if (prev) sel.value = prev;
  onSellItemChange();
}

function onSellItemChange() {
  const id   = document.getElementById('sellItem')?.value;
  const info = document.getElementById('selectedInfo');
  if (!info) return;
  if (!id) { info.classList.remove('show'); return; }
  const item = db.items.find(i => i.id === id);
  if (!item) { info.classList.remove('show'); return; }
  info.classList.add('show');
  setText('infoStock', item.qty);
  setText('infoPrice', fmt(item.price));
  setVal('sellQty', 1);
}

function addToCart() {
  const id  = document.getElementById('sellItem')?.value;
  const qty = parseInt(document.getElementById('sellQty')?.value) || 0;
  if (!id)       return toast('Please select an item.', 'error');
  if (qty <= 0)  return toast('Enter a valid quantity.', 'error');
  addItemToCartById(id, qty);
  setVal('sellItem', '');
  setVal('sellQty', 1);
  document.getElementById('selectedInfo')?.classList.remove('show');
}

function addItemToCartById(id, qty = 1) {
  const item = db.items.find(i => i.id === id);
  if (!item) return;
  if (item.qty === 0) return toast(`${item.name} is out of stock.`, 'error');

  // Calculate how many are already in cart
  const inCart    = cart.filter(c => c.itemId === id).reduce((a, c) => a + c.qty, 0);
  const available = item.qty - inCart;

  if (qty > available) return toast(`Only ${available} more unit${available !== 1 ? 's' : ''} available.`, 'error');

  // Merge if same item already in cart
  const existing = cart.find(c => c.itemId === id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ itemId: id, name: item.name, sku: item.sku, qty, price: item.price, origPrice: item.origPrice });
  }

  renderCart();
  toast(`${item.name} × ${qty} added to cart.`, 'success');
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  renderCart();
}

function updateCartQty(idx, val) {
  const qty  = parseInt(val) || 0;
  const item = db.items.find(i => i.id === cart[idx].itemId);
  if (!item) return;

  // Max: actual stock
  const maxQty = item.qty;
  if (qty <= 0) { removeFromCart(idx); return; }
  if (qty > maxQty) {
    toast(`Only ${maxQty} in stock.`, 'error');
    cart[idx].qty = maxQty;
  } else {
    cart[idx].qty = qty;
  }
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

function renderCart() {
  const el    = document.getElementById('cartItems');
  const empty = document.getElementById('cartEmpty');
  const btn   = document.getElementById('checkoutBtn');
  const count = document.getElementById('cartCount');

  if (!el) return;

  if (!cart.length) {
    el.innerHTML = '';
    if (empty) { empty.style.display = 'block'; el.appendChild(empty); }
    if (btn)   btn.disabled = true;
    if (count) count.textContent = '0';
    setText('cartSubtotal', '₱0.00');
    setText('cartRevenue',  '₱0.00');
    return;
  }

  if (empty) empty.style.display = 'none';
  if (btn)   btn.disabled = false;

  const totalQty  = cart.reduce((a, c) => a + c.qty, 0);
  const subtotal  = cart.reduce((a, c) => a + (c.qty * c.price), 0);
  const revenue   = cart.reduce((a, c) => a + (c.qty * (c.price - c.origPrice)), 0);

  if (count) count.textContent = totalQty;
  setText('cartSubtotal', fmt(subtotal));
  setText('cartRevenue',  fmt(revenue));

  el.innerHTML = cart.map((c, i) => `
    <div class="cart-row">
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(c.name)}</div>
        <div class="cart-item-price">${fmt(c.price)} / pc</div>
      </div>
      <input class="cart-qty-input" type="number" min="1" value="${c.qty}"
        onchange="updateCartQty(${i}, this.value)" />
      <div class="cart-item-total">${fmt(c.qty * c.price)}</div>
      <button class="cart-remove" onclick="removeFromCart(${i})" title="Remove">✕</button>
    </div>`).join('');
}

// ── PROCESS CART SALE ─────────────────────────────────────────────────────────

async function processCartSale() {
  if (!cart.length) return toast('Cart is empty.', 'error');

  const customer = (document.getElementById('sellCustomer')?.value || '').trim() || 'Walk-in';
  const payment  = document.getElementById('sellPayment')?.value || 'Cash';
  const txnId    = genId();
  const now      = new Date();
  const date     = now.toISOString().slice(0, 10);
  const time     = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Validate stock for all cart items
  for (const c of cart) {
    const item = db.items.find(i => i.id === c.itemId);
    if (!item) return toast(`Item "${c.name}" not found.`, 'error');
    if (c.qty > item.qty) return toast(`Only ${item.qty} unit(s) left for "${c.name}".`, 'error');
  }

  // Build sale records
  const newSales = cart.map(c => {
    const revenue = (c.price - c.origPrice) * c.qty;
    const total   = c.price * c.qty;
    return {
      id: genId(), itemId: c.itemId, itemName: c.name, sku: c.sku,
      qty: c.qty, pricePerPc: c.price, origPrice: c.origPrice,
      revenue, total, customer, payment, date, time, txnId
    };
  });

  // Deduct stock
  newSales.forEach(s => {
    const idx = db.items.findIndex(i => i.id === s.itemId);
    if (idx > -1) db.items[idx].qty -= s.qty;
  });

  db.sales.push(...newSales);

  // Save sales + sync each stock-deducted item back to Sheets
  const updatedItems = newSales
    .map(s => db.items.find(i => i.id === s.itemId))
    .filter(Boolean);

  // Save: first append sales, then sync each updated stock item sequentially
  await saveData({ newSales });
  for (const item of updatedItems) {
    await saveData({ updatedItem: item });
  }

  const grandTotal = newSales.reduce((a, s) => a + s.total, 0);
  const grandRev   = newSales.reduce((a, s) => a + s.revenue, 0);

  // Show receipt
  showReceipt({ newSales, customer, payment, date, time, grandTotal, grandRev });

  // Reset
  cart = [];
  renderCart();
  setVal('sellCustomer', '');
  renderAll();
}

function showReceipt({ newSales, customer, payment, date, time, grandTotal, grandRev }) {
  const el = document.getElementById('receiptBody');
  if (!el) return;

  el.innerHTML = `
    <div class="receipt">
      <div class="receipt-store">WILCY POS</div>
      <div class="receipt-meta">${date} &nbsp; ${time}</div>
      <div class="receipt-meta">Customer: ${escHtml(customer)} &nbsp;·&nbsp; ${payment}</div>
      <div class="receipt-line"></div>
      <table class="receipt-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          ${newSales.map(s => `<tr>
            <td>${escHtml(s.itemName)}</td>
            <td>${s.qty}</td>
            <td>${fmt(s.pricePerPc)}</td>
            <td>${fmt(s.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="receipt-line"></div>
      <div class="receipt-total-row"><span>Grand Total</span><strong>${fmt(grandTotal)}</strong></div>
      <div class="receipt-total-row" style="color:var(--green);font-size:0.82rem;"><span>Revenue</span><span>${fmt(grandRev)}</span></div>
      <div class="receipt-line"></div>
      <div class="receipt-thanks">Thank you for your purchase!</div>
    </div>`;

  openModal('receiptModal');
}

function printReceipt() {
  window.print();
}

// ── ADD / EDIT MODAL ─────────────────────────────────────────────────────────

function openAddModal() {
  editingId = null;
  setText('modalTitle', 'Add New Item');
  ['mName','mSku','mQty','mOrigPrice','mPrice','mThreshold'].forEach(id => setVal(id, ''));
  openModal('itemModal');
}

function openEditModal(id) {
  const item = db.items.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  setText('modalTitle', 'Edit Item');
  setVal('mName',      item.name);
  setVal('mSku',       item.sku);
  setVal('mQty',       item.qty);
  setVal('mOrigPrice', item.origPrice);
  setVal('mPrice',     item.price);
  setVal('mThreshold', item.threshold || 5);
  openModal('itemModal');
}

async function saveItem() {
  const name      = document.getElementById('mName')?.value.trim()          || '';
  const sku       = document.getElementById('mSku')?.value.trim()           || '';
  const qty       = parseInt(document.getElementById('mQty')?.value);
  const origPrice = parseFloat(document.getElementById('mOrigPrice')?.value);
  const price     = Math.round(parseFloat(document.getElementById('mPrice')?.value));
  const threshold = parseInt(document.getElementById('mThreshold')?.value)  || 5;

  if (!name)                             return toast('Item name is required.', 'error');
  if (!sku)                              return toast('SKU is required.', 'error');
  if (isNaN(qty)   || qty  < 0)          return toast('Enter a valid quantity.', 'error');
  if (isNaN(origPrice) || origPrice < 0) return toast('Enter a valid original price.', 'error');
  if (isNaN(price) || price < 0)         return toast('Enter a valid price per piece.', 'error');

  let savedItem;
  if (editingId) {
    const idx = db.items.findIndex(i => i.id === editingId);
    if (idx > -1) { db.items[idx] = { ...db.items[idx], name, sku, qty, origPrice, price, threshold }; savedItem = db.items[idx]; }
    toast(`"${name}" updated successfully!`, 'success');
  } else {
    if (db.items.some(i => i.sku === sku)) return toast('SKU already exists.', 'error');
    savedItem = { id: genId(), name, sku, qty, origPrice, price, threshold };
    db.items.push(savedItem);
    toast(`"${name}" added to inventory!`, 'success');
  }

  await saveData({ updatedItem: savedItem });
  closeModal('itemModal');
  renderAll();
}

// ── DELETE ───────────────────────────────────────────────────────────────────

function openConfirm(id) {
  const item = db.items.find(i => i.id === id);
  if (!item) return;
  deleteId = id;
  const el = document.getElementById('confirmMsg');
  if (el) el.innerHTML = `This will permanently remove <strong>${escHtml(item.name)}</strong>. This cannot be undone.`;
  openModal('confirmModal');
}

async function confirmDelete() {
  if (!deleteId) return;
  const item = db.items.find(i => i.id === deleteId);
  db.items   = db.items.filter(i => i.id !== deleteId);
  await saveData({ deletedItemId: deleteId });
  closeModal('confirmModal');
  deleteId = null;
  renderAll();
  toast(`"${item?.name}" removed.`, 'warn');
}

// ── RESTOCK ──────────────────────────────────────────────────────────────────

function openRestockModal(id) {
  const item = db.items.find(i => i.id === id);
  if (!item) return;
  restockId = id;
  setText('restockName', item.name);
  setVal('restockQty', '');
  openModal('restockModal');
  setTimeout(() => document.getElementById('restockQty')?.focus(), 100);
}

async function confirmRestock() {
  const qty = parseInt(document.getElementById('restockQty')?.value);
  if (isNaN(qty) || qty <= 0) return toast('Enter a valid quantity.', 'error');
  const idx = db.items.findIndex(i => i.id === restockId);
  if (idx < 0) return;
  db.items[idx].qty += qty;
  await saveData({ updatedItem: db.items[idx] });
  closeModal('restockModal');
  renderAll();
  toast(`Restocked ${qty} units of "${db.items[idx].name}".`, 'success');
  restockId = null;
}

// ── SALES LOG ────────────────────────────────────────────────────────────────

function renderSalesLog() {
  const body    = document.getElementById('salesLogBody');
  const countEl = document.getElementById('saleCount');
  if (!body) return;

  const today      = todayStr();
  const todaySales = db.sales.filter(s => s.date === today).slice().reverse();

  if (countEl) countEl.textContent = `${todaySales.length} record${todaySales.length !== 1 ? 's' : ''}`;

  if (!todaySales.length) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No sales recorded today.</p></div>`;
    return;
  }

  body.innerHTML = todaySales.map(s => `
    <div class="sale-row">
      <div class="sale-dot"></div>
      <div class="sale-info">
        <div class="sale-name">${escHtml(s.itemName)}</div>
        <div class="sale-meta">${s.qty} pc${s.qty!==1?'s':''} × ${fmt(s.pricePerPc)} · ${s.time}
          ${s.customer && s.customer !== 'Walk-in' ? ` · ${escHtml(s.customer)}` : ''}
          &nbsp;<span class="pay-chip pay-${(s.payment||'Cash').toLowerCase()}">${s.payment||'Cash'}</span>
        </div>
      </div>
      <div class="sale-rev-col">
        <div class="sale-rev-amt">+${fmt(s.revenue)}</div>
        <div class="sale-rev-lbl">revenue</div>
      </div>
    </div>`).join('');
}

async function clearSales() {
  const today = todayStr();
  const count = db.sales.filter(s => s.date === today).length;
  if (!count) return toast("No sales to clear today.", 'warn');
  db.sales = db.sales.filter(s => s.date !== today);
  await saveData({ full: true });
  renderAll();
  toast("Today's sales cleared.", 'warn');
}

// ── EXPORT ───────────────────────────────────────────────────────────────────

function exportInventoryCSV() {
  const rows = [['SKU','Name','Qty','Original Price','Price/PC','Margin','Total Sold']];
  const qtyMap = {};
  db.sales.forEach(s => { qtyMap[s.itemId] = (qtyMap[s.itemId]||0) + s.qty; });
  db.items.forEach(i => rows.push([i.sku,i.name,i.qty,i.origPrice,i.price,(i.price-i.origPrice),qtyMap[i.id]||0]));
  downloadCSV(rows, 'wilcy_inventory_' + todayStr() + '.csv');
  toast('Inventory exported!', 'success');
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

// ── MODAL HELPERS ────────────────────────────────────────────────────────────

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// ── EVENT BINDINGS ───────────────────────────────────────────────────────────

function bindEvents() {
  ['itemModal','confirmModal','restockModal','receiptModal'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal(id);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['itemModal','confirmModal','restockModal','receiptModal'].forEach(id => closeModal(id));
    if ((e.ctrlKey||e.metaKey) && e.key === 'n') { e.preventDefault(); openAddModal(); }
  });

  document.getElementById('searchInput')?.addEventListener('input', renderTable);

  document.getElementById('mOrigPrice')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0) setVal('mPrice', Math.round(v) + 3);
  });

  document.getElementById('restockQty')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmRestock();
  });

  document.getElementById('sellQty')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') addToCart();
  });
}

// ── BOOT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
