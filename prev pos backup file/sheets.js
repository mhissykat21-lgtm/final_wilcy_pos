// ─── WILCY POS — sheets.js ───────────────────────────────────────────────────
// Google Sheets as database via Apps Script Web App
//
// QUICK SETUP (5 steps):
// ─────────────────────────────────────────────────────────────────────────────
// 1. Create a Google Sheet with two tabs named exactly: "Inventory" and "Sales"
//
// 2. "Inventory" tab — Row 1 headers (A→G):
//    id | name | sku | qty | origPrice | price | threshold
//
// 3. "Sales" tab — Row 1 headers (A→M):
//    id | itemId | itemName | sku | qty | pricePerPc | origPrice |
//    revenue | total | customer | payment | date | time
//
// 4. In the Google Sheet: Extensions → Apps Script
//    • Paste the contents of sheets_backend.gs
//    • Click Deploy → New deployment
//      - Type: Web App
//      - Execute as: Me
//      - Who has access: Anyone
//    • Copy the Web App URL
//
// 5. Paste that URL into SHEETS_URL below, then set USE_SHEETS = true
// ─────────────────────────────────────────────────────────────────────────────

const USE_SHEETS = false;   // ← flip to true after you paste your URL below
const SHEETS_URL = 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';  // ← paste your URL here

// ── LOCAL STORAGE FALLBACK ───────────────────────────────────────────────────

const STORE_KEY = 'wilcy_pos_v3';

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
  } catch (e) {
    console.warn('Failed to load local data:', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveLocal() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    console.warn('Failed to save locally:', e);
  }
}

// ── GOOGLE SHEETS API ────────────────────────────────────────────────────────
//
// Apps Script Web Apps only accept GET or POST.
// We POST a JSON body with { action, ...payload }.
// The response is always { ok: true, ... } or { error: '...' }.
//
// NOTE: Apps Script deployed as "Anyone" does NOT require authentication,
// but it does require the exact URL. Keep it secret — treat it like a password.

async function sheetsRequest(action, payload = {}) {
  const body = JSON.stringify({ action, ...payload });

  const res = await fetch(SHEETS_URL, {
    method:  'POST',
    // Apps Script requires 'text/plain' for POST bodies to avoid CORS preflight
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
  });

  if (!res.ok) {
    throw new Error(`Sheets HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (json.error) {
    throw new Error(`Sheets backend error: ${json.error}`);
  }

  return json;
}

// ── UNIFIED DATA LAYER ────────────────────────────────────────────────────────

let db          = null;      // in-memory working copy
let sheetsReady = false;     // true when Sheets confirmed working

/**
 * initDB()
 * Called once at page load.
 * If USE_SHEETS is true, tries to load everything from Google Sheets.
 * Falls back to localStorage on any error.
 */
async function initDB() {
  if (!USE_SHEETS) {
    db = loadLocal();
    setSyncStatus('local');
    return;
  }

  setSyncStatus('syncing');

  try {
    const data = await sheetsRequest('getAll');
    db = {
      items: Array.isArray(data.items) ? data.items : [],
      sales: Array.isArray(data.sales) ? data.sales : [],
    };
    sheetsReady = true;
    setSyncStatus('live');

    // Mirror to localStorage so we have an offline copy
    saveLocal();

  } catch (e) {
    console.warn('Google Sheets unavailable, falling back to localStorage:', e);
    db = loadLocal();
    setSyncStatus('offline');
  }
}

/**
 * saveData(opts)
 * Always saves to localStorage immediately.
 * Then, if Sheets is active, syncs the relevant change.
 *
 * opts:
 *   { updatedItem }   — upsert one inventory item
 *   { deletedItemId } — remove one inventory item
 *   { newSales }      — append new sale records (array)
 *   { full: true }    — replace ALL data in Sheets (used after clear/bulk ops)
 */
async function saveData(opts = {}) {
  // 1. Always persist locally first (instant, no network)
  saveLocal();

  // 2. If Sheets is not configured or not reachable, we're done
  if (!USE_SHEETS || !sheetsReady) return;

  setSyncStatus('syncing');

  try {
    if (opts.updatedItem) {
      await sheetsRequest('upsertItem', { item: opts.updatedItem });
    }

    if (opts.deletedItemId) {
      await sheetsRequest('deleteItem', { id: opts.deletedItemId });
    }

    if (opts.newSales && opts.newSales.length > 0) {
      await sheetsRequest('appendSales', { sales: opts.newSales });
    }

    if (opts.full) {
      await sheetsRequest('replaceAll', { items: db.items, sales: db.sales });
    }

    setSyncStatus('live');

  } catch (e) {
    console.warn('Sheets sync failed (data saved locally):', e);
    setSyncStatus('offline');
    // Mark Sheets as unreachable so we don't keep retrying every action
    sheetsReady = false;

    // After 30 s, attempt to reconnect automatically
    setTimeout(async () => {
      try {
        await sheetsRequest('ping');
        sheetsReady = true;
        setSyncStatus('live');
      } catch {
        // Still offline — stay in local mode
      }
    }, 30_000);
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
