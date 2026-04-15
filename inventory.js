// ─── WILCY POS — inventory.js ────────────────────────────────────────────────
// Handles the standalone Inventory Management page (inventory.html).
// Cart / sell logic lives in app.js on the Dashboard (index.html).

let editingId = null;
let deleteId  = null;
let restockId = null;
let invPage   = 1;
const INV_PAGE_SIZE = 10;

// ── HELPERS ───────────────────────────────────────────────────────────────────

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

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

// ── INIT ──────────────────────────────────────────────────────────────────────

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
  renderTable();
  renderLowStockAlert();
}

// ── STATS STRIP ───────────────────────────────────────────────────────────────

function renderStats() {
  if (!db) return;
  const totalSkus  = db.items.length;
  const totalUnits = db.items.reduce((a, i) => a + i.qty, 0);
  const lowItems   = db.items.filter(i => i.qty > 0 && i.qty <= (i.threshold || 5)).length;
  const outItems   = db.items.filter(i => i.qty === 0).length;

  setText('stat-skus',  totalSkus);
  setText('stat-units', totalUnits);
  setText('stat-low',   lowItems);
  setText('stat-out',   outItems);
}

// ── LOW STOCK ALERT ───────────────────────────────────────────────────────────

function renderLowStockAlert() {
  const strip = document.getElementById('lowStockAlert');
  if (!strip) return;
  const low = db.items.filter(i => i.qty > 0 && i.qty <= (i.threshold || 5));
  const out = db.items.filter(i => i.qty === 0);
  if (!low.length && !out.length) { strip.style.display = 'none'; return; }
  const parts = [];
  if (out.length) parts.push(`<strong>${out.length} item${out.length !== 1 ? 's' : ''} out of stock</strong>`);
  if (low.length) parts.push(`${low.length} item${low.length !== 1 ? 's' : ''} running low`);
  strip.innerHTML = `<span class="alert-ico">⚠</span> ${parts.join(' · ')} — 
    ${[...out, ...low].slice(0, 4).map(i => `<em>${escHtml(i.name)}</em>`).join(', ')}
    ${(out.length + low.length) > 4 ? ` and ${(out.length + low.length) - 4} more` : ''}`;
  strip.style.display = 'flex';
}

// ── INVENTORY TABLE (paginated) ───────────────────────────────────────────────

function renderTable(resetPage = false) {
  const q      = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const filter = document.getElementById('stockFilter')?.value || 'all';
  const body   = document.getElementById('inventoryBody');
  const pagBar = document.getElementById('invPaginationBar');
  if (!body) return;

  let filtered = db.items.filter(i =>
    i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
  );
  if (filter === 'out') filtered = filtered.filter(i => i.qty === 0);
  else if (filter === 'low') filtered = filtered.filter(i => i.qty > 0 && i.qty <= (i.threshold || 5));
  else if (filter === 'ok')  filtered = filtered.filter(i => i.qty > (i.threshold || 5));

  if (resetPage) invPage = 1;

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / INV_PAGE_SIZE));
  if (invPage > totalPages) invPage = totalPages;

  const pageItems = filtered.slice((invPage - 1) * INV_PAGE_SIZE, invPage * INV_PAGE_SIZE);

  if (!pageItems.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📦</div>
      <p>${db.items.length ? 'No items match your search.' : 'No items yet. Click "Add Item" to get started.'}</p></div></td></tr>`;
    if (pagBar) pagBar.innerHTML = '';
    return;
  }

  const qtyMap = {};
  db.sales.forEach(s => { qtyMap[s.itemId] = (qtyMap[s.itemId] || 0) + s.qty; });
  const maxSold = Math.max(0, ...Object.values(qtyMap));
  const isAdmin = window.currentSession?.role === 'Admin';

  body.innerHTML = pageItems.map(item => {
    const margin    = item.price - item.origPrice;
    const isBest    = maxSold > 0 && (qtyMap[item.id] || 0) === maxSold;
    const thresh    = item.threshold || 5;
    const totalSold = qtyMap[item.id] || 0;
    let qtyClass = 'qty-ok', badge = '';
    if (item.qty === 0)         { qtyClass = 'qty-out'; badge = '<span class="badge badge-out">Out of Stock</span>'; }
    else if (item.qty <= thresh){ qtyClass = 'qty-low'; badge = '<span class="badge badge-low">⚠ Low</span>'; }
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
          <a href="index.html?addToCart=${item.id}" class="btn btn-sm btn-sell" title="Go to dashboard and add to cart">+ Cart</a>
          ${isAdmin ? `
          <button class="btn btn-sm btn-restock" onclick="openRestockModal('${item.id}')">+Stock</button>
          <button class="btn btn-sm btn-edit"    onclick="openEditModal('${item.id}')">Edit</button>
          <button class="btn btn-sm btn-del"     onclick="openConfirm('${item.id}')">Delete</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Pagination bar
  if (pagBar) {
    const start = (invPage - 1) * INV_PAGE_SIZE + 1;
    const end   = Math.min(invPage * INV_PAGE_SIZE, totalItems);
    let pageButtons = '';
    const delta = 2;
    const left  = Math.max(1, invPage - delta);
    const right = Math.min(totalPages, invPage + delta);

    if (left > 1) pageButtons += `<button class="pg-btn" onclick="goToInvPage(1)">1</button>`;
    if (left > 2) pageButtons += `<span class="pg-ellipsis">…</span>`;
    for (let p = left; p <= right; p++) {
      pageButtons += `<button class="pg-btn${p === invPage ? ' pg-active' : ''}" onclick="goToInvPage(${p})">${p}</button>`;
    }
    if (right < totalPages - 1) pageButtons += `<span class="pg-ellipsis">…</span>`;
    if (right < totalPages)     pageButtons += `<button class="pg-btn" onclick="goToInvPage(${totalPages})">${totalPages}</button>`;

    pagBar.innerHTML = `
      <div class="pagination-wrap">
        <span class="pg-info">${start}–${end} of ${totalItems} item${totalItems !== 1 ? 's' : ''}</span>
        <div class="pg-controls">
          <button class="pg-btn pg-arrow" onclick="goToInvPage(${invPage - 1})" ${invPage === 1 ? 'disabled' : ''}>‹</button>
          ${pageButtons}
          <button class="pg-btn pg-arrow" onclick="goToInvPage(${invPage + 1})" ${invPage === totalPages ? 'disabled' : ''}>›</button>
        </div>
      </div>`;
  }
}

function goToInvPage(p) {
  const totalPages = Math.max(1, Math.ceil(
    db.items.filter(i => {
      const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
      const f = document.getElementById('stockFilter')?.value || 'all';
      if (!(i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))) return false;
      if (f === 'out') return i.qty === 0;
      if (f === 'low') return i.qty > 0 && i.qty <= (i.threshold || 5);
      if (f === 'ok')  return i.qty > (i.threshold || 5);
      return true;
    }).length / INV_PAGE_SIZE
  ));
  invPage = Math.max(1, Math.min(p, totalPages));
  renderTable();
}

// ── ADD / EDIT MODAL ──────────────────────────────────────────────────────────

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
  const name      = document.getElementById('mName')?.value.trim()         || '';
  const sku       = document.getElementById('mSku')?.value.trim()          || '';
  const qty       = parseInt(document.getElementById('mQty')?.value);
  const origPrice = parseFloat(document.getElementById('mOrigPrice')?.value);
  const price     = Math.round(parseFloat(document.getElementById('mPrice')?.value));
  const threshold = parseInt(document.getElementById('mThreshold')?.value) || 5;

  if (!name)                              return toast('Item name is required.', 'error');
  if (!sku)                               return toast('SKU is required.', 'error');
  if (isNaN(qty) || qty < 0)             return toast('Enter a valid quantity.', 'error');
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

// ── DELETE ────────────────────────────────────────────────────────────────────

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

// ── RESTOCK ───────────────────────────────────────────────────────────────────

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

// ── EXPORT ────────────────────────────────────────────────────────────────────

function exportInventoryCSV() {
  const rows = [['SKU','Name','Qty','Original Price','Price/PC','Margin','Total Sold']];
  const qtyMap = {};
  db.sales.forEach(s => { qtyMap[s.itemId] = (qtyMap[s.itemId]||0) + s.qty; });
  db.items.forEach(i => rows.push([i.sku, i.name, i.qty, i.origPrice, i.price, (i.price - i.origPrice), qtyMap[i.id] || 0]));
  downloadCSV(rows, 'wilcy_inventory_' + todayStr() + '.csv');
  toast('Inventory exported!', 'success');
}

// ── MODAL HELPERS ─────────────────────────────────────────────────────────────

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// ── EVENT BINDINGS ────────────────────────────────────────────────────────────

function bindEvents() {
  ['itemModal','confirmModal','restockModal'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal(id);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['itemModal','confirmModal','restockModal'].forEach(id => closeModal(id));
    if ((e.ctrlKey||e.metaKey) && e.key === 'n') { e.preventDefault(); openAddModal(); }
  });

  document.getElementById('searchInput')?.addEventListener('input', () => renderTable(true));

  document.getElementById('mOrigPrice')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0) setVal('mPrice', Math.round(v) + 3);
  });

  document.getElementById('restockQty')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmRestock();
  });
}

// ── BOOT ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
