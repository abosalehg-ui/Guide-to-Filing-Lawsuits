/**
 * Data and markup tests. Dependency-free (node:test, node:assert, node:vm),
 * so they run with a bare `node --test tests/*.mjs`. Browser behaviour —
 * routing, focus, the dialog, search — lives in tests/e2e/.
 *
 * data.js and the pure top of app.js (search index + Arabic normalisation)
 * are evaluated in a sandbox, so these tests exercise the shipped code, not
 * a copy of it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');

const html = read('index.html');
const dataJs = read('data.js');
const appJs = read('app.js');

function slice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start !== -1, `marker not found: ${startMarker}`);
  assert.ok(end > start, `marker not found or out of order: ${endMarker}`);
  return source.slice(start, end);
}

// Everything in app.js before the first DOM lookup is pure.
const pureApp = slice(appJs, 'function hasOwn', '/* --- Element references');

const sandbox = {};
vm.createContext(sandbox);
// `const` declarations stay in the script's lexical scope rather than landing
// on the context object, so hand them out explicitly on the last line.
vm.runInContext(
  `${dataJs}\n${pureApp}\n` +
    ';globalThis.__extracted = { lawsuitCategories, completionData, serviceData, caseDetails, allSearchableItems, normalizeAr, hasOwn };',
  sandbox,
  { filename: 'data.js + app.js' }
);

const {
  lawsuitCategories,
  completionData,
  serviceData,
  caseDetails,
  allSearchableItems,
  normalizeAr,
  hasOwn,
} = sandbox.__extracted;

const groups = { ...completionData, ...serviceData };

function allCaseNames() {
  const names = new Set();
  for (const cat of Object.values(lawsuitCategories)) {
    for (const items of Object.values(cat.subcategories)) items.forEach((n) => names.add(n));
  }
  return names;
}

/* ------------------------------------------------------------------ */
/* Data shape                                                          */
/* ------------------------------------------------------------------ */

test('data.js parses and defines every data set', () => {
  // A syntax error in data.js fails the vm.runInContext call above, which
  // reports the line — this is the check content editors rely on.
  for (const [name, value] of Object.entries({ lawsuitCategories, completionData, serviceData, caseDetails })) {
    assert.ok(value && typeof value === 'object', `${name} missing`);
  }
});

const COLORS = new Set(['blue', 'green', 'orange', 'purple', 'red', 'teal']);

function assertCardFields(key, group) {
  for (const field of ['title', 'icon', 'summary']) {
    assert.equal(typeof group[field], 'string', `${key}: missing ${field}`);
    assert.ok(group[field].trim(), `${key}: empty ${field}`);
  }
  assert.ok(COLORS.has(group.color), `${key}: color "${group.color}" has no icon-* class`);
  assert.ok(html.includes(`.icon-${group.color} {`), `${key}: .icon-${group.color} not styled`);
}

test('every lawsuit category has card fields, a description and subcategories', () => {
  for (const [key, cat] of Object.entries(lawsuitCategories)) {
    assertCardFields(key, cat);
    assert.equal(typeof cat.description, 'string', `${key}: missing description`);
    const subs = Object.keys(cat.subcategories);
    assert.ok(subs.length > 0, `${key}: no subcategories`);
    for (const sub of subs) {
      assert.ok(Array.isArray(cat.subcategories[sub]), `${key}/${sub}: not an array`);
      assert.ok(cat.subcategories[sub].length > 0, `${key}/${sub}: empty`);
    }
  }
});

test('every completion and service group has card fields and items', () => {
  for (const [key, group] of Object.entries(groups)) {
    assertCardFields(key, group);
    assert.ok(Array.isArray(group.items) && group.items.length > 0, `${key}: empty items`);
  }
});

test('no item is listed twice within the same group', () => {
  const check = (where, items) => {
    const dupes = [...items.filter((item, i) => items.indexOf(item) !== i)];
    assert.deepEqual(dupes, [], `${where}: duplicated ${dupes.join(' | ')}`);
  };
  for (const [key, cat] of Object.entries(lawsuitCategories)) {
    for (const [sub, items] of Object.entries(cat.subcategories)) check(`${key}/${sub}`, items);
  }
  for (const [key, group] of Object.entries(groups)) check(key, group.items);
});

test('subcategory names use the spelling الدعاوى, not الدعاوي', () => {
  for (const cat of Object.values(lawsuitCategories)) {
    for (const sub of Object.keys(cat.subcategories)) {
      assert.ok(!/دعاوي/.test(sub), `"${sub}" uses دعاوي`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Case details: optional, but every entry must be real and sourced.   */
/* ------------------------------------------------------------------ */

test('every caseDetails key is a real case name', () => {
  const names = allCaseNames();
  for (const key of Object.keys(caseDetails)) {
    assert.ok(names.has(key), `caseDetails["${key}"] matches no case in lawsuitCategories`);
  }
});

test('every caseDetails entry cites at least one https source', () => {
  for (const [key, detail] of Object.entries(caseDetails)) {
    assert.ok(Array.isArray(detail.sources) && detail.sources.length, `${key}: no sources`);
    for (const source of detail.sources) {
      assert.equal(typeof source.label, 'string', `${key}: source has no label`);
      assert.match(source.url, /^https:\/\//, `${key}: source url is not https`);
    }
    if ('documents' in detail) {
      assert.ok(Array.isArray(detail.documents) && detail.documents.length, `${key}: documents must be a non-empty array`);
    }
    for (const field of ['court', 'notes']) {
      if (field in detail) assert.equal(typeof detail[field], 'string', `${key}: ${field} must be text`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Search index — the real one built by app.js                         */
/* ------------------------------------------------------------------ */

test('the search index holds every item of every data set exactly once', () => {
  const expected = [];
  for (const cat of Object.values(lawsuitCategories)) {
    for (const items of Object.values(cat.subcategories)) expected.push(...items);
  }
  for (const group of Object.values(groups)) expected.push(...group.items);

  assert.equal(allSearchableItems.length, expected.length);
  assert.deepEqual(
    [...allSearchableItems.map((i) => i.name)].sort(),
    [...expected].sort(),
    'index entries differ from the data'
  );
  assert.ok(expected.length > 300, `index unexpectedly small: ${expected.length}`);
});

test('every index entry has a type and a normalised haystack', () => {
  const types = new Set(allSearchableItems.map((i) => i.type));
  assert.deepEqual([...types].sort(), ['إنهاء', 'خدمة', 'دعوى'].sort());
  for (const item of allSearchableItems) {
    assert.equal(item.haystack, normalizeAr(`${item.name} ${item.category} ${item.subcategory}`));
  }
});

test('hasOwn rejects inherited keys taken from the URL', () => {
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(hasOwn(lawsuitCategories, key), false, key);
  }
  assert.equal(hasOwn(lawsuitCategories, 'labor'), true);
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
  const hits = (q) => allSearchableItems.filter((i) => i.haystack.includes(normalizeAr(q))).length;
  assert.ok(hits('أحوال') > 0, 'hamzated query returns nothing');
  assert.equal(hits('احوال'), hits('أحوال'));
  assert.equal(hits('اجرة'), hits('أجرة'));
  assert.equal(hits('دعاوي'), hits('دعاوى'));
});

/* ------------------------------------------------------------------ */
/* Markup and security invariants                                      */
/* ------------------------------------------------------------------ */

test('no inline script, so the CSP can forbid it', () => {
  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)];
  assert.equal(inline.length, 0, 'inline <script> found');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, 'no CSP meta tag');
  const scriptSrc = csp[1].split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
  assert.equal(scriptSrc, "script-src 'self'");
});

test('data.js loads before app.js', () => {
  const data = html.indexOf('<script src="data.js">');
  const app = html.indexOf('<script src="app.js">');
  assert.ok(data !== -1 && app !== -1, 'script tags missing');
  assert.ok(data < app, 'data.js must load first');
});

test('no inline event handlers or style attributes', () => {
  const handlers = [...html.matchAll(/\son[a-z]+="/g)].map((m) => m[0].trim());
  assert.deepEqual(handlers, [], `inline handlers found: ${handlers.join(', ')}`);
  assert.equal(html.includes('style="'), false, 'inline style attribute found');
});

test('no innerHTML, outerHTML, insertAdjacentHTML or eval', () => {
  for (const [name, src] of [['index.html', html], ['app.js', appJs], ['data.js', dataJs]]) {
    assert.doesNotMatch(src, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|\beval\(/, name);
  }
});

test('cards are not hand-written in the markup', () => {
  assert.equal(html.includes('class="category-card"'), false, 'a card is hard-coded in index.html');
  for (const id of ['lawsuit-cards', 'completion-cards', 'service-cards']) {
    assert.match(html, new RegExp(`id="${id}"></div>`), `#${id} container missing or not empty`);
  }
});

test('the dialog carries dialog semantics', () => {
  assert.ok(html.includes('role="dialog"'), 'modal missing role="dialog"');
  assert.ok(html.includes('aria-modal="true"'), 'modal missing aria-modal');
  assert.ok(html.includes('aria-labelledby="modal-title"'), 'modal missing aria-labelledby');
});

test('only the search status line is a live region', () => {
  const live = [...html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"[^>]*aria-live=/g)].map((m) => m[2]);
  assert.deepEqual(live, ['search-status']);
});

test('the search field is labelled and its button has an accessible name', () => {
  assert.ok(html.includes('<label for="search-input"'), 'search input has no label');
  assert.match(html, /id="search-button"[^>]*aria-label="/, 'search button has no accessible name');
});

test('the document declares Arabic and RTL and explains a missing JavaScript', () => {
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
});

test('a disclaimer and a content date are present', () => {
  assert.ok(html.includes('غير رسمي'), 'no disclaimer');
  assert.match(html, /<time[^>]*datetime="\d{4}-\d{2}-\d{2}"/, 'no content date');
  assert.ok(html.includes('https://www.najiz.sa/'), 'no link to Najiz');
});

/* ------------------------------------------------------------------ */
/* CSS                                                                 */
/* ------------------------------------------------------------------ */

function cssVar(name) {
  const m = html.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(m, `--${name} not defined`);
  return m[1];
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('white text on the header gradients meets WCAG AA (4.5:1)', () => {
  for (const selector of ['.header', '.subcategory-header']) {
    const block = slice(html, `        ${selector} {`, '}');
    const gradient = block.match(/background: linear-gradient\(([^;]+)\);/);
    assert.ok(gradient, `${selector}: no gradient found`);
    const stops = [...gradient[1].matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]);
    assert.ok(stops.length >= 2, `${selector}: no gradient found`);
    for (const stop of stops) {
      const ratio = 1.05 / (luminance(cssVar(stop)) + 0.05);
      assert.ok(ratio >= 4.5, `${selector}: white on --${stop} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('no dead CSS from removed components', () => {
  for (const selector of ['.service-item', '.tooltip', '.services-grid', '.search-hint']) {
    assert.equal(html.includes(selector), false, `${selector} is styled but never used`);
  }
});

test('keyboard focus is visible and reduced motion is respected', () => {
  assert.match(html, /:focus-visible\s*\{\s*outline:/, 'no :focus-visible outline rule');
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/, 'no prefers-reduced-motion block');
});

test('print shows the generated full copy instead of the interactive sections', () => {
  const printBlock = slice(html, '@media print', '</style>');
  assert.match(printBlock, /\.print-only\s*\{[^}]*display: block !important/);
  assert.match(html, /<section id="print-view" class="print-only"/);
  assert.ok(appJs.includes("addEventListener('beforeprint', buildPrintView)"), 'print view is never built');
});
