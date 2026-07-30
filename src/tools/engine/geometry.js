// @ts-check
// Coordinate conversion (data <-> screen) and hit-test math for the drawing
// engine. Anchors live in data space {time, price}; the screen positions are
// recomputed every render so drawings stay pinned through pan/zoom/timeframe.

// A pane (and its chart/series/timeAxis handles) is the vendored kapelka engine, untyped here.
/** @typedef {any} Pane */
/** @typedef {any} Series */
// A drawing anchor in data space, and its resolved screen pixel.
/** @typedef {{ time: number, price: number }} DataPoint */
/** @typedef {{ x: number, y: number }} ScreenPoint */

// time -> x coordinate that works across timeframes. timeToX only resolves
// times that are actual bars in THIS series, so a 5m anchor would vanish on a 4h
// pane. Fall back to interpolating the time into a fractional logical index against
// the pane's own bar times, then barToX (which also extrapolates past
// the data). This keeps synced drawings pinned on every timeframe.
/** @param {Pane} pane @param {number} time @returns {number|null} */
export function timeToX(pane, time) {
  const ts = pane.chart.timeAxis();
  const exact = ts.timeToX(time);
  if (exact != null) return exact;
  const times = pane.barTimes;
  if (!times || times.length < 2) return null;
  const n = times.length;
  // fractional logical index for `time` (interpolated/extrapolated against bars)
  let logical;
  if (time <= times[0]) {
    const span = times[1] - times[0];
    logical = span > 0 ? (time - times[0]) / span : 0; // <= 0
  } else if (time >= times[n - 1]) {
    const span = times[n - 1] - times[n - 2];
    logical = n - 1 + (span > 0 ? (time - times[n - 1]) / span : 0); // >= n-1
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
  // barToX only accepts INTEGER indices (a fraction returns 0), so
  // interpolate in pixels: bar spacing is constant, x = coord(0) + logical * barPx.
  const c0 = ts.barToX(0),
    c1 = ts.barToX(1);
  if (c0 == null || c1 == null) return null;
  return c0 + logical * (c1 - c0);
}

// data anchor -> screen pixel {x,y} (CSS px), or null if it maps nowhere on-screen.
// `series` selects the price scale (a sub-pane's series for drawings on that pane);
// defaults to the pane's main candle series. x (time) is shared across all panes.
/** @param {Pane} pane @param {DataPoint} p @param {Series} [series] @returns {ScreenPoint|null} */
export function toScreen(pane, p, series) {
  const x = timeToX(pane, p.time);
  const y = (series || pane.series).priceToY(p.price);
  return x == null || y == null ? null : { x, y };
}

// magnet: snap a cursor (screen x,y) to the nearest OHLC point of the nearest bar.
// 'strong' always snaps; 'weak' snaps only when the cursor is near a candle value.
// Returns the snapped screen {x,y} (x at the bar, y at the price), or the input.
// `series` + `bars` select the surface: the shared time grid (pane.barTimes) gives the
// column under the cursor, then we read that column's OHLC from THIS surface's bar map
// (a sub-pane reads its compare bars) and convert via its price scale. Both default to
// the main pane.
/**
 * @param {Pane} pane @param {number} x @param {number} y @param {string} mode
 * @param {Series} [series] @param {Map<number, any>} [bars]
 * @returns {{ x: number, y: number, price?: number }}
 */
export function magnetSnap(pane, x, y, mode, series, bars) {
  if (!mode || mode === 'off') return { x, y };
  const sers = series || pane.series;
  const ts = pane.chart.timeAxis();
  const l = ts.xToBar(x);
  if (l == null) return { x, y };
  const idx = Math.round(l);
  const times = pane.barTimes || [];
  if (idx < 0 || idx >= times.length) return { x, y };
  // The shared grid (barTimes/barArr) uses DISPLAY times; on daily+ those are ANCHORED to the session
  // open, whereas pane.bars is keyed by NATIVE broker times -- so `pane.bars.get(displayTime)` misses and
  // the magnet dies on daily/weekly/monthly. Read the MAIN pane's OHLC from the indexed display array
  // (barArr), keyed by position not time. The main drawing surface passes pane.bars itself, so route to
  // barArr whenever the surface map IS pane.bars (or absent); only a genuinely different sub-pane surface
  // (e.g. a compare) stays keyed by time.
  const bar = bars && bars !== pane.bars ? bars.get(times[idx]) : pane.barArr && pane.barArr[idx];
  if (!bar) return { x, y };
  const barX = ts.barToX(idx);
  if (barX == null) return { x, y };
  /** @type {{ x: number, y: number, price: number }|null} */
  let best = null;
  let bestDy = Infinity;
  for (const k of ['open', 'high', 'low', 'close']) {
    const v = bar[k];
    if (v == null) continue;
    const py = sers.priceToY(v);
    if (py == null) continue;
    const dy = Math.abs(py - y);
    // carry the EXACT OHLC value v: the caller uses it directly instead of round-tripping py back
    // through yToPrice, which floors to an integer pixel and biases the price up by ~1px worth --
    // a couple of ticks off at forex zoom (one pixel spans several pipettes).
    if (dy < bestDy) {
      bestDy = dy;
      best = { x: barX, y: py, price: v };
    }
  }
  if (!best) return { x, y };
  if (mode === 'weak' && bestDy > 14) return { x, y }; // weak: only when near a candle point
  return best;
}

// round a screen x to the nearest bar's x on this pane — for snapToBar tools (e.g.
// the vertical line), so the anchor sits on a bar and jumps in this pane's bar
// increments rather than floating between bars.
/** @param {Pane} pane @param {number} x @returns {number} */
export function snapXToBar(pane, x) {
  const ts = pane.chart.timeAxis();
  const l = ts.xToBar(x);
  if (l == null) return x;
  const cx = ts.barToX(Math.round(l));
  return cx == null ? x : cx;
}

// screen pixel -> data anchor {time, price}. In the whitespace past the last bar
// (or before the first) xToTime is null, so extrapolate a time from the
// logical index using the bar spacing — this lets drawings extend into empty space
// and round-trips exactly with timeToX (which interpolates the same way).
// `series` selects the price scale (sub-pane aware); defaults to the main series.
/** @param {Pane} pane @param {number} x @param {number} y @param {Series} [series] @returns {{ time: number|null, price: number|null }} */
export function toData(pane, x, y, series) {
  const ts = pane.chart.timeAxis();
  let time = ts.xToTime(x);
  if (time == null) {
    const times = pane.barTimes,
      l = ts.xToBar(x);
    if (l != null && times && times.length >= 2) {
      const n = times.length;
      if (l >= n - 1) time = Math.round(times[n - 1] + (l - (n - 1)) * (times[n - 1] - times[n - 2]));
      else if (l <= 0) time = Math.round(times[0] + l * (times[1] - times[0]));
      else {
        const lo = Math.floor(l);
        time = Math.round(times[lo] + (l - lo) * (times[lo + 1] - times[lo]));
      }
    } else {
      const r = ts.timeWindow();
      if (r) time = x < 0 ? r.from : r.to;
    }
  }
  const price = (series || pane.series).yToPrice(y);
  return { time, price };
}

// Hit-test helpers exposed to tool files via window.Tools.geom, so a shape's
// hitTest() can be written without importing anything.
export const geom = {
  /** @param {number} ax @param {number} ay @param {number} bx @param {number} by @returns {number} */
  dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
  /** @param {number} px @param {number} py @param {number} ax @param {number} ay @param {number} bx @param {number} by @returns {number} */
  distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax,
      dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  },
  /** @param {number} px @param {number} py @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @returns {boolean} */
  pointInRect: (px, py, x1, y1, x2, y2) =>
    px >= Math.min(x1, x2) && px <= Math.max(x1, x2) && py >= Math.min(y1, y2) && py <= Math.max(y1, y2),
};
