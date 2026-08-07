// @ts-check
// STOP AUTO-SIZE decision -- pure. A netting position's protective stop must cover the whole net, but only
// when there is exactly ONE working stop to own that job (the rule's original case: an add or a partial
// close with a lone resting stop). Several working stops share the job by SUMMING their coverage: a broker's
// server-side per-tranche OCO children (a resting bracket entry that filled in pieces) or a hand-built
// ladder. Sum == net is healthy -- touch nothing. Sum != net with several stops is OBSERVED, never "fixed":
// resizing each to the net multiplies coverage (a 4-lot short once ended up with 12 contracts of stop when
// every 1/1/2 tranche stop was inflated to 4). Kept as a pure leaf so the rule is testable in Node.
import { isTerminal } from '../data/adapter-contract.js';

/**
 * Decide the stop-sizing actions for the current book.
 * @param {any[]} positions  platform.positions.all()
 * @param {any[]} lots       platform.positionLots.all() (any open lot = hedging -> skipped)
 * @param {any[]} orders     platform.orders.all()
 * @returns {{ resize: { broker:string, id:any, qty:number, from:number }[],
 *             flag: { broker:string, symbol:string, sum:number, want:number, count:number }[] }}
 */
export function planStopSizing(positions, lots, orders) {
  /** @type {{ broker:string, id:any, qty:number, from:number }[]} */
  const resize = [];
  /** @type {{ broker:string, symbol:string, sum:number, want:number, count:number }[]} */
  const flag = [];
  for (const p of positions || []) {
    if (!p || !(Number(p.qty) > 0)) continue;
    if ((lots || []).some((l) => l && l.broker === p.broker && l.symbol === p.symbol && Number(l.qty) > 0)) continue; // hedging -> ticket-linked stops
    const want = Number(p.qty);
    const exitSide = p.side === 'long' ? 'sell' : 'buy';
    const stops = (orders || []).filter(
      (o) =>
        o &&
        o.broker === p.broker &&
        o.symbol === p.symbol &&
        !isTerminal(o.status) &&
        o.type === 'stop' &&
        o.side === exitSide,
    );
    if (!stops.length) continue;
    const sum = stops.reduce((s, o) => s + (Number(o.qty) || 0), 0);
    if (sum === want) continue; // covered exactly (one right-sized stop, or tranches that sum to the net)
    if (stops.length > 1) {
      flag.push({ broker: p.broker, symbol: p.symbol, sum, want, count: stops.length });
      continue;
    }
    resize.push({ broker: p.broker, id: stops[0].id, qty: want, from: Number(stops[0].qty) || 0 });
  }
  return { resize, flag };
}
