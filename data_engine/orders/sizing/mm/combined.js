// @ts-check
// Combined policy -- how the zone window and the cascade ladder work together on a single trade. Pure logic.
//
// The zone sets the ceiling; the ladder LEVEL carries across zones (only the ceiling swaps, no re-base):
//   STOP   -> no ladder change (sizing stays at MIN via the cascade's base override); informational
//   FLOOR  -> ladder forced to MIN, progress 0 (frozen)
//   BASE / SHOT -> set the ceiling to that zone's max%, then run the ladder
import { CascadeMM } from './cascade.js';
import { ZoneManager } from './zones.js';

/** Set the cascade ceiling; MID/MIN are derived by halving. @param {CascadeMM} mm @param {number} ceiling */
export function setCeiling(mm, ceiling) {
  mm.maxPct = ceiling;
  mm.midPct = ceiling / 2.0;
  mm.minPct = ceiling / 4.0;
}

/** Slide the window to the balance and set the cascade ceiling to the zone's max%. Returns the zone.
 *  @param {CascadeMM} mm @param {ZoneManager} zm @param {number} balance @returns {string} */
export function applyCeiling(mm, zm, balance) {
  zm.update(balance);
  setCeiling(mm, zm.activeMaxPct(balance));
  return zm.zone(balance);
}

/**
 * Apply one closed trade to the combined state. `balance` is the account balance AFTER the trade's net.
 * Mutates mm and zm. Returns the resolved zone and the ladder move.
 * @param {CascadeMM} mm @param {ZoneManager} zm @param {number} net @param {number} balance
 * @returns {{ zone: string, move: 'stop'|'floor'|'climb'|'drop'|'hold' }}
 */
export function applyTrade(mm, zm, net, balance) {
  zm.update(balance);
  const zone = zm.zone(balance);
  if (zone === ZoneManager.STOP) return { zone, move: 'stop' }; // no ladder change; MIN holds via base override
  setCeiling(mm, zm.activeMaxPct(balance));
  if (zone === ZoneManager.FLOOR) {
    mm.currentLevel = CascadeMM.MIN;
    mm.progress = 0.0;
    return { zone, move: 'floor' };
  }
  const r = mm.recordTrade(net, balance);
  return { zone, move: r.climbed ? 'climb' : r.dropped ? 'drop' : 'hold' };
}
