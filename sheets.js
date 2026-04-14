// ─── WILCY POS — sheets.js ───────────────────────────────────────────────────
// Google Sheets as database via Apps Script Web App
//
// SETUP:
// 1. Create a Google Sheet with two tabs: "Inventory" and "Sales"
// 2. Paste sheets_backend.gs into Extensions → Apps Script
// 3. Deploy as Web App (Execute as: Me, Anyone access), copy URL
// 4. Paste URL into SHEETS_URL, set USE_SHEETS = true
// ─────────────────────────────────────────────────────────────────────────────

const USE_SHEETS = true;
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxcLcDKqhp6qDK2U0Fx4Hm3Mj8p7fQbAifawmecRvNBBxFWzc2bAJ2RFnAZOmbj1aue/exec';

// ── LOCAL STORAGE ────────────────────────────────────────────────────────────

const STORE_KEY   = 'wilcy_pos_v3';
const PENDING_KEY = 'wilcy_pending_sales_v1';

const DEFAULT_DATA = {
  items: [
    { id: 'demo001', name: 'Wireless Earbuds',       sku: 'WE-001', qty: 25, origPrice: 450,  price: 799,  threshold: 5 },
    { id: 'demo002', name: 'USB-C Hub 7-in-1',       sku: 'UC-007', qty: 4,  origPrice: 620,  price: 950,  threshold: 5 },
    { id: 'demo003', name: 'Mechanical Keyboard',    sku: 'MK-104', qty: 0,  origPrice: 1200, price: 1850, threshold: 3 },
    { id: 'demo004', name: 'Phone Stand Adjustable', sku: 'PS-ADJ', qty: 18, origPrice: 85,   price: 149,  threshold: 5 }
  ],
  sales: []
};

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('loadLocal failed:', e); }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { console.warn('saveLocal failed:', e); }
}

// ── DATE NORMALIZER ───────────────────────────────────────────────────────────
// Google Sheets / Apps Script sometimes returns dates as full JS date strings
// (e.g. "Mon Apr 14 2026 00:00:00 GMT+0800") instead of "YYYY-MM-DD".
// This function enforces YYYY-MM-DD on every sale object.

function normalizeSaleDate(sale) {
  if (!sale.date) { sale.date = ''; return sale; }
  // Already correct format
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(sale.date))) return sale;
  try {
    const d = new Date(sale.date);
    if (!isNaN(d.getTime())) {
      sale.date =
        d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }
  } catch (e) {}
  return sale;
}

// ── PENDING SALES QUEUE ───────────────────────────────────────────────────────
// New sales are written here before the network call.
// On every page load, any unconfirmed pending sales are re-sent to Sheets.
// This guarantees no sale is lost even if the tab is closed mid-request.

function loadPendingSales() {
  try { const r = localStorage.getItem(PENDING_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function savePendingSales(arr) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); } catch {}
}
function addToPendingQueue(sales) {
  const pending = loadPendingSales();
  const ids = new Set(pending.map(s => s.id));
  sales.forEach(s => { if (!ids.has(s.id)) pending.push(s); });
  savePendingSales(pending);
}
function removeFromPendingQueue(confirmedIds) {
  const set = new Set(confirmedIds);
  savePendingSales(loadPendingSales().filter(s => !set.has(s.id)));
}

async function flushPendingSales() {
  const pending = loadPendingSales();
  if (!pending.length) return;
  try {
    await sheetsRequest('appendSales', { sales: pending });
    removeFromPendingQueue(pending.map(s => s.id));
    console.log('[Sheets] Flushed', pending.length, 'pending sale(s).');
  } catch (e) {
    console.warn('[Sheets] Could not flush pending sales, will retry next load:', e);
  }
}

// ── GOOGLE SHEETS API ─────────────────────────────────────────────────────────

async function sheetsRequest(action, payload = {}) {
  const res = await fetch(SHEETS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body:    JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error(`Sheets HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Sheets error: ${json.error}`);
  return json;
}

// ── DB + SYNC STATE ───────────────────────────────────────────────────────────

let db          = null;
let sheetsReady = false;

function scheduleReconnect() {
  setTimeout(async () => {
    try {
      await sheetsRequest('ping');
      sheetsReady = true;
      setSyncStatus('live');
      await flushPendingSales();
    } catch {}
  }, 30_000);
}

// ── initDB ────────────────────────────────────────────────────────────────────
// 1. Load localStorage immediately (instant, works offline).
// 2. If USE_SHEETS, fetch from Sheets and merge.
//    - Sheets is the source of truth for inventory.
//    - Sales are merged: Sheets wins, but any locally-pending sales are kept.
// 3. Flush any pending (unconfirmed) sales to Sheets.

async function initDB() {
  // Always start with local data so the UI is never blank
  db = loadLocal();
  db.sales = (db.sales || []).map(normalizeSaleDate);

  if (!USE_SHEETS) {
    setSyncStatus('local');
    return;
  }

  setSyncStatus('syncing');

  try {
    const data = await sheetsRequest('getAll');

    const sheetsItems = Array.isArray(data.items) ? data.items : [];
    const sheetsSales = (Array.isArray(data.sales) ? data.sales : [])
      .map(normalizeSaleDate);

    // Any sales in localStorage that Sheets doesn't have yet
    const sheetsIds        = new Set(sheetsSales.map(s => s.id));
    const localUnconfirmed = (db.sales || []).filter(s => !sheetsIds.has(s.id));

    db = {
      items: sheetsItems,
      sales: [...sheetsSales, ...localUnconfirmed],
    };

    sheetsReady = true;
    setSyncStatus('live');
    saveLocal();

    // Re-send any sales the server hasn't confirmed yet
    await flushPendingSales();

  } catch (e) {
    console.warn('[Sheets] initDB failed, using localStorage:', e);
    setSyncStatus('offline');
    scheduleReconnect();
  }
}

// ── saveData ──────────────────────────────────────────────────────────────────
// opts:
//   { newSales }      — append new sale rows to Sheets Sales tab
//   { updatedItem }   — upsert one inventory item
//   { deletedItemId } — remove one inventory item
//   { full: true }    — replace ALL data (used by clearAllSales in history.js)
//
// NOTE: "Clear Today" on the dashboard never calls saveData — it only modifies
// the local in-memory view so that sales history in Sheets is always preserved.

async function saveData(opts = {}) {
  // 1. Always persist locally first (synchronous)
  saveLocal();

  // 2. Enqueue new sales BEFORE the network call so a closed tab can't lose them
  if (opts.newSales && opts.newSales.length > 0) {
    addToPendingQueue(opts.newSales);
  }

  if (!USE_SHEETS || !sheetsReady) return;

  setSyncStatus('syncing');

  try {
    if (opts.newSales && opts.newSales.length > 0) {
      await sheetsRequest('appendSales', { sales: opts.newSales });
      removeFromPendingQueue(opts.newSales.map(s => s.id));

    } else if (opts.updatedItem) {
      await sheetsRequest('upsertItem', { item: opts.updatedItem });

    } else if (opts.deletedItemId) {
      await sheetsRequest('deleteItem', { id: opts.deletedItemId });

    } else if (opts.full) {
      await sheetsRequest('replaceAll', { items: db.items, sales: db.sales });
      savePendingSales([]); // everything is now in Sheets
    }

    setSyncStatus('live');

  } catch (e) {
    console.warn('[Sheets] saveData failed — data is safe in localStorage:', e);
    setSyncStatus('offline');
    sheetsReady = false;
    scheduleReconnect();
  }
}

// ── SYNC STATUS BADGE ─────────────────────────────────────────────────────────

function setSyncStatus(state) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const states = {
    live:    { cls: 'sync-live',    icon: '●', text: 'Google Sheets' },
    syncing: { cls: 'sync-syncing', icon: '↻', text: 'Syncing…'      },
    offline: { cls: 'sync-offline', icon: '⚠', text: 'Sheets offline — local' },
    local:   { cls: 'sync-local',   icon: '◉', text: 'Local mode'    },
  };
  const s = states[state] || states.local;
  el.className = `sync-badge ${s.cls}`;
  el.innerHTML = `<span>${s.icon}</span> ${s.text}`;
}