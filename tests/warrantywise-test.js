/* WarrantyWise verification suite (headless Firefox via playwright-core). */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pad(n) { return (n < 10 ? '0' : '') + n; }
function dateStr(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-test-'));
function writeJson(name, obj) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  return p;
}

(async () => {
  const browser = await firefox.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const extRequests = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR: ' + e.message); });
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:8142')) extRequests.push(r.url()); });

  await page.goto('http://127.0.0.1:8142/index.html');
  await page.waitForSelector('#dashAddBtn');
  await sleep(300);

  // --- 1. fresh install, empty start ---
  check('page title', (await page.title()) === 'WarrantyWise — Product & Warranty Tracker');
  check('stats all zero at empty start',
    (await page.textContent('#statTotal')) === '0' &&
    (await page.textContent('#statActive')) === '0' &&
    (await page.textContent('#statSoon')) === '0' &&
    (await page.textContent('#statExpired')) === '0');
  check('dashboard empty notes visible', await page.isVisible('#recentEmpty') && await page.isVisible('#attentionEmpty'));
  check('no demo data in list', (await page.textContent('#listCount')).includes('0 products'));

  async function openAddForm() {
    await page.click('[data-view="form"] >> nth=0');
    await page.waitForSelector('#view-form:not([hidden])');
  }
  async function fillProduct(o) {
    await page.fill('#fName', o.name || '');
    await page.fill('#fBrand', o.brand || '');
    if (o.customCategory) {
      await page.selectOption('#fCategory', '__custom');
      await page.fill('#fCustomCategory', o.customCategory);
    } else if (o.category) {
      await page.selectOption('#fCategory', o.category);
    }
    if (o.purchaseDate) await page.fill('#fPurchaseDate', o.purchaseDate);
    if (o.warrantyEnd) await page.fill('#fWarrantyEnd', o.warrantyEnd);
    if (o.price !== undefined) await page.fill('#fPrice', String(o.price));
    await page.fill('#fRetailer', o.retailer || '');
    await page.fill('#fSerial', o.serial || '');
    await page.fill('#fNotes', o.notes || '');
  }
  async function stat(id) { return await page.textContent(id); }

  // --- 2. form validation ---
  await openAddForm();
  await page.click('#saveProductBtn');
  check('blank name rejected', await page.isVisible('#errName'));
  check('no product added after blank name', (await stat('#statTotal')) === '0');
  await fillProduct({ name: 'Bad Dates', purchaseDate: dateStr(-10), warrantyEnd: dateStr(-20) });
  await page.click('#saveProductBtn');
  check('warranty before purchase rejected', await page.isVisible('#errWarrantyEnd'));
  await page.fill('#fWarrantyEnd', '');
  await page.fill('#fPrice', '-5');
  await page.click('#saveProductBtn');
  check('negative price rejected', await page.isVisible('#errPrice'));
  check('still no product after failed submits', (await stat('#statTotal')) === '0');
  await page.click('#cancelFormBtn');

  // --- 3. add 5 products across all statuses ---
  await openAddForm();
  await fillProduct({ name: 'Washer X1', brand: 'CleanCo', category: 'Appliances', purchaseDate: dateStr(-400), warrantyEnd: dateStr(-1), price: 499.99, retailer: 'ElectroMart', serial: 'WX-001' });
  await page.click('#saveProductBtn');
  await sleep(200);
  await openAddForm();
  await fillProduct({ name: 'Fridge Cool', brand: 'Frost', category: 'Appliances', purchaseDate: dateStr(-100), warrantyEnd: dateStr(5), price: 899 });
  await page.click('#saveProductBtn');
  await sleep(200);
  await openAddForm();
  await fillProduct({ name: 'Laptop Pro', brand: 'TechBrand', category: 'Electronics', purchaseDate: dateStr(-30), warrantyEnd: dateStr(60), price: 1299.99, notes: 'Work laptop' });
  await page.click('#saveProductBtn');
  await sleep(200);
  await openAddForm();
  await fillProduct({ name: 'Wooden Chair', category: 'Furniture', purchaseDate: dateStr(-200) });
  await page.click('#saveProductBtn');
  await sleep(200);
  await openAddForm();
  await fillProduct({ name: 'Phone Mini', brand: 'TechBrand', category: 'Electronics', purchaseDate: dateStr(-90), warrantyEnd: dateStr(0), price: 299 });
  await page.click('#saveProductBtn');
  await sleep(300);

  check('stats total 5', (await stat('#statTotal')) === '5');
  check('stats active 1', (await stat('#statActive')) === '1');
  check('stats soon 2 (today + 5 days)', (await stat('#statSoon')) === '2');
  check('stats expired 1', (await stat('#statExpired')) === '1');

  // --- 4. dashboard attention + persistence ---
  const attentionText = await page.textContent('#attentionList');
  check('attention lists expired + soon items', attentionText.includes('Washer X1') && attentionText.includes('Phone Mini') && attentionText.includes('Fridge Cool'));
  check('attention sorted expired first', attentionText.indexOf('Washer X1') < attentionText.indexOf('Phone Mini') && attentionText.indexOf('Phone Mini') < attentionText.indexOf('Fridge Cool'));
  check('recently added shows products', (await page.textContent('#recentList')).includes('Phone Mini'));
  await page.reload();
  await page.waitForSelector('#dashAddBtn');
  check('data persists after reload', (await stat('#statTotal')) === '5' && (await stat('#statExpired')) === '1');

  // --- 5. search / filter / sort ---
  await page.click('[data-view="products"] >> nth=0');
  await sleep(200);
  await page.fill('#searchInput', 'laptop');
  await sleep(200);
  check('search finds laptop', (await page.textContent('#listCount')).includes('1 product'));
  await page.fill('#searchInput', '');
  await page.selectOption('#filterStatus', 'expired');
  await sleep(200);
  check('status filter expired = 1', (await page.textContent('#listCount')).includes('1 product') && (await page.textContent('#productList')).includes('Washer X1'));
  await page.selectOption('#filterStatus', 'all');
  await page.selectOption('#filterCategory', 'Electronics');
  await sleep(200);
  check('category filter Electronics = 2', (await page.textContent('#listCount')).includes('2 products'));
  await page.selectOption('#filterCategory', 'all');
  await page.selectOption('#sortSelect', 'name');
  await sleep(200);
  const firstName = await page.textContent('#productList .item-card:first-child .item-title');
  check('sort by name first is Fridge Cool', firstName.trim() === 'Fridge Cool', firstName);
  await page.selectOption('#sortSelect', 'warranty');

  // --- 6. delete with confirm: cancel then confirm ---
  await page.fill('#searchInput', 'Wooden Chair');
  await sleep(200);
  await page.click('#productList .item-card .icon-btn.danger');
  await page.waitForSelector('#confirmBackdrop:not([hidden])');
  await page.click('#confirmCancel');
  await sleep(200);
  check('delete cancel keeps product', (await page.textContent('#productList')).includes('Wooden Chair'));
  await page.click('#productList .item-card .icon-btn.danger');
  await page.waitForSelector('#confirmBackdrop:not([hidden])');
  await page.click('#confirmOk');
  await sleep(300);
  check('delete confirm removes product', !(await page.textContent('#productList')).includes('Wooden Chair'));
  check('total now 4 after delete', (await stat('#statTotal')) === '4');
  await page.fill('#searchInput', '');

  // --- 7. detail view + service records ---
  await page.fill('#searchInput', 'Laptop Pro');
  await sleep(200);
  await page.click('#productList .item-card');
  await page.waitForSelector('#detailPanel');
  check('detail shows warranty line with days left', (await page.textContent('#detailPanel')).includes('60 days left'));
  check('detail shows price', (await page.textContent('#detailPanel')).includes('1,299.99'));
  check('service empty note visible', await page.isVisible('#serviceEmpty'));
  await page.click('#addServiceBtn');
  await page.fill('#sDate', dateStr(0));
  await page.selectOption('#sType', 'Repair');
  await page.fill('#sDescription', 'Battery replaced');
  await page.fill('#sCost', '25');
  await page.fill('#sProvider', 'TechCare');
  await page.click('#saveServiceBtn');
  await sleep(200);
  check('service record added', (await page.textContent('#serviceList')).includes('Battery replaced') && (await page.textContent('#serviceList')).includes('25.00'));
  check('service empty note hidden', !(await page.isVisible('#serviceEmpty')));
  // edit service record
  await page.click('#serviceList .icon-btn:first-child');
  await page.fill('#sDescription', 'Battery replaced under warranty');
  await page.click('#saveServiceBtn');
  await sleep(200);
  check('service record edited', (await page.textContent('#serviceList')).includes('Battery replaced under warranty'));
  // delete service record: cancel then confirm
  await page.click('#serviceList .icon-btn.danger');
  await page.waitForSelector('#confirmBackdrop:not([hidden])');
  await page.click('#confirmCancel');
  await sleep(150);
  check('service delete cancel keeps record', (await page.textContent('#serviceList')).includes('Battery replaced'));
  await page.click('#serviceList .icon-btn.danger');
  await page.waitForSelector('#confirmBackdrop:not([hidden])');
  await page.click('#confirmOk');
  await sleep(200);
  check('service record deleted', !(await page.textContent('#serviceList')).includes('Battery replaced'));
  // re-add one record to test association survives reload
  await page.click('#addServiceBtn');
  await page.fill('#sDate', dateStr(-2));
  await page.selectOption('#sType', 'Maintenance');
  await page.fill('#sDescription', 'Fan cleaned');
  await page.click('#saveServiceBtn');
  await sleep(200);
  await page.reload();
  await page.waitForSelector('#dashAddBtn');
  await page.click('[data-view="products"] >> nth=0');
  await page.fill('#searchInput', 'Laptop Pro');
  await sleep(200);
  await page.click('#productList .item-card');
  await page.waitForSelector('#detailPanel');
  check('service record persists after reload', (await page.textContent('#serviceList')).includes('Fan cleaned'));
  await page.click('#detailBack');

  // --- 8. custom category with special chars + XSS as text ---
  await page.click('[data-view="form"] >> nth=0');
  await fillProduct({ name: 'Garden Hose', customCategory: 'Garden]Tools', purchaseDate: dateStr(-10) });
  await page.click('#saveProductBtn');
  await sleep(300);
  check('custom category product saved', (await stat('#statTotal')) === '5');
  await page.click('[data-view="products"] >> nth=0');
  await sleep(200);
  await page.fill('#searchInput', '');
  await sleep(200);
  const catOptions = await page.$$eval('#filterCategory option', els => els.map(e => e.value));
  check('custom category appears in filter (selector fix)', catOptions.includes('Garden]Tools'), catOptions.join(','));
  await page.click('[data-view="form"] >> nth=0');
  await fillProduct({ name: '<img src=x onerror=alert(1)>', category: 'Electronics', purchaseDate: dateStr(0), warrantyEnd: dateStr(90) });
  await page.click('#saveProductBtn');
  await sleep(300);
  check('XSS name saved as product', (await stat('#statTotal')) === '6');
  await page.click('[data-view="products"] >> nth=0');
  await sleep(200);
  const imgCount = await page.$$eval('#productList img', els => els.length);
  check('XSS name renders as text, no img element', imgCount === 0, 'img count ' + imgCount);
  const xssTitle = await page.textContent('#productList .item-card:first-child .item-title').catch(() => '');
  check('XSS literal text present', (await page.textContent('#productList')).includes('<img src=x'));

  // --- 9. settings: alert window, currency, theme ---
  await page.click('[data-view="settings"] >> nth=0');
  await sleep(200);
  await page.fill('#setAlertWindow', '1');
  await page.dispatchEvent('#setAlertWindow', 'change');
  await sleep(200);
  check('alert window 1: soon drops to 1 (only today)', (await stat('#statSoon')) === '1');
  check('alert window 1: active rises', (await stat('#statActive')) === '3', await stat('#statActive'));
  await page.fill('#setAlertWindow', '0');
  await page.dispatchEvent('#setAlertWindow', 'change');
  await sleep(200);
  check('invalid alert window 0 rejected', await page.isVisible('#errAlertWindow'));
  await page.fill('#setAlertWindow', '30');
  await page.dispatchEvent('#setAlertWindow', 'change');
  await sleep(200);
  check('alert window restored to 30, soon back to 2', (await stat('#statSoon')) === '2');
  await page.selectOption('#setCurrency', 'PKR');
  await sleep(200);
  await page.click('[data-view="products"] >> nth=0');
  await page.fill('#searchInput', 'Laptop Pro');
  await sleep(200);
  await page.click('#productList .item-card');
  await page.waitForSelector('#detailPanel');
  const detailTextPKR = await page.textContent('#detailPanel');
  check('currency PKR applied to price', detailTextPKR.includes('PKR') || detailTextPKR.includes('Rs'), detailTextPKR.slice(0, 200));
  await page.click('#detailBack');
  await page.click('[data-view="settings"] >> nth=0');
  await page.selectOption('#setCurrency', 'USD');
  await sleep(200);
  await page.click('#themeToggle');
  await sleep(200);
  check('dark theme applied', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
  await page.reload();
  await page.waitForSelector('#dashAddBtn');
  check('dark theme persists after reload', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
  await page.click('#themeToggle');
  await sleep(150);

  // --- 10. export / import ---
  await page.click('[data-view="settings"] >> nth=0');
  await sleep(150);
  const dlPromise = page.waitForEvent('download');
  await page.click('#exportBtn');
  const download = await dlPromise;
  const dlPath = await download.path();
  const exported = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
  check('export JSON version 1 with 6 products', exported.version === 1 && exported.products.length === 6, 'products: ' + (exported.products || []).length);
  check('export includes service record', exported.products.some(p => (p.serviceRecords || []).some(s => s.description === 'Fan cleaned')));

  async function importFile(filePath) {
    await page.setInputFiles('#importFile', filePath);
    await sleep(600);
  }
  const totalBefore = await stat('#statTotal');
  await importFile(writeJson('bad.json', '{not json'));
  check('malformed JSON import rejected', await page.isVisible('#importError'));
  check('data unchanged after malformed import', (await stat('#statTotal')) === totalBefore);
  const dup = JSON.parse(JSON.stringify(exported));
  dup.products.push(JSON.parse(JSON.stringify(dup.products[0])));
  await importFile(writeJson('dup.json', dup));
  check('duplicate-id import rejected', await page.isVisible('#importError'));
  check('data unchanged after duplicate-id import', (await stat('#statTotal')) === totalBefore);
  const badDate = JSON.parse(JSON.stringify(exported));
  badDate.products[0].warrantyEnd = '2026-13-40';
  await importFile(writeJson('baddate.json', badDate));
  check('bad-date import rejected', await page.isVisible('#importError'));
  const badOrder = JSON.parse(JSON.stringify(exported));
  badOrder.products[0].purchaseDate = '2026-06-01';
  badOrder.products[0].warrantyEnd = '2026-01-01';
  await importFile(writeJson('badorder.json', badOrder));
  check('warranty-before-purchase import rejected', await page.isVisible('#importError'));
  check('data unchanged after invalid imports', (await stat('#statTotal')) === totalBefore);

  const validImport = { version: 1, products: [{ id: 'imp-1', name: 'Imported Item', brand: '', category: 'Other', purchaseDate: '2026-01-05', warrantyEnd: '', price: null, retailer: '', serial: '', notes: '', createdAt: 1700000000000, serviceRecords: [] }], settings: { alertWindowDays: 14, currency: 'EUR', theme: 'light' } };
  await importFile(writeJson('valid.json', validImport));
  check('valid import replaces data', (await stat('#statTotal')) === '1');
  check('valid import applies settings', (await page.inputValue('#setAlertWindow')) === '14' && (await page.inputValue('#setCurrency')) === 'EUR');
  await importFile(dlPath);
  await sleep(300);
  check('re-import of export restores 6 products', (await stat('#statTotal')) === '6');
  check('re-import restores alert window 30', (await page.inputValue('#setAlertWindow')) === '30');

  // --- 11. corrupt storage ---
  await page.evaluate(() => localStorage.setItem('warrantywise.v1', '{broken json'));
  await page.reload();
  await page.waitForSelector('#dashAddBtn');
  check('corrupt storage shows warning banner', await page.isVisible('#corruptBanner'));
  check('corrupt storage starts empty', (await stat('#statTotal')) === '0');
  check('corrupt raw value left untouched', (await page.evaluate(() => localStorage.getItem('warrantywise.v1'))) === '{broken json');
  await page.click('[data-view="settings"] >> nth=0');
  await importFile(dlPath);
  check('import recovers from corrupt state', (await stat('#statTotal')) === '6');
  check('banner hidden after recovery import', !(await page.isVisible('#corruptBanner')));

  // --- 12. delete-all two-step with expiry ---
  await page.click('#deleteAllBtn');
  check('delete-all arms on first tap', (await page.textContent('#deleteAllBtn')).includes('Tap again'));
  await sleep(10500);
  check('delete-all disarms after 10s', (await page.textContent('#deleteAllBtn')) === 'Delete all data');
  await page.click('#deleteAllBtn');
  await sleep(150);
  await page.click('#deleteAllBtn');
  await sleep(300);
  check('delete-all confirmed wipes data', (await stat('#statTotal')) === '0');
  await page.click('[data-view="dashboard"] >> nth=0');
  check('dashboard empty again after delete-all', await page.isVisible('#recentEmpty'));

  // --- 13. keyboard focus ---
  await page.keyboard.press('Tab');
  const activeTag = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
  check('Tab moves keyboard focus', ['BUTTON', 'INPUT', 'SELECT', 'A'].includes(activeTag), activeTag);

  // --- 14. service worker + hygiene ---
  await sleep(800);
  check('service worker registered', await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r)));
  check('zero external requests', extRequests.length === 0, extRequests.join(', '));
  check('zero uncaught page errors', errors.length === 0, errors.join(' | '));

  // --- 15. mobile 375px ---
  const mctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mpage = await mctx.newPage();
  await mpage.goto('http://127.0.0.1:8142/index.html');
  await mpage.waitForSelector('#dashAddBtn');
  await sleep(300);
  const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('375px no horizontal overflow', overflow <= 0, 'overflow ' + overflow + 'px');
  check('bottom nav visible at 375px', await mpage.isVisible('#bottomNav .nav-btn'));
  await mctx.close();

  await browser.close();
  console.log('\nTOTAL: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH: ' + (e && e.stack || e)); process.exit(2); });
