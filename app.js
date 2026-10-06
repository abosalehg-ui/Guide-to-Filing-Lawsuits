/* =====================================================================
   Guide behaviour. Content lives in data.js, which is loaded first and
   provides lawsuitCategories, completionData, serviceData and caseDetails.
   ===================================================================== */

/* Data keys come from the URL, so look them up as own properties only:
   `lawsuitCategories['__proto__']` is Object.prototype, not undefined. */
function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

/* -----------------------------------------------------------------
   Search index, built from all three data sets.
   ----------------------------------------------------------------- */
const allSearchableItems = [];

Object.keys(lawsuitCategories).forEach(catKey => {
    const cat = lawsuitCategories[catKey];
    Object.keys(cat.subcategories).forEach(subCat => {
        cat.subcategories[subCat].forEach(item => {
            allSearchableItems.push({ name: item, category: cat.title, subcategory: subCat, type: 'دعوى' });
        });
    });
});

function indexGroups(data, subcategory, type) {
    Object.keys(data).forEach(key => {
        const group = data[key];
        group.items.forEach(item => {
            allSearchableItems.push({ name: item, category: group.title, subcategory: subcategory, type: type });
        });
    });
}

indexGroups(completionData, 'إنهاء', 'إنهاء');
indexGroups(serviceData, 'خدمة إلكترونية', 'خدمة');

/* -----------------------------------------------------------------
   Arabic normalisation.
   Hamza forms, alef maqsura and taa marbuta are written
   inconsistently both by users and inside the data, so both sides of
   every comparison are folded to one form first.
   ----------------------------------------------------------------- */
function normalizeAr(text) {
    return text
        .replace(/[ً-ْـ]/g, '')  // تشكيل وتطويل
        .replace(/[أإآٱ]/g, 'ا')                 // أ إ آ ٱ  ->  ا
        .replace(/ى/g, 'ي')                      // ى        ->  ي
        .replace(/ة/g, 'ه')                      // ة        ->  ه
        .toLowerCase();
}

// Normalise the haystack once at startup, not on every keystroke.
allSearchableItems.forEach(item => {
    item.haystack = normalizeAr(item.name + ' ' + item.category + ' ' + item.subcategory);
});

/* --- Element references --- */
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const searchStatus = document.getElementById('search-status');
const searchResults = document.getElementById('search-results');
const categoriesView = document.getElementById('categories-view');
const subcategoryView = document.getElementById('subcategory-view');
const subcategoryTitle = document.getElementById('subcategory-title');
const caseTypesList = document.getElementById('case-types-list');
const printView = document.getElementById('print-view');

/* --- Small DOM builders (textContent everywhere, never innerHTML) --- */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function heading(text) {
    const p = el('p');
    p.appendChild(el('strong', '', text));
    return p;
}

function labelled(label, value) {
    const p = el('p');
    p.append(el('strong', '', label + ' '), document.createTextNode(value));
    return p;
}

function buildList(items) {
    const ul = el('ul');
    items.forEach(text => ul.appendChild(el('li', '', text)));
    return ul;
}

// Explicit SVG chevron: arrow glyphs such as U+2190/U+2192 carry
// Bidi_Mirrored, so their rendered direction inside an RTL paragraph
// is up to the engine. A path is not mirrored.
function chevronForward() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z');
    svg.appendChild(path);
    return svg;
}

/* -----------------------------------------------------------------
   Cards. Rendered from the data, so a title, icon or count can only
   ever be written once (in data.js).
   ----------------------------------------------------------------- */
function countLabel(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n <= 10) return n + ' ' + few;
    return n + ' ' + many;
}

function subcategoryCount(group) {
    const n = Object.keys(group.subcategories).length;
    return countLabel(n, 'تصنيف فرعي واحد', 'تصنيفان فرعيان', 'تصنيفات فرعية', 'تصنيفاً فرعياً');
}

function itemCount(group) {
    return countLabel(group.items.length, 'خدمة واحدة', 'خدمتان', 'خدمات', 'خدمة');
}

function renderCards(container, data, kind, countText, onOpen) {
    Object.keys(data).forEach(key => {
        const group = data[key];
        const card = el('button', 'category-card');
        card.type = 'button';
        card.dataset[kind] = key;

        const icon = el('div', 'category-icon icon-' + group.color, group.icon);
        icon.setAttribute('aria-hidden', 'true');

        card.append(
            icon,
            el('h3', '', group.title),
            el('p', '', group.summary),
            el('span', 'category-count', countText(group))
        );
        card.addEventListener('click', () => onOpen(key));
        container.appendChild(card);
    });
}

/* -----------------------------------------------------------------
   Modal: dialog semantics, focus trap, focus restore, scroll lock.
   ----------------------------------------------------------------- */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
let lastFocused = null;

function isModalOpen() {
    return modalOverlay.classList.contains('active');
}

function openModal(title, content) {
    lastFocused = document.activeElement;
    modalTitle.textContent = title;
    modalBody.replaceChildren(content);
    modalOverlay.classList.add('active');
    document.body.classList.add('modal-open');
    modalClose.focus();
}

function closeModal() {
    if (!isModalOpen()) return;
    modalOverlay.classList.remove('active');
    document.body.classList.remove('modal-open');
    if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
    }
    lastFocused = null;
}

modalClose.addEventListener('click', closeModal);

modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
});

modalOverlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(modalOverlay.querySelectorAll(FOCUSABLE))
        .filter(node => node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});

function openListModal(data, intro) {
    const frag = document.createDocumentFragment();
    frag.appendChild(heading(intro));
    frag.appendChild(buildList(data.items));
    openModal(data.title, frag);
}

function sourcesBlock(sources) {
    const wrap = el('div', 'case-sources');
    wrap.appendChild(heading('المصدر:'));
    const ul = el('ul');
    sources.forEach(source => {
        const li = el('li');
        const link = el('a', '', source.label);
        link.href = source.url;
        link.rel = 'noopener external';
        li.appendChild(link);
        ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
}

function showCaseTypeDetails(caseName, subCategory, mainCategory) {
    const detail = hasOwn(caseDetails, caseName) ? caseDetails[caseName] : {};
    const frag = document.createDocumentFragment();

    frag.appendChild(labelled('التصنيف الرئيسي:', mainCategory));
    frag.appendChild(labelled('التصنيف الفرعي:', subCategory));

    if (detail.court) {
        frag.appendChild(labelled('المحكمة المختصة:', detail.court));
    }

    if (detail.notes) {
        frag.appendChild(labelled('قبل التقديم:', detail.notes));
    }

    if (Array.isArray(detail.documents) && detail.documents.length) {
        frag.appendChild(heading('المستندات المطلوبة:'));
        frag.appendChild(buildList(detail.documents));
    }

    frag.appendChild(heading('للتقديم على هذه الدعوى:'));
    frag.appendChild(buildList([
        'قم بتسجيل الدخول في نظام ناجز',
        'اختر "الخدمات القضائية" ثم "صحيفة الدعوى"',
        'حدد التصنيف: ' + mainCategory,
        'اختر نوع الدعوى: ' + caseName,
        'أكمل البيانات المطلوبة وأرفق المستندات'
    ]));

    if (Array.isArray(detail.sources) && detail.sources.length) {
        frag.appendChild(sourcesBlock(detail.sources));
    }

    openModal(caseName, frag);
}

function showServiceItemDetails(item) {
    const isCompletion = item.type === 'إنهاء';
    const frag = document.createDocumentFragment();

    frag.appendChild(labelled('القسم:', item.category));
    frag.appendChild(labelled('النوع:', item.type));
    frag.appendChild(heading('للوصول إلى هذه الخدمة:'));
    frag.appendChild(buildList([
        'قم بتسجيل الدخول في نظام ناجز',
        isCompletion ? 'افتح قسم "الإنهاءات"' : 'افتح قسم "الخدمات الإلكترونية"',
        'اختر الخدمة: ' + item.name,
        'أكمل البيانات المطلوبة وأرفق المستندات'
    ]));

    openModal(item.name, frag);
}

function openSearchItem(item) {
    if (item.type === 'دعوى') {
        showCaseTypeDetails(item.name, item.subcategory, item.category);
    } else {
        showServiceItemDetails(item);
    }
}

/* -----------------------------------------------------------------
   Case-type rows. Real <button> elements, so keyboard activation and
   focus come from the platform rather than being re-implemented.
   ----------------------------------------------------------------- */
function buildCaseTypeRow(options) {
    const row = el('button', 'case-type-item');
    row.type = 'button';

    const number = el('span', 'case-type-number', String(options.index + 1));
    number.setAttribute('aria-hidden', 'true');

    const body = el('div', 'case-type-body');
    body.appendChild(el('span', 'case-type-name', options.name));
    if (options.meta) {
        body.appendChild(el('span', 'case-type-meta', options.meta));
    }

    const arrow = el('span', 'case-type-arrow');
    arrow.appendChild(chevronForward());

    row.append(number, body, arrow);
    row.addEventListener('click', options.onOpen);
    return row;
}

function showSubcategory(categoryKey) {
    const category = lawsuitCategories[categoryKey];

    categoriesView.hidden = true;
    subcategoryView.hidden = false;
    subcategoryTitle.textContent = category.title;
    document.getElementById('subcategory-desc').textContent = category.description;

    caseTypesList.replaceChildren();

    Object.keys(category.subcategories).forEach(subCatName => {
        caseTypesList.appendChild(el('div', 'case-type-group', subCatName));

        category.subcategories[subCatName].forEach((item, index) => {
            caseTypesList.appendChild(buildCaseTypeRow({
                index: index,
                name: item,
                onOpen: function () {
                    showCaseTypeDetails(item, subCatName, category.title);
                }
            }));
        });
    });
}

function showCategories() {
    categoriesView.hidden = false;
    subcategoryView.hidden = true;
}

/* -----------------------------------------------------------------
   Search. Typing is debounced and the list is capped, so a two-letter
   query such as "ال" (which matches almost everything) stays cheap.
   ----------------------------------------------------------------- */
const SEARCH_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 150;
let searchTimer = null;

function searchHash(query) {
    return query ? '#/search/' + encodeURIComponent(query) : '#/search';
}

function performSearch(showAll) {
    const raw = searchInput.value.trim();
    const query = normalizeAr(raw);

    // Keep the query in the URL so a search can be shared or reloaded.
    // replaceState: each keystroke must not become a history entry. Only
    // while the search section is showing, so a late debounced call can
    // never overwrite the URL of a section the user has moved on to.
    if (currentRoute && currentRoute.section === 'search' && location.hash !== searchHash(raw)) {
        history.replaceState(null, '', searchHash(raw));
    }

    if (query.length < 2) {
        searchStatus.textContent = 'أدخل حرفين على الأقل للبحث';
        searchResults.replaceChildren();
        return;
    }

    const results = allSearchableItems.filter(item => item.haystack.indexOf(query) !== -1);

    if (!results.length) {
        searchStatus.textContent = 'لم يتم العثور على نتائج. جرّب كلمة أقصر أو كتابة مختلفة.';
        searchResults.replaceChildren();
        return;
    }

    searchStatus.textContent = 'تم العثور على ' + results.length + ' نتيجة';

    const list = el('div', 'case-type-list');
    const shown = showAll ? results : results.slice(0, SEARCH_LIMIT);

    shown.forEach((item, index) => {
        list.appendChild(buildCaseTypeRow({
            index: index,
            name: item.name,
            meta: item.category + ' - ' + item.subcategory,
            onOpen: function () {
                openSearchItem(item);
            }
        }));
    });

    if (shown.length === results.length) {
        searchResults.replaceChildren(list);
        return;
    }

    const more = el('button', 'show-all-btn', 'عرض كل النتائج (' + results.length + ')');
    more.type = 'button';
    more.addEventListener('click', () => {
        performSearch(true);
        // The button is gone; continue from the first newly shown row.
        const rows = searchResults.querySelectorAll('.case-type-item');
        if (rows[SEARCH_LIMIT]) rows[SEARCH_LIMIT].focus();
    });
    searchResults.replaceChildren(list, more);
}

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => performSearch(false), SEARCH_DEBOUNCE_MS);
});

searchButton.addEventListener('click', () => {
    clearTimeout(searchTimer);
    performSearch(false);
    searchInput.focus();
});

/* -----------------------------------------------------------------
   Routing. The hash is the single source of truth, so a category or a
   search is linkable and the browser Back button works.
   Format:  #/services  |  #/lawsuits/general  |  #/search/<query>
   The leading slash keeps the browser from scroll-jumping to the
   element whose id matches the section name.
   ----------------------------------------------------------------- */
const SECTIONS = ['lawsuits', 'completions', 'services', 'steps', 'search'];
let currentRoute = null;

function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const slash = raw.indexOf('/');
    const head = slash === -1 ? raw : raw.slice(0, slash);
    let arg = slash === -1 ? '' : raw.slice(slash + 1);
    try {
        arg = decodeURIComponent(arg);
    } catch (err) {
        arg = '';  // malformed escape such as "%E0%A4%A"
    }
    return {
        section: SECTIONS.indexOf(head) !== -1 ? head : 'lawsuits',
        arg: arg
    };
}

function isHidden(node) {
    return !node || node === document.body || node.offsetParent === null;
}

function focusHeading(node) {
    if (node) node.focus({ preventScroll: true });
}

function applyHash() {
    const route = parseHash();
    const previous = currentRoute;
    const category = route.section === 'lawsuits' && hasOwn(lawsuitCategories, route.arg) ? route.arg : '';

    // A route change always dismisses the dialog (e.g. browser Back) and
    // drops any search still waiting on the debounce timer.
    closeModal();
    clearTimeout(searchTimer);

    document.querySelectorAll('.nav-tab').forEach(tab => {
        const isActive = tab.dataset.section === route.section;
        tab.classList.toggle('active', isActive);
        if (isActive) {
            tab.setAttribute('aria-current', 'page');
        } else {
            tab.removeAttribute('aria-current');
        }
    });

    document.querySelectorAll('.section').forEach(s => {
        s.classList.toggle('active', s.id === route.section);
    });

    if (category) {
        showSubcategory(category);
    } else {
        showCategories();
    }

    currentRoute = { section: route.section, category: category };

    if (route.section === 'search' && searchInput.value.trim() !== route.arg) {
        searchInput.value = route.arg;
        performSearch(false);
    }

    // Focus management. Nothing moves on first load; afterwards, focus
    // follows the content whenever the element that had it was hidden.
    if (!previous) return;

    if (category && category !== previous.category) {
        focusHeading(subcategoryTitle);
    } else if (!category && previous.category && route.section === 'lawsuits') {
        focusHeading(document.querySelector('.category-card[data-category="' + previous.category + '"]'));
    } else if (isHidden(document.activeElement)) {
        const section = document.getElementById(route.section);
        focusHeading(section.querySelector('h2'));
    }
}

function navigate(hash) {
    if (location.hash !== hash) {
        history.pushState(null, '', hash);
    }
    applyHash();
}

// popstate also fires when the user edits the hash by hand, so a
// separate hashchange listener would only run applyHash twice.
window.addEventListener('popstate', applyHash);

/* -----------------------------------------------------------------
   Print. The lists are only in the DOM once opened, so build a full
   copy of every data set the first time the page is printed.
   ----------------------------------------------------------------- */
function printGroup(title, items) {
    const wrap = el('div', 'print-group');
    wrap.append(el('h3', '', title), buildList(items));
    return wrap;
}

function buildPrintView() {
    if (printView.childElementCount) return;
    const frag = document.createDocumentFragment();

    Object.keys(lawsuitCategories).forEach(key => {
        const cat = lawsuitCategories[key];
        frag.appendChild(el('h2', '', cat.title));
        Object.keys(cat.subcategories).forEach(sub => {
            frag.appendChild(printGroup(sub, cat.subcategories[sub]));
        });
    });

    [['الإنهاءات', completionData], ['الخدمات الإلكترونية', serviceData]].forEach(pair => {
        frag.appendChild(el('h2', '', pair[0]));
        Object.keys(pair[1]).forEach(key => {
            frag.appendChild(printGroup(pair[1][key].title, pair[1][key].items));
        });
    });

    printView.appendChild(frag);
}

window.addEventListener('beforeprint', buildPrintView);

/* --- Wiring --- */
renderCards(document.getElementById('lawsuit-cards'), lawsuitCategories, 'category', subcategoryCount,
    key => navigate('#/lawsuits/' + key));

renderCards(document.getElementById('completion-cards'), completionData, 'completion', itemCount,
    key => openListModal(completionData[key], 'الخدمات المتاحة في هذا القسم:'));

renderCards(document.getElementById('service-cards'), serviceData, 'service', itemCount,
    key => openListModal(serviceData[key], 'الخدمات المتاحة:'));

document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        // Returning to the search tab keeps the last query.
        const hash = tab.dataset.section === 'search'
            ? searchHash(searchInput.value.trim())
            : '#/' + tab.dataset.section;
        navigate(hash);
    });
});

document.getElementById('back-to-categories').addEventListener('click', () => {
    navigate('#/lawsuits');
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
        return;
    }

    // e.code identifies the physical key: on the Arabic layout the same
    // key types "ظ", so e.key alone never sees "/".
    if ((e.key === '/' || e.code === 'Slash') && !isModalOpen() && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        const tag = active ? active.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable)) return;
        e.preventDefault();
        navigate(searchHash(searchInput.value.trim()));
        searchInput.focus();
    }
});

/* --- Initial render --- */
searchStatus.textContent = 'أدخل حرفين على الأقل للبحث';
applyHash();
