// @ts-check
// Pure classifier for the redraw fast path: does an ingest batch only touch the LAST bar?
// A live tick is a replace-in-place of the forming bar or a strictly-newer append -- those
// become ops the pane can apply incrementally (patch the sorted arrays + feedBar). Anything
// else (first fill, prepend, closed-bar correction) demands the full rebuild. Runs BEFORE the
// batch is written into the bars map: `prev` lookups need the pre-mutation state.

/** @typedef {import('../../../data_engine/index.js').Bar} Bar */

/**
 * @param {Map<number, Bar>} bars loaded bars keyed by native time (pre-mutation)
 * @param {number|null} lastT last-bar time the accumulator works from (null = fast path unavailable)
 * @param {Bar[]} batch incoming bars, invalid entries already filtered out
 * @returns {{ ops: Bar[]|'full', lastT: number|null }} ops in arrival order; 'full' = rebuild
 */
export function classifyTicks(bars, lastT, batch) {
  /** @type {Bar[]} */
  const ops = [];
  for (const b of batch) {
    if (lastT == null) return { ops: 'full', lastT: null };
    const prev = bars.get(b.time);
    const same =
      prev &&
      prev.open === b.open &&
      prev.high === b.high &&
      prev.low === b.low &&
      prev.close === b.close &&
      prev.volume === b.volume;
    if (same) continue; // identical re-send -> no-op
    if (b.time === lastT)
      ops.push(b); // forming-bar replace
    else if (b.time > lastT) {
      ops.push(b);
      lastT = b.time;
    } // append (multi-append stays in order)
    else return { ops: 'full', lastT: null }; // older bar changed -> rebuild
  }
  return { ops, lastT };
}
