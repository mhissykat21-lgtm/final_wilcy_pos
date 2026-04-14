// ─── WILCY POS — auth.js ─────────────────────────────────────────────────────

const AUTH_KEY       = 'wilcy_session';
const IDLE_MINUTES   = 15;       // auto-logout after 15 min idle
const WARN_SECONDS   = 60;       // show warning 60s before logout

// ── USERS (in production, replace with server-side auth) ─────────────────────
const USERS = [
  { username: 'admin',   password: '050720', role: 'Admin',   display: 'Administrator' },
  { username: 'cashier', password: 'pos2024',  role: 'Cashier', display: 'Cashier'       },
];

// ── SESSION ──────────────────────────────────────────────────────────────────

function getSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSession(user) {
  sessionStorage.setItem(AUTH_KEY, JSON.stringify({
    username: user.username,
    role:     user.role,
    display:  user.display,
    loginAt:  Date.now()
  }));
}

function clearSession() {
  sessionStorage.removeItem(AUTH_KEY);
}

function requireAuth() {
  const session = getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

// ── LOGIN FORM ───────────────────────────────────────────────────────────────

function doLogin() {
  const username = document.getElementById('loginUser')?.value.trim();
  const password = document.getElementById('loginPass')?.value;
  const errEl    = document.getElementById('loginError');

  if (!username || !password) {
    showLoginError('Please enter both username and password.');
    return;
  }

  const user = USERS.find(u => u.username === username && u.password === password);

  if (!user) {
    showLoginError('Invalid username or password. Please try again.');
    document.getElementById('loginPass').value = '';
    document.getElementById('loginPass').focus();
    return;
  }

  setSession(user);
  window.location.href = 'index.html';
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (el) { el.textContent = msg; el.style.display = 'flex'; }
}

function togglePw() {
  const inp = document.getElementById('loginPass');
  const btn = document.getElementById('pwToggle');
  if (!inp) return;
  inp.type   = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

// ── IDLE TIMER ───────────────────────────────────────────────────────────────

let idleTimer   = null;
let warnTimer   = null;
let warnVisible = false;

const IDLE_MS = IDLE_MINUTES * 60 * 1000;
const WARN_MS = (IDLE_MINUTES * 60 - WARN_SECONDS) * 1000;

function resetIdle() {
  clearTimeout(idleTimer);
  clearTimeout(warnTimer);

  if (warnVisible) hideIdleWarning();

  warnTimer = setTimeout(showIdleWarning, WARN_MS);
  idleTimer = setTimeout(forceLogout,     IDLE_MS);
}

function showIdleWarning() {
  warnVisible = true;
  const existing = document.getElementById('idleWarning');
  if (existing) return;

  const div = document.createElement('div');
  div.id        = 'idleWarning';
  div.className = 'idle-warning';
  div.innerHTML = `
    <div class="idle-warning-inner">
      <div class="idle-ico">⏱</div>
      <div>
        <strong>Still there?</strong>
        <p>You'll be signed out in <span id="idleCountdown">${WARN_SECONDS}</span>s due to inactivity.</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="stayActive()">Stay signed in</button>
    </div>`;
  document.body.appendChild(div);

  let count = WARN_SECONDS;
  const interval = setInterval(() => {
    count--;
    const el = document.getElementById('idleCountdown');
    if (el) el.textContent = count;
    if (count <= 0) clearInterval(interval);
  }, 1000);

  div._interval = interval;
}

function hideIdleWarning() {
  warnVisible = false;
  const el = document.getElementById('idleWarning');
  if (el) { clearInterval(el._interval); el.remove(); }
}

function stayActive() {
  resetIdle();
}

function forceLogout() {
  clearSession();
  window.location.href = 'login.html?reason=idle';
}

function doLogout() {
  clearSession();
  window.location.href = 'login.html';
}

function initIdleTimer() {
  ['mousemove','mousedown','keydown','scroll','touchstart','click'].forEach(ev => {
    document.addEventListener(ev, resetIdle, { passive: true });
  });
  resetIdle();
}

// ── HEADER USER CHIP ─────────────────────────────────────────────────────────

function renderUserChip(session) {
  const wrap = document.getElementById('userChip');
  if (!wrap || !session) return;
  wrap.innerHTML = `
    <div class="user-chip">
      <div class="user-avatar">${session.display[0]}</div>
      <div class="user-info">
        <span class="user-name">${escHtml(session.display)}</span>
        <span class="user-role">${session.role}</span>
      </div>
      <button class="logout-btn" onclick="doLogout()" title="Sign out">⏻</button>
    </div>`;
}

// ── BOOT ON PROTECTED PAGES ──────────────────────────────────────────────────

function bootAuth() {
  // On login page: if already logged in, redirect away
  if (window.location.pathname.endsWith('login.html')) {
    if (getSession()) window.location.href = 'index.html';

    // Handle idle redirect message
    const params = new URLSearchParams(window.location.search);
    if (params.get('reason') === 'idle') {
      document.addEventListener('DOMContentLoaded', () => {
        showLoginError('You were signed out due to inactivity.');
      });
    }

    // Bind Enter key on login form
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('loginPass')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') doLogin();
      });
      document.getElementById('loginUser')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('loginPass')?.focus();
      });
    });
    return;
  }

  // On all other pages: require auth
  const session = requireAuth();
  if (!session) return;

  document.addEventListener('DOMContentLoaded', () => {
    renderUserChip(session);
    initIdleTimer();

    // Expose session globally
    window.currentSession = session;

    // Show role-restricted elements
    if (session.role !== 'Admin') {
      document.querySelectorAll('[data-role="admin"]').forEach(el => {
        el.style.display = 'none';
      });
    }
  });
}

// ── SHARED HELPERS (also used in login.html) ─────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, type = 'success') {
  const icons = { success: '✓', error: '✕', warn: '⚠' };
  const el    = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-icon">${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toastContainer')?.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

bootAuth();
