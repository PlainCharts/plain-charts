// @ts-check
// Watchlist — a right-panel library of symbols with live Last / Chg / Chg%.
// Each entry is (broker, symbol) since symbols are protocol-dependent. Persisted
// globally in settings/watchlist.json.
//
// This module is the panel shell: init, the flat item/section list (CRUD, drag-reorder,
// context menus) and the row rendering. The shared state lives in watchlist-state.js
// (single store + render slot); the column system in watchlist-columns.js; the
// per-symbol live data in watchlist-live.js; the named-lists manager in
// watchlist-lists.js.
import { bus } from '../bus.js';
import { broker, bus as engineBus } from '../../data_engine/index.js';   // facade + engine events (logon)
import { themeIcon } from '../ui/icon.js';
import { openSymbolSearch } from '../market/symbol-search.js';
import { state, store, keyOf, newId, newListId, activeList, symbols, persist, setRenderer } from './watchlist-state.js';
import { renderHeader, loadColumnPrefs, orderedCols, displayItems, toggleColsMenu } from './watchlist-columns.js';
import { startAll, stop, paint } from './watchlist-live.js';
import { renderListBtn, toggleListMenu } from './watchlist-lists.js';
import * as rp from './rightpanel.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup (list/section names stay user data)

/** @typedef {import('./watchlist-state.js').WlItem} WlItem */
/** @typedef {import('./watchlist-state.js').SectionItem} SectionItem */
/** @typedef {import('./watchlist-state.js').SymbolItem} SymbolItem */
/** @typedef {import('./watchlist-state.js').WatchList} WatchList */

/**
 * @param {string} tag
 * @param {(string|null)=} cls
 * @param {(string|null)=} txt
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

export async function initWatchlist() {
  const view = el('div', 'wl-view');
  const head = el('div', 'obj-head');
  // the title is a dropdown: the active watchlist's name; click to switch / create / remove (palette-style)
  const listBtn = el('button', 'wl-listbtn');
  state.listBtnName = el('span', 'wl-listbtn-t');
  listBtn.append(state.listBtnName, el('span', 'wl-listbtn-caret', '▾'));
  listBtn.title = t('Switch, create, or remove a watchlist');
  listBtn.onclick = () => toggleListMenu(listBtn);
  const closeX = el('span', 'lib-x', '✕'); closeX.onclick = () => rp.toggle('watchlist', false);
  head.append(listBtn, closeX);
  const bar = el('div', 'obj-bar');
  const add = el('button', 'obj-bar-btn', '＋'); add.title = t('Add symbol');
  add.onclick = () => openSymbolSearch((/** @type {string} */ brokerId, /** @type {string} */ symbol) => addItem(brokerId, symbol));
  const sec = el('button', 'obj-bar-btn', '＋☰'); sec.title = t('New section');
  sec.onclick = () => addSection();
  const colBtn = el('button', 'obj-bar-btn', '⋯'); colBtn.title = t('Customize columns');
  colBtn.style.marginLeft = 'auto';   // push it to the right edge of the toolbar
  colBtn.onclick = () => toggleColsMenu(colBtn);
  bar.append(add, el('span', 'obj-bar-sep'), sec, colBtn);
  state.colhdrEl = el('div', 'wl-colhdr');
  renderHeader();
  state.listEl = el('div', 'wl-list');
  view.append(head, bar, state.colhdrEl, state.listEl);
  rp.addView({ id: 'watchlist', icon: themeIcon('/images/menu.png', 18), title: t('Watchlist'), content: view, width: 300 });

  bus.on('rightpanel:shown', (id) => { if (id === 'watchlist') { render(); startAll(); } });
  bus.on('vocab:changed', () => { renderListBtn(); renderHeader(); if (rp.isShown('watchlist')) render(); });   // live vocabulary switch

  const d = await store.load();
  state.lists = /** @type {WatchList[]} */ ((Array.isArray(d.lists) ? d.lists : []).map(normList).filter(Boolean));
  if (!state.lists.length) state.lists = [{ id: newListId(), name: 'Watchlist', items: [] }];
  state.activeId = (d.activeId && state.lists.some((l) => l.id === d.activeId)) ? d.activeId : state.lists[0].id;
  state.items = /** @type {WatchList} */ (activeList()).items;
  loadColumnPrefs(d);
  renderListBtn(); renderHeader();
  if (rp.isShown('watchlist')) { render(); startAll(); }
  engineBus.on('logon', () => { if (rp.isShown('watchlist')) startAll(); });   // a broker connected → pull data
}

// ---- normalize persisted data ----
/** @param {any} arr @returns {WlItem[]} */
function normItems(arr) {
  return /** @type {WlItem[]} */ ((Array.isArray(arr) ? arr : []).map((/** @type {any} */ e) => {
    if (e && e.type === 'section') return { type: 'section', id: e.id || newId(), name: e.name || 'Section', collapsed: !!e.collapsed };
    if (e && e.broker && e.symbol) return { type: 'symbol', broker: e.broker, symbol: e.symbol };
    return null;
  }).filter(Boolean));
}
/** @param {any} l @returns {WatchList|null} */
function normList(l) { return (l && l.id) ? { id: l.id, name: l.name || 'Watchlist', items: normItems(l.items) } : null; }

/** @param {string} brokerId @param {string} symbol */
function addItem(brokerId, symbol) {
  if (symbols().some((x) => x.broker === brokerId && x.symbol === symbol)) return;   // no dupes
  state.items.push({ type: 'symbol', broker: brokerId, symbol });
  persist(); render(); startAll();
}
/** @param {SymbolItem} it */
function removeItem(it) {
  stop(it);
  state.items = state.items.filter((x) => !(x.type === 'symbol' && x.broker === it.broker && x.symbol === it.symbol));
  persist(); render();
}
function addSection() {
  /** @type {SectionItem} */
  const s = { type: 'section', id: newId(), name: 'New section', collapsed: false };
  state.items.push(s);
  persist();
  startRename(s.id);   // inline-rename the fresh header (calls render)
}
/** @param {string} id */
function removeSection(id) {   // drop the header only — its symbols stay (uncategorized / merge up)
  state.items = state.items.filter((e) => !(e.type === 'section' && e.id === id));
  persist(); render();
}
// add (or move) a symbol so it lands at the end of the given section
/** @param {string} id @param {string} brokerId @param {string} symbol */
function addItemToSection(id, brokerId, symbol) {
  state.items = state.items.filter((e) => !(e.type === 'symbol' && e.broker === brokerId && e.symbol === symbol));   // de-dupe / move
  const idx = state.items.findIndex((e) => e.type === 'section' && e.id === id);
  if (idx < 0) { state.items.push({ type: 'symbol', broker: brokerId, symbol }); }
  else {
    let end = idx + 1;
    while (end < state.items.length && state.items[end].type !== 'section') end++;
    state.items.splice(end, 0, { type: 'symbol', broker: brokerId, symbol });
  }
  persist(); render(); startAll();
}

// insert a new section just ABOVE this symbol (symbols below belong to it)
/** @param {SymbolItem} it */
function addSectionBefore(it) {
  const idx = state.items.findIndex((e) => e.type === 'symbol' && e.broker === it.broker && e.symbol === it.symbol);
  /** @type {SectionItem} */
  const s = { type: 'section', id: newId(), name: 'New section', collapsed: false };
  if (idx < 0) state.items.push(s); else state.items.splice(idx, 0, s);
  persist();
  startRename(s.id);
}

// ---- context menus ----
// item(label, fn) builds a clickable menu row; build(menu, item) populates a fresh menu.
/**
 * @typedef {(label: string, fn: () => void) => HTMLElement} MenuItemFactory
 * @typedef {(m: HTMLElement, item: MenuItemFactory) => void} MenuBuilder
 */
/** @type {HTMLElement|null} */
let wlMenu = null;
/** @type {((e: PointerEvent) => void)|null} */
let wlMenuAway = null;
function closeWlMenu() {
  if (wlMenuAway) { document.removeEventListener('pointerdown', /** @type {any} */ (wlMenuAway), true); wlMenuAway = null; }
  if (wlMenu) { wlMenu.remove(); wlMenu = null; }
}
/** @param {number} x @param {number} y @param {MenuBuilder} build */
function wlMenuAt(x, y, build) {
  closeWlMenu();
  const m = el('div', 'dwg-menu'); wlMenu = m;
  /** @type {MenuItemFactory} */
  const item = (label, fn) => { const r = el('div', 'dwg-item'); r.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', t(label))); r.onclick = () => { closeWlMenu(); fn(); }; return r; };
  build(m, item);
  document.body.appendChild(m);
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 6) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 6) + 'px';
  wlMenuAway = (e) => { if (wlMenu && !wlMenu.contains(/** @type {Node} */ (e.target))) closeWlMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', /** @type {any} */ (wlMenuAway), true), 0);
}
/** @param {SectionItem} s @param {number} x @param {number} y */
function openSectionMenu(s, x, y) {
  wlMenuAt(x, y, (m, item) => m.append(
    item('Rename', () => startRename(s.id)),
    item('Remove section', () => removeSection(s.id)),
    el('div', 'dwg-div'),
    item('Add symbol', () => openSymbolSearch((/** @type {string} */ b, /** @type {string} */ sym) => addItemToSection(s.id, b, sym))),
  ));
}
/** @param {SymbolItem} it @param {number} x @param {number} y */
function openSymbolMenu(it, x, y) {
  wlMenuAt(x, y, (m, item) => m.append(
    item('Add section', () => addSectionBefore(it)),
    item('Add symbol', () => openSymbolSearch((/** @type {string} */ b, /** @type {string} */ sym) => addItem(b, sym))),
    el('div', 'dwg-div'),
    item(t('Remove') + ' ' + it.symbol, () => removeItem(it)),
  ));
}
/** @param {string} id */
function toggleCollapse(id) {
  const s = /** @type {SectionItem|undefined} */ (state.items.find((e) => e.type === 'section' && e.id === id));
  if (s) { s.collapsed = !s.collapsed; persist(); render(); }
}

// ---- drag-to-reorder ----
/** @type {string|null} */
let dragKey = null;
/** @type {string|null} */
let dropKey = null;
/** @type {'before'|'after'|null} */
let dropPos = null;
function clearDrop() {
  state.listEl.querySelectorAll('.wl-drop-before,.wl-drop-after').forEach((r) => r.classList.remove('wl-drop-before', 'wl-drop-after'));
  dropKey = null; dropPos = null;
}
/** @param {HTMLElement} row @param {string} key */
function rowDnd(row, key) {
  row.draggable = true;
  row.ondragstart = (e) => { dragKey = key; /** @type {DataTransfer} */ (e.dataTransfer).effectAllowed = 'move'; try { /** @type {DataTransfer} */ (e.dataTransfer).setData('text/plain', key); } catch (_) {} row.classList.add('wl-drag'); };
  row.ondragend = () => { row.classList.remove('wl-drag'); clearDrop(); dragKey = null; };
  row.ondragover = (e) => {
    if (!dragKey || dragKey === key) return;
    e.preventDefault(); clearDrop();
    const r = row.getBoundingClientRect();
    dropKey = key; dropPos = (e.clientY - r.top) > r.height / 2 ? 'after' : 'before';
    row.classList.add(dropPos === 'after' ? 'wl-drop-after' : 'wl-drop-before');
  };
  row.ondrop = (e) => { e.preventDefault(); doDrop(); };
}
// entries spanned by the section header at idx (header + its symbols)
/** @param {number} idx */
function sectionSpan(idx) {
  let end = idx + 1;
  while (end < state.items.length && state.items[end].type !== 'section') end++;
  return end - idx;
}
function doDrop() {
  const dk = dragKey, tk = dropKey, pos = dropPos;
  clearDrop(); dragKey = null;
  if (!dk || !tk || dk === tk) return;
  const from = state.items.findIndex((e) => keyOf(e) === dk);
  if (from < 0) return;
  const draggedSection = state.items[from].type === 'section';
  const moved = state.items.splice(from, draggedSection ? sectionSpan(from) : 1);
  let to = state.items.findIndex((e) => keyOf(e) === tk);
  if (to < 0) { state.items.splice(from, 0, ...moved); persist(); render(); return; }   // target was inside the moved span
  if (pos === 'after') to = (draggedSection && state.items[to].type === 'section') ? to + sectionSpan(to) : to + 1;
  state.items.splice(to, 0, ...moved);
  persist(); render();
}

// ---- render ----
/** @type {string|null} */
let renamingId = null;
/** @param {string} id */
function startRename(id) { renamingId = id; render(); }

function render() {
  state.listEl.innerHTML = ''; state.rowEls.clear();
  if (!state.items.length) { state.listEl.appendChild(el('div', 'wl-empty', t('No symbols yet — click ＋ to add, ＋☰ for a section.'))); return; }
  let collapsed = false;
  /** @type {HTMLInputElement|null} */
  let toFocus = null;
  displayItems().forEach((e) => {   // sorted-for-display when a column sort is active; the stored order is untouched
    const key = keyOf(e);
    if (e.type === 'section') { collapsed = !!e.collapsed; state.listEl.appendChild(buildSection(e, key, (inp) => { toFocus = inp; })); return; }
    if (collapsed) return;   // symbol hidden under a collapsed section
    state.listEl.appendChild(buildSymbolRow(e, key));
  });
  if (toFocus) { /** @type {HTMLInputElement} */ (toFocus).focus(); /** @type {HTMLInputElement} */ (toFocus).select(); }
}
setRenderer(render);   // columns/lists re-render through the state slot

/** @param {SectionItem} s @param {string} key @param {(inp: HTMLInputElement) => void} setFocus */
function buildSection(s, key, setFocus) {
  const row = el('div', 'wl-section');
  const tw = el('span', 'wl-sec-tw', s.collapsed ? '▸' : '▾');
  tw.onclick = (e) => { e.stopPropagation(); toggleCollapse(s.id); };
  row.appendChild(tw);
  if (s.id === renamingId) {
    const inp = /** @type {HTMLInputElement} */ (el('input', 'wl-sec-input')); inp.value = s.name;
    const commit = () => { const v = inp.value.trim(); renamingId = null; s.name = v || 'Section'; persist(); render(); };
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') { renamingId = null; render(); } };
    inp.onblur = commit; inp.onclick = (ev) => ev.stopPropagation();
    row.appendChild(inp); setFocus(inp);
  } else {
    const name = el('span', 'wl-sec-name', s.name);
    name.ondblclick = () => startRename(s.id);
    const del = el('span', 'wl-sec-del', '✕'); del.title = t('Remove section (keeps its symbols)');
    del.onclick = (e) => { e.stopPropagation(); removeSection(s.id); };
    row.append(name, del);
    row.oncontextmenu = (e) => { e.preventDefault(); openSectionMenu(s, e.clientX, e.clientY); };
    if (!state.sort.key) rowDnd(row, key);   // drag a header to move the whole section (only in manual order)
  }
  return row;
}

/** @param {SymbolItem} it @param {string} key */
function buildSymbolRow(it, key) {
  const row = el('div', 'wl-row');
  const sym = el('div', 'wl-c-sym');
  sym.append(el('span', 'wl-sym', it.symbol), el('span', 'wl-brk', broker.labelOf(it.broker)));
  const del = el('span', 'wl-del', '✕'); del.title = t('Remove'); del.onclick = (e) => { e.stopPropagation(); removeItem(it); };
  row.append(sym);
  // value cells in the user's column order; a hidden column contributes no cell
  /** @type {Record<string, HTMLElement>} */
  const cells = {};
  orderedCols().forEach((c) => { if (state.cols[c.key]) { const cell = el('span', 'wl-c-num'); cells[c.key] = cell; row.append(cell); } });
  row.append(del);
  row.onclick = () => bus.emit('watchlist:pick', { broker: it.broker, symbol: it.symbol });
  row.oncontextmenu = (e) => { e.preventDefault(); openSymbolMenu(it, e.clientX, e.clientY); };
  if (!state.sort.key) rowDnd(row, key);   // manual drag-reorder only when unsorted
  state.rowEls.set(key, { row, cells });
  paint(key);
  return row;
}
