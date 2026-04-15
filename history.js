// ─── WILCY POS — history.js ──────────────────────────────────────────────────
// NOTE: history.html does NOT load app.js, so all shared helpers live here too.

// ── SHARED HELPERS (history page doesn't load app.js) ────────────────────────

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

// ── HISTORY STATE ─────────────────────────────────────────────────────────────

let historySortKey = 'date';
let historySortDir = 'desc';

async function initHistory() {
  const dateBadge = document.getElementById('dateBadge');
  if (dateBadge) dateBadge.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  await initDB();

  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - 29);
  document.getElementById('hDateFrom').value = from.toISOString().slice(0, 10);
  document.getElementById('hDateTo').value   = today.toISOString().slice(0, 10);

  renderHistoryStats();
  renderHistory();
  renderTopItemsChart();
  renderDailyRevenueChart();
}

// ── STATS ────────────────────────────────────────────────────────────────────

function renderHistoryStats() {
  if (!db) return;
  const all      = db.sales;
  const totalRev = all.reduce((a, s) => a + s.revenue, 0);
  const totalUnits = all.reduce((a, s) => a + s.qty, 0);
  const avgSale  = all.length ? (all.reduce((a, s) => a + s.total, 0) / all.length) : 0;

  setText('h-totalTxns',  all.length);
  setText('h-txnSub',     `across ${[...new Set(all.map(s=>s.date))].length} days`);
  setText('h-totalRev',   fmt(totalRev));
  setText('h-revSub',     `${all.length} transactions total`);
  setText('h-unitsSold',  totalUnits);
  setText('h-unitsSub',   `${[...new Set(all.map(s=>s.itemId))].length} unique items`);
  setText('h-avgSale',    fmt(avgSale));
}

// ── HISTORY TABLE ────────────────────────────────────────────────────────────

function getFilteredSales() {
  const q       = (document.getElementById('hSearch')?.value || '').toLowerCase();
  const dateFrom = document.getElementById('hDateFrom')?.value || '';
  const dateTo   = document.getElementById('hDateTo')?.value   || '';
  const pay      = document.getElementById('hPayFilter')?.value || 'all';

  return db.sales.filter(s => {
    if (q && !s.itemName.toLowerCase().includes(q) && !s.sku.toLowerCase().includes(q)) return false;
    // Normalize the sale date to YYYY-MM-DD before comparing, in case any
    // old cached records slipped through without normalization
    let sDate = s.date || '';
    if (sDate && !/^\d{4}-\d{2}-\d{2}$/.test(sDate)) {
      try {
        const d = new Date(sDate);
        if (!isNaN(d.getTime())) {
          sDate = d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
        }
      } catch {}
    }
    if (dateFrom && sDate < dateFrom) return false;
    if (dateTo   && sDate > dateTo)   return false;
    if (pay !== 'all' && (s.payment || 'Cash') !== pay) return false;
    return true;
  });
}

function sortHistory(key) {
  if (historySortKey === key) {
    historySortDir = historySortDir === 'asc' ? 'desc' : 'asc';
  } else {
    historySortKey = key;
    historySortDir = key === 'date' ? 'desc' : 'asc';
  }
  renderHistory();
}

function renderHistory() {
  const body    = document.getElementById('historyBody');
  const footer  = document.getElementById('historyFooter');
  if (!body) return;

  let rows = getFilteredSales();

  // Sort
  rows = rows.slice().sort((a, b) => {
    let va = a[historySortKey] ?? '';
    let vb = b[historySortKey] ?? '';
    if (historySortKey === 'date') {
      va = a.date + ' ' + (a.time || '');
      vb = b.date + ' ' + (b.time || '');
    }
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return historySortDir === 'asc' ? -1 : 1;
    if (va > vb) return historySortDir === 'asc' ?  1 : -1;
    return 0;
  });

  // Update sort icons
  ['date','itemName','qty','pricePerPc','total','revenue'].forEach(k => {
    const el = document.getElementById('sort-' + k);
    if (el) el.textContent = historySortKey === k ? (historySortDir === 'asc' ? ' ↑' : ' ↓') : '';
  });

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📋</div><p>No sales match your filters.</p></div></td></tr>`;
    if (footer) footer.innerHTML = '';
    return;
  }

  body.innerHTML = rows.map(s => {
    const pay = s.payment || 'Cash';
    return `<tr>
      <td class="td-mono" style="font-size:0.75rem;">
        <div>${s.date}</div>
        <div style="color:var(--text4)">${s.time || ''}</div>
      </td>
      <td><div class="td-name" style="font-size:0.85rem;">${escHtml(s.itemName)}</div></td>
      <td class="td-sku" style="font-size:0.72rem;">${escHtml(s.sku)}</td>
      <td class="td-mono">${s.qty}</td>
      <td class="td-mono">${fmt(s.pricePerPc)}</td>
      <td class="td-mono" style="font-weight:700;">${fmt(s.total)}</td>
      <td class="margin-pos">${fmt(s.revenue)}</td>
      <td><span class="pay-chip pay-${pay.toLowerCase()}">${pay}</span></td>
      <td style="font-size:0.82rem;color:var(--text3);">${escHtml(s.customer || 'Walk-in')}</td>
    </tr>`;
  }).join('');

  // Footer totals
  const totRev   = rows.reduce((a, s) => a + s.revenue, 0);
  const totTotal = rows.reduce((a, s) => a + s.total, 0);
  const totQty   = rows.reduce((a, s) => a + s.qty, 0);

  if (footer) {
    footer.innerHTML = `<div class="history-footer-row">
      <span>${rows.length} transaction${rows.length!==1?'s':''} &nbsp;·&nbsp; ${totQty} units sold</span>
      <span>Total sale: <strong>${fmt(totTotal)}</strong> &nbsp;|&nbsp; Total revenue: <strong style="color:var(--green)">${fmt(totRev)}</strong></span>
    </div>`;
  }

  // Update charts with filtered data
  renderTopItemsChart(rows);
  renderDailyRevenueChart(rows);
}

function resetHistoryFilters() {
  setVal('hSearch', '');
  setVal('hPayFilter', 'all');
  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - 29);
  document.getElementById('hDateFrom').value = from.toISOString().slice(0, 10);
  document.getElementById('hDateTo').value   = today.toISOString().slice(0, 10);
  renderHistory();
}

// ── EXPORT ───────────────────────────────────────────────────────────────────

function exportSalesCSV() {
  const rows = [['Date', 'Time', 'Item', 'SKU', 'Qty', 'Price/PC', 'Total Sale', 'Revenue', 'Payment', 'Customer']];
  getFilteredSales().forEach(s => {
    rows.push([s.date, s.time || '', s.itemName, s.sku, s.qty, s.pricePerPc, s.total, s.revenue, s.payment || 'Cash', s.customer || 'Walk-in']);
  });
  downloadCSV(rows, 'wilcy_sales_history_' + new Date().toISOString().slice(0,10) + '.csv');
  toast('Sales history exported!', 'success');
}

function printHistory() {
  window.print();
}

async function clearAllSales() {
  if (!db.sales.length) return toast('No sales history to clear.', 'warn');
  if (!confirm('Clear ALL sales history? This will permanently delete everything from Google Sheets too. This cannot be undone.')) return;
  db.sales = [];
  await saveData({ full: true });
  renderHistoryStats();
  renderHistory();
  toast('All sales history cleared.', 'warn');
}

// ── CHARTS (pure CSS/HTML, no libs) ─────────────────────────────────────────

function renderTopItemsChart(rows) {
  rows = rows || getFilteredSales();
  const el = document.getElementById('topItemsChart');
  if (!el) return;

  const map = {};
  rows.forEach(s => {
    if (!map[s.itemName]) map[s.itemName] = 0;
    map[s.itemName] += s.revenue;
  });

  const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, 8);

  if (!sorted.length) {
    el.innerHTML = '<div class="empty-state" style="padding:40px 0"><div class="empty-icon">📊</div><p>No data for selected range.</p></div>';
    return;
  }

  const max = sorted[0][1];
  const colors = ['#4f6ef7','#0fb8a0','#f75f8f','#f59e0b','#10b981','#8b5cf6','#ef4444','#06b6d4'];

  el.innerHTML = sorted.map(([name, rev], i) => {
    const pct = Math.round((rev / max) * 100);
    return `<div class="chart-row">
      <div class="chart-label" title="${escHtml(name)}">${escHtml(name.length > 22 ? name.slice(0,22)+'…' : name)}</div>
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="width:${pct}%;background:${colors[i%colors.length]}"></div>
      </div>
      <div class="chart-val">${fmt(rev)}</div>
    </div>`;
  }).join('');
}

function renderDailyRevenueChart(rows) {
  rows = rows || getFilteredSales();
  const el = document.getElementById('dailyRevenueChart');
  if (!el) return;

  const map = {};
  rows.forEach(s => {
    if (!map[s.date]) map[s.date] = 0;
    map[s.date] += s.revenue;
  });

  const sorted = Object.entries(map).sort((a,b) => a[0].localeCompare(b[0])).slice(-14);

  if (!sorted.length) {
    el.innerHTML = '<div class="empty-state" style="padding:40px 0"><div class="empty-icon">📈</div><p>No data for selected range.</p></div>';
    return;
  }

  const max = Math.max(...sorted.map(([,v])=>v));

  el.innerHTML = `<div class="bar-chart">` +
    sorted.map(([date, rev]) => {
      const pct = Math.round((rev / max) * 100);
      const d   = new Date(date + 'T00:00:00');
      const lbl = d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
      return `<div class="bar-col">
        <div class="bar-tip">${fmt(rev)}</div>
        <div class="bar-body" style="height:${Math.max(pct,4)}%"></div>
        <div class="bar-lbl">${lbl}</div>
      </div>`;
    }).join('') +
  `</div>`;
}

// ── BOOT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', initHistory);