/* WarrantyWise — Personal Warranty & Product Ownership Tracker.
   Vanilla JS, localStorage only, no external requests, no demo data. */
(function () {
  'use strict';

  var STORAGE_KEY = 'warrantywise.v1';
  var BACKUP_KEY = 'warrantywise.v1.backup';
  var DATA_VERSION = 1;

  var CATEGORIES = ['Electronics', 'Appliances', 'Furniture', 'Vehicles', 'Tools', 'Clothing', 'Jewellery', 'Other'];
  var SERVICE_TYPES = ['Repair', 'Maintenance', 'Inspection', 'Other'];
  var CURRENCIES = ['USD', 'PKR', 'EUR', 'GBP', 'INR', 'AED', 'SAR', 'CAD', 'AUD', 'JPY'];

  var DEFAULT_SETTINGS = { alertWindowDays: 30, currency: 'USD', theme: 'light' };

  var state = { products: [], settings: clone(DEFAULT_SETTINGS), corrupt: false };
  var currentView = 'dashboard';
  var detailProductId = null;
  var editingProductId = null;
  var formOrigin = 'products';
  var editingServiceId = null;
  var deleteAllArmedUntil = 0;
  var deleteAllTimer = null;

  /* ---------- small utilities ---------- */
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
  }

  function toast(message) {
    var t = $('toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  /* ---------- local dates (never UTC) ---------- */
  function parseLocalDate(str) {
    if (typeof str !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
    return d;
  }

  function isValidDateStr(str) { return parseLocalDate(str) !== null; }

  function todayLocal() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function toDateStr(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function dayNumber(d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; }

  function daysUntil(dateStr) {
    var d = parseLocalDate(dateStr);
    if (!d) return null;
    return Math.round(dayNumber(d) - dayNumber(todayLocal()));
  }

  function formatDate(dateStr) {
    var d = parseLocalDate(dateStr);
    if (!d) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------- warranty status ---------- */
  function warrantyStatus(product) {
    if (!product.warrantyEnd) return 'none';
    var days = daysUntil(product.warrantyEnd);
    if (days === null) return 'none';
    if (days < 0) return 'expired';
    if (days <= state.settings.alertWindowDays) return 'soon';
    return 'active';
  }

  var STATUS_LABEL = { active: 'Active', soon: 'Expiring soon', expired: 'Expired', none: 'No warranty' };

  function warrantyLine(product) {
    var status = warrantyStatus(product);
    if (status === 'none') return 'No warranty';
    var days = daysUntil(product.warrantyEnd);
    var dateText = 'Warranty ends ' + formatDate(product.warrantyEnd);
    if (status === 'expired') return dateText + ' · Expired ' + Math.abs(days) + (Math.abs(days) === 1 ? ' day' : ' days') + ' ago';
    if (days === 0) return dateText + ' · Expires today';
    if (days === 1) return dateText + ' · Expires tomorrow';
    return dateText + ' · ' + days + ' days left';
  }

  /* ---------- money ---------- */
  function formatMoney(amount, currency) {
    if (amount === null || amount === undefined || amount === '') return '';
    var code = CURRENCIES.indexOf(currency) !== -1 ? currency : 'USD';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(amount));
    } catch (e) {
      return code + ' ' + Number(amount).toFixed(2);
    }
  }

  /* ---------- storage ---------- */
  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) { state.products = []; state.settings = clone(DEFAULT_SETTINGS); state.corrupt = false; return; }
    try {
      var parsed = JSON.parse(raw);
      var checked = validateData(parsed);
      if (!checked.ok) throw new Error(checked.error);
      state.products = checked.data.products;
      state.settings = checked.data.settings;
      state.corrupt = false;
    } catch (e) {
      // Corrupt stored data: start empty, leave the raw value untouched.
      state.products = [];
      state.settings = clone(DEFAULT_SETTINGS);
      state.corrupt = true;
    }
  }

  function saveState() {
    var payload = { version: DATA_VERSION, products: state.products, settings: state.settings };
    var raw;
    try { raw = JSON.stringify(payload); } catch (e) { return { ok: false, error: 'Could not prepare data to save.' }; }
    var previous = null;
    try { previous = localStorage.getItem(STORAGE_KEY); } catch (e) { previous = null; }
    try {
      // Keep a temporary backup so a failed write can be rolled back.
      if (previous !== null) { try { localStorage.setItem(BACKUP_KEY, previous); } catch (e) { /* backup is best-effort */ } }
      localStorage.setItem(STORAGE_KEY, raw);
      try { localStorage.removeItem(BACKUP_KEY); } catch (e) { /* ignore */ }
      return { ok: true };
    } catch (e) {
      // Roll back to the previous value if the write failed (e.g. quota).
      try { if (previous !== null) localStorage.setItem(STORAGE_KEY, previous); } catch (e2) { /* ignore */ }
      return { ok: false, error: 'Could not save: storage may be full. Your existing data was kept unchanged.' };
    }
  }

  function storageInfo() {
    var raw = '';
    try { raw = localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { raw = ''; }
    var kb = (new Blob([raw]).size / 1024);
    var serviceCount = state.products.reduce(function (n, p) { return n + (p.serviceRecords || []).length; }, 0);
    return state.products.length + (state.products.length === 1 ? ' product' : ' products') +
      ' · ' + serviceCount + (serviceCount === 1 ? ' service record' : ' service records') +
      ' · ' + kb.toFixed(1) + ' KB';
  }

  /* ---------- validation (used for storage, import, and forms) ---------- */
  function validateData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'Backup must be a WarrantyWise data object.' };
    if (data.version !== DATA_VERSION) return { ok: false, error: 'Unsupported backup version: ' + String(data.version) + '. Expected version 1.' };
    if (!Array.isArray(data.products)) return { ok: false, error: 'Backup has no product list.' };
    if (!data.settings || typeof data.settings !== 'object') return { ok: false, error: 'Backup has no settings.' };

    var settings = data.settings;
    if (typeof settings.alertWindowDays !== 'number' || !Number.isInteger(settings.alertWindowDays) ||
        settings.alertWindowDays < 1 || settings.alertWindowDays > 90) {
      return { ok: false, error: 'Settings alert window must be a whole number from 1 to 90.' };
    }
    if (CURRENCIES.indexOf(settings.currency) === -1) return { ok: false, error: 'Settings currency is not supported.' };
    if (settings.theme !== 'light' && settings.theme !== 'dark') return { ok: false, error: 'Settings theme must be light or dark.' };

    var seenProductIds = {};
    var products = [];
    for (var i = 0; i < data.products.length; i++) {
      var p = data.products[i];
      var err = validateProduct(p, seenProductIds);
      if (err) return { ok: false, error: 'Product ' + (i + 1) + ': ' + err };
      seenProductIds[p.id] = true;
      products.push(normalizeProduct(p));
    }
    return { ok: true, data: { products: products, settings: { alertWindowDays: settings.alertWindowDays, currency: settings.currency, theme: settings.theme } } };
  }

  function validateProduct(p, seenIds) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return 'not an object';
    if (typeof p.id !== 'string' || !p.id) return 'missing id';
    if (seenIds && seenIds[p.id]) return 'duplicate id "' + p.id + '"';
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100) return 'name must be 1–100 characters';
    if (p.brand !== undefined && (typeof p.brand !== 'string' || p.brand.length > 100)) return 'brand must be at most 100 characters';
    if (typeof p.category !== 'string' || !p.category.trim() || p.category.length > 50) return 'category must be 1–50 characters';
    if (p.purchaseDate !== null && p.purchaseDate !== undefined && p.purchaseDate !== '' && !isValidDateStr(p.purchaseDate)) return 'purchase date is not a valid date';
    if (p.warrantyEnd !== null && p.warrantyEnd !== undefined && p.warrantyEnd !== '' && !isValidDateStr(p.warrantyEnd)) return 'warranty end date is not a valid date';
    if (p.purchaseDate && p.warrantyEnd && p.warrantyEnd < p.purchaseDate) return 'warranty end is before the purchase date';
    if (p.price !== null && p.price !== undefined && p.price !== '' && (typeof p.price !== 'number' || !isFinite(p.price) || p.price < 0 || p.price > 999999999)) return 'price must be a number from 0';
    if (p.retailer !== undefined && (typeof p.retailer !== 'string' || p.retailer.length > 100)) return 'retailer must be at most 100 characters';
    if (p.serial !== undefined && (typeof p.serial !== 'string' || p.serial.length > 100)) return 'serial number must be at most 100 characters';
    if (p.notes !== undefined && (typeof p.notes !== 'string' || p.notes.length > 1000)) return 'notes must be at most 1000 characters';
    if (!Array.isArray(p.serviceRecords)) return 'service records must be a list';
    var seenServiceIds = {};
    for (var j = 0; j < p.serviceRecords.length; j++) {
      var s = p.serviceRecords[j];
      if (!s || typeof s !== 'object') return 'service record ' + (j + 1) + ' is not an object';
      if (typeof s.id !== 'string' || !s.id) return 'service record ' + (j + 1) + ' has no id';
      if (seenServiceIds[s.id]) return 'duplicate service record id';
      seenServiceIds[s.id] = true;
      if (!isValidDateStr(s.date)) return 'service record ' + (j + 1) + ' has an invalid date';
      if (SERVICE_TYPES.indexOf(s.type) === -1) return 'service record ' + (j + 1) + ' has an unknown type';
      if (typeof s.description !== 'string' || !s.description.trim() || s.description.length > 200) return 'service record ' + (j + 1) + ' description must be 1–200 characters';
      if (s.cost !== null && s.cost !== undefined && s.cost !== '' && (typeof s.cost !== 'number' || !isFinite(s.cost) || s.cost < 0 || s.cost > 999999999)) return 'service record ' + (j + 1) + ' cost must be a number from 0';
      if (s.provider !== undefined && (typeof s.provider !== 'string' || s.provider.length > 100)) return 'service record ' + (j + 1) + ' provider must be at most 100 characters';
    }
    return null;
  }

  function normalizeProduct(p) {
    return {
      id: p.id,
      name: p.name.trim(),
      brand: (p.brand || '').trim(),
      category: p.category.trim(),
      purchaseDate: p.purchaseDate || '',
      warrantyEnd: p.warrantyEnd || '',
      price: (p.price === '' || p.price === null || p.price === undefined) ? null : Number(p.price),
      retailer: (p.retailer || '').trim(),
      serial: (p.serial || '').trim(),
      notes: (p.notes || '').trim(),
      createdAt: p.createdAt || Date.now(),
      serviceRecords: (p.serviceRecords || []).map(function (s) {
        return {
          id: s.id, date: s.date, type: s.type, description: s.description.trim(),
          cost: (s.cost === '' || s.cost === null || s.cost === undefined) ? null : Number(s.cost),
          provider: (s.provider || '').trim()
        };
      })
    };
  }

  /* ---------- confirm modal ---------- */
  var confirmResolve = null;
  function askConfirm(title, text, okLabel) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmOk').textContent = okLabel || 'Delete';
    $('confirmBackdrop').hidden = false;
    $('confirmOk').focus();
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }
  function closeConfirm(result) {
    $('confirmBackdrop').hidden = true;
    if (confirmResolve) { var r = confirmResolve; confirmResolve = null; r(result); }
  }

  /* ---------- rendering ---------- */
  var VIEW_TITLES = { dashboard: 'Dashboard', products: 'My Products', form: 'Add Product', detail: 'Product Details', settings: 'Settings' };

  function showView(view) {
    currentView = view;
    ['dashboard', 'products', 'form', 'detail', 'settings'].forEach(function (v) {
      $('view-' + v).hidden = (v !== view);
    });
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      var active = b.getAttribute('data-view') === view || (view === 'detail' && b.getAttribute('data-view') === 'products');
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('pageTitle').textContent = VIEW_TITLES[view] || 'WarrantyWise';
    window.scrollTo(0, 0);
  }

  function badge(status) {
    return el('span', 'badge badge-' + status, STATUS_LABEL[status]);
  }

  function productCard(p, showActions) {
    var li = el('li', 'item-card');
    li.setAttribute('tabindex', '0');
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', 'Open details for ' + p.name);
    var main = el('div', 'item-main');
    var titleRow = el('div');
    titleRow.appendChild(el('span', 'item-title', p.name));
    main.appendChild(titleRow);
    var sub = [];
    if (p.brand) sub.push(p.brand);
    sub.push(p.category);
    main.appendChild(el('div', 'item-sub', sub.join(' · ')));
    var meta = el('div', 'item-meta');
    meta.appendChild(el('span', null, warrantyLine(p)));
    if (p.purchaseDate) meta.appendChild(el('span', null, 'Bought ' + formatDate(p.purchaseDate)));
    if (p.price !== null && p.price !== undefined) meta.appendChild(el('span', null, formatMoney(p.price, state.settings.currency)));
    main.appendChild(meta);
    li.appendChild(main);
    li.appendChild(badge(warrantyStatus(p)));
    if (showActions) {
      var actions = el('div', 'item-actions');
      var editBtn = el('button', 'icon-btn', 'Edit');
      editBtn.type = 'button';
      editBtn.setAttribute('aria-label', 'Edit ' + p.name);
      editBtn.addEventListener('click', function (e) { e.stopPropagation(); openForm(p.id); });
      var delBtn = el('button', 'icon-btn danger', 'Delete');
      delBtn.type = 'button';
      delBtn.setAttribute('aria-label', 'Delete ' + p.name);
      delBtn.addEventListener('click', function (e) { e.stopPropagation(); deleteProduct(p.id); });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      li.appendChild(actions);
    }
    li.addEventListener('click', function () { openDetail(p.id); });
    li.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(p.id); }
    });
    return li;
  }

  function updateStats() {
    var total = state.products.length;
    var active = 0, soon = 0, expired = 0;
    state.products.forEach(function (p) {
      var s = warrantyStatus(p);
      if (s === 'active') active++;
      else if (s === 'soon') soon++;
      else if (s === 'expired') expired++;
    });
    $('statTotal').textContent = String(total);
    $('statActive').textContent = String(active);
    $('statSoon').textContent = String(soon);
    $('statExpired').textContent = String(expired);
  }

  function renderDashboard() {
    updateStats();
    $('soonWindowNote').textContent = 'Alert window: ' + state.settings.alertWindowDays + ' days';
    var soonList = state.products
      .filter(function (p) { return warrantyStatus(p) === 'soon' || warrantyStatus(p) === 'expired'; })
      .sort(function (a, b) {
        var da = daysUntil(a.warrantyEnd), db = daysUntil(b.warrantyEnd);
        return (da === null ? 1e9 : da) - (db === null ? 1e9 : db);
      });
    var attention = $('attentionList');
    attention.innerHTML = '';
    soonList.slice(0, 6).forEach(function (p) { attention.appendChild(productCard(p, false)); });
    $('attentionEmpty').hidden = soonList.length > 0;

    var recent = state.products.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 6);
    var recentList = $('recentList');
    recentList.innerHTML = '';
    recent.forEach(function (p) { recentList.appendChild(productCard(p, false)); });
    $('recentEmpty').hidden = recent.length > 0;
  }

  function renderProducts() {
    var q = ($('searchInput').value || '').trim().toLowerCase();
    var cat = $('filterCategory').value;
    var statusFilter = $('filterStatus').value;
    var sort = $('sortSelect').value;

    var filtered = state.products.filter(function (p) {
      if (cat !== 'all' && p.category !== cat) return false;
      if (statusFilter !== 'all' && warrantyStatus(p) !== statusFilter) return false;
      if (q) {
        var hay = [p.name, p.brand, p.retailer, p.serial, p.notes, p.category].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    filtered.sort(function (a, b) {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'purchase-desc') return (b.purchaseDate || '').localeCompare(a.purchaseDate || '');
      if (sort === 'purchase-asc') return (a.purchaseDate || '').localeCompare(b.purchaseDate || '');
      if (sort === 'created-desc') return (b.createdAt || 0) - (a.createdAt || 0);
      // warranty: soonest end first; no-warranty items last.
      var da = a.warrantyEnd ? daysUntil(a.warrantyEnd) : null;
      var db = b.warrantyEnd ? daysUntil(b.warrantyEnd) : null;
      if (da === null && db === null) return a.name.localeCompare(b.name);
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });

    var list = $('productList');
    list.innerHTML = '';
    filtered.forEach(function (p) { list.appendChild(productCard(p, true)); });
    $('listCount').textContent = filtered.length + (filtered.length === 1 ? ' product' : ' products') +
      (filtered.length !== state.products.length ? ' (of ' + state.products.length + ')' : '');
    $('listEmptyAll').hidden = state.products.length > 0;
    $('listEmpty').hidden = state.products.length === 0 || filtered.length > 0;

    // Category filter options: built-ins present in data, plus custom categories.
    var cats = {};
    state.products.forEach(function (p) { cats[p.category] = true; });
    var select = $('filterCategory');
    var current = select.value || 'all';
    select.innerHTML = '';
    var allOpt = el('option', null, 'All categories');
    allOpt.value = 'all';
    select.appendChild(allOpt);
    Object.keys(cats).sort().forEach(function (c) {
      var o = el('option', null, c);
      o.value = c;
      select.appendChild(o);
    });
    var hasCurrent = false;
    Array.prototype.forEach.call(select.options, function (o) { if (o.value === current) hasCurrent = true; });
    select.value = hasCurrent ? current : 'all';
  }

  function renderDetail() {
    var p = state.products.find(function (x) { return x.id === detailProductId; });
    if (!p) { showView('products'); renderProducts(); return; }
    var panel = $('detailPanel');
    panel.innerHTML = '';
    var head = el('div', 'detail-head');
    var titleWrap = el('div');
    titleWrap.appendChild(el('h2', null, p.name));
    var sub = [];
    if (p.brand) sub.push(p.brand);
    sub.push(p.category);
    titleWrap.appendChild(el('p', 'item-sub', sub.join(' · ')));
    head.appendChild(titleWrap);
    head.appendChild(badge(warrantyStatus(p)));
    var actions = el('div', 'detail-actions');
    var editBtn = el('button', 'btn btn-secondary btn-small', 'Edit product');
    editBtn.type = 'button';
    editBtn.addEventListener('click', function () { openForm(p.id); });
    var delBtn = el('button', 'btn btn-danger btn-small', 'Delete product');
    delBtn.type = 'button';
    delBtn.addEventListener('click', function () { deleteProduct(p.id); });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    head.appendChild(actions);
    panel.appendChild(head);

    var grid = el('dl', 'detail-grid');
    var rows = [
      ['Warranty', warrantyLine(p)],
      ['Purchase date', p.purchaseDate ? formatDate(p.purchaseDate) : 'Not recorded'],
      ['Price', (p.price !== null && p.price !== undefined) ? formatMoney(p.price, state.settings.currency) : 'Not recorded'],
      ['Retailer', p.retailer || 'Not recorded'],
      ['Serial number', p.serial || 'Not recorded'],
      ['Service records', String((p.serviceRecords || []).length)]
    ];
    rows.forEach(function (r) {
      grid.appendChild(el('dt', null, r[0]));
      grid.appendChild(el('dd', null, r[1]));
    });
    panel.appendChild(grid);
    if (p.notes) {
      panel.appendChild(el('h3', null, 'Notes'));
      panel.appendChild(el('div', 'detail-notes', p.notes));
    }

    var list = $('serviceList');
    list.innerHTML = '';
    var records = (p.serviceRecords || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    records.forEach(function (s) {
      var li = el('li', 'item-card');
      var main = el('div', 'item-main');
      main.appendChild(el('div', 'item-title', s.description));
      var subText = s.type + ' · ' + formatDate(s.date);
      if (s.provider) subText += ' · ' + s.provider;
      main.appendChild(el('div', 'item-sub', subText));
      if (s.cost !== null && s.cost !== undefined) {
        main.appendChild(el('div', 'item-meta', formatMoney(s.cost, state.settings.currency)));
      }
      li.appendChild(main);
      var actionsDiv = el('div', 'item-actions');
      var editS = el('button', 'icon-btn', 'Edit');
      editS.type = 'button';
      editS.setAttribute('aria-label', 'Edit service record: ' + s.description);
      editS.addEventListener('click', function () { openServiceForm(s.id); });
      var delS = el('button', 'icon-btn danger', 'Delete');
      delS.type = 'button';
      delS.setAttribute('aria-label', 'Delete service record: ' + s.description);
      delS.addEventListener('click', function () { deleteService(s.id); });
      actionsDiv.appendChild(editS);
      actionsDiv.appendChild(delS);
      li.appendChild(actionsDiv);
      list.appendChild(li);
    });
    $('serviceEmpty').hidden = records.length > 0;
  }

  function renderSettings() {
    $('setAlertWindow').value = String(state.settings.alertWindowDays);
    $('setCurrency').value = state.settings.currency;
    $('setTheme').value = state.settings.theme;
    $('storageInfo').textContent = storageInfo();
  }

  function renderAll() {
    updateStats();
    renderDashboard();
    renderProducts();
    if (currentView === 'detail') renderDetail();
    renderSettings();
  }

  /* ---------- navigation & forms ---------- */
  function openForm(productId) {
    editingProductId = productId || null;
    formOrigin = (productId && detailProductId === productId) ? 'detail' : 'products';
    var p = productId ? state.products.find(function (x) { return x.id === productId; }) : null;
    $('formTitle').textContent = p ? 'Edit product' : 'Add product';
    $('saveProductBtn').textContent = p ? 'Save changes' : 'Save product';
    $('fName').value = p ? p.name : '';
    $('fBrand').value = p ? p.brand : '';
    if (p && CATEGORIES.indexOf(p.category) === -1) {
      $('fCategory').value = '__custom';
      $('fCustomCategory').value = p.category;
      $('customCategoryField').hidden = false;
    } else {
      $('fCategory').value = p ? p.category : 'Electronics';
      $('fCustomCategory').value = '';
      $('customCategoryField').hidden = true;
    }
    $('fPurchaseDate').value = p ? (p.purchaseDate || '') : '';
    $('fWarrantyEnd').value = p ? (p.warrantyEnd || '') : '';
    $('fPrice').value = (p && p.price !== null && p.price !== undefined) ? String(p.price) : '';
    $('fRetailer').value = p ? p.retailer : '';
    $('fSerial').value = p ? p.serial : '';
    $('fNotes').value = p ? p.notes : '';
    $('notesCount').textContent = String($('fNotes').value.length);
    ['errName', 'errCustomCategory', 'errPurchaseDate', 'errWarrantyEnd', 'errPrice'].forEach(function (id) { $(id).hidden = true; });
    ['fName', 'fCustomCategory', 'fPurchaseDate', 'fWarrantyEnd', 'fPrice'].forEach(function (id) { $(id).removeAttribute('aria-invalid'); });
    showView('form');
    $('fName').focus();
  }

  function setFieldError(inputId, errorId, message) {
    var input = $(inputId), err = $(errorId);
    if (message) {
      err.textContent = message;
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      return false;
    }
    err.hidden = true;
    input.removeAttribute('aria-invalid');
    return true;
  }

  function submitProductForm(e) {
    e.preventDefault();
    var ok = true;
    var name = $('fName').value.trim();
    ok = setFieldError('fName', 'errName', name ? (name.length > 100 ? 'Name must be at most 100 characters.' : '') : 'Product name is required.') && ok;

    var category = $('fCategory').value;
    if (category === '__custom') {
      var custom = $('fCustomCategory').value.trim();
      ok = setFieldError('fCustomCategory', 'errCustomCategory', custom ? (custom.length > 50 ? 'Category must be at most 50 characters.' : '') : 'Enter a custom category name.') && ok;
      if (custom) category = custom;
    }

    var purchaseDate = $('fPurchaseDate').value;
    if (purchaseDate && !isValidDateStr(purchaseDate)) {
      ok = setFieldError('fPurchaseDate', 'errPurchaseDate', 'Enter a valid purchase date.') && ok;
    } else {
      ok = setFieldError('fPurchaseDate', 'errPurchaseDate', '') && ok;
    }

    var warrantyEnd = $('fWarrantyEnd').value;
    if (warrantyEnd && !isValidDateStr(warrantyEnd)) {
      ok = setFieldError('fWarrantyEnd', 'errWarrantyEnd', 'Enter a valid warranty end date.') && ok;
    } else if (purchaseDate && warrantyEnd && warrantyEnd < purchaseDate) {
      ok = setFieldError('fWarrantyEnd', 'errWarrantyEnd', 'Warranty end cannot be before the purchase date.') && ok;
    } else {
      ok = setFieldError('fWarrantyEnd', 'errWarrantyEnd', '') && ok;
    }

    var priceRaw = $('fPrice').value.trim();
    var price = null;
    if (priceRaw !== '') {
      price = Number(priceRaw);
      if (!isFinite(price) || price < 0) {
        ok = setFieldError('fPrice', 'errPrice', 'Price must be 0 or more.') && ok;
      } else {
        ok = setFieldError('fPrice', 'errPrice', '') && ok;
      }
    } else {
      ok = setFieldError('fPrice', 'errPrice', '') && ok;
    }

    if (!ok) return;

    var existing = editingProductId ? state.products.find(function (x) { return x.id === editingProductId; }) : null;
    var product = {
      id: existing ? existing.id : newId(),
      name: name,
      brand: $('fBrand').value.trim(),
      category: category,
      purchaseDate: purchaseDate || '',
      warrantyEnd: warrantyEnd || '',
      price: price,
      retailer: $('fRetailer').value.trim(),
      serial: $('fSerial').value.trim(),
      notes: $('fNotes').value.trim(),
      createdAt: existing ? existing.createdAt : Date.now(),
      serviceRecords: existing ? existing.serviceRecords : []
    };
    if (existing) {
      var idx = state.products.indexOf(existing);
      state.products[idx] = product;
    } else {
      state.products.push(product);
    }
    var saved = saveState();
    if (!saved.ok) { toast(saved.error); return; }
    renderAll();
    toast(existing ? 'Product updated.' : 'Product added.');
    if (existing && formOrigin === 'detail') { detailProductId = product.id; renderDetail(); showView('detail'); }
    else { showView('products'); renderProducts(); }
  }

  function deleteProduct(productId) {
    var p = state.products.find(function (x) { return x.id === productId; });
    if (!p) return;
    var count = (p.serviceRecords || []).length;
    askConfirm('Delete product?', '“' + p.name + '” will be permanently deleted' +
      (count ? ' along with its ' + count + (count === 1 ? ' service record' : ' service records') : '') + '. This cannot be undone.', 'Delete')
      .then(function (confirmed) {
        if (!confirmed) return;
        state.products = state.products.filter(function (x) { return x.id !== productId; });
        var saved = saveState();
        if (!saved.ok) { toast(saved.error); loadState(); renderAll(); return; }
        if (detailProductId === productId) detailProductId = null;
        renderAll();
        toast('Product deleted.');
        showView('products');
      });
  }

  function openDetail(productId) {
    detailProductId = productId;
    editingServiceId = null;
    $('serviceFormPanel').hidden = true;
    renderDetail();
    showView('detail');
  }

  function openServiceForm(serviceId) {
    var p = state.products.find(function (x) { return x.id === detailProductId; });
    if (!p) return;
    editingServiceId = serviceId || null;
    var s = serviceId ? (p.serviceRecords || []).find(function (x) { return x.id === serviceId; }) : null;
    $('serviceFormTitle').textContent = s ? 'Edit service record' : 'Add service record';
    $('saveServiceBtn').textContent = s ? 'Save changes' : 'Save record';
    $('sDate').value = s ? s.date : toDateStr(todayLocal());
    $('sType').value = s ? s.type : 'Repair';
    $('sDescription').value = s ? s.description : '';
    $('sCost').value = (s && s.cost !== null && s.cost !== undefined) ? String(s.cost) : '';
    $('sProvider').value = s ? s.provider : '';
    ['errServiceDate', 'errServiceDescription', 'errServiceCost'].forEach(function (id) { $(id).hidden = true; });
    $('serviceFormPanel').hidden = false;
    $('sDate').focus();
  }

  function submitServiceForm(e) {
    e.preventDefault();
    var p = state.products.find(function (x) { return x.id === detailProductId; });
    if (!p) return;
    var ok = true;
    var date = $('sDate').value;
    ok = setFieldError('sDate', 'errServiceDate', !date ? 'Service date is required.' : (!isValidDateStr(date) ? 'Enter a valid date.' : '')) && ok;
    var description = $('sDescription').value.trim();
    ok = setFieldError('sDescription', 'errServiceDescription', !description ? 'Description is required.' : (description.length > 200 ? 'Description must be at most 200 characters.' : '')) && ok;
    var costRaw = $('sCost').value.trim();
    var cost = null;
    if (costRaw !== '') {
      cost = Number(costRaw);
      if (!isFinite(cost) || cost < 0) ok = setFieldError('sCost', 'errServiceCost', 'Cost must be 0 or more.') && ok;
      else ok = setFieldError('sCost', 'errServiceCost', '') && ok;
    } else {
      ok = setFieldError('sCost', 'errServiceCost', '') && ok;
    }
    if (!ok) return;

    var record = {
      id: editingServiceId || newId(),
      date: date,
      type: $('sType').value,
      description: description,
      cost: cost,
      provider: $('sProvider').value.trim()
    };
    if (!p.serviceRecords) p.serviceRecords = [];
    var existing = p.serviceRecords.find(function (x) { return x.id === record.id; });
    if (existing) {
      p.serviceRecords[p.serviceRecords.indexOf(existing)] = record;
    } else {
      p.serviceRecords.push(record);
    }
    var saved = saveState();
    if (!saved.ok) { toast(saved.error); return; }
    editingServiceId = null;
    $('serviceFormPanel').hidden = true;
    renderAll();
    renderDetail();
    toast('Service record saved.');
  }

  function deleteService(serviceId) {
    var p = state.products.find(function (x) { return x.id === detailProductId; });
    if (!p) return;
    var s = (p.serviceRecords || []).find(function (x) { return x.id === serviceId; });
    if (!s) return;
    askConfirm('Delete service record?', '“' + s.description + '” (' + formatDate(s.date) + ') will be permanently deleted.', 'Delete')
      .then(function (confirmed) {
        if (!confirmed) return;
        p.serviceRecords = p.serviceRecords.filter(function (x) { return x.id !== serviceId; });
        var saved = saveState();
        if (!saved.ok) { toast(saved.error); loadState(); renderAll(); return; }
        renderAll();
        renderDetail();
        toast('Service record deleted.');
      });
  }

  /* ---------- settings: export / import / delete-all ---------- */
  function exportBackup() {
    var data = { version: DATA_VERSION, products: state.products, settings: state.settings };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'warrantywise-backup-' + toDateStr(todayLocal()) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Backup exported.');
  }

  function importBackup(file) {
    $('importError').hidden = true;
    $('importNote').hidden = true;
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch (e) { $('importError').textContent = 'That file is not valid JSON. Your data was not changed.'; $('importError').hidden = false; return; }
      var checked = validateData(parsed);
      if (!checked.ok) {
        $('importError').textContent = 'Import rejected: ' + checked.error + ' Your data was not changed.';
        $('importError').hidden = false;
        return;
      }
      state.products = checked.data.products;
      state.settings = checked.data.settings;
      state.corrupt = false;
      $('corruptBanner').hidden = true;
      var saved = saveState();
      if (!saved.ok) { $('importError').textContent = saved.error; $('importError').hidden = false; return; }
      applyTheme();
      renderAll();
      $('importNote').textContent = 'Backup imported: ' + state.products.length + (state.products.length === 1 ? ' product' : ' products') + ' restored.';
      $('importNote').hidden = false;
      toast('Backup imported.');
    };
    reader.onerror = function () {
      $('importError').textContent = 'Could not read that file. Your data was not changed.';
      $('importError').hidden = false;
    };
    reader.readAsText(file);
  }

  function armDeleteAll() {
    var btn = $('deleteAllBtn');
    var now = Date.now();
    if (now < deleteAllArmedUntil) {
      clearTimeout(deleteAllTimer);
      deleteAllArmedUntil = 0;
      btn.classList.remove('armed');
      btn.textContent = 'Delete all data';
      state.products = [];
      state.settings = clone(DEFAULT_SETTINGS);
      state.corrupt = false;
      $('corruptBanner').hidden = true;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      try { localStorage.removeItem(BACKUP_KEY); } catch (e) { /* ignore */ }
      detailProductId = null;
      applyTheme();
      renderAll();
      showView('dashboard');
      toast('All data deleted.');
      return;
    }
    deleteAllArmedUntil = now + 10000;
    btn.classList.add('armed');
    btn.textContent = 'Tap again to confirm delete';
    toast('Tap Delete all data again within 10 seconds to confirm.');
    deleteAllTimer = setTimeout(function () {
      deleteAllArmedUntil = 0;
      btn.classList.remove('armed');
      btn.textContent = 'Delete all data';
    }, 10000);
  }

  /* ---------- theme ---------- */
  function applyTheme() {
    var theme = state.settings.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    $('themeLabel').textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
    $('setTheme').value = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1220' : '#101827');
  }

  function toggleTheme() {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    var saved = saveState();
    if (!saved.ok) { toast(saved.error); return; }
    applyTheme();
  }

  /* ---------- init ---------- */
  function init() {
    loadState();
    applyTheme();
    if (state.corrupt) $('corruptBanner').hidden = false;

    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var view = b.getAttribute('data-view');
        if (view === 'form') openForm(null);
        else { showView(view); if (view === 'dashboard') renderDashboard(); if (view === 'products') renderProducts(); if (view === 'settings') renderSettings(); }
      });
    });

    $('themeToggle').addEventListener('click', toggleTheme);
    $('dashAddBtn').addEventListener('click', function () { openForm(null); });
    $('dashViewAll').addEventListener('click', function () { showView('products'); renderProducts(); });
    $('corruptGoSettings').addEventListener('click', function () { showView('settings'); renderSettings(); });

    $('searchInput').addEventListener('input', renderProducts);
    $('filterCategory').addEventListener('change', renderProducts);
    $('filterStatus').addEventListener('change', renderProducts);
    $('sortSelect').addEventListener('change', renderProducts);

    $('fCategory').addEventListener('change', function () {
      var custom = $('fCategory').value === '__custom';
      $('customCategoryField').hidden = !custom;
      if (custom) $('fCustomCategory').focus();
    });
    $('fNotes').addEventListener('input', function () { $('notesCount').textContent = String($('fNotes').value.length); });
    $('productForm').addEventListener('submit', submitProductForm);
    $('cancelFormBtn').addEventListener('click', function () {
      if (detailProductId && state.products.some(function (x) { return x.id === detailProductId; })) { renderDetail(); showView('detail'); }
      else { showView('products'); renderProducts(); }
    });

    $('detailBack').addEventListener('click', function () { showView('products'); renderProducts(); });
    $('addServiceBtn').addEventListener('click', function () { openServiceForm(null); });
    $('serviceForm').addEventListener('submit', submitServiceForm);
    $('cancelServiceBtn').addEventListener('click', function () { $('serviceFormPanel').hidden = true; editingServiceId = null; });

    $('setAlertWindow').addEventListener('change', function () {
      var v = Number($('setAlertWindow').value);
      if (!Number.isInteger(v) || v < 1 || v > 90) {
        $('errAlertWindow').textContent = 'Enter a whole number from 1 to 90.';
        $('errAlertWindow').hidden = false;
        $('setAlertWindow').value = String(state.settings.alertWindowDays);
        return;
      }
      $('errAlertWindow').hidden = true;
      state.settings.alertWindowDays = v;
      var saved = saveState();
      if (!saved.ok) { toast(saved.error); return; }
      renderAll();
      toast('Alert window updated.');
    });
    $('setCurrency').addEventListener('change', function () {
      if (CURRENCIES.indexOf($('setCurrency').value) === -1) { $('setCurrency').value = state.settings.currency; return; }
      state.settings.currency = $('setCurrency').value;
      var saved = saveState();
      if (!saved.ok) { toast(saved.error); return; }
      renderAll();
      toast('Currency updated.');
    });
    $('setTheme').addEventListener('change', function () {
      state.settings.theme = $('setTheme').value === 'dark' ? 'dark' : 'light';
      var saved = saveState();
      if (!saved.ok) { toast(saved.error); return; }
      applyTheme();
    });

    $('exportBtn').addEventListener('click', exportBackup);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function () {
      if ($('importFile').files.length) importBackup($('importFile').files[0]);
      $('importFile').value = '';
    });
    $('deleteAllBtn').addEventListener('click', armDeleteAll);

    $('confirmCancel').addEventListener('click', function () { closeConfirm(false); });
    $('confirmOk').addEventListener('click', function () { closeConfirm(true); });
    $('confirmBackdrop').addEventListener('click', function (e) { if (e.target === $('confirmBackdrop')) closeConfirm(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('confirmBackdrop').hidden) closeConfirm(false); });

    renderAll();
    showView('dashboard');

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is best-effort */ });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
