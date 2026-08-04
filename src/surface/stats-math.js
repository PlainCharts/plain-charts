// @ts-check
// The Stats tab's statistical layer (edge / variance / equity), layered ON TOP of the desk's shared trade
// stats. compute() merges the two: computeTradeStats (trades/win/BE/loss -- the desk's own rule, unchanged)
// plus the dispersion/equity numbers this tab adds. avg win/loss are DERIVED from the gross/win counts, not
// re-classified. No trade-classification rule is reinvented here -- it reads trade-derive.js like History does.
import { computeTradeStats, netOf } from './trade-derive.js';

/** @typedef {{ x: number, y: number }} CurvePoint */

// A normal-distribution curve from a mean and std: sampled points {x, y=density} across +/- span sigma.
/** @param {number} mean @param {number} std @param {number} [span] @param {number} [steps] @returns {CurvePoint[]} */
export function normalCurve(mean, std, span = 4, steps = 160) {
  if (!(std > 0)) return [];
  const lo = mean - span * std,
    hi = mean + span * std,
    k = 1 / (std * Math.sqrt(2 * Math.PI));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    const z = (x - mean) / std;
    pts.push({ x, y: k * Math.exp(-0.5 * z * z) });
  }
  for (const bx of [mean - std, mean + std]) {
    const z = (bx - mean) / std;
    pts.push({ x: bx, y: k * Math.exp(-0.5 * z * z) });
  }
  return pts.sort((a, b) => a.x - b.x);
}

/** @typedef {{ i: number, pnl: number }} EquityPoint */
/**
 * @typedef {{ mean: number, variance: number, std: number, sharpe: number, maxDd: number,
 *   equity: EquityPoint[] }} Additions
 */

// Dispersion + equity over the trade nets (the new statistical layer).
/** @param {number[]} nets @returns {Additions} */
function additions(nets) {
  const n = nets.length;
  if (!n) return { mean: 0, variance: 0, std: 0, sharpe: 0, maxDd: 0, equity: [] };
  const sum = nets.reduce((a, b) => a + b, 0);
  const mean = sum / n; // EV per trade
  const variance = nets.reduce((a, b) => a + b * b, 0) / n - mean * mean; // E[X^2] - E[X]^2
  const std = Math.sqrt(Math.max(0, variance));
  const sharpe = std > 0 ? mean / std : 0; // per-trade Sharpe (no annualization)
  let peak = 0,
    maxDd = 0,
    run = 0;
  /** @type {EquityPoint[]} */
  const equity = [];
  nets.forEach((x, i) => {
    run += x;
    equity.push({ i: i + 1, pnl: run });
    if (run > peak) peak = run;
    if (peak - run > maxDd) maxDd = peak - run;
  });
  return { mean, variance, std, sharpe, maxDd, equity };
}

/** The full stats object for the board: shared trade stats + the new statistical layer. USD only -- every
 *  value comes from the win/loss gross outcomes, needs no stop, and is exact.
 *  @param {any[]} records @param {number} be breakeven threshold
 *  @returns {ReturnType<typeof computeTradeStats> & Additions & { avgWin: number, avgLossAbs: number,
 *    winPct: number, lossPct: number, bePct: number, maxLossStreak: number }} */
export function compute(records, be) {
  const t = computeTradeStats(records, be); // the desk's shared rule
  const nets = /** @type {number[]} */ (records.map(netOf).filter((n) => n != null));
  const a = additions(nets);
  // derived from the gross/win counts -- not a new classification
  const avgWin = t.wins ? t.grossWin / t.wins : 0;
  const avgLossAbs = t.losses ? t.grossLossAbs / t.losses : 0;
  const winPct = t.trades ? t.wins / t.trades : 0; // of TOTAL trades
  const lossPct = t.trades ? t.losses / t.trades : 0;
  const bePct = t.trades ? t.bes / t.trades : 0; // scratched (within +/-BE); win% + loss% + be% = 100%
  // Max loss streak: longest run of consecutive LOSSES (misses). A hit or a breakeven ends the run --
  // a BE is not a loss. Order-dependent, like max drawdown.
  let streak = 0,
    maxLossStreak = 0;
  for (const r of records) {
    const n = netOf(r);
    if (n == null) continue;
    if (n < -be) {
      streak += 1;
      if (streak > maxLossStreak) maxLossStreak = streak;
    } else streak = 0;
  }
  return { ...t, ...a, avgWin, avgLossAbs, winPct, lossPct, bePct, maxLossStreak };
}
