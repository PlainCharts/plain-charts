// @ts-check
// Watchlist shared state -- the single store for the panel's cross-module state: the
// named lists, the active list's items, the per-symbol live-data records, the column
// prefs, and the DOM anchors the submodules paint into. Every watchlist-* module
// reads/writes THIS instance; nothing keeps a shadow copy. The render slot lets the
// column/list modules re-render the panel without importing it back (keeps the DAG).
import { createStore } from '../store.js';

// items is a FLAT ordered list: section headers + symbols. A
// symbol belongs to the nearest section header above it (symbols before any header
// are uncategorized).
/**
 * @typedef {{ type: 'section', id: string, name: string, collapsed: boolean }} SectionItem
 * @typedef {{ type: 'symbol', broker: string, symbol: string }} SymbolItem
 * @typedef {SectionItem | SymbolItem} WlItem
 */
// Per-symbol live-data record kept in `state.live`, keyed by keyOf(item).
/**
 * @typedef {Object} LiveRec
 * @property {string=} contractId
 * @property {number=} decimals
 * @property {number=} last
 * @property {number=} bid
 * @property {number=} ask
 * @property {number=} prevClose
 * @property {((q: any) => void)=} qcb    the quote callback (for unsubscribe)
 * @property {boolean=} started
 */
// Multiple named watchlists live in ONE file (market/watchlist.json), the same shape as the colour
// palettes: a list of { id, name, items } plus the active id. `state.items` always mirrors the
// ACTIVE list's items (kept in sync by persist).
/** @typedef {{ id: string, name: string, items: WlItem[] }} WatchList */

/** @param {WlItem} e */
export const keyOf = (e) => (e.type === 'section' ? 'sec|' + e.id : 'sym|' + e.broker + '|' + e.symbol);

export function seedLists() {
  return {
    lists: [{ id: 'wl_1', name: 'Watchlist', items: [] }],
    activeId: 'wl_1',
    columns: { last: true, chg: true, pct: true, bid: false, ask: false, spread: false },
    colOrder: ['last', 'chg', 'pct', 'bid', 'ask', 'spread'],
    sort: { key: null, dir: 'desc' },
  };
}
export const store = createStore('/api/watchlist', seedLists());

export const state = {
  /** @type {WatchList[]} */ lists: [],
  /** @type {string|null} */ activeId: null,
  /** @type {WlItem[]} */ items: [], // === the active list's items
  /** @type {Map<string, LiveRec>} */ live: new Map(),
  /** @type {HTMLElement} */ listEl: /** @type {any} */ (null),
  /** @type {HTMLElement} */ listBtnName: /** @type {any} */ (null), // the header dropdown's name label
  /** @type {HTMLElement} */ colhdrEl: /** @type {any} */ (null), // the column-header row (rebuilt when columns toggle)
  // The value columns the user can show/hide (Symbol is always shown). Persisted globally (not per list).
  /** @type {Record<string, boolean>} */ cols: {
    last: true,
    chg: true,
    pct: true,
    bid: false,
    ask: false,
    spread: false,
  },
  /** @type {string[]} */ colOrder: ['last', 'chg', 'pct', 'bid', 'ask', 'spread'], // left-to-right order of the value columns (Symbol stays pinned first)
  // Display sort: click a header to sort symbols by that column (within each section). key null = manual order.
  /** @type {{ key: string|null, dir: 'asc'|'desc' }} */ sort: { key: null, dir: 'desc' },
  // per symbol key: the row element and its live-value cells (cells keyed by column key; visible columns only)
  /** @type {Map<string, { row: HTMLElement, cells: Record<string, HTMLElement> }>} */ rowEls: new Map(),
  seq: 0,
};

export const newId = () => 's' + Date.now().toString(36) + (state.seq++).toString(36);
export const newListId = () => 'wl_' + Date.now().toString(36) + (state.seq++).toString(36);
/** @returns {WatchList|null} */
export const activeList = () => state.lists.find((l) => l.id === state.activeId) || state.lists[0] || null;
/** @returns {SymbolItem[]} */
export const symbols = () => /** @type {SymbolItem[]} */ (state.items.filter((e) => e.type === 'symbol'));

// persist the WHOLE structure. `state.items` may be a reassigned array (filter/splice), so flush it back
// into the active list before saving -- that keeps the active list and `items` in sync no matter what mutated.
export function persist() {
  const L = activeList();
  if (L) L.items = state.items;
  store.set('lists', state.lists);
  store.set('activeId', state.activeId);
}

// render-dispatch indirection: watchlist.js owns the render; columns/lists call the slot
let renderer = () => {};
/** @param {() => void} fn */
export const setRenderer = (fn) => {
  renderer = fn;
};
export const render = () => renderer();
