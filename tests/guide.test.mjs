/**
 * Regression tests for index.html.
 *
 * Deliberately dependency-free: the project ships as a single static file
 * with no build step, and adding a toolchain just to test it would cost more
 * than it returns. These tests read the file as text, evaluate the data
 * declarations in a sandbox, and assert the invariants that actually broke
 * before — counts drifting away from the data, entries missing from the
 * search index, and inline handlers creeping back in.
 *
 * Run with:  node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

/* ------------------------------------------------------------------ */
/* Extract the data declarations and evaluate them in isolation.       */
/* ------------------------------------------------------------------ */

function slice(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  assert.ok(start !== -1, `marker not found: ${startMarker}`);
  assert.ok(end > start, `marker not found or out of order: ${endMarker}`);
  return html.slice(start, end);
}

const dataSource = slice('const lawsuitCategories', 'const allSearchableItems');
const normalizeSource = slice('function normalizeAr(text)', '// Normalise the haystack');

const sandbox = {};
vm.createContext(sandbox);
// `const` declarations stay in the script's lexical scope rather than landing
// on the context object, so hand them out explicitly on the last line.
vm.runInContext(
  `${dataSource}\n${normalizeSource}\n` +
    ';globalThis.__extracted = { lawsuitCategories, completionData, serviceData, normalizeAr };',
  sandbox
);

const { lawsuitCategories, completionData, serviceData, normalizeAr } = sandbox.__extracted;

/* ------------------------------------------------------------------ */
/* Data shape                                                          */
/* ------------------------------------------------------------------ */

test('all three data sets are defined at module scope', () => {
  // serviceData used to live inside showServiceCategory(), which is exactly
  // why its entries never reached the search index.
  assert.ok(lawsuitCategories, 'lawsuitCategories missing');
  assert.ok(completionData, 'completionData missing');
  assert.ok(serviceData, 'serviceData missing');
});

test('every lawsuit category has a title, description and subcategories', () => {
  for (const [key, cat] of Object.entries(lawsuitCategories)) {
    assert.equal(typeof cat.title, 'string', `${key}: missing title`);
    assert.equal(typeof cat.description, 'string', `${key}: missing description`);
    const subs = Object.keys(cat.subcategories);
    assert.ok(subs.length > 0, `${key}: no subcategories`);
    for (const sub of subs) {
      assert.ok(Array.isArray(cat.subcategories[sub]), `${key}/${sub}: not an array`);
      assert.ok(cat.subcategories[sub].length > 0, `${key}/${sub}: empty`);
    }
  }
});

test('every completion and service group has a non-empty item list', () => {
  for (const [key, group] of Object.entries({ ...completionData, ...serviceData })) {
    assert.equal(typeof group.title, 'string', `${key}: missing title`);
    assert.ok(Array.isArray(group.items) && group.items.length > 0, `${key}: empty items`);
  }
});

/* ------------------------------------------------------------------ */
/* Counts shown in the UI must be derived, never hand-written.         */
/* This is the check that would have caught the 8 mismatched cards.    */
/* ------------------------------------------------------------------ */

function attrValues(attr) {
  const re = new RegExp(`${attr}="([^"]+)"`, 'g');
  return [...html.matchAll(re)].map((m) => m[1]);
}

test('no category count is hard-coded in the markup', () => {
  const hardCoded = [...html.matchAll(/<span class="category-count"[^>]*>([^<]+)<\/span>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  assert.deepEqual(
    hardCoded,
    [],
    `counts must be rendered from the data, found literal text: ${hardCoded.join(' | ')}`
  );
});

test('every data-count-for key resolves to a real lawsuit category', () => {
  const keys = attrValues('data-count-for');
  assert.ok(keys.length > 0, 'no data-count-for attributes found');
  for (const key of keys) {
    assert.ok(lawsuitCategories[key], `data-count-for="${key}" has no matching category`);
  }
});

test('every data-count-for-completion key resolves to real completion data', () => {
  const keys = attrValues('data-count-for-completion');
  assert.ok(keys.length > 0, 'no data-count-for-completion attributes found');
  for (const key of keys) {
    assert.ok(completionData[key], `data-count-for-completion="${key}" has no matching data`);
  }
});

test('every data-count-for-service key resolves to real service data', () => {
  const keys = attrValues('data-count-for-service');
  assert.ok(keys.length > 0, 'no data-count-for-service attributes found');
  for (const key of keys) {
    assert.ok(serviceData[key], `data-count-for-service="${key}" has no matching data`);
  }
});

test('every clickable card key resolves to real data', () => {
  for (const key of attrValues('data-category')) {
    assert.ok(lawsuitCategories[key], `data-category="${key}" has no matching category`);
  }
  for (const key of attrValues('data-completion')) {
    assert.ok(completionData[key], `data-completion="${key}" has no matching data`);
  }
  for (const key of attrValues('data-service')) {
    assert.ok(serviceData[key], `data-service="${key}" has no matching data`);
  }
});

test('every data group is reachable from a card in the markup', () => {
  const categories = new Set(attrValues('data-category'));
  const completions = new Set(attrValues('data-completion'));
  const services = new Set(attrValues('data-service'));

  for (const key of Object.keys(lawsuitCategories)) {
    assert.ok(categories.has(key), `lawsuit category "${key}" has no card`);
  }
  for (const key of Object.keys(completionData)) {
    assert.ok(completions.has(key), `completion group "${key}" has no card`);
  }
  for (const key of Object.keys(serviceData)) {
    assert.ok(services.has(key), `service group "${key}" has no card`);
  }
});

/* ------------------------------------------------------------------ */
/* Search index coverage                                               */
/* ------------------------------------------------------------------ */

test('the search index is built from all three data sets', () => {
  const builder = slice('const allSearchableItems = [];', 'Arabic normalisation');
  for (const source of ['lawsuitCategories', 'completionData', 'serviceData']) {
    assert.ok(
      builder.includes(`Object.keys(${source})`),
      `search index does not include ${source}`
    );
  }
});

test('search covers every item in every data set', () => {
  let expected = 0;
  for (const cat of Object.values(lawsuitCategories)) {
    for (const items of Object.values(cat.subcategories)) expected += items.length;
  }
  for (const group of Object.values({ ...completionData, ...serviceData })) {
    expected += group.items.length;
  }

  // Mirrors the builder in index.html.
  const index = [];
  for (const cat of Object.values(lawsuitCategories)) {
    for (const items of Object.values(cat.subcategories)) {
      for (const item of items) index.push(item);
    }
  }
  for (const group of Object.values({ ...completionData, ...serviceData })) {
    for (const item of group.items) index.push(item);
  }

  assert.equal(index.length, expected);
  assert.ok(expected > 300, `index unexpectedly small: ${expected}`);
});

/* ------------------------------------------------------------------ */
/* Arabic normalisation                                                */
/* ------------------------------------------------------------------ */

test('normalizeAr folds hamza forms onto bare alef', () => {
  assert.equal(normalizeAr('أحوال'), normalizeAr('احوال'));
  assert.equal(normalizeAr('إثبات'), normalizeAr('اثبات'));
  assert.equal(normalizeAr('آخر'), normalizeAr('اخر'));
});

test('normalizeAr folds alef maqsura and taa marbuta', () => {
  assert.equal(normalizeAr('الدعاوى'), normalizeAr('الدعاوي'));
  assert.equal(normalizeAr('وكالة'), normalizeAr('وكاله'));
});

test('normalizeAr strips diacritics and tatweel', () => {
  assert.equal(normalizeAr('نَفَقَة'), normalizeAr('نفقة'));
  assert.equal(normalizeAr('حضـــانة'), normalizeAr('حضانة'));
});

test('unhamzated queries reach the same results as hamzated ones', () => {
  const haystacks = [];
  for (const [, cat] of Object.entries(lawsuitCategories)) {
    for (const [sub, items] of Object.entries(cat.subcategories)) {
      for (const item of items) {
        haystacks.push(normalizeAr(`${item} ${cat.title} ${sub}`));
      }
    }
  }
  const hits = (q) => haystacks.filter((h) => h.includes(normalizeAr(q))).length;

  // Before normalisation these pairs returned 37/0 and 7/0 respectively.
  assert.ok(hits('أحوال') > 0, 'hamzated query returns nothing');
  assert.equal(hits('احوال'), hits('أحوال'));
  assert.equal(hits('اجرة'), hits('أجرة'));
  assert.equal(hits('دعاوي'), hits('دعاوى'));
});

/* ------------------------------------------------------------------ */
/* Markup invariants                                                   */
/* ------------------------------------------------------------------ */

test('no inline event handlers', () => {
  const handlers = [...html.matchAll(/\son[a-z]+="/g)].map((m) => m[0].trim());
  assert.deepEqual(handlers, [], `inline handlers found: ${handlers.join(', ')}`);
});

test('no inline style attributes', () => {
  assert.equal(html.includes('style="'), false, 'inline style attribute found');
});

test('no innerHTML assignment', () => {
  const assignments = [...html.matchAll(/\.innerHTML\s*=/g)];
  assert.equal(assignments.length, 0, 'innerHTML assignment found');
});

test('every category card is a real button', () => {
  const cards = [...html.matchAll(/<(\w+)[^>]*class="category-card"/g)].map((m) => m[1]);
  assert.ok(cards.length > 0, 'no category cards found');
  for (const tag of cards) {
    assert.equal(tag, 'button', `category-card rendered as <${tag}>, must be <button>`);
  }
});

test('keyboard focus is visible', () => {
  assert.ok(html.includes(':focus-visible'), 'no :focus-visible rule');
});

test('reduced motion is respected', () => {
  assert.ok(html.includes('prefers-reduced-motion'), 'no prefers-reduced-motion block');
});

test('the dialog carries dialog semantics', () => {
  assert.ok(html.includes('role="dialog"'), 'modal missing role="dialog"');
  assert.ok(html.includes('aria-modal="true"'), 'modal missing aria-modal');
  assert.ok(html.includes('aria-labelledby="modal-title"'), 'modal missing aria-labelledby');
});

test('the search field is labelled and its button has an accessible name', () => {
  assert.ok(html.includes('<label for="search-input"'), 'search input has no label');
  assert.match(html, /id="search-button"[^>]*aria-label="/, 'search button has no accessible name');
});

test('the document declares Arabic and RTL', () => {
  assert.match(html, /<html lang="ar" dir="rtl">/);
});

test('a disclaimer and a content date are present', () => {
  assert.ok(html.includes('غير رسمي'), 'no disclaimer');
  assert.match(html, /<time[^>]*datetime="\d{4}-\d{2}-\d{2}"/, 'no content date');
});

test('the guide links to the service it documents', () => {
  assert.ok(html.includes('https://www.najiz.sa/'), 'no link to Najiz');
});

test('security headers are declared', () => {
  assert.ok(html.includes('Content-Security-Policy'), 'no CSP meta tag');
  assert.ok(html.includes('name="referrer"'), 'no referrer policy');
});

test('print styles expand every section', () => {
  const printBlock = slice('@media print', '</style>');
  assert.match(printBlock, /\.section,[\s\S]*display: block !important/);
});
