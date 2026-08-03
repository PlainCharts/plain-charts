// @ts-check
// Order-ticket DOMAIN RULES -- a PURE, import-free leaf (no DOM, no data_engine, no store). This is where the trading
// logic lives so it stays OUT of the form/DOM code and has ONE testable home: the direction a bracket implies, snapping
// a price to an instrument's tick, and (see buildPlaceIntent, added next) assembling the worker place-intent. Everything
// here is a plain function of its arguments; errors are returned as i18n KEYS (the view calls t()), never rendered here.

// A bracket implies a DIRECTION -- Stop BELOW the entry (Target above) is a LONG; Stop ABOVE is a SHORT. Used to gate the
// Buy/Sell buttons (the contradicting one is disabled). Entry = the live market (Market tab) or the order Price
// (Limit/Stop). No entry reference, or no levels yet -> null (both buttons work). Pure.
/** @param {number} entry @param {number} stop @param {number} target @returns {'long'|'short'|null} */
export function sideForSetup(entry, stop, target) {
  if (!(entry > 0)) return null;
  if (stop > 0) return stop < entry ? 'long' : stop > entry ? 'short' : null;
  if (target > 0) return target > entry ? 'long' : target < entry ? 'short' : null;
  return null;
}

// Snap a price onto the instrument's tick grid and round to its decimals (0.25 for an index, 0.0001 for a forex major).
// tick <= 0 (unknown) leaves the value unrounded-to-grid but still decimal-clamped; a non-finite result falls back to the
// input. The single source for what were two identical copies (the dialog stop-writer + the plan->fields mirror). Pure.
/** @param {number} v @param {number} tickSize @param {number|null|undefined} decimals @returns {number} */
export function snapToTick(v, tickSize, decimals) {
  const tick = tickSize > 0 ? Number(tickSize) : 0;
  const dec = decimals != null ? Number(decimals) : 2;
  const x = tick > 0 ? Math.round(Number(v) / tick) * tick : Number(v);
  return Number.isFinite(x) ? Number(x.toFixed(dec)) : Number(v);
}

/**
 * The place-order INTENT the ticket sends to the worker -- ALL the order-shaping rules in one pure function, so the
 * form only gathers state and dispatches. Returns a validated intent, or an error KEY the view renders with t().
 * Rules (identical to the old inline fire() bodies): needs a broker+symbol; a limit/stop needs a price, and a GTD tif
 * needs a resolvable date (good-thru = UTC midnight of it); STAKE mode needs a stake amount AND a stop (the sizing
 * basis) -> it sends the risk intent { risk, stop } and the worker sizes the qty; the bracket is the Stop/Target
 * levels -- always attached on a MARKET order (both account types; the worker omits a 0 leg), but only on a
 * HEDGING account for a limit/stop pending order (netting has no pending-order SL/TP).
 * @param {{ orderType: 'market'|'limit'|'stop', ctx: { broker?: string, symbol?: string, hedging?: boolean }|null,
 *   side: 'buy'|'sell', qty: number, qtType: string, stake: number, sl: number, tp: number,
 *   price?: number, tif?: string, gtdDate?: string }} p
 * @returns {{ ok: true, intent: any } | { ok: false, error: string }}
 */
export function buildPlaceIntent(p) {
  const ctx = p.ctx;
  if (!ctx || !ctx.broker || !ctx.symbol) return { ok: false, error: 'no account / symbol' };
  const isLS = p.orderType === 'limit' || p.orderType === 'stop';
  let goodThru = null;
  if (isLS) {
    if (!(Number(p.price) > 0)) return { ok: false, error: 'enter a price' };
    if (p.tif === 'gtd') {
      const ms = p.gtdDate ? Date.parse(p.gtdDate + 'T00:00:00Z') : NaN;
      if (!Number.isFinite(ms)) return { ok: false, error: 'pick a GTD date' };
      goodThru = ms;
    } // UTC midnight of the date
  }
  const stake = p.qtType === 'stake';
  if (stake && !(p.stake > 0)) return { ok: false, error: 'enter a stake' };
  if (stake && !(p.sl > 0)) return { ok: false, error: 'stake needs a stop' }; // sizing has no meaning without a stop basis
  // MM mode: the WORKER computes the risk itself (its sizing policy) from the stop in the bracket -- the ticket
  // sends no risk number (one authority, never a stale UI copy). It still needs the stop basis to exist.
  if (p.qtType === 'mm' && !(p.sl > 0)) return { ok: false, error: 'money management needs a stop' };
  const sizing = stake ? { risk: p.stake, stop: p.sl } : null;
  // bracket = the Stop/Target fields; always on a market order, hedging-only on a pending order
  const bracketOn = p.orderType === 'market' ? p.sl > 0 || p.tp > 0 : !!ctx.hedging && (p.sl > 0 || p.tp > 0);
  const bracket = bracketOn ? { stopLoss: p.sl, takeProfit: p.tp } : null;
  const base = { type: 'place', ctx, side: p.side, qty: p.qty, bracket, sizing };
  const intent = isLS ? { ...base, orderType: p.orderType, price: p.price, tif: p.tif, goodThru } : base;
  return { ok: true, intent };
}
