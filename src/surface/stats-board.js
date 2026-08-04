// @ts-check
// The Stats board model: a CATALOG of every available stat tile, and a LAYOUT (which tiles sit on the board,
// in which grid slots) the user edits by drag-and-drop. A tile is in exactly ONE place -- on the board or in
// the inventory (= catalog minus board). Pure data + persistence via the desk settings; no DOM.
//
// USD only. Every tile reads the merged stats object (trade-derive.js aggregates + stats-math.js additions);
// no tile needs a stop, so all are exact. Formatting mirrors the History surface's money conventions.
import { getSetting, setSetting } from '../settings/settings.js';

// money formatters -- money0 matches the History surface; money2 is the 2-decimal variant.
/** @param {number} v */
const money0 = (v) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
/** @param {number} v */
const money2 = (v) =>
  (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** @param {number} v @returns {{ text: string, cls: string }} */
const signedMoney = (v) => ({ text: (v > 0 ? '+' : '') + money0(v), cls: v > 0 ? 'pos' : v < 0 ? 'neg' : '' });
/** @param {number} v */
const pos = (v) => (v >= 0 ? 'pos' : 'neg');

/** @typedef {{ text: string, cls?: string }} TileValue */
/** @typedef {{ key: string, label: string, get: (s: any) => TileValue }} Tile */

// Each entry: key (stable id), label, and get(s) -> { text, cls } from the computed stats object.
/** @type {Tile[]} */
export const CATALOG = [
  // ---- trade-stat tiles: formatting mirrors the History surface ----
  { key: 'netProfit', label: 'Net Profit', get: (s) => (s.trades ? signedMoney(s.net) : { text: '—' }) },
  {
    key: 'trades',
    label: 'Trades',
    get: (s) => ({
      text: s.trades ? s.trades + ' (' + s.wins + 'H' + (s.bes ? '/' + s.bes + 'BE' : '') + '/' + s.losses + 'M)' : '0',
    }),
  },
  {
    key: 'profitFactor',
    label: 'Profit Factor',
    get: (s) =>
      s.profitFactor == null
        ? { text: '—' }
        : { text: s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2), cls: s.profitFactor >= 1 ? 'pos' : 'neg' },
  },
  {
    key: 'commission',
    label: 'Commission',
    get: (s) =>
      s.comm
        ? { text: '-$' + Math.abs(s.comm).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), cls: 'neg' }
        : { text: '—' },
  },
  // ---- statistical tiles (this tab's additions) ----
  { key: 'edge', label: 'EV (USD)', get: (s) => ({ text: money2(s.mean), cls: pos(s.mean) }) },
  { key: 'std', label: 'Std dev (σ)', get: (s) => ({ text: money0(s.std), cls: '' }) },
  { key: 'maxDd', label: 'Max drawdown', get: (s) => ({ text: money0(s.maxDd), cls: 'neg' }) },
  { key: 'maxLossStreak', label: 'Max loss streak', get: (s) => ({ text: String(s.maxLossStreak), cls: s.maxLossStreak > 0 ? 'neg' : '' }) },
  { key: 'sharpe', label: 'Per-trade Sharpe', get: (s) => ({ text: s.sharpe.toFixed(3), cls: '' }) },
  { key: 'avgWin', label: 'Avg win', get: (s) => ({ text: money2(s.avgWin), cls: 'pos' }) },
  { key: 'avgLoss', label: 'Avg loss', get: (s) => ({ text: money2(-s.avgLossAbs), cls: 'neg' }) },
  { key: 'winPct', label: 'Win % (of total)', get: (s) => ({ text: (s.winPct * 100).toFixed(2) + '%', cls: '' }) },
  { key: 'lossPct', label: 'Loss % (of total)', get: (s) => ({ text: (s.lossPct * 100).toFixed(2) + '%', cls: '' }) },
  { key: 'bePct', label: 'BE % (of total)', get: (s) => ({ text: (s.bePct * 100).toFixed(2) + '%', cls: '' }) },
];
/** @param {string} k @returns {Tile|undefined} */
export const byKey = (k) => CATALOG.find((c) => c.key === k);
export const COLS = 6;

/** @typedef {{ board: (string|null)[][], inv: (string|null)[][] }} Grids */

// TWO positioned grids: `board` (shown live, row 0 at the BOTTOM) and `inv` (the inventory -- also a real
// cell grid the user arranges freely, NOT a linear flow). A tile lives in exactly ONE cell of ONE grid.
// Default board = the core outcomes + ratios; everything else starts laid out in the inventory grid.
/** @type {(string|null)[][]} */
const DEFAULT_BOARD = [
  ['trades', 'avgWin', 'avgLoss', 'winPct', 'bePct', 'lossPct'],
  ['edge', null, null, null, 'maxDd', 'maxLossStreak'],
];

const KEY = 'tradeDesk'; // the desk settings document; the board lives under its `statsBoard` sub-key
const KEYS = new Set(CATALOG.map((c) => c.key));

const emptyRow = () => /** @type {(string|null)[]} */ (Array(COLS).fill(null));
// chunk a key list into rows of COLS (padded with nulls); always at least one row
/** @param {(string|null)[]} keys */
function chunk(keys) {
  const rows = [];
  for (let i = 0; i < keys.length; i += COLS) {
    const row = keys.slice(i, i + COLS);
    while (row.length < COLS) row.push(null);
    rows.push(row);
  }
  return rows.length ? rows : [emptyRow()];
}
// drop keys into a grid: fill existing empty cells first, then append new rows
/** @param {(string|null)[][]} grid @param {(string|null)[]} keys */
function appendKeys(grid, keys) {
  const q = keys.slice();
  for (const row of grid) for (let c = 0; c < COLS && q.length; c++) if (!row[c]) row[c] = q.shift() || null;
  while (q.length) {
    const row = emptyRow();
    for (let c = 0; c < COLS && q.length; c++) row[c] = q.shift() || null;
    grid.push(row);
  }
}

/** @returns {Grids} */
function defaults() {
  const inBoard = new Set();
  DEFAULT_BOARD.forEach((r) => r.forEach((k) => k && inBoard.add(k)));
  const rest = CATALOG.map((c) => c.key).filter((k) => !inBoard.has(k));
  return { board: DEFAULT_BOARD.map((r) => r.slice()), inv: chunk(rest) };
}

// Every catalog key appears exactly once across the two grids: drop unknown/duplicate keys to null, then
// append any catalog key that ended up nowhere (a new stat, or tiles freed by a removed row) into the inv.
/** @param {Grids} grids @returns {Grids} */
export function reconcile(grids) {
  const seen = new Set();
  for (const g of [grids.board, grids.inv])
    for (const row of g)
      for (let c = 0; c < row.length; c++) {
        const k = row[c];
        if (k && KEYS.has(k) && !seen.has(k)) seen.add(k);
        else row[c] = null;
      }
  const orphans = CATALOG.map((c) => c.key).filter((k) => !seen.has(k));
  if (orphans.length) appendKeys(grids.inv, orphans);
  if (!grids.board.length) grids.board.push(emptyRow());
  // The inventory SELF-SIZES: it holds everything not on the board and never needs manual rows. Trim any
  // trailing empty rows, then leave exactly ONE spare empty row so there is always a cell to drop into.
  while (grids.inv.length && grids.inv[grids.inv.length - 1].every((k) => !k)) grids.inv.pop();
  grids.inv.push(emptyRow());
  return grids;
}

// ---- persistence: the board layout is a sub-key of the shared `tradeDesk` settings document ----
const readSaved = () => /** @type {any} */ (getSetting(KEY) || {}).statsBoard;
/** @param {any} v */
const writeSaved = (v) => setSetting(KEY, Object.assign({}, getSetting(KEY) || {}, { statsBoard: v }));

/** @returns {Grids} */
export function load() {
  const raw = readSaved();
  if (!raw || !Array.isArray(raw.board)) return defaults(); // no save, or a malformed record
  /** @param {any} g @returns {(string|null)[][]} */
  const norm = (g) => (Array.isArray(g) ? g.filter(Array.isArray).map((row) => row.slice(0, COLS)) : []);
  return reconcile({ board: norm(raw.board), inv: norm(raw.inv) });
}
/** @param {Grids} grids */
export function save(grids) {
  writeSaved({ board: grids.board, inv: grids.inv });
}
/** @returns {Grids} */
export function reset() {
  writeSaved(null);
  return defaults();
}
