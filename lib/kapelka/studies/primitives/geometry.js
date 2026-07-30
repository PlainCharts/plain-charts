// @ts-check
// time -> x coordinate that works across timeframes. timeToX only resolves times that
// are actual bars in the series, so a 5m anchor would vanish on a 4h pane. Fall back to
// interpolating the time into a fractional logical index against the supplied bar times, then to
// pixels (bar spacing is constant). This keeps shapes/fills pinned through pan/zoom/timeframe.
//
// Decoupled from any app Pane: takes the engine `chart` and the `barTimes` array directly.
/**
 * @param {any} chart  the app engine chart (its timeAxis() coordinate API is a boundary)
 * @param {number[]} barTimes
 * @param {number} time
 * @returns {number|null}
 */
export function timeToX(chart, barTimes, time) {
  const ts = chart.timeAxis();
  const exact = ts.timeToX(time);
  if (exact != null) return exact;
  const times = barTimes;
  if (!times || times.length < 2) return null;
  const n = times.length;
  let logical;
  if (time <= times[0]) {
    const span = times[1] - times[0];
    logical = span > 0 ? (time - times[0]) / span : 0;
  } else if (time >= times[n - 1]) {
    const span = times[n - 1] - times[n - 2];
    logical = n - 1 + (span > 0 ? (time - times[n - 1]) / span : 0);
  } else {
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= time) lo = mid;
      else hi = mid;
    }
    const span = times[hi] - times[lo];
    logical = lo + (span > 0 ? (time - times[lo]) / span : 0);
  }
  // barToX only accepts INTEGER indices, so interpolate in pixels.
  const c0 = ts.barToX(0),
    c1 = ts.barToX(1);
  if (c0 == null || c1 == null) return null;
  return c0 + logical * (c1 - c0);
}
