// ─── WILCY POS — sheets_backend.gs ──────────────────────────────────────────
//
// Paste this entire file into your Google Apps Script editor.
// Deploy as Web App:
//   Execute as: Me
//   Who has access: Anyone
//
// The sheet must have two tabs: "Inventory" and "Sales"
// with header rows exactly matching the columns below.
// ─────────────────────────────────────────────────────────────────────────────

// ── COLUMN MAPS ──────────────────────────────────────────────────────────────
//
// Inventory (columns A–G):
//   A=id  B=name  C=sku  D=qty  E=origPrice  F=price  G=threshold
//
// Sales (columns A–N):
//   A=id  B=itemId  C=itemName  D=sku  E=qty  F=pricePerPc  G=origPrice
//   H=revenue  I=total  J=customer  K=payment  L=date  M=time  N=txnId

var INVENTORY_HEADERS = ['id','name','sku','qty','origPrice','price','threshold'];
var SALES_HEADERS     = ['id','itemId','itemName','sku','qty','pricePerPc','origPrice','revenue','total','customer','payment','date','time','txnId'];

// ── ENTRY POINT ───────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var data   = JSON.parse(e.postData.contents);
    var action = data.action;
    var result = {};

    if      (action === 'ping')        result = { ok: true, pong: true };
    else if (action === 'getAll')      result = getAll();
    else if (action === 'upsertItem')  result = upsertItem(data.item);
    else if (action === 'deleteItem')  result = deleteItem(data.id);
    else if (action === 'appendSales') result = appendSales(data.sales);
    else if (action === 'replaceAll')  result = replaceAll(data.items, data.sales);
    else                               result = { error: 'Unknown action: ' + action };

  } catch (err) {
    result = { error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Also handle GET so you can test the URL in a browser
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'WILCY POS backend is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" not found. Did you name your tabs correctly?');
  return sh;
}

/**
 * Ensure header row exists. If the sheet is empty, write headers.
 * If it already has a header row, leave it alone.
 */
function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
}

/**
 * Read all data rows (skip header row 1) from a sheet.
 * Returns an array of plain objects keyed by the header names.
 */
function readRows(sheet, headers) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];   // only header row or empty

  var range = sheet.getRange(2, 1, lastRow - 1, headers.length);
  var values = range.getValues();

  return values
    .filter(function(row) { return row[0] !== '' && row[0] !== null; })  // skip blank rows
    .map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });
}

// ── ACTIONS ───────────────────────────────────────────────────────────────────

/**
 * getAll — fetch entire Inventory + Sales data
 * Returns: { ok: true, items: [...], sales: [...] }
 */
function getAll() {
  var invSheet = getSheet('Inventory');
  var salSheet = getSheet('Sales');

  ensureHeaders(invSheet, INVENTORY_HEADERS);
  ensureHeaders(salSheet, SALES_HEADERS);

  var rawItems = readRows(invSheet, INVENTORY_HEADERS);
  var rawSales = readRows(salSheet, SALES_HEADERS);

  // Cast numeric fields for items
  var items = rawItems.map(function(r) {
    return {
      id:         String(r.id),
      name:       String(r.name),
      sku:        String(r.sku),
      qty:        Number(r.qty)        || 0,
      origPrice:  Number(r.origPrice)  || 0,
      price:      Number(r.price)      || 0,
      threshold:  Number(r.threshold)  || 5,
    };
  });

  // Cast numeric fields for sales
  var sales = rawSales.map(function(r) {
    return {
      id:         String(r.id),
      itemId:     String(r.itemId),
      itemName:   String(r.itemName),
      sku:        String(r.sku),
      qty:        Number(r.qty)        || 0,
      pricePerPc: Number(r.pricePerPc) || 0,
      origPrice:  Number(r.origPrice)  || 0,
      revenue:    Number(r.revenue)    || 0,
      total:      Number(r.total)      || 0,
      customer:   String(r.customer   || 'Walk-in'),
      payment:    String(r.payment    || 'Cash'),
      date:       String(r.date       || ''),
      time:       String(r.time       || ''),
      txnId:      String(r.txnId      || ''),
    };
  });

  return { ok: true, items: items, sales: sales };
}

/**
 * upsertItem — add or update one inventory item.
 * Matches on item.id. Updates the existing row if found, appends a new row if not.
 * Payload: { item: { id, name, sku, qty, origPrice, price, threshold } }
 * Returns: { ok: true }
 */
function upsertItem(item) {
  if (!item || !item.id) throw new Error('upsertItem: missing item.id');

  var sheet    = getSheet('Inventory');
  ensureHeaders(sheet, INVENTORY_HEADERS);

  var lastRow  = sheet.getLastRow();
  var rowIndex = -1;

  if (lastRow >= 2) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();  // column A
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(item.id)) {
        rowIndex = i + 2;  // 1-based, +1 for header
        break;
      }
    }
  }

  var row = [
    item.id,
    item.name       || '',
    item.sku        || '',
    Number(item.qty)        || 0,
    Number(item.origPrice)  || 0,
    Number(item.price)      || 0,
    Number(item.threshold)  || 5,
  ];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return { ok: true };
}

/**
 * deleteItem — remove an inventory item row by id.
 * Payload: { id: 'itemId' }
 * Returns: { ok: true, deleted: true/false }
 */
function deleteItem(id) {
  if (!id) throw new Error('deleteItem: missing id');

  var sheet   = getSheet('Inventory');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, deleted: false };

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);  // +2: 1-based + skip header
      return { ok: true, deleted: true };
    }
  }

  return { ok: true, deleted: false };
}

/**
 * appendSales — add one or more sale records to the Sales sheet.
 * Does NOT touch Inventory (stock deduction is handled client-side via upsertItem).
 * Payload: { sales: [ { id, itemId, itemName, sku, qty, pricePerPc, origPrice,
 *                        revenue, total, customer, payment, date, time }, ... ] }
 * Returns: { ok: true, appended: N }
 */
function appendSales(sales) {
  if (!Array.isArray(sales) || sales.length === 0) return { ok: true, appended: 0 };

  var sheet = getSheet('Sales');
  ensureHeaders(sheet, SALES_HEADERS);

  var rows = sales.map(function(s) {
    return [
      s.id         || '',
      s.itemId     || '',
      s.itemName   || '',
      s.sku        || '',
      Number(s.qty)        || 0,
      Number(s.pricePerPc) || 0,
      Number(s.origPrice)  || 0,
      Number(s.revenue)    || 0,
      Number(s.total)      || 0,
      s.customer   || 'Walk-in',
      s.payment    || 'Cash',
      s.date       || '',
      s.time       || '',
      s.txnId      || '',
    ];
  });

  // Append all rows at once for performance
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, SALES_HEADERS.length).setValues(rows);

  return { ok: true, appended: rows.length };
}

/**
 * replaceAll — clear both sheets and rewrite from scratch.
 * Used after "Clear Today's Sales" or "Clear All History".
 * Payload: { items: [...], sales: [...] }
 * Returns: { ok: true }
 */
function replaceAll(items, sales) {
  var invSheet = getSheet('Inventory');
  var salSheet = getSheet('Sales');

  // Clear and rewrite Inventory
  invSheet.clearContents();
  invSheet.appendRow(INVENTORY_HEADERS);
  if (Array.isArray(items) && items.length > 0) {
    var invRows = items.map(function(i) {
      return [
        i.id,
        i.name       || '',
        i.sku        || '',
        Number(i.qty)        || 0,
        Number(i.origPrice)  || 0,
        Number(i.price)      || 0,
        Number(i.threshold)  || 5,
      ];
    });
    invSheet.getRange(2, 1, invRows.length, INVENTORY_HEADERS.length).setValues(invRows);
  }

  // Clear and rewrite Sales
  salSheet.clearContents();
  salSheet.appendRow(SALES_HEADERS);
  if (Array.isArray(sales) && sales.length > 0) {
    var salRows = sales.map(function(s) {
      return [
        s.id         || '',
        s.itemId     || '',
        s.itemName   || '',
        s.sku        || '',
        Number(s.qty)        || 0,
        Number(s.pricePerPc) || 0,
        Number(s.origPrice)  || 0,
        Number(s.revenue)    || 0,
        Number(s.total)      || 0,
        s.customer   || 'Walk-in',
        s.payment    || 'Cash',
        s.date       || '',
        s.time       || '',
        s.txnId      || '',
      ];
    });
    salSheet.getRange(2, 1, salRows.length, SALES_HEADERS.length).setValues(salRows);
  }

  return { ok: true };
}
