// @ts-check
// Trade feed — the always-on bridge from every connected broker's EXECUTION stream into the platform stores
// (orders / positions / accounts). It runs where the REAL broker lives (the data-host in Electron, the page
// in the browser build), so the stores are the single source of truth; their BroadcastChannel sync carries
// the data to every UI window. Orders/positions/accounts populate whether or not any addon or the order
// ticket is open. Fills are surfaced on the Console as execution activity.
//
// Keys are broker-scoped so multiple connected brokers coexist: orders 'broker:orderId', positions
// 'broker:symbol', accounts 'broker:accountId'. On disconnect a broker's rows are dropped.
import { bus } from '../bus.js';
import { platform } from '../platform/index.js';
import { normalizeTradeEvent, isTerminal } from './adapter-contract.js';

/** @typedef {import('./adapter-contract.js').TradeEvent} TradeEvent */

/** @type {any} */
let core = null;   // the broker facade (coreBroker); untyped facade, so any
// How far back the connect-time filled-order (fills) snapshot reaches. The reference position manager requests
// from the account's starting-balance DATE, or 30 days back when that's unset, floored to MIDNIGHT UTC (CQG
// caps historical orders at ~30 days). The per-account starting date is wired in a later step; until then the
// 30-day default floor applies to every broker.
const SEED_LOOKBACK_DAYS = 30;

// The reference's `from_date`: the start (00:00 UTC) of the day `days` ago. `to` is left open (up to now).
/** @param {number} days @returns {number} */
function seedFromMs(days) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  from.setUTCDate(from.getUTCDate() - days);
  return from.getTime();
}
/** @type {Map<string, { cb: (ev: any) => void }>} */
const subs = new Map();   // brokerId -> { cb }
/** @type {Map<string, boolean>} */
const live = new Map();   // brokerId -> bool: false during the connect-time history replay, true once live

// EVERY event enters here and is VALIDATED against the adapter contract before it reaches the app. A malformed
// event (wrong shape / missing field) is dropped LOUDLY — a warning in the Console — never silently. This is
// the one boundary that keeps a bad or new adapter from corrupting the pipeline.
// quiet=true for connect-time SNAPSHOT seeds (getOrders/getHistory): still write the stores, but never log to
// the Console -- the snapshot is history, not live activity, and getHistory may resolve after the live gate.
/** @param {string} brokerId @param {any} raw @param {boolean} [quiet] */
function onEvent(brokerId, raw, quiet) {
  const n = normalizeTradeEvent(raw);
  if (!n.ok) { platform.console.post({ level: 'warn', cat: 'journal', src: brokerId, msg: 'dropped malformed trade event: ' + n.reason }); return; }
  feed(brokerId, n.event, quiet);
}

// TRIPWIRE dedupe: one Console report per order+reason (a status burst would otherwise spam identical lines)
/** @type {Set<string>} */
const tripped = new Set();

// TRIPWIRE (the intermittent "working orders vanished from the chart" hunt): an order whose SYMBOL is an
// unresolved placeholder ('contract N') or whose WORKING limit/stop carries no drawable price lands in the store
// fine -- the desk lists it -- but the chart overlay filters it out silently. Catch the corrupt event the moment
// it lands and name it in the Console (the next well-formed status self-heals the store, so this line is the
// only trace). Active debug instrumentation -- stays until the hunt closes.
/** @param {string} brokerId @param {string} key @param {any} o */
function tripwireCheck(brokerId, key, o) {
  const drawPx = o.type === 'stop' ? (o.stopPrice != null ? o.stopPrice : o.price) : (o.limitPrice != null ? o.limitPrice : o.price);
  const why = (!o.symbol || /^contract \d+$/.test(String(o.symbol))) ? 'unresolved symbol "' + o.symbol + '"'
    : ((o.type === 'limit' || o.type === 'stop') && !isTerminal(o.status) && !Number.isFinite(Number(drawPx))) ? 'no drawable price on a working ' + o.type
    : null;
  if (!why) return;
  const k = key + '|' + why;
  if (tripped.has(k)) return;
  tripped.add(k);
  platform.console.post({ level: 'error', cat: 'journal', src: brokerId, msg: 'ORDER TRIPWIRE #' + o.id + ' ' + o.side + ' ' + o.type + ' ' + o.symbol + ' (' + o.status + '): ' + why + ' -- the chart cannot draw this order; raw ' + JSON.stringify({ price: o.price, limitPrice: o.limitPrice, stopPrice: o.stopPrice, time: o.time, updateTime: o.updateTime }) });
}

// Console = RAW broker comms. Print the broker's OWN per-transaction reports (ACK_PLACE / ACK_MODIFY /
// ACK_CANCEL / FILL / REJECTED ...) verbatim -- no app-synthesized status narrative. text is set by the broker
// mainly on rejects. Adapters without per-transaction comms (e.g. MT5) fall back to the plain status line.
/** @param {string} brokerId @param {any} o */
function journalOrder(brokerId, o) {
  const head = o.side + ' ' + o.qty + ' ' + o.symbol;
  const txns = Array.isArray(o.txns) ? o.txns : [];
  if (txns.length) {
    const fillPx = o.avgFillPrice != null ? o.avgFillPrice : o.price;
    for (const t of txns) {
      const isRej = /REJECT/.test(t.type);
      const fill = t.type === 'FILL' && t.fillQty != null ? ' ' + t.fillQty + (fillPx != null ? ' @ ' + fillPx : '') : '';
      const text = t.text ? ' -- ' + t.text : (isRej && o.rejectText ? ' -- ' + o.rejectText : '');
      platform.console.post({ cat: 'journal', src: brokerId, dir: 'in', level: isRej ? 'error' : 'info', msg: head + ' ' + t.type + fill + text });
    }
  } else if (o.rejectText) {
    platform.console.post({ cat: 'journal', src: brokerId, dir: 'in', level: 'error', msg: head + ' REJECTED -- ' + o.rejectText });
  } else {
    const px = o.price != null ? ' @ ' + o.price : '';
    platform.console.post({ cat: 'journal', src: brokerId, dir: 'in', level: o.status === 'rejected' ? 'error' : 'info', msg: head + ' ' + o.type + px + ' - ' + o.status });
  }
}

/** @param {string} brokerId @param {TradeEvent} ev @param {boolean} [quiet] */
function feed(brokerId, ev, quiet) {
  const log = !quiet && live.get(brokerId);   // log to Console only for live events, never for snapshot seeds/replay
  if (ev.kind === 'order') {
    const o = ev.order, key = brokerId + ':' + o.id;
    // the order BOOK retains every order, including terminal ones (filled/cancelled/rejected) with their final
    // status + times -- positions are accumulations of these. A 'working orders' view is just a status filter.
    platform.orders.set(key, { broker: brokerId, ...o });
    tripwireCheck(brokerId, key, o);   // corrupt-event diagnostic (chart-drawability rules)
    if (log) journalOrder(brokerId, o);
  } else if (ev.kind === 'position') {
    const p = ev.position, key = brokerId + ':' + p.symbol;
    if (Number(p.qty) > 0) platform.positions.set(key, { broker: brokerId, ...p });
    else platform.positions.remove(key);
    // The net position is DERIVED (reconstructed from fills), not a broker wire message -- so it is NOT journalled.
    // The raw broker order/fill lines already show what happened; a synthetic "POSITION ..." line only duplicated
    // and confused that. The store still updates (chart dot / net views read it).
  } else if (ev.kind === 'positionLot') {
    // one individual broker position (hedging lot), keyed broker:ticket -- carries native SL/TP + live P&L.
    // Store only (chart / order-ticket read it); derived state, not journalled -- same reason as the net above.
    const l = ev.lot, key = brokerId + ':' + l.ticket;
    if (Number(l.qty) > 0) platform.positionLots.set(key, { broker: brokerId, ...l });
    else platform.positionLots.remove(key);
  } else if (ev.kind === 'account') {
    platform.accounts.set(brokerId + ':' + ev.account.accountId, { broker: brokerId, ...ev.account });
  } else if (ev.kind === 'fill') {
    // the fills stream (executions) -- the PRIMITIVE positions and history derive from (net-0 grouping).
    // Keyed broker:orderId: the broker reports a cumulative fill per order, so live overwrites/merges the
    // snapshot by the same key (no double counting). Both live and quiet snapshot fills are stored.
    const f = ev.fill;
    platform.fills.set(brokerId + ':' + f.id, { broker: brokerId, ...f });
    // No dedicated Console line -- the broker's own FILL transaction (order event above) already reports it; this just
    // feeds the fills/positions stores.
  } else if (ev.kind === 'reject') {
    // an order REQUEST was refused (margin, bad price, …) — always surface it, with the reason
    if (!quiet) platform.console.post({ cat: 'journal', src: brokerId, dir: 'in', level: 'error', msg: 'REJECT — ' + ev.reject.reason });
  }
}

/** @param {string} brokerId */
function clearBroker(brokerId) {
  const pfx = brokerId + ':';
  [platform.orders, platform.fills, platform.positions, platform.positionLots, platform.accounts].forEach((s) => s.keys().filter((k) => k.startsWith(pfx)).forEach((k) => s.remove(k)));
}

// (re)align subscriptions with the set of connected brokers; seed positions + account on a fresh connect
function resubscribe() {
  /** @type {any[]} */
  const conns = (core && core.connections && core.connections()) || [];
  /** @type {Set<string>} */
  const connected = new Set(conns.filter((c) => c.connected).map((c) => c.id));
  for (const [id, rec] of [...subs]) {   // drop feeds for brokers that dropped
    if (connected.has(id)) continue;
    const a = core.for(id);
    if (a && a.unsubscribeTrade && rec.cb) { try { a.unsubscribeTrade(rec.cb); } catch (_) {} }
    subs.delete(id); live.delete(id); clearBroker(id);
  }
  for (const id of connected) {           // add feeds for brokers that connected
    if (subs.has(id)) continue;
    const a = core.for(id);
    if (!a || !a.subscribeTrade) continue;   // market-data-only adapters have no trade stream
    /** @param {any} ev */
    const cb = (ev) => onEvent(id, ev);   // every event validated against the contract
    subs.set(id, { cb });
    live.set(id, false);
    try { setTimeout(() => live.set(id, true), 2500); } catch (_) { live.set(id, true); }   // skip the connect-time replay burst; fills after are live
    try { a.subscribeTrade(cb); } catch (_) {}
    try { a.getPositions && a.getPositions(/** @param {any[]} ps */ (ps) => (ps || []).forEach((p) => onEvent(id, { kind: 'position', position: p }))); } catch (_) {}
    try { a.getAccount && a.getAccount(/** @param {any} acc */ (acc) => acc && !acc.error && onEvent(id, { kind: 'account', account: acc })); } catch (_) {}
    // per-account seed depth: the connection carries the user's historyDays (Connections dialog); default 30
    const rec = conns.find((c) => c.id === id);
    const days = rec && Number(rec.historyDays) > 0 ? Number(rec.historyDays) : SEED_LOOKBACK_DAYS;
    seedOrderBook(id, a, days);   // SNAPSHOT: working orders + recent order history -> the order book (quiet, no Console flood)
  }
}

// Seed the order book on connect: current working orders + recently filled orders (the reference position
// manager does the same "snapshot at start, live capture during"). Both are quiet seeds -- store only, no log.
/** @param {string} id @param {any} a @param {number} [days] */
function seedOrderBook(id, a, days = SEED_LOOKBACK_DAYS) {
  try { a.getOrders && a.getOrders(/** @param {any[]} os */ (os) => (os || []).forEach((o) => onEvent(id, { kind: 'order', order: o }, true))); } catch (_) {}
  const fromMs = seedFromMs(days);
  try {
    a.getHistory && a.getHistory({ fromMs }, /** @param {any} hs */ (hs) => {
      if (!Array.isArray(hs)) { platform.console.post({ level: 'warn', cat: 'journal', src: id, msg: 'history seed failed: ' + ((hs && hs.error) || 'unknown') }); return; }   // surface, don't hide
      // getHistory returns ALL terminal orders with their real status. Seed every one into the ORDER BOOK
      // (filled / cancelled / expired / rejected), but feed the FILLS stream only when it actually filled
      // (h.qty is the fill qty) -- Positions/History derive from fills, and an unfilled order has no fill.
      hs.forEach((/** @type {any} */ h) => {
        const filled = Number(h.qty) > 0;
        onEvent(id, { kind: 'order', order: {
          id: h.id, symbol: h.symbol, side: h.side, type: h.type,
          qty: h.orderQty != null ? h.orderQty : h.qty,
          price: h.type === 'limit' ? h.limitPrice : h.type === 'stop' ? h.stopPrice : null,
          limitPrice: h.limitPrice, stopPrice: h.stopPrice,
          avgFillPrice: filled ? h.price : null,
          status: h.status || (filled ? 'filled' : 'cancelled'),
          time: h.time, updateTime: h.time, accountId: h.accountId, priceDecimals: h.priceDecimals,
        } }, true);
        if (filled) onEvent(id, { kind: 'fill', fill: h }, true);
      });
      // one summary line (not a per-order flood) so the snapshot load is visible/verifiable. Include the REQUESTED
      // window (days + from-date) and the ACTUAL date-range returned, so it is obvious whether the day-limit held.
      if (hs.length) {
        const day = (/** @type {any} */ ms) => { const n = Number(ms); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().slice(0, 10) : '?'; };
        const times = hs.map((/** @type {any} */ h) => Number(h.time)).filter((/** @type {number} */ n) => Number.isFinite(n) && n > 0);
        const range = times.length ? day(Math.min(...times)) + '..' + day(Math.max(...times)) : '?';
        platform.console.post({ cat: 'journal', src: id, msg: 'snapshot: ' + hs.length + ' order' + (hs.length === 1 ? '' : 's') + ' loaded (' + days + 'd, from ' + day(fromMs) + '; got ' + range + ')' });
      }
    });
  } catch (_) {}
}

/** @param {any} coreBroker */
export function startTradeFeed(coreBroker) {
  core = coreBroker;
  bus.on('connections:changed', resubscribe);
  bus.on('logon', resubscribe);
  resubscribe();
}
