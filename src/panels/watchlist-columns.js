// @ts-check
// Watchlist COLUMN system -- the user-configurable value columns: show/hide (the
// Customize-columns menu), drag-to-reorder on the header cells, click-to-sort with the
// manual/primary/reverse cycle, the display-order sorter, and the per-column value
// formatter (colCell). Shared state
// lives in watchlist-state.js.
import { state, store, keyOf, render } from './watchlist-state.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup for column names + sort tips

/** @typedef {import('./watchlist-state.js').WlItem} WlItem */
/** @typedef {import('./watchlist-state.js').SymbolItem} SymbolItem */
/** @typedef {import('./watchlist-state.js').LiveRec} LiveRec */

/**
 * @param {string} tag
 * @param {(string|null)=} cls
 * @param {(string|null)=} txt
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

export const COLS = [
  { key: 'last', label: 'Last', head: 'Last' },
  { key: 'chg', label: 'Change', head: 'Chg' },
  { key: 'pct', label: 'Change %', head: 'Chg%' },
  { key: 'bid', label: 'Bid', head: 'Bid' },
  { key: 'ask', label: 'Ask', head: 'Ask' },
  { key: 'spread', label: 'Spread', head: 'Sprd' },
];

// apply the persisted column prefs (from the watchlist store document), sanitized.
// existing columns default on (!== false); the newer bid/ask/spread default off (only when explicitly saved on)
/** @param {any} d */
export function loadColumnPrefs(d) {
  const c = d.columns || {};
  state.cols = { last: c.last !== false, chg: c.chg !== false, pct: c.pct !== false, bid: !!c.bid, ask: !!c.ask, spread: !!c.spread };
  const validOrder = (Array.isArray(d.colOrder) ? d.colOrder : []).filter((/** @type {string} */ k) => COLS.some((x) => x.key === k));
  state.colOrder = validOrder.concat(COLS.filter((x) => !validOrder.includes(x.key)).map((x) => x.key));   // sanitize + append any missing
  const so = d.sort || {};
  state.sort = { key: (so.key && ['symbol', ...COLS.map((x) => x.key)].includes(so.key)) ? so.key : null, dir: so.dir === 'asc' ? 'asc' : 'desc' };
}

function saveCols() { store.set('columns', state.cols); store.set('colOrder', state.colOrder); store.set('sort', state.sort); }
// COLS in the user's saved order (any not listed are appended, so it's robust to a stale/short order).
/** @returns {typeof COLS} */
export function orderedCols() {
  return /** @type {typeof COLS} */ (state.colOrder.map((k) => COLS.find((c) => c.key === k)).filter(Boolean)
    .concat(COLS.filter((c) => !state.colOrder.includes(c.key))));
}
/** @param {string} key */
function sortArrow(key) { return state.sort.key === key ? el('span', 'wl-sortarrow', state.sort.dir === 'asc' ? '▲' : '▼') : null; }
export function renderHeader() {
  if (!state.colhdrEl) return;
  state.colhdrEl.innerHTML = '';
  // Symbol: pinned first, click to sort by name (not draggable)
  const symH = el('span', 'wl-c-sym wl-sortable', t('Symbol')); symH.title = t('Click to sort by symbol');
  symH.onclick = () => cycleSort('symbol');
  const symArrow = sortArrow('symbol'); if (symArrow) symH.appendChild(symArrow);
  state.colhdrEl.appendChild(symH);
  orderedCols().forEach((c) => {
    if (!state.cols[c.key]) return;
    const cell = el('span', 'wl-c-num wl-colhead wl-sortable', t(c.head)); cell.title = t('Click to sort, drag to reorder');
    const arrow = sortArrow(c.key); if (arrow) cell.appendChild(arrow);
    cell.onclick = () => { if (colDidDrag) { colDidDrag = false; return; } cycleSort(c.key); };
    headerCellDnd(cell, c.key);
    state.colhdrEl.appendChild(cell);
  });
}
// Click cycle per column: manual -> primary -> reverse -> manual. Values default to descending, Symbol to ascending.
/** @param {string} key */
function cycleSort(key) {
  const primary = key === 'symbol' ? 'asc' : 'desc';
  const reverse = primary === 'asc' ? 'desc' : 'asc';
  if (state.sort.key !== key) { state.sort.key = key; state.sort.dir = primary; }
  else if (state.sort.dir === primary) { state.sort.dir = reverse; }
  else { state.sort.key = null; }
  saveCols(); renderHeader(); render();
}
// The value used to sort a symbol by the active column (null -> sorts to the bottom).
/** @param {SymbolItem} it @returns {number|string|null} */
function sortVal(it) {
  if (state.sort.key === 'symbol') return it.symbol.toLowerCase();
  const s = state.live.get(keyOf(it));
  if (!s) return null;
  return colCell(state.sort.key, s, s.decimals != null ? s.decimals : 2).val;
}
/** @returns {(a: SymbolItem, b: SymbolItem) => number} */
function makeCmp() {
  const dir = state.sort.dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const va = sortVal(a), vb = sortVal(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;                          // missing values always sink to the bottom
    if (vb == null) return -1;
    if (typeof va === 'string' || typeof vb === 'string') return String(va) < String(vb) ? -dir : String(va) > String(vb) ? dir : 0;
    return (va - vb) * dir;
  };
}
// items reordered for display: when a sort is active, symbols are sorted WITHIN each section (headers stay put).
/** @returns {WlItem[]} */
export function displayItems() {
  if (!state.sort.key) return state.items;
  const cmp = makeCmp();
  /** @type {WlItem[]} */
  const out = [];
  /** @type {SymbolItem[]} */
  let buf = [];
  const flush = () => { if (buf.length) { buf.sort(cmp); out.push(...buf); buf = []; } };
  state.items.forEach((e) => { if (e.type === 'section') { flush(); out.push(e); } else buf.push(e); });
  flush();
  return out;
}

// One column's value for one symbol: the raw number (for sorting), the display text, and an up/down class.
// Price columns (last/bid/ask/spread) show a dash when absent; change columns blank when not computable.
/** @param {string|null} key @param {LiveRec|undefined} s @param {number} dec @returns {{ val: number|null, text: string, cls: string }} */
export function colCell(key, s, dec) {
  const dash = { val: /** @type {number|null} */ (null), text: '—', cls: '' };
  const blank = { val: /** @type {number|null} */ (null), text: '', cls: '' };
  if (!s) return dash;
  const last = s.last, prev = s.prevClose, bid = s.bid, ask = s.ask;
  /** @param {number|null|undefined} v */
  const price = (v) => (v == null ? dash : { val: v, text: v.toFixed(dec), cls: '' });
  const chg = (last != null && prev != null && prev) ? last - prev : null;
  switch (key) {
    case 'last': return price(last);
    case 'bid': return price(bid);
    case 'ask': return price(ask);
    case 'spread': return price((bid != null && ask != null) ? ask - bid : null);
    case 'chg': return chg == null ? blank : { val: chg, text: (chg >= 0 ? '+' : '') + chg.toFixed(dec), cls: chg > 0 ? 'up' : chg < 0 ? 'down' : '' };
    case 'pct': { if (chg == null || prev == null) return blank; const p = chg / prev * 100; return { val: p, text: (p >= 0 ? '+' : '') + p.toFixed(2) + '%', cls: p > 0 ? 'up' : p < 0 ? 'down' : '' }; }
  }
  return blank;
}

// ---- column drag-to-reorder (header cells; mirrors the row drag logic) ----
/** @type {string|null} */
let dragCol = null;
/** @type {string|null} */
let colDropKey = null;
let colDropAfter = false;
let colDidDrag = false;   // set on a real header drag, so the trailing click doesn't also fire a sort
function clearColDrop() {
  if (state.colhdrEl) state.colhdrEl.querySelectorAll('.wl-cdrop-before,.wl-cdrop-after').forEach((c) => c.classList.remove('wl-cdrop-before', 'wl-cdrop-after'));
  colDropKey = null;
}
/** @param {HTMLElement} cell @param {string} key */
function headerCellDnd(cell, key) {
  cell.draggable = true;
  cell.ondragstart = (e) => { dragCol = key; colDidDrag = true; try { const dt = /** @type {DataTransfer} */ (e.dataTransfer); dt.effectAllowed = 'move'; dt.setData('text/plain', key); } catch (_) {} cell.classList.add('wl-cdrag'); };
  cell.ondragend = () => { cell.classList.remove('wl-cdrag'); clearColDrop(); dragCol = null; };
  cell.ondragover = (e) => {
    if (!dragCol || dragCol === key) return;
    e.preventDefault(); clearColDrop();
    const r = cell.getBoundingClientRect();
    colDropAfter = (e.clientX - r.left) > r.width / 2; colDropKey = key;
    cell.classList.add(colDropAfter ? 'wl-cdrop-after' : 'wl-cdrop-before');
  };
  cell.ondrop = (e) => { e.preventDefault(); doColDrop(); };
}
function doColDrop() {
  const dk = dragCol, tk = colDropKey, after = colDropAfter;
  clearColDrop(); dragCol = null;
  if (!dk || !tk || dk === tk) return;
  const from = state.colOrder.indexOf(dk); if (from < 0) return;
  state.colOrder.splice(from, 1);
  let to = state.colOrder.indexOf(tk); if (to < 0) return;
  if (after) to += 1;
  state.colOrder.splice(to, 0, dk);
  saveCols(); renderHeader(); render();
}

// ---- the Customize-columns menu (the toolbar's ⋯ button) ----
/** @type {HTMLElement|null} */
let colsMenu = null;
/** @type {((e: PointerEvent) => void)|null} */
let colsMenuAway = null;
function closeColsMenu() {
  if (colsMenuAway) { document.removeEventListener('pointerdown', /** @type {any} */ (colsMenuAway), true); colsMenuAway = null; }
  if (colsMenu) { colsMenu.remove(); colsMenu = null; }
}
/** @param {HTMLElement} anchor */
export function toggleColsMenu(anchor) { if (colsMenu) closeColsMenu(); else openColsMenu(anchor); }
/** @param {HTMLElement} anchor */
function openColsMenu(anchor) {
  closeColsMenu();
  const m = el('div', 'wl-listmenu'); colsMenu = m;
  m.appendChild(el('div', 'wl-colsmenu-hdr', t('Customize columns')));
  COLS.forEach((c) => {
    const r = el('div', 'wl-listmenu-row wl-colsrow');
    const cb = /** @type {HTMLInputElement} */ (document.createElement('input'));
    cb.type = 'checkbox'; cb.className = 'wl-colscb'; cb.checked = !!state.cols[c.key]; cb.style.pointerEvents = 'none';
    r.append(cb, el('span', 'wl-listmenu-name', t(c.label)));
    r.onclick = () => { state.cols[c.key] = !state.cols[c.key]; cb.checked = state.cols[c.key]; saveCols(); renderHeader(); render(); };
    m.appendChild(r);
  });
  document.body.appendChild(m);
  const rc = anchor.getBoundingClientRect();
  m.style.top = (rc.bottom + 4) + 'px';
  m.style.left = Math.min(rc.left, window.innerWidth - m.offsetWidth - 6) + 'px';
  colsMenuAway = (e) => { if (colsMenu && !colsMenu.contains(/** @type {Node} */ (e.target)) && !anchor.contains(/** @type {Node} */ (e.target))) closeColsMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', /** @type {any} */ (colsMenuAway), true), 0);
}
