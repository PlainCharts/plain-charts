// @ts-check
// Net-0 position reconstruction -- PURE, no I/O. Positions are not a broker object on a netting account; they
// are round-trips reconstructed from the FILL stream: a position opens when net qty leaves 0 and closes when
// it returns to 0. This mirrors the reference position manager's history algorithm (group fills, accumulate
// signed qty until flat). Hedging brokers that stamp a positionId on fills are grouped by that instead.
//
//   computePositions(fills, opts?) -> { open: [Position], closed: [Position] }
//
// opts.contractInfo(symbol) -> { tickSize, tickValue } | undefined   (optional; enables currency + tick P&L)

/**
 * @typedef {import('./adapter-contract.js').Fill & { broker?: string, positionId?: any }} FillLike
 * @typedef {(symbol: string) => ({ tickSize?: number, tickValue?: number } | undefined)} ContractInfo
 */
/**
 * A reconstructed position (round-trip). See the field notes inline.
 * @typedef {Object} DerivedPosition
 * @property {string} key
 * @property {string|null} [positionId]  the broker's real position id (hedging accounts); null on netting brokers
 * @property {any} broker
 * @property {any} accountId
 * @property {any} symbol
 * @property {'long'|'short'} side       direction of the OPENING fills
 * @property {number} qty                current net qty (0 = closed, >0 = still open)
 * @property {number} entryQty           total opened qty
 * @property {number} avgEntry           qty-weighted avg entry price
 * @property {number} closedQty          total exited qty
 * @property {number|null} avgExit       qty-weighted avg exit price (null if none)
 * @property {any} entryTime             first fill time (ms)
 * @property {any} exitTime              last fill time (ms)
 * @property {number} commission         sum of fill commissions
 * @property {number} realizedPricePnl   realized P&L in PRICE units (always available)
 * @property {number|null} realizedPnl   realized P&L in CURRENCY when contractInfo gives tickSize+tickValue; else null
 * @property {number|null} ticks         realized ticks when contractInfo present; else null
 * @property {boolean} closed            true when net returned to 0
 * @property {FillLike[]} fills          the constituent fill records, in time order
 */

/** @param {any} s @returns {number} */
const sideSign = (s) => (s === 'sell' || s === 'short' ? -1 : 1);
const EPS = 1e-9;

/**
 * @param {FillLike[]} fills
 * @param {{ contractInfo?: ContractInfo }} [opts]
 * @returns {{ open: DerivedPosition[], closed: DerivedPosition[] }}
 */
export function computePositions(fills, opts = {}) {
  /** @type {ContractInfo} */
  const info = typeof opts.contractInfo === 'function' ? opts.contractInfo : () => undefined;

  // 1) bucket fills by broker:account:symbol (or by positionId when the broker stamps one -- hedging)
  /** @type {Map<string, { key: string, hedged: boolean, list: FillLike[] }>} */
  const buckets = new Map();
  for (const f of fills || []) {
    if (!f || !f.symbol) continue;
    if (Number(f.qty) === 0) continue;                          // skip balance/deposit deals
    const key = f.positionId != null
      ? `${f.broker}:${f.positionId}`
      : `${f.broker}:${f.accountId != null ? f.accountId : ''}:${f.symbol}`;
    if (!buckets.has(key)) buckets.set(key, { key, hedged: f.positionId != null, list: [] });
    buckets.get(key)?.list.push(f);
  }

  // 2) within each bucket, net-0 group into positions
  const open = /** @type {DerivedPosition[]} */ ([]), closed = /** @type {DerivedPosition[]} */ ([]);
  for (const { key, hedged, list } of buckets.values()) {
    list.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

    /** @param {FillLike[]} groupFills @param {boolean} forceClosed */
    const flush = (groupFills, forceClosed) => {
      const pos = buildPosition(key, groupFills, info);
      if (forceClosed || pos.closed) closed.push(pos); else open.push(pos);
    };

    if (hedged) { flush(list, false); continue; }               // broker delineates -> one group per positionId

    let current = [], running = 0;
    for (const f of list) {
      running += sideSign(f.side) * Number(f.qty);
      current.push(f);
      if (Math.abs(running) < EPS) { flush(current, true); current = []; running = 0; }
    }
    if (current.length) flush(current, false);                  // trailing, not yet flat -> open
  }

  /** @param {DerivedPosition} a @param {DerivedPosition} b */
  const byTime = (a, b) => (a.entryTime || 0) - (b.entryTime || 0);
  open.sort(byTime); closed.sort(byTime);
  return { open, closed };
}

// turn one net-0 group of fills into a Position using running AVERAGE-COST netting (the correct model, matching
// .temp/dump_history.py). A fill in the position's direction ADDS (updates the avg cost, realizes nothing); an
// opposite fill REDUCES (realizes P&L on the closed qty vs the running avg cost); a fill that crosses zero closes
// the old side and re-bases the remainder in the new direction. This is what a scalping session (many buys+sells,
// never flat) needs -- the old "leading run = entry, everything after = exit" wrongly booked re-adds as profits.
/** @param {string} key @param {FillLike[]} groupFills @param {ContractInfo} info @returns {DerivedPosition} */
function buildPosition(key, groupFills, info) {
  const first = groupFills[0];

  const ci = /** @type {{ tickSize?: number, tickValue?: number }} */ (info(first.symbol) || {});
  const tickSize = Number(ci.tickSize) || 0, tickValue = Number(ci.tickValue) || 0;
  const canCurrency = tickSize > 0 && tickValue > 0;

  let net = 0, avgCost = 0, entrySideSign = sideSign(first.side);
  let entryQty = 0, entryPxQty = 0, closedQty = 0, exitPxQty = 0;
  let realizedPrice = 0, realizedPnl = 0, ticks = 0, commission = 0;
  let brokerPnl = 0, hasBrokerPnl = false;   // exact per-fill realized P&L from the broker (MT5), when supplied
  const entryTime = first.time; let exitTime = first.time;

  for (const f of groupFills) {
    const q = Number(f.qty), px = Number(f.price), s = sideSign(f.side);
    if (f.commission != null) commission += Number(f.commission) || 0;
    if (f.realizedPnl != null) { brokerPnl += Number(f.realizedPnl) || 0; hasBrokerPnl = true; }
    if (f.time != null) exitTime = f.time;
    if (!(q > 0)) continue;

    if (Math.abs(net) < EPS) {                                  // opening from flat
      avgCost = px; net = s * q; entrySideSign = s;
      entryQty += q; entryPxQty += px * q;
    } else if ((net > 0) === (s > 0)) {                         // same direction -> ADD (re-average, no realize)
      avgCost = (avgCost * Math.abs(net) + px * q) / (Math.abs(net) + q);
      net += s * q;
      entryQty += q; entryPxQty += px * q;
    } else {                                                    // opposite -> REDUCE (realize on the closed qty)
      const closeQ = Math.min(q, Math.abs(net));
      const dirPos = net > 0 ? 1 : -1;
      const priceDiff = dirPos * (px - avgCost);                // profit per unit, in price, vs running avg cost
      realizedPrice += priceDiff * closeQ;
      closedQty += closeQ; exitPxQty += px * closeQ;
      if (canCurrency) { realizedPnl += (priceDiff / tickSize) * tickValue * closeQ; ticks += (priceDiff / tickSize) * closeQ; }
      const oldSign = net > 0 ? 1 : -1;
      net += s * q;
      if (Math.abs(net) >= EPS && (net > 0 ? 1 : -1) !== oldSign) {   // crossed zero -> remainder re-opens the other way
        const remainder = Math.abs(net);
        avgCost = px; entrySideSign = s;
        entryQty += remainder; entryPxQty += px * remainder;
      }
    }
  }

  const avgEntry = entryQty ? entryPxQty / entryQty : 0;
  const closed = Math.abs(net) < EPS;
  return {
    key, broker: first.broker, accountId: first.accountId != null ? first.accountId : null, symbol: first.symbol,
    positionId: first.positionId != null ? String(first.positionId) : null,   // the broker's real position id (hedging); null on netting
    side: entrySideSign < 0 ? 'short' : 'long',
    qty: Math.abs(net),
    entryQty, avgEntry,
    closedQty, avgExit: closedQty ? exitPxQty / closedQty : null,
    entryTime, exitTime,
    commission,
    realizedPricePnl: realizedPrice,
    // exact broker P&L when the fills carry it (MT5), else the tickValue estimate, else null (price-only)
    realizedPnl: hasBrokerPnl ? brokerPnl : (canCurrency ? realizedPnl : null),
    ticks: canCurrency ? ticks : null,
    closed,
    fills: groupFills,
  };
}
