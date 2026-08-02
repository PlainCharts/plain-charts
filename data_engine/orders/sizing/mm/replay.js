// @ts-check
// Replay driver -- reconstruct the money-management state from an account's closed-trade history.
// Pure and deterministic: no persisted state. Walk the closed round-trip nets oldest-first against the
// starting balance; the running balance positions the zone window, and the ladder state falls out of the
// same pass. This is what the order worker calls to get the next trade's risk, and what the Money Man tab
// renders. replayTrace additionally records EVERY step so the tab can explain how it got here.
import { CascadeMM } from './cascade.js';
import { ZoneManager } from './zones.js';
import { applyTrade } from './combined.js';

/**
 * @typedef {Object} MmConfig
 * @property {number} origin       starting balance (from the account)
 * @property {number} increment    grid step
 * @property {number} maxDd        max drawdown -> hard floor
 * @property {number} baseMaxPct   BASE-zone ceiling percent
 * @property {number} shotMaxPct   SHOT-zone ceiling percent
 * @property {number} beThreshold  breakeven dollar band
 */

/** A plain snapshot of the current state. @param {CascadeMM} mm @param {ZoneManager} zm @param {number} balance */
function snapshot(mm, zm, balance) {
  const zone = zm.zone(balance);
  return {
    balance,
    zone, // STOP | FLOOR | BASE | SHOT
    origin: zm.origin,
    hardFloor: zm.hardFloor,
    bands: zm.lines(), // { hardFloor, origin, baseBottom, shotBottom, shotTop }
    level: mm.levelName, // MIN | MID | MAX
    levelPct: mm.currentPct(balance),
    ceiling: zm.activeMaxPct(balance),
    progress: mm.progress,
    gateToNext: mm.currentLevel < CascadeMM.MAX ? mm.gateInto(mm.currentLevel + 1, balance) : 0,
    risk: mm.riskUsd(balance), // the $ that feeds sizeFromStake (MIN via base override in FLOOR/STOP)
    tradable: zm.tradable(balance), // false below the hard floor (informational)
  };
}

/** Fresh engine instances for a config. @param {MmConfig} cfg */
function build(cfg) {
  return {
    zm: new ZoneManager(cfg.origin, cfg.increment, cfg.maxDd, cfg.baseMaxPct, cfg.shotMaxPct),
    mm: new CascadeMM(cfg.baseMaxPct, cfg.origin, cfg.beThreshold),
  };
}

/**
 * Replay the history and return the live engine instances plus the running balance.
 * @param {MmConfig} cfg @param {number[]} trades closed round-trip nets, oldest first
 * @returns {{ mm: CascadeMM, zm: ZoneManager, balance: number }}
 */
export function replay(cfg, trades) {
  const { mm, zm } = build(cfg);
  let balance = cfg.origin;
  for (const net of trades) {
    balance += net;
    applyTrade(mm, zm, net, balance);
  }
  return { mm, zm, balance };
}

/** The current money-management state -- the snapshot the worker (reads `risk`) and the UI use.
 *  @param {MmConfig} cfg @param {number[]} trades */
export function mmState(cfg, trades) {
  const { mm, zm, balance } = replay(cfg, trades);
  return snapshot(mm, zm, balance);
}

/**
 * @typedef {Object} TraceStep
 * @property {number} i        1-based trade number
 * @property {number} net      the trade's net
 * @property {number} balance  running balance after it
 * @property {string} zone     zone after it
 * @property {string} prevZone zone before it
 * @property {string} level    ladder level after it
 * @property {number} ceiling  active ceiling % after it
 * @property {number} risk     next-trade risk$ after it
 * @property {'stop'|'floor'|'climb'|'drop'|'hold'} move   what the ladder did
 * @property {boolean} slid    did the zone window slide on this trade
 */

/**
 * Replay AND record every step, so the tab can explain how it reached the current state. Same math as replay;
 * it just keeps a trace. @param {MmConfig} cfg @param {number[]} trades
 * @returns {{ trace: TraceStep[], state: ReturnType<typeof snapshot> }}
 */
export function replayTrace(cfg, trades) {
  const { mm, zm } = build(cfg);
  let balance = cfg.origin;
  let prevZone = zm.zone(balance);
  /** @type {TraceStep[]} */
  const trace = [];
  let i = 0;
  for (const net of trades) {
    i += 1;
    balance += net;
    const prevL = zm.L;
    const { zone, move } = applyTrade(mm, zm, net, balance);
    trace.push({
      i,
      net,
      balance,
      zone,
      prevZone,
      level: mm.levelName,
      ceiling: zm.activeMaxPct(balance),
      risk: mm.riskUsd(balance),
      move,
      slid: zm.L !== prevL,
    });
    prevZone = zone;
  }
  return { trace, state: snapshot(mm, zm, balance) };
}
