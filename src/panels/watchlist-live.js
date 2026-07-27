// @ts-check
// Watchlist LIVE DATA -- per-symbol quote subscriptions and row painting. Live data:
// resolveSymbol -> subscribeQuotes for Last, plus a daily-bar fetch for the prior
// close (Chg = last - prevClose).
// shared state lives in watchlist-state.js.
import { broker } from '../../data_engine/index.js';
import { state, keyOf, symbols } from './watchlist-state.js';
import { COLS, colCell } from './watchlist-columns.js';

/** @typedef {import('./watchlist-state.js').SymbolItem} SymbolItem */

const DAY = 86400000;
const DAILY = { id: 'D', unit: 'D', n: 1 };

export function startAll() { symbols().forEach((it) => start(it)); }
export function stopAll() { symbols().forEach(stop); }
/** @param {SymbolItem} it */
function start(it) {
  const key = keyOf(it);
  let s = state.live.get(key);
  if (s && s.started) return;
  if (!broker.isConnected(it.broker)) return;   // wait for its broker
  const api = broker.for(it.broker);
  if (!api) return;
  if (!s) { s = {}; state.live.set(key, s); }
  s.started = true;
  api.resolveSymbol(it.symbol, (/** @type {any} */ inst) => {
    if (!inst) { s.started = false; return; }
    s.contractId = inst.id; s.decimals = inst.priceDecimals != null ? inst.priceDecimals : 2;
    // prior close from the last completed daily bar
    api.getBars({ id: inst.id, tf: DAILY, fromMs: Date.now() - 8 * DAY, toMs: Date.now() }, (/** @type {any} */ u) => {
      const bars = (u && u.bars) || [];
      if (bars.length) s.prevClose = (bars.length >= 2 ? bars[bars.length - 2] : bars[bars.length - 1]).close;
      paint(key);
    });
    // live last
    s.qcb = (/** @type {any} */ q) => {
      if (q.last != null) s.last = q.last; else if (q.bid != null && q.ask != null) s.last = (q.bid + q.ask) / 2;
      if (q.bid != null) s.bid = q.bid;
      if (q.ask != null) s.ask = q.ask;
      paint(key);
    };
    api.subscribeQuotes(inst.id, s.qcb);
  });
}
/** @param {SymbolItem} it */
export function stop(it) {
  const key = keyOf(it); const s = state.live.get(key);
  if (s && s.qcb && s.contractId != null) { try { /** @type {any} */ (broker.for(it.broker)).unsubscribeQuotes(s.contractId, s.qcb); } catch (_) {} }
  state.live.delete(key);
}

/** @param {string} key */
export function paint(key) {
  const r = state.rowEls.get(key), s = state.live.get(key);
  if (!r) return;
  const dec = (s && s.decimals != null) ? s.decimals : 2;
  COLS.forEach((c) => {
    const cell = r.cells[c.key];
    if (!cell) return;
    const out = colCell(c.key, s, dec);
    cell.textContent = out.text;
    cell.className = 'wl-c-num' + (out.cls ? ' ' + out.cls : '');
  });
}
