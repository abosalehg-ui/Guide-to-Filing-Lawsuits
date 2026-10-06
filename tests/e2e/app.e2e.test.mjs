/**
 * Browser tests: routing, focus, the dialog, search and print, driven in
 * headless Chromium against index.html over file:// — exactly how the README
 * tells people to open it locally.
 *
 * Run with:  npm run test:e2e
 * Needs:     npm ci && npx playwright install chromium
 */

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const pageUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html')).href;

let browser;
let page;
let errors;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
});

afterEach(async () => {
  await page.close();
});

async function open(hash = '') {
  await page.goto(pageUrl + hash);
  await page.waitForSelector('.category-card', { state: 'attached' });
}

const activeId = () => page.evaluate(() => document.activeElement.id);
const activeDataset = () => page.evaluate(() => ({ ...document.activeElement.dataset }));
const isVisible = (selector) => page.isVisible(selector);
const modalOpen = () => page.$eval('#modal-overlay', (el) => el.classList.contains('active'));

test('loads without script, CSP or console errors and renders every card from the data', async () => {
  await open();
  const counts = await page.evaluate(() => ({
    lawsuits: document.querySelectorAll('#lawsuit-cards .category-card').length,
    completions: document.querySelectorAll('#completion-cards .category-card').length,
    services: document.querySelectorAll('#service-cards .category-card').length,
    expected: [lawsuitCategories, completionData, serviceData].map((d) => Object.keys(d).length),
    emptyCounts: [...document.querySelectorAll('.category-count')].filter((el) => !el.textContent.trim()).length,
  }));
  assert.deepEqual([counts.lawsuits, counts.completions, counts.services], counts.expected);
  assert.equal(counts.emptyCounts, 0);
  assert.deepEqual(errors, []);
});

test('the page does not scroll sideways on a 375px phone', async () => {
  await open('#/lawsuits/personal');
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 375, `scrollWidth ${width}`);
});

test('a direct link opens the category', async () => {
  await open('#/lawsuits/labor');
  assert.equal(await page.textContent('#subcategory-title'), 'الدعاوى العمالية');
  assert.equal(await isVisible('#categories-view'), false);
});

for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '%E0%A4%A']) {
  test(`#/lawsuits/${key} falls back to the category list without an error`, async () => {
    await open('#/lawsuits/' + key);
    assert.equal(await isVisible('#categories-view'), true);
    assert.equal(await isVisible('#subcategory-view'), false);
    assert.deepEqual(errors, []);
  });
}

test('keyboard focus follows the content into a category and back to its card', async () => {
  await open('#/lawsuits');
  await page.focus('.category-card[data-category="labor"]');
  await page.keyboard.press('Enter');
  assert.equal(await activeId(), 'subcategory-title');

  await page.focus('#back-to-categories');
  await page.keyboard.press('Enter');
  assert.deepEqual(await activeDataset(), { category: 'labor' });

  // Browser Back from a category also lands on the card, not on <body>.
  await page.keyboard.press('Enter');
  await page.goBack();
  assert.deepEqual(await activeDataset(), { category: 'labor' });
});

test('focus never drops to <body> when the focused element is hidden by Back', async () => {
  await open('#/services');
  await page.click('.nav-tab[data-section="lawsuits"]');
  await page.click('.category-card[data-category="general"]');
  await page.focus('.case-type-item');
  await page.goBack();
  await page.goBack();
  assert.equal(await page.evaluate(() => location.hash), '#/services');
  assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY');
});

test('the dialog traps Tab, closes on Escape and restores focus', async () => {
  await open('#/lawsuits/labor');
  await page.focus('.case-type-item');
  await page.keyboard.press('Enter');
  assert.equal(await modalOpen(), true);
  assert.equal(await activeId(), 'modal-close');

  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('.modal')), true, 'focus left the dialog');

  await page.keyboard.press('Escape');
  assert.equal(await modalOpen(), false);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('case-type-item')), true);
});

test('browser Back closes an open dialog', async () => {
  await open('#/lawsuits');
  await page.click('.category-card[data-category="labor"]');
  await page.click('.case-type-item');
  assert.equal(await modalOpen(), true);
  await page.goBack();
  assert.equal(await modalOpen(), false);
});

test('case details show the court and their sources when documented', async () => {
  await open('#/search/' + encodeURIComponent('شهادة الخدمة'));
  await page.click('#search-results .case-type-item');
  const body = await page.textContent('#modal-body');
  assert.match(body, /المحكمة العمالية/);
  assert.match(body, /التسوية الودية/);
  const links = await page.$$eval('#modal-body a', (as) => as.map((a) => a.href));
  assert.ok(links.length >= 1 && links.every((h) => h.startsWith('https://')));
});

test('search: debounced, capped at 50, announces only the count', async () => {
  await open('#/search');
  await page.fill('#search-input', 'ال');
  await page.waitForFunction(() => /\d+ نتيجة/.test(document.getElementById('search-status').textContent));

  const total = await page.evaluate(() => {
    const q = normalizeAr('ال');
    return allSearchableItems.filter((i) => i.haystack.includes(q)).length;
  });
  assert.ok(total > 50, `fixture assumption: "ال" should match more than 50, got ${total}`);
  assert.equal(await page.textContent('#search-status'), `تم العثور على ${total} نتيجة`);
  assert.equal(await page.$$eval('#search-results .case-type-item', (r) => r.length), 50);
  assert.equal(await page.getAttribute('#search-results', 'aria-live'), null);

  await page.click('.show-all-btn');
  assert.equal(await page.$$eval('#search-results .case-type-item', (r) => r.length), total);
  assert.equal(
    await page.evaluate(() => [...document.querySelectorAll('#search-results .case-type-item')].indexOf(document.activeElement)),
    50,
    'focus should move to the first newly shown row'
  );
});

test('search: unhamzated query matches and is kept in the URL across a reload', async () => {
  await open('#/search');
  await page.fill('#search-input', 'احوال');
  await page.waitForFunction(() => location.hash.startsWith('#/search/'));
  assert.equal(await page.evaluate(() => decodeURIComponent(location.hash)), '#/search/احوال');

  await page.reload();
  await page.waitForSelector('#search-results .case-type-item');
  assert.equal(await page.inputValue('#search-input'), 'احوال');
  assert.match(await page.textContent('#search-status'), /^تم العثور على \d+ نتيجة$/);
});

test('leaving search mid-debounce keeps the new section in the URL', async () => {
  await open('#/search');
  await page.type('#search-input', 'وكالة');
  await page.click('.nav-tab[data-section="steps"]');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => location.hash), '#/steps');
  assert.equal(await isVisible('#steps'), true);
});

test('the "/" shortcut works on the Arabic keyboard layout too', async () => {
  await open('#/lawsuits');
  // On the Arabic layout the physical slash key reports key "ظ".
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ظ', code: 'Slash', bubbles: true, cancelable: true }));
  });
  assert.equal(await page.evaluate(() => location.hash), '#/search');
  assert.equal(await activeId(), 'search-input');
});

test('printing builds a full copy of every data set', async () => {
  await open('#/steps');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });

  const { printed, expected } = await page.evaluate(() => ({
    printed: document.querySelectorAll('#print-view li').length,
    expected: allSearchableItems.length,
  }));
  assert.equal(printed, expected);
  assert.equal(await isVisible('#print-view'), true);
  assert.equal(await isVisible('#lawsuits'), false);
});
