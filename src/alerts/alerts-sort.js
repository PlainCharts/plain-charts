// @ts-check
// Sort model for the alerts panel — the comparator groups behind the toolbar's ⇅ dropdown, and cmpOf() to
// resolve a sort KEY to its comparator (defaulting to newest-created first). Pure and DOM-free: labels are
// plain strings the view translates at render time; comparators derive from the record via alerts-format.
import { nameOf, firedAt } from './alerts-format.js';

/** @param {(a:any)=>any} f */ const byStr = (f) => (/** @type {any} */ a, /** @type {any} */ b) => String(f(a) || '').localeCompare(String(f(b) || ''));
/** @param {(a:any)=>number} f */ const byNum = (f) => (/** @type {any} */ a, /** @type {any} */ b) => (f(a) || 0) - (f(b) || 0);
/** @param {(a:any,b:any)=>number} c */ const rev = (c) => (/** @type {any} */ a, /** @type {any} */ b) => c(b, a);
// Essentials only (Symbol, Name, Date created, Time triggering — no Message). Grouped for the menu (a
// divider between groups); each option carries its comparator.
export const SORT_GROUPS = [
  [{ key: 'symbol-asc', dir: 'asc', label: 'Symbol (A to Z)', cmp: byStr((a) => a.symbol) },
   { key: 'symbol-desc', dir: 'desc', label: 'Symbol (Z to A)', cmp: rev(byStr((a) => a.symbol)) }],
  [{ key: 'name-asc', dir: 'asc', label: 'Name (A to Z)', cmp: byStr(nameOf) },
   { key: 'name-desc', dir: 'desc', label: 'Name (Z to A)', cmp: rev(byStr(nameOf)) }],
  [{ key: 'created-asc', dir: 'asc', label: 'Date created (oldest first)', cmp: byNum((a) => a.createdAt) },
   { key: 'created-desc', dir: 'desc', label: 'Date created (newest first)', cmp: rev(byNum((a) => a.createdAt)) }],
  [{ key: 'fired-asc', dir: 'asc', label: 'Time triggering (oldest first)', cmp: byNum(firedAt) },
   { key: 'fired-desc', dir: 'desc', label: 'Time triggering (newest first)', cmp: rev(byNum(firedAt)) }],
];
const ALL_SORTS = SORT_GROUPS.flat();
const DEFAULT_CMP = rev(byNum((a) => a.createdAt));   // newest-created first
/** comparator for the selected sort key (defaults to newest-created first). @param {string} key */
export const cmpOf = (key) => { const o = ALL_SORTS.find((x) => x.key === key); return o ? o.cmp : DEFAULT_CMP; };
