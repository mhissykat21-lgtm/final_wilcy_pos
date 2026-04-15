// ─── WILCY POS — sw.js (Service Worker) ──────────────────────────────────────
// Provides full offline support via Cache-First strategy.
// All app shell files are pre-cached on install.
// Google Sheets API calls are queued when offline and replayed when back online.

const CACHE_NAME    = 'wilcy-pos-v1';
const OFFLINE_QUEUE = 'wilcy-sync-queue';

// ── APP SHELL FILES TO PRE-CACHE ─────────────────────────────────────────────
// These are cached immediately when the PWA is installed.
const APP_SHELL = [
  './',
  './index.html',
  './history.html',
  './login.html',
  './style.css',
  './app.js',
  './auth.js',
  './history.js',
  './sheets.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── INSTALL — pre-cache app shell ────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())   // activate immediately, don't wait for old SW to die
  );
});

// ── ACTIVATE — clean up old caches ───────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())  // take control of all open tabs immediately
  );
});

// ── FETCH — serve from cache, fall back to network ───────────────────────────

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ── Google Sheets API calls ──
  // When online  → pass through to network, update nothing (sheets.js handles it)
  // When offline → queue the request and return a fake "queued" response
  if (request.url.includes('script.google.com')) {
    event.respondWith(handleSheetsRequest(request));
    return;
  }

  // ── Everything else → Cache First ──
  // Serves instantly from cache; if not cached, tries network then caches the result.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request)
        .then(response => {
          // Cache successful GET responses for app assets
          if (request.method === 'GET' && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // If completely offline and not cached, return offline page
          if (request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
    })
  );
});

// ── SHEETS REQUEST HANDLER ────────────────────────────────────────────────────

async function handleSheetsRequest(request) {
  try {
    // Try network first
    const response = await fetch(request.clone());
    return response;
  } catch {
    // Offline — queue the request body for later replay
    try {
      const body = await request.clone().text();
      await queueRequest({ url: request.url, body, timestamp: Date.now() });
    } catch (e) {
      console.warn('[SW] Failed to queue Sheets request:', e);
    }

    // Return a synthetic "queued" response so the app doesn't crash
    return new Response(
      JSON.stringify({ ok: true, queued: true, offline: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── OFFLINE QUEUE (IndexedDB) ─────────────────────────────────────────────────

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_QUEUE, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('queue', { keyPath: 'timestamp' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function queueRequest(item) {
  const db    = await openQueueDB();
  const tx    = db.transaction('queue', 'readwrite');
  const store = tx.objectStore('queue');
  store.add(item);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

async function flushQueue(sheetsUrl) {
  if (!sheetsUrl) return;
  const db    = await openQueueDB();
  const tx    = db.transaction('queue', 'readwrite');
  const store = tx.objectStore('queue');
  const all   = await new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });

  for (const item of all) {
    try {
      await fetch(item.url, {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body:    item.body,
      });
      store.delete(item.timestamp);
    } catch {
      break;  // still offline, stop trying
    }
  }
}

// ── BACKGROUND SYNC — replay queue when back online ──────────────────────────

self.addEventListener('sync', event => {
  if (event.tag === 'wilcy-sheets-sync') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        // Ask an open client for the Sheets URL (we can't read app config directly)
        if (clients.length > 0) {
          clients[0].postMessage({ type: 'GET_SHEETS_URL' });
        }
      })
    );
  }
});

// ── MESSAGE HANDLER — receive Sheets URL from client for sync ─────────────────

self.addEventListener('message', event => {
  if (event.data?.type === 'SHEETS_URL') {
    flushQueue(event.data.url);
  }
  // Client can force a cache update (call after deploying new version)
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
