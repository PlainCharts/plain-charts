// @ts-check
// CQG trade routing — the EXECUTION plane of the adapter: accounts, order placement / modify / cancel
// (working orders tracked by the stable chain_order_id), positions (incremental lot merge, the ghost
// filter, the fills-based avg-entry reconstruction), account summary, and filled-order history.
// Rides the connection in transport.js one-way: it sends through `connection` and receives through the
// transport's hooks (onLogon -> start the trade subscriptions, onMessage -> the trade message tap,
// onReset -> clear all trade state on disconnect). transport.js never imports this file.
import { connection, onMessage, onLogon, onReset } from './transport.js';
import { log } from '/data_engine/status.js';
import { emitRaw } from '/data_engine/data/raw-tap.js';   // diagnostic tap (Data Interceptor); no-op when unused

// ---- typedefs for the trade plane's own STRUCTURED state (raw CQG protocol messages stay `any`) ----
/** @typedef {(...args: any[]) => void} Cb */
/** @typedef {{ cb?: Cb, fills: any[], chains: Set<any>, syms: Map<any, string>, ticks: Map<any, { tickSize?: any, tickValue?: any }> }} HistEntry */
/** @typedef {{ id: any, name: any, number: any, brokerage: any, brokerageType: any }} TradeAccount */
/** @typedef {{ qty: number, price: number, isShort: boolean, isYesterday?: boolean }} Lot */
/** @typedef {{ lots: Map<any, Lot>, net?: number, avgPrice?: number, accountId?: any }} PositionEntry */
/** @typedef {{ cb?: Cb, clOrderId: string }} PendingOrder */
/** @typedef {{ orderId: any, clOrderId: string, chainOrderId: any, contractId?: any, side?: any, orderType?: any, duration?: any, goodThruDate?: any, expiry?: (number|null), scaledLimitPrice?: any, scaledStopPrice?: any, qty?: any }} LiveOrderRec */

/** @type {Map<number, HistEntry>} */
const histCbs = new Map();  // historical-orders request id -> { cb, fills:[], chains:Set, syms:Map }
/** @type {{ fromMs?: number, toMs?: number, cb?: any }[]} */
const pendingHistory = [];  // getHistory requests deferred until the trade account is known (see getHistory/handleAccounts)

let tradeAccountId = 0;                  // the trading account we route orders to
/** @type {TradeAccount[]} */
const tradeAccounts = [];               // [{ id, name, number, brokerage, brokerageType }]
/** @type {Map<any, PositionEntry>} */
const positionsByContract = new Map();  // contractId -> { lots: Map(openPositionId -> {qty,price,isShort,isYesterday}), net (signed), avgPrice }
const GHOST_DEBOUNCE_MS = 1000;         // the account net must STAY flat this long before a brought-forward lot is confirmed a ghost
/** @type {Map<any, any>} */
const ghostTimers = new Map();          // contractId -> pending confirm-ghost timeout (debounce; see emitPosition)
/** @type {Map<any, Array<{ time: number, side: any, qty: number, price: number }>>} */
const fillLog = new Map();              // contractId -> deduped fills; drives the RECONSTRUCTED avg entry (not priceCorrect)
/** @type {Set<any>} */
const seenFillChains = new Set();       // chainOrderId dedup across the connect history seed + live fills
/** @type {Record<string, any> | null} */
let acctSummary = null;                 // merged AccountSummaryStatus (incremental fields)
/** @type {Map<number, PendingOrder>} */
const pendingOrders = new Map();        // requestId -> { cb, clOrderId }
/** @type {Map<any, string>} */
const clByOrderId = new Map();          // orderId -> cl_order_id (for cancels/modifies)
// CQG re-assigns order_id on every modify (the reject literally says "Order id might already be
// changed"). So track working orders by the STABLE chain_order_id, keeping the CURRENT order_id +
// cl_order_id (refreshed on each status), and map every order_id ever seen -> its chain. A modify
// then resolves the freshest order_id no matter which (possibly stale) id the caller held.
/** @type {Map<any, LiveOrderRec>} */
const ordersByChain = new Map();        // chainOrderId -> { orderId, clOrderId, chainOrderId, contractId, side, orderType, scaledLimitPrice, scaledStopPrice, qty }
/** @type {Map<any, any>} */
const chainByOrderId = new Map();       // any seen orderId -> chainOrderId
/** @param {any} orderId */
const liveOrder = (orderId) => ordersByChain.get(chainByOrderId.get(orderId) || orderId);
/** @type {Set<Cb>} */
const tradeListeners = new Set();        // OnTrade: fan-out of order/fill/position/account events
/** @param {any} ev */
const emitTrade = (ev) => tradeListeners.forEach((cb) => { try { cb(ev); } catch (_) {} });
let orderSeq = 1;                        // request_id + cl_order_id source (unique per session)
/** @param {any} d */
const dec = (d) => (d ? Number(d.significand || 0) * Math.pow(10, Number(d.exponent || 0)) : 0);
// OrderStatus.status enum (shared_1.OrderStatus.Status) -- taken from the proven position-manager app:
// 1 Working  2 InCancel  3 Working  4 Filled  5 DoneForDay  6 Replaced  7 Cancelled  8 Filled  9 Busted
// 10 Rejected  11 Suspended. Mapped to our neutral order statuses:
/** @type {Record<number, string>} */
// CQG OrderStatus.Status (shared_1.proto): 1 IN_TRANSIT, 2 REJECTED, 3 WORKING, 4 EXPIRED, 5 IN_CANCEL,
// 6 IN_MODIFY, 7 CANCELLED, 8 FILLED, 9 SUSPENDED, 10 DISCONNECTED, 11 ACTIVEAT.
// IN_MODIFY (6): CQG assigns a NEW order_id per modify; the OLD order_id is left at status 6 while the new one arrives
// as WORKING (3). So 6 means "this order_id is SUPERSEDED" -> map it to 'replaced' (TERMINAL) so the store drops the
// stale id, exactly as the position-manager app does (status 6 = Replaced -> remove that order_id). It is NOT in
// OS_WORKING (don't point the chain at the old id) nor OS_DONE (don't delete the chain -- the new WORKING id owns it).
const OS_NAME = { 1: 'in_transit', 2: 'rejected', 3: 'working', 4: 'expired', 5: 'in_cancel', 6: 'replaced', 7: 'cancelled', 8: 'filled', 9: 'suspended', 10: 'cancelled', 11: 'working' };
const OS_WORKING = new Set([1, 3, 5, 9, 11]);          // live / in-flight / parked -> stays in the working set (6 excluded: superseded id)
const OS_DONE = new Set([2, 4, 7, 8, 10]);             // terminal -> leaves the working set (rejected/expired/cancelled/filled/disconnected)
// TransactionStatus.Status (shared_1.proto) -- the RAW per-transaction broker comms (exec reports). Passed through
// verbatim so the Console shows what the BROKER actually said, not our synthesized status narrative.
/** @type {Record<number, string>} */
const TX_NAME = { 1: 'IN_TRANSIT', 2: 'REJECTED', 3: 'ACK_PLACE', 4: 'EXPIRED', 5: 'IN_CANCEL', 6: 'ACK_CANCEL', 7: 'REJECT_CANCEL', 8: 'IN_MODIFY', 9: 'ACK_MODIFY', 10: 'REJECT_MODIFY', 11: 'FILL', 12: 'SUSPEND', 13: 'FILL_CORRECT', 14: 'TRADE_BROKEN', 15: 'ACTIVATED', 16: 'REMOVE', 17: 'ACTIVATION_REJECT' };
const OS_REJECTED = 2;                                 // REJECTED
/** @param {any} ts @returns {number|null} */
const tsMs = (ts) => ts ? Number(ts.seconds || 0) * 1000 + Math.round(Number(ts.nanos || 0) / 1e6) : null;   // google.protobuf.Timestamp -> epoch ms
/** @param {number} ms */
const tsObj = (ms) => { const s = Math.floor(ms / 1000); return { seconds: s, nanos: Math.round((ms - s * 1000) * 1e6) }; };   // epoch ms -> google.protobuf.Timestamp
// an order's GTD expiry as absolute ms: prefer the precise Timestamp, fall back to the base-relative date field
/** @param {any} o @returns {number|null} */
function goodThruMsOf(o) { return tsMs(o.goodThruUtcTimestamp) || (o.goodThruDate ? o.goodThruDate + connection.baseMs() : null); }

export const trading = {
  // ---- trade routing reads ----
  tradeAccountId: () => tradeAccountId,
  accountSummary: () => acctSummary,
  accounts: () => tradeAccounts.slice(),
  positions: () => [...positionsByContract.entries()]
    .filter(([, p]) => p.net !== 0)
    .map(([contractId, p]) => ({ contractId, qty: Math.abs(/** @type {number} */ (p.net)), side: /** @type {number} */ (p.net) < 0 ? 'short' : 'long', avgPrice: p.avgPrice })),
  orders: () => [...ordersByChain.values()],   // live working orders (stop/limit), freshest order_id per chain
  /** @param {any} orderId */
  findOrder: (orderId) => liveOrder(orderId),  // resolve a (possibly stale) order_id to its current record
  /** @param {Cb} cb */
  onTrade: (cb) => tradeListeners.add(cb),   // subscribe to live order/fill/position/account events
  /** @param {Cb} cb */
  offTrade: (cb) => tradeListeners.delete(cb),

  // place an order. order_type 1=MKT 2=LMT 3=STP; side 1=buy 2=sell; duration 1=DAY.
  // duration = CQG TIF enum (1=DAY 2=GTC 3=GTD 5=FAK/IOC 6=FOK). goodThru (absolute UTC ms) is
  // required for GTD and ignored otherwise.
  /** @param {{ contractId: any, side: any, qty: number, orderType?: number, duration?: number, goodThru?: number, scaledLimitPrice?: number, scaledStopPrice?: number }} order0 @param {Cb} [cb] */
  placeOrder({ contractId, side, qty, orderType = 1, duration = 1, goodThru, scaledLimitPrice, scaledStopPrice }, cb) {
    if (!tradeAccountId) return cb && cb({ error: 'no trading account (not authorized for trade routing?)' });
    const requestId = ++orderSeq;
    const clOrderId = 'o' + Date.now() + '-' + requestId;   // unique per trader per day
    /** @type {{ accountId: number, whenUtcTime: number, contractId: any, clOrderId: string, orderType: number, duration: number, side: any, qty: { significand: number, exponent: number }, isManual: boolean, scaledLimitPrice?: number, scaledStopPrice?: number, goodThruDate?: number }} */
    const order = { accountId: tradeAccountId, whenUtcTime: 0, contractId, clOrderId, orderType, duration, side, qty: { significand: Math.abs(Math.round(qty)), exponent: 0 }, isManual: true };
    if (scaledLimitPrice != null) order.scaledLimitPrice = scaledLimitPrice;
    if (scaledStopPrice != null) order.scaledStopPrice = scaledStopPrice;
    // GTD (duration 3, good-till-DATE): send good_thru_date ONLY (base-relative ms, like the history fromDate).
    // A good_thru_utc_timestamp needs duration GTT, which futures reject -- so GTD is date-resolution here.
    if (duration === 3 && goodThru != null) order.goodThruDate = Math.round(goodThru - connection.baseMs());
    pendingOrders.set(requestId, { cb, clOrderId });
    connection.send({ orderRequests: [{ requestId, newOrder: { order } }] });
    return requestId;
  },
  // place an entry WITH a native bracket, as the canonical compound: an OPO (Order-Places-Order) whose ENTRY,
  // on fill, places a nested OCO (Order-Cancels-Order) of the TP limit + SL stop at their absolute prices. One
  // exit filling cancels the other. Order-level construct -> works on netting. Reject reasons surface as usual.
  /** @param {{ contractId: any, side: any, qty: number, orderType?: number, duration?: number, goodThru?: number, scaledLimitPrice?: number, scaledStopPrice?: number, exitSide?: any, scaledTp?: number, scaledSl?: number }} bracket0 @param {Cb} [cb] */
  placeBracket({ contractId, side, qty, orderType = 1, duration = 1, goodThru, scaledLimitPrice, scaledStopPrice, exitSide, scaledTp, scaledSl }, cb) {
    if (!tradeAccountId) return cb && cb({ error: 'no trading account (not authorized for trade routing?)' });
    const requestId = ++orderSeq;
    const stamp = Date.now();
    /** @param {string} n */
    const cl = (n) => 'o' + stamp + '-' + requestId + '-' + n;
    const q = { significand: Math.abs(Math.round(qty)), exponent: 0 };
    /** @type {{ accountId: number, whenUtcTime: number, contractId: any, clOrderId: string, orderType: number, duration: number, side: any, qty: { significand: number, exponent: number }, isManual: boolean, scaledLimitPrice?: number, scaledStopPrice?: number, goodThruDate?: number }} */
    const entry = { accountId: tradeAccountId, whenUtcTime: 0, contractId, clOrderId: cl('e'), orderType, duration, side, qty: q, isManual: true };
    if (scaledLimitPrice != null) entry.scaledLimitPrice = scaledLimitPrice;
    if (scaledStopPrice != null) entry.scaledStopPrice = scaledStopPrice;
    if (duration === 3 && goodThru != null) entry.goodThruDate = Math.round(goodThru - connection.baseMs());
    const exits = [];   // exit orders are GTC so they persist until one fills (then OCO cancels the other)
    if (scaledTp != null) exits.push({ order: { accountId: tradeAccountId, whenUtcTime: 0, contractId, clOrderId: cl('t'), orderType: 2, duration: 2, side: exitSide, qty: q, isManual: true, scaledLimitPrice: scaledTp } });
    if (scaledSl != null) exits.push({ order: { accountId: tradeAccountId, whenUtcTime: 0, contractId, clOrderId: cl('s'), orderType: 3, duration: 2, side: exitSide, qty: q, isManual: true, scaledStopPrice: scaledSl } });
    const child = exits.length === 2 ? { compoundOrder: { type: 2, clCompoundId: 'oco' + stamp + requestId, compoundOrderEntries: exits } } : exits[0];   // OCO of both, or the single exit
    const compoundOrder = { type: 1, clCompoundId: 'opo' + stamp + requestId, compoundOrderEntries: [{ order: entry }, child] };   // OPO: entry places the exit(s)
    pendingOrders.set(requestId, { cb, clOrderId: entry.clOrderId });
    connection.send({ orderRequests: [{ requestId, newCompoundOrder: { compoundOrder } }] });
    return requestId;
  },
  // modify a working order's price and/or qty. The order_id changes per modify, so resolve the
  // CURRENT order_id + cl_order_id from the live working set (by chain). qty is always sent (CQG
  // expects it), defaulting to the order's current qty when the caller only moves the price.
  /** @param {{ orderId: any, qty?: number, scaledLimitPrice?: number, scaledStopPrice?: number }} mod0 @param {Cb} [cb] */
  modifyOrder({ orderId, qty, scaledLimitPrice, scaledStopPrice }, cb) {
    if (!tradeAccountId) return cb && cb({ error: 'no trading account' });
    const cur = liveOrder(orderId);
    if (!cur) return cb && cb({ error: 'order not working (gone or not received yet): ' + orderId });
    const requestId = ++orderSeq;
    const clOrderId = 'm' + Date.now() + '-' + requestId;
    const useQty = qty != null ? qty : cur.qty;
    /** @type {{ orderId: any, accountId: number, origClOrderId: string, clOrderId: string, whenUtcTime: number, qty: { significand: number, exponent: number }, scaledLimitPrice?: number, scaledStopPrice?: number }} */
    const mod = { orderId: cur.orderId, accountId: tradeAccountId, origClOrderId: cur.clOrderId || '', clOrderId, whenUtcTime: 0,
      qty: { significand: Math.abs(Math.round(Number(useQty) || 1)), exponent: 0 } };
    if (scaledLimitPrice != null) mod.scaledLimitPrice = scaledLimitPrice;
    if (scaledStopPrice != null) mod.scaledStopPrice = scaledStopPrice;
    pendingOrders.set(requestId, { cb, clOrderId });
    connection.send({ orderRequests: [{ requestId, modifyOrder: mod }] });
    return requestId;
  },
  /** @param {any} orderId @param {Cb} [cb] */
  cancelOrder(orderId, cb) {
    if (!tradeAccountId) return cb && cb({ error: 'no trading account' });
    const cur = liveOrder(orderId);
    const useId = cur ? cur.orderId : orderId;
    const origCl = cur ? (cur.clOrderId || '') : (clByOrderId.get(orderId) || '');
    const requestId = ++orderSeq;
    const clOrderId = 'c' + Date.now() + '-' + requestId;
    pendingOrders.set(requestId, { cb, clOrderId });
    // CQG requires a client-side time on a cancel ("at least one of when_utc_time / when_utc_timestamp") --
    // use broker-now as an absolute Timestamp, else it rejects "client side time was not specified".
    connection.send({ orderRequests: [{ requestId, cancelOrder: { orderId: useId, accountId: tradeAccountId, origClOrderId: origCl, clOrderId, whenUtcTimestamp: tsObj(Date.now() + (connection.brokerSkewMs() || 0)) } }] });
    return requestId;
  },

  // account history: filled orders over a date range, via HistoricalOrdersRequest.
  // from/to are absolute UTC ms; CQG wants them as ms offsets from the logon base time.
  // The report can be paged (is_report_complete flags the last page); handleHistory()
  // accumulates filled orders, dedups by chain, resolves symbols from the report metadata,
  // then fires cb once with the full sorted list (or { error } on failure).
  /** @param {{ fromMs?: number, toMs?: number }} [range] @param {Cb} [cb] */
  getHistory({ fromMs, toMs } = {}, cb) {
    if (!connection.baseMs()) return cb && cb({ error: 'not logged on' });
    // The trade account is established asynchronously AFTER logon (setupTrading requests the account list;
    // handleAccounts sets tradeAccountId when the report lands). The connect-time seed asks for history right
    // on 'logon', BEFORE that -- so if the account isn't known yet, queue the request and flush it once it is.
    // Without this the seed failed with 'no trading account' and was never retried (only today's live fills
    // showed in History).
    if (!tradeAccountId) { pendingHistory.push({ fromMs, toMs, cb }); return; }
    return sendHistoryRequest(fromMs, toMs, cb);
  },
};

// after logon: ask for the account list, then subscribe to orders(1)/positions(2)/account
// summary(4)/exchange positions(5). Mirrors the working CQG WebAPI flow.
function setupTrading() {
  connection.send({ informationRequests: [{ id: connection.nextId(), accountsRequest: {} }] });
  // account-summary fields: margin(6) position_margin(7) purchasing_power(8) ote(9) mvo(10)
  // mvf(11) margin_credit(12) cash_excess(13) balance(15) pl(16) upl(17) yesterday_bal(18)
  // filled_qty(19) filled_orders(20) long_qty(21) short_qty(22) parked(28) working(29) option_prem(30)
  connection.send({ tradeSubscriptions: [{ id: connection.nextId(), subscribe: true, subscriptionScopes: [1, 2, 4, 5], accountSummaryParameters: { requestedFields: [6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 28, 29, 30] } }] });
}
// accumulate one HistoricalOrdersReport page; fire the callback once the last page arrives.
// Only FILLED orders are kept (fill_qty > 0); deduped by chain_order_id. Symbols come from
// the report's own contract_metadata (these contracts may never have been resolved this session).
// Issue a historical-orders request. Caller guarantees baseMs + tradeAccountId are set.
/** @param {number|undefined} fromMs @param {number|undefined} toMs @param {any} cb @returns {number} */
function sendHistoryRequest(fromMs, toMs, cb) {
  const id = connection.nextId();
  histCbs.set(id, { cb, fills: [], chains: new Set(), syms: new Map(), ticks: new Map() });
  /** @type {{ fromDate: number, accountIds: number[], toDate?: number }} */
  const req = { fromDate: Math.round(/** @type {number} */ (fromMs) - connection.baseMs()), accountIds: [tradeAccountId] };
  if (toMs != null) req.toDate = Math.round(toMs - connection.baseMs());
  connection.send({ informationRequests: [{ id, historicalOrdersRequest: req }] });
  return id;
}
/** @param {any} rep */
function handleHistory(rep) {
  const h = histCbs.get(rep.id);
  if (!h) return;
  if (rep.statusCode >= 100) {   // FAILURE / INVALID_PARAMS / NOT_FOUND etc. (success codes are 0-4)
    histCbs.delete(rep.id);
    h.cb && h.cb({ error: 'history failed (' + rep.statusCode + ')' + (rep.textMessage ? ': ' + rep.textMessage : '') });
    return;
  }
  const r = rep.historicalOrdersReport || {};
  (r.orderStatuses || []).forEach((/** @type {any} */ os) => {
    (os.contractMetadata || []).forEach((/** @type {any} */ m) => {
      const sym = m.cqgContractSymbol || m.contractSymbol;
      if (sym && !h.syms.has(m.contractId)) h.syms.set(m.contractId, sym);
      // tick size + tick value come from the report's own metadata -> the ONLY source for contracts
      // traded but never resolved this session (so past-trade P&L resolves without a live subscription)
      if (!h.ticks.has(m.contractId) && (m.tickValue != null || m.tickSize != null)) h.ticks.set(m.contractId, { tickSize: m.tickSize, tickValue: m.tickValue });
    });
    if (h.chains.has(os.chainOrderId)) return;
    const o = os.order;
    if (!o) return;
    h.chains.add(os.chainOrderId);
    const ts = os.statusUtcTimestamp;
    const time = ts ? Number(ts.seconds || 0) * 1000 + Math.round(Number(ts.nanos || 0) / 1e6) : null;
    const fc = os.fillCommission;
    // keep EVERY terminal order (filled + cancelled/expired/rejected), one per chain, with its real status,
    // ordered qty, and limit/stop -- the order book shows all of them. `qty` here is the FILLED qty (0 when
    // unfilled); only orders with fillQty > 0 feed the fills stream downstream (Positions/History).
    h.fills.push({ orderId: os.orderId, contractId: o.contractId, side: o.side, orderType: o.orderType, status: OS_NAME[os.status] || ('status_' + os.status), orderQty: dec(o.qty), qty: dec(os.fillQty), price: os.avgFillPriceCorrect, scaledLimitPrice: o.scaledLimitPrice, scaledStopPrice: o.scaledStopPrice, time, commission: fc ? fc.commission : null, commissionCurrency: fc ? fc.commissionCurrency : null });
    recordFill(o.contractId, os.chainOrderId, o.side, dec(os.fillQty), os.avgFillPriceCorrect, time);   // seed the avg-entry reconstruction from history
  });
  if (rep.isReportComplete === false) return;        // more pages coming
  histCbs.delete(rep.id);
  h.fills.forEach((f) => { f.symbol = h.syms.get(f.contractId) || ('contract ' + f.contractId); const t = h.ticks.get(f.contractId); if (t) { f.tickSize = t.tickSize; f.tickValue = t.tickValue; } });
  h.fills.sort((a, b) => (a.time || 0) - (b.time || 0));
  h.cb && h.cb(h.fills);
  for (const cid of positionsByContract.keys()) emitPosition(cid);   // history seeded -> re-emit positions with the reconstructed avg entry
}
/** @param {any} report */
function handleAccounts(report) {
  tradeAccounts.length = 0;
  (report.brokerages || []).forEach((/** @type {any} */ b) => (b.salesSeries || []).forEach((/** @type {any} */ ss) => (ss.accounts || []).forEach((/** @type {any} */ a) => {
    tradeAccounts.push({ id: a.accountId, name: a.name, number: a.brokerageAccountNumber, brokerage: b.name, brokerageType: b.type });
  })));
  const demo = tradeAccounts.find((a) => a.brokerageType === 2 || a.brokerageType === 3);   // sim/demo preferred
  tradeAccountId = (demo || tradeAccounts[0] || {}).id || 0;
  if (tradeAccountId) log('Trading account ' + tradeAccountId + ' (' + tradeAccounts.length + ' available).');
  // flush any history requests that arrived before the account was known (the connect-time seed)
  if (tradeAccountId && pendingHistory.length) {
    pendingHistory.splice(0, pendingHistory.length).forEach((p) => sendHistoryRequest(p.fromMs, p.toMs, p.cb));
  }
}
/** @param {any} ps */
function handlePosition(ps) {
  // CQG sends INCREMENTAL position updates: open_positions carries only ADDED/CHANGED/DELETED lots, keyed by
  // OpenPosition.id (qty 0/absent = the lot was deleted). The full list is sent only in a snapshot. So we must
  // maintain the lot set PER CONTRACT and aggregate the net from ALL accumulated lots -- never from just this
  // message, or an incremental single-lot update clobbers the real net (e.g. 8 contracts -> shows 1).
  const cid = ps.contractId;
  let entry = positionsByContract.get(cid);
  if (!entry) { entry = { lots: new Map() }; positionsByContract.set(cid, entry); }
  entry.accountId = ps.accountId != null ? ps.accountId : (tradeAccountId || null);
  // SNAPSHOT RECONCILIATION: a snapshot (is_snapshot) carries the FULL current lot set for this contract; deltas
  // carry only added/changed/deleted lots. CQG (esp. the demo) can drop a closed lot WITHOUT sending an explicit
  // qty-0 delete -- so an incremental-only merge leaves a GHOST lot lingering forever (a phantom open position at
  // a stale price). On a snapshot we therefore CLEAR this contract's lots first, then apply the authoritative set,
  // so a lot the fresh snapshot omits is dropped. Deltas still merge (preserving the multi-lot net).
  if (ps.isSnapshot) entry.lots.clear();
  (ps.openPositions || []).forEach((/** @type {any} */ op) => {
    const q = dec(op.qty);
    if (!q) { entry.lots.delete(op.id); return; }                                  // deleted lot
    entry.lots.set(op.id, { qty: q, price: op.priceCorrect || 0, isShort: !!op.isShort, isYesterday: !!op.isYesterday });   // add/update lot (isYesterday = brought-forward; used by the ghost filter)
  });
  emitPosition(cid);
}
// CQG GHOST FILTER (validated in .temp/cqg-lab against the live feed). CQG (esp. the demo, on illiquid far-dated
// contracts like EPU26) can leave a phantom brought-forward (is_yesterday) lot in PositionStatus for an account
// that is actually FLAT -- the on-chart dot then sticks at a stale price while the account shows zero margin/OTE.
// TradingView filters these the same way: the ACCOUNT SUMMARY net (long_qty/short_qty) is authoritative, so a
// brought-forward lot on a flat account cannot be real. BUT a genuine just-opened position ALSO reads account-flat
// for ~100ms (the position message beats the account-summary update), and on EPU26 even a fresh lot is tagged
// is_yesterday -- so dropping immediately would flicker/hide real opens. Hence a DEBOUNCE: show the raw position
// now, and only drop the lot if the account is STILL flat GHOST_DEBOUNCE_MS later. A real position flips the
// account net non-zero within that window (timer cancelled -> kept); a persistent ghost stays flat -> dropped.
// NOTE: the account net is account-wide, so this catches ghosts when the WHOLE account is flat (the common case);
// per-contract reconciliation across mixed positions would need scope-5 exchange positions (CQG sends none here).
const acctIsFlat = () => !!(acctSummary && acctSummary.longQty === 0 && acctSummary.shortQty === 0);
/** @param {PositionEntry} entry @param {boolean} dropYday @returns {{ net: number, avgPrice: number }} */
function netOf(entry, dropYday) {
  let net = 0, tot = 0, pxw = 0;
  for (const l of entry.lots.values()) { if (dropYday && l.isYesterday) continue; net += l.isShort ? -l.qty : l.qty; tot += l.qty; pxw += l.price * l.qty; }
  return { net, avgPrice: tot ? pxw / tot : 0 };
}
// Record a FILL for the avg-entry reconstruction. Deduped by chainOrderId so the connect history seed and the live
// stream never double-count the same order. Fed from BOTH handleHistory (seed) and handleOrderStatus (live).
/** @param {any} cid @param {any} chain @param {any} side @param {number} qty @param {number} price @param {number|null} time */
function recordFill(cid, chain, side, qty, price, time) {
  if (!(qty > 0) || price == null) return;
  if (chain != null) { if (seenFillChains.has(chain)) return; seenFillChains.add(chain); }
  const a = fillLog.get(cid) || []; a.push({ time: time || 0, side, qty, price }); fillLog.set(cid, a);
}
// The TRUE avg entry of the open position, reconstructed from the fill stream (net-0 round-trip grouping, keyed by
// contractId -- mirrors compute-positions.js, and avoids the F.US.EPU26/EPU26 symbol split). CQG's
// PositionStatus.priceCorrect is the prior SETTLEMENT price on an is_yesterday lot, NOT the entry (that is the wrong
// price the dot showed, e.g. 7555.50 while TV shows the real 7540.25). Validated in .temp/cqg-lab against the live
// feed. Returns null when flat / no fills, so the caller falls back to priceCorrect.
/** @param {any} cid @returns {number|null} */
function reconstructAvg(cid) {
  const a = fillLog.get(cid); if (!a || !a.length) return null;
  let running = 0; /** @type {Array<{ time: number, side: any, qty: number, price: number }>} */ let group = [];
  for (const f of [...a].sort((x, y) => (x.time || 0) - (y.time || 0))) {
    running += (f.side === 1 ? 1 : -1) * f.qty; group.push(f);
    if (Math.abs(running) < 1e-9) group = [];   // net back to 0 -> round-trip closed; reset
  }
  if (!group.length) return null;               // currently flat
  const openSide = group[0].side; let q = 0, cost = 0;
  for (const f of group) if (f.side === openSide) { q += f.qty; cost += f.qty * f.price; }
  return q ? cost / q : null;
}
/** @param {any} cid @param {number} net @param {number} avgPrice */
function sendPosition(cid, net, avgPrice) {
  const entry = positionsByContract.get(cid);
  if (entry) { entry.net = net; entry.avgPrice = avgPrice; }
  if (entry && entry.lots.size === 0) positionsByContract.delete(cid);   // no lots at all -> the contract is truly gone
  emitTrade({ kind: 'position', contractId: cid, qty: Math.abs(net), side: net < 0 ? 'short' : 'long', avgPrice, accountId: (entry && entry.accountId != null) ? entry.accountId : (tradeAccountId || null) });
}
/** @param {any} cid */
function emitPosition(cid) {
  const entry = positionsByContract.get(cid); if (!entry) return;
  const raw = netOf(entry, false);
  const recon = reconstructAvg(cid);
  const avgPrice = recon != null ? recon : raw.avgPrice;   // fills-based avg entry (TV-correct); fall back to priceCorrect if no fills yet
  const hasYday = [...entry.lots.values()].some((l) => l.isYesterday);
  const candidate = acctIsFlat() && hasYday && raw.net !== 0;   // account says flat but a brought-forward lot is present
  if (candidate) {
    if (!ghostTimers.has(cid)) ghostTimers.set(cid, setTimeout(() => { ghostTimers.delete(cid); confirmGhost(cid); }, GHOST_DEBOUNCE_MS));
    sendPosition(cid, raw.net, avgPrice);   // show the raw position while the ghost-check is pending (no flicker on real opens)
  } else {
    const t = ghostTimers.get(cid); if (t) { clearTimeout(t); ghostTimers.delete(cid); }   // account moved (real) -> cancel any pending drop
    sendPosition(cid, raw.net, avgPrice);
  }
}
/** @param {any} cid */
function confirmGhost(cid) {
  const entry = positionsByContract.get(cid); if (!entry) return;
  if (acctIsFlat() && [...entry.lots.values()].some((l) => l.isYesterday)) sendPosition(cid, 0, 0);   // still flat -> the brought-forward lot is a ghost; emit flat (lots retained, so it un-filters if the account net returns)
  else emitPosition(cid);   // resolved to a real position in the meantime
}
/** @param {any} s */
function handleAccountSummary(s) {
  acctSummary = acctSummary || {};
  if (s.accountId != null) acctSummary.accountId = s.accountId;
  if (s.currency) acctSummary.currency = s.currency;
  ['currentBalance', 'profitLoss', 'unrealizedProfitLoss', 'totalMargin', 'positionMargin', 'purchasingPower', 'ote',
    'mvo', 'mvf', 'marginCredit', 'cashExcess', 'yesterdayBalance', 'totalFilledOrders', 'totalParkedOrders', 'totalWorkingOrders', 'optionPremium'].forEach((k) => { if (s[k] != null) /** @type {Record<string, any>} */ (acctSummary)[k] = s[k]; });
  if (s.totalFilledQty) acctSummary.filledQty = dec(s.totalFilledQty);
  if (s.longOpenPositionsQty) acctSummary.longQty = dec(s.longOpenPositionsQty);
  if (s.shortOpenPositionsQty) acctSummary.shortQty = dec(s.shortOpenPositionsQty);
  if (acctSummary.accountId == null) return;   // don't emit until CQG names the account (else it keys as 'default' -> a phantom row)
  emitTrade({ kind: 'account', summary: acctSummary });
  // The account net (long_qty/short_qty) gates the ghost filter in emitPosition; re-evaluate every tracked
  // contract so a phantom brought-forward position clears the instant the account reports flat.
  for (const cid of [...positionsByContract.keys()]) emitPosition(cid);
}
/** @param {any} os */
function handleOrderStatus(os) {
  const o = os.order || {};
  const cl = o.clOrderId;
  const chain = os.chainOrderId;
  if (os.orderId && cl) clByOrderId.set(os.orderId, cl);
  if (os.orderId && chain) chainByOrderId.set(os.orderId, chain);   // map this id -> its chain (even if it later changes)
  // maintain the live working set keyed by the STABLE chain, refreshing the current order_id + cl_order_id
  if (OS_WORKING.has(os.status) && chain) {
    /** @type {LiveOrderRec | Partial<LiveOrderRec>} */
    const prev = ordersByChain.get(chain) || {};
    ordersByChain.set(chain, { orderId: os.orderId, clOrderId: cl || prev.clOrderId || '', chainOrderId: chain, contractId: o.contractId, side: o.side, orderType: o.orderType, duration: o.duration, goodThruDate: o.goodThruDate, expiry: goodThruMsOf(o), scaledLimitPrice: o.scaledLimitPrice, scaledStopPrice: o.scaledStopPrice, qty: dec(o.qty) || dec(os.remainingQty) || prev.qty });
  } else if (OS_DONE.has(os.status) && chain) ordersByChain.delete(chain);
  // OnTrade: push the order update, and a dedicated fill event when filled
  // the RAW per-transaction broker comms for THIS update (ACK_PLACE / ACK_MODIFY / ACK_CANCEL / FILL / REJECTED ...),
  // carried through to the Console verbatim. text_message is populated by the broker mainly on rejects/errors.
  const txns = (os.transactionStatuses || []).map((/** @type {any} */ t) => ({ type: TX_NAME[t.status] || ('TXN_' + t.status), fillQty: dec(t.fillQty) || null, text: t.textMessage || null }));
  // times: submission = when the order was PLACED; status = when it last CHANGED (fill/cancel/etc.)
  emitTrade({ kind: 'order', orderId: os.orderId, contractId: o.contractId, side: o.side, orderType: o.orderType, duration: o.duration, qty: dec(o.qty) || dec(os.remainingQty), scaledLimitPrice: o.scaledLimitPrice, scaledStopPrice: o.scaledStopPrice, avgFillPrice: os.avgFillPriceCorrect, status: OS_NAME[os.status] || ('status_' + os.status), submitTime: tsMs(os.submissionUtcTimestamp), statusTime: tsMs(os.statusUtcTimestamp), expiry: goodThruMsOf(o), accountId: o.accountId != null ? o.accountId : tradeAccountId || null, txns, rejectText: os.rejectMessage || null });
  if (os.status === 8) {
    const fc = os.fillCommission;
    recordFill(o.contractId, os.chainOrderId, o.side, dec(os.fillQty), os.avgFillPriceCorrect, tsMs(os.fillUtcTimestamp));   // feed the avg-entry reconstruction (live)
    emitTrade({ kind: 'fill', orderId: os.orderId, contractId: o.contractId, side: o.side, qty: dec(os.fillQty), avgPrice: os.avgFillPriceCorrect, time: tsMs(os.fillUtcTimestamp), commission: fc ? fc.commission : null, commissionCurrency: fc ? fc.commissionCurrency : null, accountId: o.accountId != null ? o.accountId : tradeAccountId || null });
  }
  // status=Rejected(2): surface the WHY. Request-level rejects come as OrderRequestReject; an accepted-then-
  // rejected order carries the reason on OrderStatus.reject_message (or its transaction statuses' text).
  if (os.status === OS_REJECTED) {
    const rejMsg = os.rejectMessage || (os.transactionStatuses || []).map((/** @type {any} */ t) => t.textMessage).filter(Boolean).join('; ') || 'order rejected';
    emitTrade({ kind: 'reject', code: null, text: rejMsg, reason: rejMsg });
  }
  // resolve a pending place/modify/cancel only on a SETTLED status (working or terminal; skip transient in-flight)
  if (!OS_WORKING.has(os.status) && !OS_DONE.has(os.status)) return;
  for (const [rid, p] of pendingOrders) {
    if (p.clOrderId && cl === p.clOrderId) {
      pendingOrders.delete(rid);
      const rejMsg = os.status === OS_REJECTED ? (os.rejectMessage || (os.transactionStatuses || []).map((/** @type {any} */ t) => t.textMessage).filter(Boolean).join('; ') || 'order rejected') : null;
      p.cb && p.cb({ id: os.orderId, status: OS_NAME[os.status] || ('status_' + os.status), fillQty: dec(os.fillQty), avgPrice: os.avgFillPriceCorrect, error: rejMsg ? ('rejected: ' + rejMsg) : undefined, raw: os });
      break;
    }
  }
}

// The trade message tap: every decoded server message reaches here (transport keeps the data plane —
// bars/quotes/symbols/sessions — and forwards the rest). Request ids come from the shared counter, so
// membership checks (histCbs) never collide with the transport's own callback maps.
/** @param {any} msg */
function handleTradeMessage(msg) {
  (msg.informationReports || []).forEach((/** @type {any} */ rep) => {
    if (rep.accountsReport) { emitRaw('cqg', 'accounts', rep.accountsReport); handleAccounts(rep.accountsReport); }
    if (rep.historicalOrdersReport) emitRaw('cqg', 'order-history', rep.historicalOrdersReport);   // raw filled-order history
    if (rep.historicalOrdersReport || histCbs.has(rep.id)) handleHistory(rep);
  });
  // execution stream taps (Data Interceptor) — raw order/position/account/reject as CQG sends them,
  // BEFORE we strip to the neutral trade shapes, so we can see exactly what the protocol carries.
  (msg.positionStatuses || []).forEach((/** @type {any} */ ps) => { emitRaw('cqg', 'position', ps); handlePosition(ps); });
  (msg.accountSummaryStatuses || []).forEach((/** @type {any} */ s) => { emitRaw('cqg', 'account', s); handleAccountSummary(s); });
  (msg.orderStatuses || []).forEach((/** @type {any} */ os) => { emitRaw('cqg', 'order', os); handleOrderStatus(os); });
  (msg.orderRequestRejects || []).forEach((/** @type {any} */ r) => {
    emitRaw('cqg', 'reject', r);
    const text = (r.details && r.details.text) || '';
    emitTrade({ kind: 'reject', code: r.rejectCode, text, requestId: r.requestId });   // surface WHY an order request failed
    const p = pendingOrders.get(r.requestId);
    if (p) { pendingOrders.delete(r.requestId); p.cb && p.cb({ error: 'rejected (' + r.rejectCode + ')' + (text ? ': ' + text : '') }); }
  });
}

// disconnect: clear ALL trade state (mirrors what transport clears for the data plane)
function resetTrade() {
  histCbs.clear(); pendingHistory.length = 0;
  ghostTimers.forEach((t) => { try { clearTimeout(t); } catch (_) {} }); ghostTimers.clear();
  fillLog.clear(); seenFillChains.clear();
  tradeAccountId = 0; tradeAccounts.length = 0; positionsByContract.clear(); acctSummary = null; pendingOrders.clear(); clByOrderId.clear(); ordersByChain.clear(); chainByOrderId.clear();
}

// wire the trade plane into the transport's lifecycle (registration is one-way; no cycle)
onLogon(setupTrading);
onMessage(handleTradeMessage);
onReset(resetTrade);
