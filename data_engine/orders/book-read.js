// @ts-check
// ORDER BOOK-READ selectors -- the SINGLE home for interpreting the platform BOOK into positions + protective exits.
// Pure, SYNCHRONOUS reads over platform.positions / positionLots / orders (no side effects, safe to call every render).
// This is order BUSINESS LOGIC -- netting vs hedging aggregation, exit-side resolution, resting-order matching -- kept
// OUT of the display and the surfaces: the chart overlay, the Order dialog, and the order worker all call these instead
// of each re-deriving the same thing (which is how the three drifted). Display draws what this returns; it never
// interprets the book itself. Read-only: nothing here places, modifies, or cancels an order.
import { platform } from '../platform/index.js';
import { isTerminal } from '../data/adapter-contract.js';

/** The broker order SIDE that EXITS a position (a long is closed by a sell, a short by a buy). @param {string} side @returns {'sell'|'buy'} */
export const exitSide = (side) => (side === 'long' ? 'sell' : 'buy');

/** @param {number} v */
const cleanPx = (v) => (Number.isFinite(v) ? Number(v.toPrecision(12)) : v); // strip IEEE754 scaling noise

// a WORKING order leg for the chart: every resting order in the book.
/** @typedef {{ id: any, type: string, side: string, price: number, qty: number, accountId?: any, stopLoss?: number|null, takeProfit?: number|null }} OrderLeg */
// The ACTIVE picture (LAYER 1) for a (broker, symbol): the net/hedged POSITION entry PLUS every working order in the book.
// Unlike readPositionView this does NOT depend on a position existing -- a standalone resting order (no position) is still
// returned, so the chart ALWAYS shows real orders and the pre-trade plan can never overshadow them. Hedging SL/TP are
// position ATTRIBUTES (no order id) -> hedgeStop/hedgeTarget; netting exits and every other resting order carry an id ->
// orders[]. Never returns null (empty when flat with nothing working). Read-only.
/** @param {string} broker @param {string} symbol
 *  @returns {{ entry: number|null, side: string|null, qty: number, hedge: boolean, hedgeStop: number|null, hedgeStopQty: number|null, hedgeTarget: number|null, hedgeTargetQty: number|null, orders: OrderLeg[] }} */
export function readActive(broker, symbol) {
  /** @type {{ entry: number|null, side: string|null, qty: number, hedge: boolean, hedgeStop: number|null, hedgeStopQty: number|null, hedgeTarget: number|null, hedgeTargetQty: number|null, orders: OrderLeg[] }} */
  const empty = {
    entry: null,
    side: null,
    qty: 0,
    hedge: false,
    hedgeStop: null,
    hedgeStopQty: null,
    hedgeTarget: null,
    hedgeTargetQty: null,
    orders: [],
  };
  if (!symbol) return empty;
  /** @param {any} x */
  const mine = (x) => x.symbol === symbol && (!broker || x.broker === broker);
  // EVERY working order in the book -- separate orders (netting exits, pending entries, scale-outs...). Always collected,
  // both account types, so all real orders show. Hedging position SL/TP are lot ATTRIBUTES (not here) -> hedge fields.
  /** @type {OrderLeg[]} */ const orders = [];
  for (const o of /** @type {any[]} */ (platform.orders.all())) {
    if (!mine(o) || isTerminal(o.status)) continue;
    const raw = Number(
      o.type === 'stop' ? (o.stopPrice != null ? o.stopPrice : o.price) : o.limitPrice != null ? o.limitPrice : o.price,
    );
    if (!Number.isFinite(raw)) continue; // e.g. a market order in transit has no resting price -- nothing to draw
    orders.push({
      id: o.id,
      type: o.type,
      side: o.side,
      price: cleanPx(raw),
      qty: Number(o.qty),
      accountId: o.accountId,
      stopLoss: o.stopLoss != null ? Number(o.stopLoss) : null,
      takeProfit: o.takeProfit != null ? Number(o.takeProfit) : null,
    }); // carry account + native SL/TP so the order-modify dialog can gate on hedging and prefill exits
  }
  // HEDGING: per-ticket lots aggregate to one entry; SL/TP are lot ATTRIBUTES (no separate order).
  const lots = /** @type {any[]} */ (platform.positionLots.all()).filter((l) => mine(l) && Number(l.qty) > 0);
  if (lots.length) {
    let q = 0,
      cost = 0,
      longQ = 0,
      shortQ = 0;
    let stop = null,
      target = null;
    for (const l of lots) {
      const lq = Number(l.qty);
      q += lq;
      cost += lq * Number(l.avgPrice);
      if (l.side === 'short') shortQ += lq;
      else longQ += lq;
      if (l.stopLoss) stop = Number(l.stopLoss);
      if (l.takeProfit) target = Number(l.takeProfit);
    }
    return {
      entry: q > 0 ? cost / q : null,
      side: longQ >= shortQ ? 'long' : 'short',
      qty: q,
      hedge: true,
      hedgeStop: stop != null ? cleanPx(stop) : null,
      hedgeStopQty: stop != null ? q : null,
      hedgeTarget: target != null ? cleanPx(target) : null,
      hedgeTargetQty: target != null ? q : null,
      orders,
    };
  }
  // NETTING / FLAT: the net position entry (if any) + all the working orders collected above.
  const pos = /** @type {any[]} */ (platform.positions.all()).find((p) => mine(p) && Number(p.qty) > 0);
  return {
    entry: pos ? Number(pos.avgPrice) : null,
    side: pos ? pos.side : null,
    qty: pos ? Number(pos.qty) : 0,
    hedge: false,
    hedgeStop: null,
    hedgeStopQty: null,
    hedgeTarget: null,
    hedgeTargetQty: null,
    orders,
  };
}

// The LIVE resting exit order for a netting position: the freshest working 'stop'/'limit' on the exit side. The order
// store can retain ghost "working" orders (a terminal event arrived on another connection), so callers must NOT act
// on every match -- the SINGLE FRESHEST BY TIME (most recently placed/updated) is the live one. Order ids are opaque
// broker tokens (not monotonic), so rank by time. Was copied in three places (DSL setStop, setStopPrice,
// setTargetPrice); this is the one home.
/** @param {string} brokerId @param {string} symbol @param {'stop'|'limit'} type @param {string} side @returns {any|null} */
export function freshestExitOrder(brokerId, symbol, type, side) {
  const freshness = (/** @type {any} */ o) => Math.max(Number(o.updateTime) || 0, Number(o.time) || 0);
  return (
    /** @type {any[]} */ (platform.orders.all())
      .filter(
        (o) =>
          o.broker === brokerId && o.symbol === symbol && o.type === type && o.side === side && !isTerminal(o.status),
      )
      .sort((a, b) => freshness(b) - freshness(a))[0] || null
  );
}

// The CURRENT open position for a ctx: a hedging lot (by ticket, else the sole lot for the symbol) or the net
// position. Returns { net, side:'long'|'short', entry, qty, ticket?, takeProfit? } or null when flat. Throws when a
// hedging symbol has several lots and no ticket pins which one. (Moved verbatim from exec.currentPosition().)
/** @param {{broker:string, symbol:string, ticket?:any}} ctx @returns {any} */
export function currentPosition(ctx) {
  const lots = /** @type {any[]} */ (platform.positionLots.all()).filter(
    (l) => (!ctx.broker || l.broker === ctx.broker) && l.symbol === ctx.symbol && Number(l.qty) > 0,
  );
  if (lots.length) {
    let lot = ctx.ticket != null ? lots.find((l) => String(l.ticket) === String(ctx.ticket)) : null;
    if (!lot) {
      if (lots.length === 1) lot = lots[0];
      else throw new Error('several ' + ctx.symbol + ' positions -- open the ticket on the one to modify');
    }
    return {
      net: false,
      ticket: lot.ticket,
      side: lot.side,
      entry: Number(lot.avgPrice),
      qty: Number(lot.qty),
      stopLoss: lot.stopLoss,
      takeProfit: lot.takeProfit,
    };
  }
  const p = /** @type {any[]} */ (platform.positions.all()).find(
    (/** @type {any} */ x) => (!ctx.broker || x.broker === ctx.broker) && x.symbol === ctx.symbol && Number(x.qty) > 0,
  );
  return p ? { net: true, side: p.side, entry: Number(p.avgPrice), qty: Number(p.qty) } : null;
}

// Refresh a specific KNOWN position from the book: its live lot by ticket, else the net by symbol, or null once fully
// closed. (Moved verbatim from order-ticket window.livePosition().)
/** @param {any} p @returns {any} the live position for `p` (by broker:ticket, else net by broker:symbol), or null if fully closed */
export function livePosition(p) {
  const lot = /** @type {any[]} */ (platform.positionLots.all()).find(
    (l) => String(l.ticket) === String(p.ticket) && (!p.broker || l.broker === p.broker),
  );
  if (lot) return lot;
  return (
    /** @type {any[]} */ (platform.positions.all()).find(
      (n) => n.symbol === p.symbol && (!p.broker || n.broker === p.broker),
    ) || null
  );
}
