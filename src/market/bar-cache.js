// @ts-check
// Client wrapper over the server-side historical-bar cache (/api/cache/*).
//
// The opt-in persistent library: a curated list of (broker, symbol, startMs) the app
// keeps a local bar library for and maintains over time. Panes read through this cache
// (instant history for opted-in symbols) and write closed bars back into it. Symbols
// not in the library stay on the live, ephemeral lazy cache. See the locked design in
// memory: historical-bar-cache-design.
import { bus } from '../bus.js';

/** @typedef {import('../../data_engine/index.js').Bar} Bar */
// One opt-in library row (server-stored): the (broker, symbol) plus its cache window bounds.
/** @typedef {{ broker: string, symbol: string, startMs?: number, [key: string]: any }} LibRow */

/** @param {string} url @param {RequestInit} [opts] @returns {Promise<any>} */
const J = (url, opts) => fetch(url, opts).then((r) => r.json()).catch(() => null);
/** @param {string} url @param {any} body @returns {Promise<any>} */
const POST = (url, body) => J(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// a local snapshot of the opt-in list so panes can check membership synchronously
// (isCachedSync) without a round-trip. Refreshed on load and after every mutation;
// 'cache:library' fires so anything interested can react.
/** @type {LibRow[]} */
let _lib = [];
export function refreshLibrary() {
  return barCache.library().then((rows) => { _lib = Array.isArray(rows) ? rows : []; bus.emit('cache:library'); return _lib; });
}
/** @template T @param {T | Promise<T>} p @returns {Promise<T>} */
const refreshing = (p) => Promise.resolve(p).then((r) => refreshLibrary().then(() => r));

export const barCache = {
  // ---- library (the opt-in list) ----
  /** @returns {Promise<LibRow[]>} */
  library: () => J('/api/cache/library').then((d) => (d && d.rows) || []),
  /** @param {string} broker @param {string} symbol @param {number} startMs */
  addLibrary: (broker, symbol, startMs) => refreshing(POST('/api/cache/library', { broker, symbol, startMs })),
  /** @param {string} broker @param {string} symbol */
  removeLibrary: (broker, symbol) => refreshing(POST('/api/cache/library/remove', { broker, symbol })),   // revert to lazy; keep data
  /** @param {string} broker @param {string} symbol */
  deleteData: (broker, symbol) => refreshing(POST('/api/cache/delete', { broker, symbol })),               // remove row + on-disk data
  /** @param {string} broker @param {string} symbol @param {number} startMs */
  trim: (broker, symbol, startMs) => refreshing(POST('/api/cache/trim', { broker, symbol, startMs })),      // explicit cut to a later start

  // synchronous membership / row lookup from the local snapshot
  /** @param {string} broker @param {string} symbol */
  isCachedSync: (broker, symbol) => _lib.some((r) => r.broker === broker && r.symbol === symbol),
  /** @param {string} broker @param {string} symbol @returns {LibRow | null} */
  rowFor: (broker, symbol) => _lib.find((r) => r.broker === broker && r.symbol === symbol) || null,

  // ---- bars ----
  /** @param {{ broker: string, symbol: string, tf: string, from?: number|null, to?: number|null }} params @returns {Promise<{ bars: Bar[], coverage: { from: number, to: number, count: number } | null } | null>} */
  getBars({ broker, symbol, tf, from, to }) {
    const qs = new URLSearchParams({ broker, symbol, tf });
    if (from != null) qs.set('from', String(from));
    if (to != null) qs.set('to', String(to));
    return J('/api/cache/bars?' + qs.toString());   // { bars:[{time,open,high,low,close,volume}], coverage:{from,to,count}|null }
  },
  /** @param {string} broker @param {string} symbol @param {string} tf @param {Bar[]} bars */
  putBars: (broker, symbol, tf, bars) => POST('/api/cache/bars', { broker, symbol, tf, bars }),
  // coverage bounds only (no bar payload) — used by the background backfill
  /** @param {{ broker: string, symbol: string, tf: string }} params @returns {Promise<{ from: number, to: number, count: number } | null>} */
  coverage: ({ broker, symbol, tf }) => J('/api/cache/bars?' + new URLSearchParams({ broker, symbol, tf, meta: '1' })).then((d) => d && d.coverage),

  // is this (broker, symbol) opted-in? pass a previously-fetched library list to avoid a round-trip.
  /** @param {string} broker @param {string} symbol @param {LibRow[]} [lib] */
  isCached: (broker, symbol, lib) => (lib || []).some((r) => r.broker === broker && r.symbol === symbol),
};

refreshLibrary();   // prime the snapshot for this window
