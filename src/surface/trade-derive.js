// @ts-check
// Trade Desk derivations -- PURE, no DOM, no store reads. The single home for the desk's P&L rules:
// net-after-commission, the breakeven zone, the running account-balance replay, the stats-strip
// aggregates (closed round-trips), and unrealized P&L at a mark (open positions). Surfaces format;
// this module decides.

/** @typedef {import('../../data_engine/index.js').DerivedPosition} Trade */

// Unrealized P&L for an open position at a mark price. The broker's reported live P&L (hedging lot)
// wins when present -- it is exact. Otherwise: the favorable price move x qty gives POINTS; multiplying
// by the contract's currency-per-point (tickValue / tickSize) gives CURRENCY -- but only when the
// adapter puts tickSize/tickValue on the position. No tick data -> points, so a column always shows something.
/** @param {any} r open position row @param {number|null} mark @returns {{ value: number, currency: boolean }|null} */
export function unrealizedProfit(r, mark) {
  const up = r.unrealizedPnl;
  if (up != null) return { value: Number(up), currency: true };   // broker-reported live P&L (hedging lot) -- exact
  const entry = r.avgPrice, qty = Number(r.qty);
  if (mark == null || entry == null || !qty) return null;
  const sign = r.side === 'short' ? -1 : 1;
  const move = (mark - Number(entry)) * sign * qty;   // total favorable move, in points
  const ts = Number(r.tickSize), tv = Number(r.tickValue);
  return (ts && tv) ? { value: move * (tv / ts), currency: true } : { value: move, currency: false };
}

// a closed trade's NET in account currency: gross realized minus commission (null when no currency P&L)
/** @param {Trade} r @returns {number|null} */
export const netOf = (r) => (r.realizedPnl != null ? r.realizedPnl - (r.commission || 0) : null);

// outcome vs the breakeven zone: above +BE = hit, below -BE = miss, within = breakeven (scratch).
// Answers "did we reach the target?" by degree above BE, so it works without a TP/SL (netting, partials).
/** @param {number} n net currency P&L @param {number} be breakeven threshold @returns {'hit'|'miss'|'be'} */
export const classifyNet = (n, be) => (n > be ? 'hit' : n < -be ? 'miss' : 'be');

// Running BALANCE per trade, anchored to the LIVE account balance (no configured starting balance -- the
// account already carries it). The current balance is AFTER all realized trades, so the base at the start
// of the loaded window is balance - sum(net over loaded closed trades); replaying oldest->newest then makes
// the most recent trade tie out to the live number. Mirrors the reference's balance += net replay, with
// base derived from the account instead of a configured user_balance.
/**
 * @param {Trade[]} closed
 * @param {(acctKey: string) => any} liveBalanceOf  broker:accountId -> live balance (null/undefined = no anchor)
 * @returns {WeakMap<Trade, number>} each trade's ending balance (absent when its account has no anchor)
 */
export function computeRunningBalances(closed, liveBalanceOf) {
  /** @type {WeakMap<Trade, number>} */
  const balances = new WeakMap();
  /** @type {Map<string, Trade[]>} */
  const byAcct = new Map();
  for (const r of closed) { const k = r.broker + ':' + (r.accountId || ''); const g = byAcct.get(k); if (g) g.push(r); else byAcct.set(k, [r]); }
  for (const [k, group] of byAcct) {
    const liveBal = liveBalanceOf(k);
    if (liveBal == null || Number.isNaN(Number(liveBal))) continue;   // no anchor -> balances stay absent
    const chrono = group.slice().sort((a, b) => (Number(a.entryTime) || 0) - (Number(b.entryTime) || 0));   // reference replays by entry time
    let sum = 0; for (const r of chrono) { const n = netOf(r); if (n != null) sum += n; }
    let running = Number(liveBal) - sum;   // balance at the start of the loaded window
    for (const r of chrono) { const n = netOf(r); if (n != null) running += n; balances.set(r, running); }
  }
  return balances;
}

// Stats-strip aggregates over the visible round-trips. Trades are classified by net vs the breakeven zone;
// BE trades are excluded from wins/losses (so hit rate + profit factor count real outcomes only). points =
// per-contract price P&L, matching the Points column (sum of the rows).
/**
 * @param {Trade[]} vis
 * @param {number} be breakeven threshold
 * @returns {{ net: number, points: number, comm: number, wins: number, losses: number, bes: number,
 *   grossWin: number, grossLossAbs: number, trades: number, completed: number,
 *   hitRate: number|null, profitFactor: number|null }}
 */
export function computeTradeStats(vis, be) {
  let net = 0, points = 0, comm = 0, wins = 0, losses = 0, bes = 0, grossWin = 0, grossLossAbs = 0;
  vis.forEach((r) => {
    const n = netOf(r);
    if (n != null) {
      net += n;
      const c = classifyNet(n, be);
      if (c === 'hit') { wins++; grossWin += n; } else if (c === 'miss') { losses++; grossLossAbs += -n; } else { bes++; }
    }
    if (r.realizedPricePnl != null && Number(r.entryQty)) points += Number(r.realizedPricePnl) / Number(r.entryQty);
    comm += Number(r.commission) || 0;
  });
  const trades = vis.length, completed = wins + losses;
  return {
    net, points, comm, wins, losses, bes, grossWin, grossLossAbs, trades, completed,
    hitRate: completed ? (wins / completed) * 100 : null,
    profitFactor: grossLossAbs > 0 ? grossWin / grossLossAbs : (grossWin > 0 ? Infinity : null),
  };
}
