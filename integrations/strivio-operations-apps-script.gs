/** Strivio Operations - clean sheet foundation.
 * This script is intended to be bound to the new "Strivio Operations" spreadsheet.
 * Phase 1: build clean sheets and styling only.
 * Phase 2: wire these sheets to Supabase sheet_commands + sync views.
 */

const STRIVIO_GREEN = '#39ff14';
const STRIVIO_BLACK = '#050505';
const STRIVIO_DARK = '#111111';
const STRIVIO_BORDER = '#2a2a2a';
const STRIVIO_SPREADSHEET_ID = '1kH-PUPdxpIH7MYUPDk9MOUIgjKQc7LEz5kU4WMP_AMo';
const NETFLIX_SHEET_NAME = 'Netflix Inventory';

const SHEET_DEFS = [
  {
    name: 'Dashboard',
    color: '#39ff14',
    headers: ['section', 'value', 'notes'],
    widths: [260, 260, 620],
  },
  {
    name: 'Orders',
    color: '#39ff14',
    headers: ['order_id', 'created_at', 'order_status', 'fulfillment_status', 'payment_method', 'total_dzd', 'first_name', 'last_name', 'customer_email', 'customer_phone', 'items_count', 'sheet_version', 'last_sheet_sync_at', 'sync_state'],
    widths: [320, 190, 150, 190, 170, 140, 170, 170, 300, 210, 120, 130, 210, 160],
  },
  {
    name: 'Fulfillments',
    color: '#39ff14',
    headers: ['fulfillment_id', 'order_id', 'created_at', 'updated_at', 'service_id', 'mode', 'fulfillment_status', 'quantity', 'product_name', 'duration', 'customer_account_email', 'customer_account_password', 'customer_note', 'admin_notes', 'first_name', 'last_name', 'customer_email', 'customer_phone', 'total_dzd', 'email_status', 'email_error', 'sheet_version'],
    widths: [320, 320, 190, 190, 170, 190, 180, 110, 260, 160, 320, 260, 420, 420, 170, 170, 300, 210, 130, 150, 360, 130],
    validations: {
      fulfillment_status: ['pending', 'processing', 'awaiting_customer', 'awaiting_admin', 'delivered', 'problem', 'failed', 'cancelled', 'out_of_stock'],
    },
  },
  {
    name: 'Spotify',
    color: '#1db954',
    headers: ['fulfillment_id', 'order_id', 'created_at', 'updated_at', 'service_id', 'mode', 'fulfillment_status', 'problem_status', 'spotify_email', 'spotify_password', 'customer_note', 'admin_notes', 'first_name', 'last_name', 'customer_email', 'customer_phone', 'total_dzd', 'email_status', 'email_error', 'sheet_version', 'last_problem_id'],
    widths: [320, 320, 190, 190, 170, 190, 180, 160, 320, 260, 420, 420, 170, 170, 300, 210, 130, 150, 360, 130, 320],
    validations: {
      fulfillment_status: ['pending', 'processing', 'awaiting_customer', 'awaiting_admin', 'delivered', 'problem', 'failed', 'cancelled', 'out_of_stock'],
      problem_status: ['', 'open', 'reviewing', 'resolved', 'closed'],
    },
  },
  {
    name: 'Promotional Gifts',
    color: '#39ff14',
    headers: ['benefit_id', 'created_at', 'updated_at', 'status', 'order_id', 'rule_id', 'source_item_index', 'gift_item_index', 'gift_service_id', 'duration_months', 'quantity', 'allocation_policy', 'fulfillment_id', 'account_label', 'profile', 'starts_at', 'ends_at', 'first_name', 'last_name', 'customer_email', 'customer_phone', 'source_product', 'gift_product', 'order_status', 'fulfillment_status'],
    widths: [320, 190, 190, 160, 320, 320, 140, 140, 180, 140, 110, 190, 320, 260, 180, 180, 180, 170, 170, 300, 210, 260, 260, 160, 190],
    validations: {
      status: ['pending', 'processing', 'allocated', 'delivered', 'awaiting_stock', 'failed', 'cancelled', 'expired'],
    },
  },
  {
    name: 'Problems',
    color: '#ff4d4d',
    headers: ['problem_id', 'created_at', 'updated_at', 'status', 'order_id', 'fulfillment_id', 'service_id', 'product_name', 'message', 'admin_notes', 'resolved_at', 'first_name', 'last_name', 'customer_email', 'customer_phone', 'fulfillment_status', 'fulfillment_mode', 'sheet_version', 'last_sheet_sync_at'],
    widths: [320, 190, 190, 150, 320, 320, 170, 260, 620, 520, 190, 170, 170, 300, 210, 180, 180, 130, 210],
    validations: {
      status: ['open', 'reviewing', 'resolved', 'closed'],
    },
  },
  {
    name: 'Netflix Inventory',
    color: '#e50914',
    headers: ['profile_name', 'account_email', 'password', 'duration', 'ends_at', 'unit_price', 'pay', 'profile_status', 'customer_phone', 'customer_email', 'pin', 'customer_name', 'order_created_at', 'order_id', 'account_id', 'service_id', 'account_label', 'account_status', 'slot_id', 'slot_status', 'allocation_id', 'sheet_version', 'admin_notes'],
    widths: [180, 360, 300, 170, 190, 140, 140, 170, 220, 320, 130, 260, 190, 320, 320, 170, 260, 160, 320, 160, 320, 130, 520],
    validations: {
      account_status: ['active', 'maintenance', 'disabled'],
      slot_status: ['available', 'assigned', 'maintenance', 'disabled', 'expired'],
      profile_status: ['available', 'sold', 'problem', 'maintenance', 'disabled', 'expired'],
      pay: ['paid', 'unpaid'],
    },
  },
  {
    name: 'Customers',
    color: '#00c2ff',
    headers: ['customer_email', 'first_name', 'last_name', 'phone', 'orders_count', 'last_order_at', 'last_order_id', 'total_spent_dzd'],
    widths: [320, 180, 180, 220, 130, 190, 320, 170],
  },
  {
    name: 'Sheet Commands',
    color: '#fbbc04',
    headers: ['command_id', 'created_at', 'source_sheet', 'source_row', 'action', 'entity_type', 'entity_id', 'status', 'attempts', 'error_message', 'payload'],
    widths: [320, 190, 180, 120, 240, 160, 320, 140, 110, 520, 700],
    validations: {
      status: ['pending', 'processing', 'applied', 'rejected', 'failed'],
    },
  },
  {
    name: 'Sync Logs',
    color: '#9b59ff',
    headers: ['event_id', 'created_at', 'updated_at', 'event_type', 'entity_type', 'entity_id', 'order_id', 'scope', 'status', 'attempts', 'last_error', 'payload'],
    widths: [320, 190, 190, 240, 160, 320, 320, 160, 140, 110, 560, 700],
    validations: {
      status: ['pending', 'processing', 'done', 'failed', 'cancelled'],
    },
  },
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Strivio Ops')
    .addItem('Build / Repair structure', 'setupStrivioOperations')
    .addItem('Refresh Netflix Inventory', 'refreshNetflixFromDb')
    .addItem('Refresh Spotify', 'refreshSpotifyFromDb')
    .addItem('Refresh Problems', 'refreshProblemsFromDb')
    .addItem('Install edit trigger', 'installStrivioEditTrigger')
    .addSeparator()
    .addItem('About this sheet', 'showStrivioOpsHelp')
    .addToUi();
}

function onEdit(e) {
  return handleSheetEdit_(e);
}

function onSubscriptionEdit(e) {
  return handleSheetEdit_(e);
}

function handleSheetEdit_(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  if (!['Problems', 'Spotify', NETFLIX_SHEET_NAME].includes(sheetName)) return;
  const row = e.range.getRow();
  if (row < dataStartRow_(sheetName)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const headers = headerMap_(sheetName);
    const values = sheet.getRange(row, 1, 1, headers.length).getDisplayValues()[0];
    const record = {};
    headers.forEach((h, i) => record[h] = values[i]);
    if (sheetName === 'Problems') handleProblemEdit_(record);
    if (sheetName === 'Spotify') handleSpotifyEdit_(record);
    if (sheetName === NETFLIX_SHEET_NAME) handleNetflixInventoryEdit_(record);
  } catch (err) {
    writeSyncLog_(getSpreadsheet_(), {
      event_type: 'sheet_edit_error',
      status: 'failed',
      last_error: String(err),
      payload: JSON.stringify({ sheet: sheetName, row }),
    });
  } finally {
    lock.releaseLock();
  }
}

function installStrivioEditTrigger() {
  const ss = getSpreadsheet_();
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(trigger =>
    trigger.getHandlerFunction && trigger.getHandlerFunction() === 'onSubscriptionEdit'
  );
  if (!exists) {
    ScriptApp.newTrigger('onSubscriptionEdit').forSpreadsheet(ss).onEdit().create();
  }
  Logger.log('Strivio edit trigger is ready.');
}

function setupStrivioOperations() {
  const ss = getSpreadsheet_();
  ss.rename('Strivio Operations');

  SHEET_DEFS.forEach((def, index) => {
    const sheet = getOrCreateSheet_(ss, def.name, index);
    setupSheet_(sheet, def);
  });

  setupDashboard_(ss.getSheetByName('Dashboard'));
  removeExtraSheets_(ss);
  reorderSheets_(ss);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const body = JSON.parse(e.postData.contents || '{}');
    const expectedSecret = props.getProperty('STRIVIO_SYNC_SECRET');
    // Fail closed. A missing Script Property must never turn the public web-app
    // endpoint into an unauthenticated writer for the operations workbook.
    if (!expectedSecret) return json_({ success: false, error: 'Sync secret is not configured' });
    if (body.secret !== expectedSecret) return json_({ success: false, error: 'Unauthorized' });

    const ss = getSpreadsheet_();
    // A webhook can arrive for every customer action.  Re-applying colours,
    // widths and header formatting to every tab here made a tiny Spotify
    // update wait behind the whole workbook.  Structure is repaired from the
    // menu; the webhook only verifies the sheets exist and then writes data.
    ensureStrivioOperations_(false);

    if (body.order) {
      upsert_(ss.getSheetByName('Orders'), headerMap_('Orders'), 'order_id', orderRow_(body.order));
      upsertCustomerFromOrder_(ss.getSheetByName('Customers'), body.order);
    }

    if (body.order && Array.isArray(body.fulfillments)) {
      writeFulfillmentRows_(ss, body.order, body.fulfillments);
      writeSpotifyRows_(ss, body.order, body.fulfillments, body.problems || []);
    }

    if (body.order && Array.isArray(body.benefits)) {
      writePromotionalGiftRows_(ss, body.order, body.benefits);
    }

    if (Array.isArray(body.problems)) {
      writeProblemRows_(ss, body.problems);
    }

    if (Array.isArray(body.inventory) && body.inventory.length) {
      writeNetflixInventoryRows_(ss, body.inventory);
    }

    writeSyncLog_(ss, {
      event_id: body.event?.id || '',
      event_type: body.event?.type || 'webhook',
      scope: body.event?.scope || body.event?.source || '',
      status: 'done',
      order_id: body.order?.id || '',
      payload: JSON.stringify({ order: !!body.order, fulfillments: (body.fulfillments || []).length, benefits: (body.benefits || []).length, problems: (body.problems || []).length, inventory: (body.inventory || []).length }),
    });

    return json_({ success: true });
  } catch (err) {
    try {
      writeSyncLog_(getSpreadsheet_(), { event_type: 'webhook_error', status: 'failed', last_error: String(err), payload: '' });
    } catch (_) {}
    return json_({ success: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function showStrivioOpsHelp() {
  SpreadsheetApp.getUi().alert(
    'Strivio Operations',
    'This is the clean operations workbook. Supabase is the source of truth. Sheets will submit commands; backend will apply or reject them, then sync official data back.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function refreshNetflixFromDb() {
  return refreshFromDb_('inventory', true);
}

function refreshSpotifyFromDb() {
  return refreshFromDb_('spotify', false);
}

function refreshProblemsFromDb() {
  return refreshFromDb_('problems', false);
}

function handleProblemEdit_(record) {
  if (!record.problem_id || !record.status) return;
  postSheetWebhook_({
    kind: 'problem_update',
    problem_id: record.problem_id,
    status: record.status,
    admin_notes: record.admin_notes || '',
    sheet_version: Number(record.sheet_version || 0),
  });
  refreshFromDb_('problems', false);
  refreshFromDb_('inventory', true);
  if (String(record.service_id || '').toLowerCase().includes('spotify')) refreshFromDb_('spotify', false);
}

function handleSpotifyEdit_(record) {
  if (!record.fulfillment_id || !record.fulfillment_status) return;
  postSheetWebhook_({
    kind: 'activation',
    fulfillment_id: record.fulfillment_id,
    status: record.fulfillment_status,
    admin_notes: record.admin_notes || '',
    note: record.admin_notes || '',
  });
  refreshFromDb_('spotify', false);
}

function handleNetflixInventoryEdit_(record) {
  if (!record.account_id || !record.slot_id) return;
  postSheetWebhook_({
    kind: 'inventory',
    account_id: record.account_id,
    slot_id: record.slot_id,
    allocation_id: record.allocation_id || '',
    order_id: record.order_id || '',
    service_id: record.service_id || 'netflix',
    account_email: record.account_email || '',
    password: record.password || '',
    profile: record.profile_name || '',
    pin: record.pin || '',
    profile_status: record.profile_status || '',
    slot_status: record.slot_status || '',
    pay: record.pay || '',
    duration: record.duration || '',
    ends_at: record.ends_at || '',
    unit_price: record.unit_price || '',
    client_name: record.customer_name || '',
    client_email: record.customer_email || '',
    client_number: record.customer_phone || '',
    admin_notes: record.admin_notes || '',
    sheet_version: Number(record.sheet_version || 0),
  });
  refreshFromDb_('inventory', true);
}

function refreshFromDb_(scope, includeInventory) {
  return postSheetWebhook_({
    kind: 'refresh_from_db',
    scope,
    include_inventory: includeInventory === true,
    limit: 12,
  });
}

function postSheetWebhook_(payload) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('STRIVIO_SYNC_SECRET');
  const url = props.getProperty('STRIVIO_SHEET_WEBHOOK_URL') || 'https://rrfguexpsfizyijekkmi.supabase.co/functions/v1/sheet-webhook';
  if (!secret) throw new Error('Missing STRIVIO_SYNC_SECRET in Apps Script properties');
  const body = Object.assign({ secret }, payload);
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const text = response.getContentText();
  let data = {};
  try { data = JSON.parse(text || '{}'); } catch (_) { data = { raw: text }; }
  if (response.getResponseCode() >= 300 || data.success === false) {
    throw new Error(data.error || text || `Sheet webhook failed (${response.getResponseCode()})`);
  }
  return data;
}

function ensureStrivioOperations_(forceRepair) {
  const ss = getSpreadsheet_();
  SHEET_DEFS.forEach((def, index) => {
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name, index);
      setupSheet_(sheet, def);
      return;
    }
    // Fast path for normal order/activation webhooks.  This deliberately
    // avoids formatting all nine sheets for every incoming order.
    if (!forceRepair) return;
    const cols = def.headers.length;
    if (sheet.getMaxColumns() < cols) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
    const headerRow = headerRow_(def.name);
    if (def.name === NETFLIX_SHEET_NAME) ensureNetflixTitle_(sheet, cols);
    const current = sheet.getRange(headerRow, 1, 1, cols).getValues()[0].map(String);
    const needsHeaders = current.join('|') !== def.headers.join('|');
    if (needsHeaders) {
      sheet.getRange(headerRow, 1, 1, cols).setValues([def.headers]);
    }
    sheet.setTabColor(def.color);
    sheet.setFrozenRows(headerRow);
    sheet.getRange(headerRow, 1, 1, cols)
      .setBackground(STRIVIO_BLACK)
      .setFontColor(STRIVIO_GREEN)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrap(true);
    (def.widths || []).forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  });
}

function getSpreadsheet_() {
  try {
    return SpreadsheetApp.getActive() || SpreadsheetApp.openById(STRIVIO_SPREADSHEET_ID);
  } catch (_) {
    return SpreadsheetApp.openById(STRIVIO_SPREADSHEET_ID);
  }
}

function getOrCreateSheet_(ss, name, index) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name, index);
  return sheet;
}

function setupSheet_(sheet, def) {
  const cols = def.headers.length;
  if (sheet.getMaxColumns() < cols) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
  if (sheet.getMaxRows() < 50) sheet.insertRowsAfter(sheet.getMaxRows(), 50 - sheet.getMaxRows());

  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.setConditionalFormatRules([]);
  sheet.setTabColor(def.color);
  const headerRow = headerRow_(def.name);
  sheet.setFrozenRows(headerRow);
  if (def.name === NETFLIX_SHEET_NAME) ensureNetflixTitle_(sheet, cols);

  const headerRange = sheet.getRange(headerRow, 1, 1, cols);
  headerRange
    .setValues([def.headers])
    .setBackground(STRIVIO_BLACK)
    .setFontColor(STRIVIO_GREEN)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  sheet.setRowHeight(headerRow, 44);
  sheet.getRange(dataStartRow_(def.name), 1, Math.max(1, sheet.getMaxRows() - dataStartRow_(def.name) + 1), cols)
    .setBackground('#ffffff')
    .setFontColor('#111111')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  (def.widths || []).forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  applyValidations_(sheet, def);
  applyConditionalFormatting_(sheet, def);

  try {
    sheet.getRange(headerRow, 1, Math.max(1, sheet.getMaxRows() - headerRow + 1), cols).createFilter();
  } catch (_) {}
}

function ensureNetflixTitle_(sheet, cols) {
  try { sheet.getRange(1, 1, 1, cols).breakApart(); } catch (_) {}
  sheet.getRange(1, 1, 1, Math.min(cols, 14)).merge()
    .setValue('NETFLIX DATA')
    .setBackground('#ff3045')
    .setFontColor('#000000')
    .setFontWeight('bold')
    .setFontSize(18)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(false);
  sheet.setRowHeight(1, 38);
}

function setupDashboard_(sheet) {
  sheet.clear();
  sheet.setTabColor(STRIVIO_GREEN);
  sheet.setColumnWidths(1, 3, 280);
  sheet.setColumnWidth(3, 720);
  sheet.getRange(1, 1, 1, 3).merge()
    .setValue('STRIVIO OPERATIONS')
    .setBackground(STRIVIO_BLACK)
    .setFontColor(STRIVIO_GREEN)
    .setFontWeight('bold')
    .setFontSize(22)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 54);
  const rows = [
    ['Source of truth', 'Supabase', 'Sheets are an admin interface only.'],
    ['Orders', 'Read-only mirror', 'New orders come from the website/database.'],
    ['Fulfillments', 'Read mirror', 'Every delivery item for every product is mirrored here.'],
    ['Spotify', 'Command surface', 'One activation request per row, using database-exact statuses.'],
    ['Promotional Gifts', 'Read-only mirror', 'Every free bundle item, its shared profile and its delivery state are recorded here.'],
    ['Problems', 'Command surface', 'Resolving a problem will update the linked product/fulfillment.'],
    ['Netflix Inventory', 'Command surface', 'Credential changes update DB first; customer emails are sent only by explicit notify action.'],
    ['Sheet Commands', 'Audit', 'Every sheet-to-database action will be logged here.'],
    ['Sync Logs', 'Audit', 'Every database-to-sheet sync will be logged here.'],
  ];
  sheet.getRange(3, 1, rows.length, 3).setValues(rows);
  sheet.getRange(3, 1, rows.length, 3)
    .setBackground('#101010')
    .setFontColor('#eeeeee')
    .setFontWeight('bold')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.getRange(3, 1, rows.length, 1).setFontColor(STRIVIO_GREEN);
  sheet.setRowHeights(3, rows.length, 42);
}

function applyValidations_(sheet, def) {
  if (!def.validations) return;
  const headers = def.headers;
  const startRow = dataStartRow_(def.name);
  Object.keys(def.validations).forEach((name) => {
    const col = headers.indexOf(name) + 1;
    if (col <= 0) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(def.validations[name], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(startRow, col, Math.max(1, sheet.getMaxRows() - startRow + 1), 1).setDataValidation(rule);
  });
}

function applyConditionalFormatting_(sheet, def) {
  const headers = def.headers;
  const rules = [];
  const startRow = dataStartRow_(def.name);
  const rows = Math.max(1, sheet.getMaxRows() - startRow + 1);
  const all = sheet.getRange(startRow, 1, rows, headers.length);

  const statusCol = ['status', 'fulfillment_status', 'profile_status', 'slot_status', 'problem_status', 'pay'].map(h => headers.indexOf(h) + 1).find(c => c > 0);
  if (statusCol) {
    const letter = columnLetter_(statusCol);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=REGEXMATCH(LOWER($${letter}${startRow}),"problem|open|failed")`).setBackground('#f4cccc').setRanges([all]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=REGEXMATCH(LOWER($${letter}${startRow}),"resolved|delivered|done|sent|available")`).setBackground('#d9ead3').setRanges([all]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=REGEXMATCH(LOWER($${letter}${startRow}),"reviewing|pending|awaiting|processing|maintenance")`).setBackground('#fff2cc').setRanges([all]).build());
  }
  sheet.setConditionalFormatRules(rules);
}

function reorderSheets_(ss) {
  SHEET_DEFS.forEach((def, i) => {
    const sheet = ss.getSheetByName(def.name);
    if (!sheet) return;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
  });
}

function removeExtraSheets_(ss) {
  const allowed = new Set(SHEET_DEFS.map(def => def.name));
  ss.getSheets().forEach(sheet => {
    if (!allowed.has(sheet.getName()) && ss.getSheets().length > allowed.size) {
      ss.deleteSheet(sheet);
    }
  });
}

function headerMap_(sheetName) {
  const def = SHEET_DEFS.find(d => d.name === sheetName);
  if (!def) throw new Error(`Unknown sheet definition: ${sheetName}`);
  return def.headers;
}

function headerRow_(sheetName) {
  return sheetName === NETFLIX_SHEET_NAME ? 2 : 1;
}

function dataStartRow_(sheetName) {
  return headerRow_(sheetName) + 1;
}

function upsert_(sheet, headers, key, data) {
  if (!sheet) throw new Error('Sheet not found');
  const keyIndex = headers.indexOf(key);
  if (keyIndex < 0) throw new Error(`Missing key header: ${key}`);
  const keyValue = String(data[key] || '');
  if (!keyValue) return;
  const last = sheet.getLastRow();
  const startRow = dataStartRow_(sheet.getName());
  const values = last >= startRow ? sheet.getRange(startRow, keyIndex + 1, last - startRow + 1, 1).getDisplayValues().flat().map(String) : [];
  const found = values.indexOf(keyValue);
  const row = headers.map(h => data[h] === undefined ? '' : data[h]);
  if (found < 0) sheet.appendRow(row);
  else sheet.getRange(found + startRow, 1, 1, headers.length).setValues([row]);
}

function orderRow_(order) {
  const c = order.customer_info || {};
  return {
    order_id: order.id,
    created_at: order.created_at || '',
    order_status: order.status || '',
    fulfillment_status: order.fulfillment_status || '',
    payment_method: order.payment_method || '',
    total_dzd: Number(order.total_payable || 0),
    first_name: c.first_name || c.firstname || '',
    last_name: c.last_name || c.lastname || '',
    customer_email: c.email || '',
    customer_phone: c.phone || '',
    items_count: Array.isArray(order.items) ? order.items.length : 0,
    sheet_version: order.sheet_version || 0,
    last_sheet_sync_at: new Date(),
    sync_state: order.sync_state || 'clean',
  };
}

function upsertCustomerFromOrder_(sheet, order) {
  const c = order.customer_info || {};
  const email = String(c.email || '').trim().toLowerCase();
  if (!email) return;
  const headers = headerMap_('Customers');
  const last = sheet.getLastRow();
  const startRow = dataStartRow_(sheet.getName());
  const emailCol = headers.indexOf('customer_email') + 1;
  const existing = last >= startRow ? sheet.getRange(startRow, emailCol, last - startRow + 1, 1).getDisplayValues().flat().map(v => String(v).toLowerCase()) : [];
  const found = existing.indexOf(email);
  const ordersCountCol = headers.indexOf('orders_count') + 1;
  const previousCount = found >= 0 ? Number(sheet.getRange(found + startRow, ordersCountCol).getValue() || 0) : 0;
  upsert_(sheet, headers, 'customer_email', {
    customer_email: email,
    first_name: c.first_name || c.firstname || '',
    last_name: c.last_name || c.lastname || '',
    phone: c.phone || '',
    orders_count: Math.max(previousCount, 0) + (found >= 0 ? 0 : 1),
    last_order_at: order.created_at || '',
    last_order_id: order.id || '',
    total_spent_dzd: Number(order.total_payable || 0),
  });
}

function writeFulfillmentRows_(ss, order, fulfillments) {
  const sheet = ss.getSheetByName('Fulfillments');
  const headers = headerMap_('Fulfillments');
  const c = order.customer_info || {};
  (fulfillments || []).forEach(f => {
    const input = f.customer_input || {};
    const item = Array.isArray(order.items) ? (order.items[Number(f.order_item_index || 0)] || {}) : {};
    upsert_(sheet, headers, 'fulfillment_id', {
      fulfillment_id: f.id,
      order_id: f.order_id || order.id,
      created_at: f.created_at || '',
      updated_at: f.updated_at || '',
      service_id: f.service_id || '',
      mode: f.mode || '',
      fulfillment_status: f.status || '',
      quantity: Number(f.quantity || item.qty || 0),
      product_name: itemName_(item),
      duration: label_(item.durLabelData) || item.durLabel || '',
      customer_account_email: input.account_email || '',
      customer_account_password: input.account_password || '',
      customer_note: input.note || '',
      admin_notes: f.delivery_summary?.admin_notes || f.delivery_summary?.problem_admin_notes || '',
      first_name: c.first_name || c.firstname || '',
      last_name: c.last_name || c.lastname || '',
      customer_email: c.email || '',
      customer_phone: c.phone || '',
      total_dzd: Number(order.total_payable || 0),
      email_status: f.email_status || '',
      email_error: f.email_error || '',
      sheet_version: f.sheet_version || 0,
    });
  });
}

function writePromotionalGiftRows_(ss, order, benefits) {
  const sheet = ss.getSheetByName('Promotional Gifts');
  const headers = headerMap_('Promotional Gifts');
  const customer = order.customer_info || {};
  (benefits || []).forEach(benefit => {
    const sourceItem = (order.items || [])[Number(benefit.source_item_index || 0)] || {};
    const giftItem = (order.items || [])[Number(benefit.gift_item_index || 0)] || {};
    const assignments = Array.isArray(benefit.shared_allocations) ? benefit.shared_allocations : [];
    upsert_(sheet, headers, 'benefit_id', {
      benefit_id: benefit.id || '',
      created_at: benefit.created_at || '',
      updated_at: benefit.updated_at || '',
      status: benefit.status || 'pending',
      order_id: benefit.order_id || order.id || '',
      rule_id: benefit.rule_id || '',
      source_item_index: Number(benefit.source_item_index || 0),
      gift_item_index: Number(benefit.gift_item_index || 0),
      gift_service_id: benefit.gift_service_id || giftItem.id || '',
      duration_months: Number(benefit.duration_months || giftItem.durMonths || 0),
      quantity: Number(benefit.gift_quantity || benefit.quantity || giftItem.qty || 1),
      allocation_policy: benefit.allocation_policy || '',
      fulfillment_id: benefit.fulfillment_id || '',
      account_label: assignments.map(item => item.account_label || '').filter(Boolean).join('\n'),
      profile: assignments.map(item => item.profile || '').filter(Boolean).join('\n'),
      starts_at: assignments.map(item => item.starts_at || '').filter(Boolean).join('\n'),
      ends_at: assignments.map(item => item.ends_at || '').filter(Boolean).join('\n'),
      first_name: customer.first_name || customer.firstname || '',
      last_name: customer.last_name || customer.lastname || '',
      customer_email: customer.email || '',
      customer_phone: customer.phone || '',
      source_product: itemName_(sourceItem),
      gift_product: itemName_(giftItem) || benefit.gift_service_id || '',
      order_status: order.status || '',
      fulfillment_status: order.fulfillment_status || '',
    });
  });
}

function writeSpotifyRows_(ss, order, fulfillments, problems) {
  const sheet = ss.getSheetByName('Spotify');
  const headers = headerMap_('Spotify');
  const c = order.customer_info || {};
  const latestProblemByFulfillment = {};
  (problems || []).forEach(p => {
    if (!p.fulfillment_id) return;
    if (!latestProblemByFulfillment[p.fulfillment_id]) latestProblemByFulfillment[p.fulfillment_id] = p;
  });
  (fulfillments || [])
    .filter(f => String(f.mode || '') === 'manual_activation' || String(f.service_id || '').toLowerCase().includes('spotify'))
    .forEach(f => {
      const input = f.customer_input || {};
      const problem = latestProblemByFulfillment[f.id] || {};
      upsert_(sheet, headers, 'fulfillment_id', {
        fulfillment_id: f.id,
        order_id: f.order_id || order.id,
        created_at: f.created_at || '',
        updated_at: f.updated_at || '',
        service_id: f.service_id || '',
        mode: f.mode || '',
        fulfillment_status: f.status || '',
        problem_status: problem.status || f.delivery_summary?.problem_status || '',
        spotify_email: input.account_email || '',
        spotify_password: input.account_password || '',
        customer_note: input.note || '',
        admin_notes: f.delivery_summary?.admin_notes || '',
        first_name: c.first_name || c.firstname || '',
        last_name: c.last_name || c.lastname || '',
        customer_email: c.email || '',
        customer_phone: c.phone || '',
        total_dzd: Number(order.total_payable || 0),
        email_status: f.email_status || '',
        email_error: f.email_error || '',
        sheet_version: f.sheet_version || 0,
        last_problem_id: problem.id || f.last_problem_id || '',
      });
    });
}

function writeProblemRows_(ss, problems) {
  const sheet = ss.getSheetByName('Problems');
  const headers = headerMap_('Problems');
  (problems || []).forEach(p => upsert_(sheet, headers, 'problem_id', {
    problem_id: p.id,
    created_at: p.created_at || '',
    updated_at: p.updated_at || '',
    status: p.status || 'open',
    order_id: p.order_id || '',
    fulfillment_id: p.fulfillment_id || '',
    service_id: p.service_id || '',
    product_name: p.product_name || '',
    message: p.message || '',
    admin_notes: p.admin_notes || '',
    resolved_at: p.resolved_at || '',
    first_name: firstPart_(p.customer_name),
    last_name: lastPart_(p.customer_name),
    customer_email: p.customer_email || '',
    customer_phone: p.customer_phone || '',
    fulfillment_status: p.fulfillment_status || '',
    fulfillment_mode: p.fulfillment_mode || '',
    sheet_version: p.sheet_version || 0,
    last_sheet_sync_at: new Date(),
  }));
}

function writeNetflixInventoryRows_(ss, rows) {
  const netflixRows = (rows || []).filter(r => String(r.service_id || '').toLowerCase().includes('netflix'));
  const sheet = ss.getSheetByName('Netflix Inventory');
  const headers = headerMap_('Netflix Inventory');
  ensureNetflixTitle_(sheet, headers.length);
  const byAccount = {};
  netflixRows.forEach(r => {
    const key = r.account_id || 'unknown';
    (byAccount[key] = byAccount[key] || []).push(r);
  });
  const accountIds = Object.keys(byAccount).sort((a, b) => {
    const ar = byAccount[a][0] || {};
    const br = byAccount[b][0] || {};
    return String(ar.account_created_at || '').localeCompare(String(br.account_created_at || '')) || String(a).localeCompare(String(b));
  });

  const values = [];
  const accountBlocks = [];
  accountIds.forEach((accountId, accountIndex) => {
    const sorted = byAccount[accountId]
      .sort((a, b) => profileNumber_(a.profile) - profileNumber_(b.profile) || String(a.profile || '').localeCompare(String(b.profile || '')) || String(a.slot_created_at || '').localeCompare(String(b.slot_created_at || '')));
    const first = sorted[0] || {};
    const byProfile = {};
    sorted.forEach(r => { byProfile[profileNumber_(r.profile)] = r; });
    const blockStart = values.length;
    for (let profileIndex = 1; profileIndex <= 5; profileIndex++) {
      const r = byProfile[profileIndex] || {
        account_id: first.account_id || accountId,
        service_id: first.service_id || 'netflix',
        account_label: first.account_label || '',
        account_status: first.account_status || '',
        account_created_at: first.account_created_at || '',
        account_email: first.account_email || '',
        password: first.password || '',
        profile: `Profile ${profileIndex}`,
        profile_status: '',
        slot_status: '',
        admin_notes: 'missing inventory slot in database',
      };
        const profileStatus = normalizeProfileStatus_(r.profile_status || r.slot_status);
        const row = {
          profile_name: r.profile || '',
          account_email: profileIndex === 1 ? r.account_email || '' : '',
          password: profileIndex === 1 ? r.password || '' : '',
          duration: r.duration || '',
          ends_at: r.ends_at || '',
          unit_price: Number(r.unit_price || 0),
          pay: normalizePay_(r.pay),
          profile_status: profileStatus,
          customer_phone: r.client_number || '',
          customer_email: r.client_email || '',
          pin: r.pin || '',
          customer_name: r.client_name || '',
          order_created_at: r.order_created_at || '',
          order_id: r.order_id || '',
          account_id: r.account_id || '',
          service_id: r.service_id || '',
          account_label: r.account_label || '',
          account_status: r.account_status || '',
          slot_id: r.slot_id || '',
          slot_status: normalizeSlotStatus_(r.slot_status),
          allocation_id: r.allocation_id || '',
          sheet_version: r.sheet_version || 0,
          admin_notes: r.admin_notes || '',
        };
        values.push(headers.map(h => row[h] === undefined ? '' : row[h]));
    }
    accountBlocks.push({ start: blockStart, rows: 5, hasCredentials: !!(first.account_email || first.password) });
    if (accountIndex < accountIds.length - 1) values.push(headers.map(() => ''));
  });

  const last = sheet.getLastRow();
  const startRow = dataStartRow_(NETFLIX_SHEET_NAME);
  if (last >= startRow) {
    const range = sheet.getRange(startRow, 1, last - startRow + 1, headers.length);
    try { range.breakApart(); } catch (_) {}
    range.clearContent().clearFormat().clearDataValidations();
  }
  if (!values.length) return;
  sheet.getRange(startRow, 1, values.length, headers.length).setValues(values);
  sheet.getRange(startRow, 1, values.length, headers.length)
    .setBackground('#ffffff')
    .setFontColor('#111111')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(false);
  sheet.setRowHeights(startRow, values.length, 42);

  for (let r = 0; r < values.length; r++) {
    const empty = values[r].every(v => String(v || '') === '');
    if (empty) {
      sheet.getRange(r + startRow, 1, 1, headers.length).setBackground('#333333');
      sheet.setRowHeight(r + startRow, 18);
    }
  }
  const accountEmailCol = headers.indexOf('account_email') + 1;
  const passwordCol = headers.indexOf('password') + 1;
  accountBlocks.forEach(block => {
    const row = startRow + block.start;
    try {
      sheet.getRange(row, accountEmailCol, block.rows, 1).merge()
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      sheet.getRange(row, passwordCol, block.rows, 1).merge()
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    } catch (_) {}
  });
  applyValidations_(sheet, SHEET_DEFS.find(d => d.name === 'Netflix Inventory'));
  applyConditionalFormatting_(sheet, SHEET_DEFS.find(d => d.name === 'Netflix Inventory'));
}

function writeSyncLog_(ss, data) {
  const sheet = ss.getSheetByName('Sync Logs');
  const headers = headerMap_('Sync Logs');
  const eventId = data.event_id || Utilities.getUuid();
  upsert_(sheet, headers, 'event_id', {
    event_id: eventId,
    created_at: new Date(),
    updated_at: new Date(),
    event_type: data.event_type || '',
    entity_type: data.entity_type || '',
    entity_id: data.entity_id || '',
    order_id: data.order_id || '',
    scope: data.scope || '',
    status: data.status || '',
    attempts: data.attempts || 0,
    last_error: data.last_error || '',
    payload: data.payload || '',
  });
}

function normalizeSlotStatus_(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'sold' || text === 'assigned') return 'assigned';
  if (text === 'available') return 'available';
  if (text === 'problem') return 'problem';
  if (text === 'maintenance') return 'maintenance';
  if (text === 'disabled') return 'disabled';
  if (text === 'expired') return 'expired';
  return text || 'available';
}

function normalizeProfileStatus_(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'sold' || text === 'assigned' || text === 'active') return 'sold';
  if (text === 'available') return 'available';
  if (text === 'problem' || text === 'open') return 'problem';
  if (text === 'maintenance') return 'maintenance';
  if (text === 'disabled') return 'disabled';
  if (text === 'expired') return 'expired';
  return text || 'available';
}

function normalizePay_(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'paid' || text === 'yes' || text === 'true') return 'paid';
  return 'unpaid';
}

function profileNumber_(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 9999;
}

function label_(value) {
  if (!value) return '';
  if (typeof value === 'object') return value.ar || value.fr || value.en || '';
  return String(value);
}

function itemName_(item) {
  return label_(item?.nameData) || item?.name || item?.title || item?.id || '';
}

function firstPart_(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function lastPart_(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.slice(1).join(' ');
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function columnLetter_(column) {
  let temp = '';
  let n = column;
  while (n > 0) {
    const rem = (n - 1) % 26;
    temp = String.fromCharCode(65 + rem) + temp;
    n = Math.floor((n - rem - 1) / 26);
  }
  return temp;
}
