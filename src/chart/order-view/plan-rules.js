// @ts-check
// PLANNING rules -- the pure geometry of a pre-trade bracket. NO store, NO drawing, NO broker, NO live orders: just the
// maths that decides where a plan's stop / target / direction sit relative to the entry. It lives on its own so the
// planning logic is not tangled into the overlay's store I/O or into LIVE trade handling. The caller does the tick
// snapping and the store writes; this only computes.

/**
 * Dragging rung 0's STOP. The side is implied by where the stop lands relative to the entry pivot (below = long,
 * above = short); the target must sit on the PROFIT side of the pivot (long: above, short: below) -- if the
 * resolved direction leaves it on the wrong side (a flip, or a first stop placed against an existing target),
 * it MIRRORS across the pivot. Pure.
 * @param {number} stop  the stop price (already positioned)
 * @param {number} ref   the entry pivot
 * @param {string|null|undefined} _curDir  the prior direction (unused -- the stop's side alone resolves it)
 * @param {number|null|undefined} curTarget  the current rung-0 target
 * @returns {{ stop: number, target: number|null, dir: 'long'|'short' }}
 */
export function stopDragFlip(stop, ref, _curDir, curTarget) {
  const dir = stop < ref ? 'long' : 'short';
  const wrongSide = curTarget != null && (dir === 'long' ? Number(curTarget) < ref : Number(curTarget) > ref);
  const target = curTarget == null ? null : (wrongSide ? 2 * ref - Number(curTarget) : Number(curTarget));   // keep the target on the profit side
  return { stop, target, dir };
}
