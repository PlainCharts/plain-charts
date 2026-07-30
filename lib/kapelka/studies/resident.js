// @ts-check
// Resident dataset for the study worker.
//
// The worker OWNS the bars and the intrabar sub-bars between recomputes, instead of receiving a full
// snapshot on every exec. The host syncs the data once per data-change (not once per study): it replaces
// the bars (small) and appends only NEW sub-bars (the live delta, not the whole cache). An exec then
// carries only { studyId, params, meta } -- no data crosses the wire, so N studies cost one small sync,
// not N megabyte clones. This module is the pure reducer for that resident state, testable off the worker.
//
// Bars and sub-bars are Bar objects { time, open, high, low, close, volume } keyed by time (monotonic).
// Bucketing sub-bars against chart bars stays in channels.js and runs at exec time inside the worker --
// the resident state holds the RAW sub-bars, never the bucketed payload.

/** @typedef {import('../core/types.js').Bar} Bar */
/**
 * @typedef {(
 *   | { type: 'set-bars', bars: Bar[] }
 *   | { type: 'update-forming-bar', bar: Bar }
 *   | { type: 'append-bar', bar: Bar }
 *   | { type: 'append-intrabar', tf: string, sub: Bar[] }
 *   | { type: 'reset' }
 * )} ResidentMsg
 */
/** @typedef {{ bars: Bar[], sub: Record<string, Bar[]> }} Resident */

/** @returns {Resident} a fresh, empty resident dataset */
export function createResident() {
  return { bars: [], sub: {} };
}

/** bar time (asserted number; bar times are always present in the resident stream) @param {Bar} b */
const T2 = (b) => /** @type {number} */ (b.time);

/** Merge incoming sub-bars into a resident series by time, IN PLACE (the caller holds this array ref), kept
 *  sorted and DEDUPED by time -- the same semantics as channels.js `mergeBars`, which the host uses for its
 *  own cache, so the worker's resident sub-bars stay byte-for-byte identical to the host's.
 *
 *  Dedup is not optional: a live feed re-sends the forming sub-bar every tick (often several times, sometimes
 *  duplicated within one batch), and the last chart bar's bucket is open-ended -- so any same-time row left
 *  un-collapsed piles into that bucket and inflates the forming bar without bound. A key-by-time Map every
 *  merge is the only safe rule; incoming wins on a tie (it carries the latest volume).
 *  @param {Bar[]} cur @param {Bar[]} inc @returns {Bar[]} */
function mergeByTime(cur, inc) {
  if (!inc.length) return cur;
  const T = (/** @type {Bar} */ b) => /** @type {number} */ (b.time);
  /** @type {Map<number, Bar>} */
  const map = new Map();
  for (const r of cur) map.set(T(r), r);
  for (const r of inc) map.set(T(r), r); // incoming wins on same time (the forming sub-bar's latest reading)
  const merged = [...map.values()].sort((a, b) => T(a) - T(b));
  cur.length = 0;
  for (const r of merged) cur.push(r); // rewrite in place: the resident state holds this ref
  return cur;
}

/** Apply one transport message to the resident state (mutates + returns it). Throws on an unknown type,
 *  so a legacy snapshot message can never be silently swallowed.
 *  @param {Resident} state @param {ResidentMsg} msg @returns {Resident} */
export function applyResident(state, msg) {
  if (!msg) throw new Error('resident: empty message');
  switch (msg.type) {
    case 'set-bars': // full replace (first load, symbol change, backfill) -> the worker recomputes fully
      state.bars = msg.bars || [];
      return state;

    case 'update-forming-bar': {
      // a live tick on the forming (last) bar -> replace it in place
      const b = msg.bar,
        n = state.bars.length;
      if (b) {
        if (n && T2(state.bars[n - 1]) === T2(b)) state.bars[n - 1] = b;
        else if (!n || T2(b) > T2(state.bars[n - 1])) state.bars.push(b);
      }
      return state;
    }

    case 'append-bar': {
      // a bar closed and a new one opened -> push it (the prior last was finalized first)
      const b = msg.bar,
        n = state.bars.length;
      if (b) {
        if (!n || T2(b) > T2(state.bars[n - 1])) state.bars.push(b);
        else if (T2(state.bars[n - 1]) === T2(b)) state.bars[n - 1] = b;
      }
      return state;
    }

    case 'append-intrabar': {
      // sub-bars for a lower timeframe: the live delta (or the initial windowed fetch)
      const cur = state.sub[msg.tf] || (state.sub[msg.tf] = []);
      mergeByTime(cur, msg.sub || []);
      return state;
    }

    case 'reset': // symbol / timeframe change: drop everything, await a fresh sync
      state.bars = [];
      state.sub = {};
      return state;

    default:
      throw new Error('resident: unknown message type: ' + (msg && /** @type {any} */ (msg).type));
  }
}
