// @ts-check
// Time / index / zoom / range cluster, lifted out of the Chart shell (index.js). Every entry takes
// the chart reference `c` -- the engine hub (_range/_ib/_g/_series/_options/_ds/_iv/_invalidate...).
// Four groups: layout-unit <-> time/logical coordinate transforms; fit-to-data + append auto-scroll;
// the zoom-bound clamps the native input wiring drives; and the public timeAxis() API object. The
// Chart keeps thin delegators so its own render loop AND external callers (input.js / series.js /
// events.js) reach these unchanged. Bodies are the author/shell logic verbatim -- only `this` -> `c`.
import Const from './stuff/constants.js';
import { isOverlayId } from './overlay-scales.js';

// layout-units <-> real time (ms). Identity in regular mode (t2i needs the ib guard; i2t is already
// identity when ti_map.ib is false). In ib mode: index <-> time via the author's ti_mapping.
/** @param {any} c @param {number} v @returns {number} */
export function i2t(c, v) { const g = c._g; return (c._ib && g && g.ti_map) ? g.ti_map.i2t(v) : v; }
/** @param {any} c @param {number} v @returns {number} */
export function t2i(c, v) { const g = c._g; return (c._ib && g && g.ti_map) ? g.ti_map.t2i(v) : v; }

// logical coordinate = fractional bar index into the candlestick data (works in any mode,
// extrapolating past the ends by one interval per bar — matches the right-offset whitespace).
/** @param {any} c @param {number} t @returns {number} */
export function timeToLogical(c, t) {
  const cs = c._ds(); if (!cs) return 0;
  const d = cs._rows, n = d.length, iv = c._iv(); if (!n) return 0;
  if (t <= d[0][0]) return (t - d[0][0]) / iv;
  if (t >= d[n - 1][0]) return (n - 1) + (t - d[n - 1][0]) / iv;
  let lo = 0, hi = n - 1; while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (d[m][0] <= t) lo = m; else hi = m; }
  return lo + (t - d[lo][0]) / ((d[lo + 1][0] - d[lo][0]) || iv);
}
/** @param {any} c @param {number} i @returns {number} */
export function logicalToTime(c, i) {
  const cs = c._ds(); if (!cs) return 0;
  const d = cs._rows, n = d.length, iv = c._iv(); if (!n) return 0;
  if (i <= 0) return d[0][0] + i * iv;
  if (i >= n - 1) return d[n - 1][0] + (i - (n - 1)) * iv;
  const k = Math.floor(i); return d[k][0] + (i - k) * ((d[k + 1][0] - d[k][0]) || iv);
}

/** @param {any} c */
export function fitToData(c) {
  const cs = c._ds(); if (!cs) return;
  const d = cs._rows, n = d.length;
  const off = c._options.timeAxis.rightOffset != null ? c._options.timeAxis.rightOffset : 6;   // 0 = flush
  // Keep a full-width span even when few bars exist: pin the newest bar at the right and let the
  // left fill with whitespace (mirrors right-offset whitespace; consumption is clamped to index 0
  // at _visibleRows). Clamping the left to the first bar/index instead COLLAPSED the span, so a
  // thin startup batch (a session that just reopened, a lazy symbol's first tiny report) stretched
  // 1-4 candles across the whole chart -- the startup overzoom flash before the full history refit.
  if (c._ib) {   // index units: last index = n-1 (array position)
    const i1 = (n - 1) + off;
    c._range = [i1 - 150, i1];
    return;
  }
  const last = d[n - 1][0], iv = c._iv();
  const t1 = last + off * iv;
  c._range = [t1 - 150 * iv, t1];
}

// Newer bar(s) reached the main candle series (via feedBar() append OR feed() with an advanced last
// bar): auto-scroll the view so the latest bar stays visible (followNewBars)
// — but ONLY while we were following the right edge; if the user scrolled back into
// history the view stays put. `oldLastTime` = the last bar's time (ms) BEFORE the update. Forming-bar
// updates (same last time) don't scroll.
/** @param {any} c @param {import('./series.js').Series} s  @param {number|null} oldLastTime */
export function autoScrollAppend(c, s, oldLastTime) {
  if (!c._range || s !== c._ds() || oldLastTime == null) return;
  if (c._options.timeAxis && c._options.timeAxis.followNewBars === false) return;
  const rows = s._rows, n = rows.length; if (!n) return;
  if (rows[n - 1][0] <= oldLastTime) return;   // no genuine append (forming bar / reorder)
  if (c._ib) {
    let appended = 0; for (let i = n - 1; i >= 0 && rows[i][0] > oldLastTime; i--) appended++;   // count new bars
    const oldLastIdx = (n - 1) - appended;
    if (c._range[1] >= oldLastIdx) { c._range = [c._range[0] + appended, c._range[1] + appended]; c._emitRange(); }
  } else if (c._range[1] >= oldLastTime) {
    const d = rows[n - 1][0] - oldLastTime; c._range = [c._range[0] + d, c._range[1] + d]; c._emitRange();
  }
}

/** @param {any} c */
export function emitRange(c) {
  const ts = c.timeAxis();
  const tr = ts.timeWindow(); c._cbs.range.forEach((/** @type {Function} */ cb) => { try { cb(tr); } catch (_) {} });
  const lr = ts.barWindow(); c._cbs.logical.forEach((/** @type {Function} */ cb) => { try { cb(lr); } catch (_) {} });
}

// Zoom bounds in bars: maxZoom (most bars on screen = max over-compression) and minZoom (fewest
// bars = widest candles). User-settable via chart options; default to the author's Const.ChartConfig.
/** @param {any} c */
export function maxZoom(c) { const v = c._options.maxZoom; return v > 0 ? v : Const.ChartConfig.MAX_ZOOM; }
/** @param {any} c */
export function minZoom(c) { const v = c._options.minZoom; return v > 0 ? v : Const.ChartConfig.MIN_ZOOM; }
// Vertical zoom-out cap: the visible price span may not exceed maxVZoom x the visible DATA range.
// A ratio (not an absolute price), so it is instrument-agnostic. 0/unset -> default 15.
/** @param {any} c */
export function maxVZoom(c) { const v = c._options.maxVZoom; return v > 0 ? v : 3; }

// visible high/low of a pane's main series over the current window -- the data range the price
// scale would auto-fit to, and the divisor for the vertical over-compression clamp. id = pane ID.
/** @param {any} c @param {number} id pane ID @returns {number[]|null} [hi, lo] */
export function visibleHiLo(c, id) {
  const main = c._series.find((/** @type {any} */ s) => s._pane === id && s._isCandle() && s._rows.length)
            || c._series.find((/** @type {any} */ s) => s._pane === id && s._rows.length && !isOverlayId(s._priceScaleId));
  if (!main || !c._range) return null;
  const rows = main._rows, n = rows.length, cand = main._isCandle();
  let hi = -Infinity, lo = Infinity;
  if (c._ib) {
    const a = Math.max(0, Math.floor(c._range[0])), b = Math.min(n - 1, Math.ceil(c._range[1]));
    for (let i = a; i <= b; i++) { const r = rows[i]; if (cand) { if (r[2] > hi) hi = r[2]; if (r[3] < lo) lo = r[3]; } else { const v = r[1]; if (v > hi) hi = v; if (v < lo) lo = v; } }
  } else {
    const t0 = c._range[0], t1 = c._range[1];
    for (const r of rows) { if (r[0] < t0 || r[0] > t1) continue; if (cand) { if (r[2] > hi) hi = r[2]; if (r[3] < lo) lo = r[3]; } else { const v = r[1]; if (v > hi) hi = v; if (v < lo) lo = v; } }
  }
  return (isFinite(hi) && isFinite(lo) && hi > lo) ? [hi, lo] : null;
}

// Vertical over-compression clamp: cap a proposed price window [hi, lo] so its span can't exceed
// maxVZoom x the visible data range, shrinking a too-wide window around its centre. Returns range
// unchanged when there is no data range to measure against (nothing to over-compress).
/** @param {any} c @param {number[]|null} range [hi, lo] @param {number} id pane ID @returns {number[]|null} */
export function clampVZoom(c, range, id) {
  if (!range) return range;
  const dr = c._visibleHiLo(id); if (!dr) return range;
  const dSpan = dr[0] - dr[1]; if (!(dSpan > 0)) return range;
  const hi = range[0], lo = range[1], span = hi - lo; if (!(span > 0)) return range;
  const max = c._maxVZoom() * dSpan;
  if (span <= max) return range;
  const cen = (hi + lo) / 2;
  return [cen + max / 2, cen - max / 2];
}

// Compression bounds: refuse to over-compress past maxZoom bars or over-zoom below minZoom.
// _range is in INDEX units in ib mode (so span === bar count) and in MS otherwise (count =
// span / interval). Clamps the span while keeping the anchor's relative position fixed.
/** @param {any} c @param {[number, number]|null} r [t0, t1] @param {number} [anchor] @returns {[number, number]|null} */
export function clampZoom(c, r, anchor) {
  if (!r) return r;
  const a = r[0], b = r[1], span = b - a;
  if (!(span > 0)) return r;
  const unit = c._ib ? 1 : c._iv();
  const max = c._maxZoom() * unit, min = c._minZoom() * unit;
  let want = span;
  if (span > max) want = max; else if (span < min) want = min; else return r;
  const anc = (anchor != null && anchor >= a && anchor <= b) ? anchor : (a + b) / 2;
  const left = (anc - a) / span;
  return [anc - left * want, anc + (1 - left) * want];
}

// The author's this.data.length: how many real bars are currently in view. Drives the zoom
// guards (MAX_ZOOM / MIN_ZOOM). ib: count indices in range clamped to data; otherwise count
// rows whose time falls in [range0, range1].
/** @param {any} c */
export function visibleCount(c) {
  const cs = c._ds(); if (!cs || !c._range) return 0;
  const rows = cs._rows, n = rows.length; if (n < 1) return 0;
  if (c._ib) {
    const a = Math.max(0, Math.ceil(c._range[0]));
    const b = Math.min(n - 1, Math.floor(c._range[1]));
    return Math.max(0, b - a + 1);
  }
  const lb = (/** @type {number} */ t) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m][0] < t) lo = m + 1; else hi = m; } return lo; };
  return Math.max(0, lb(c._range[1]) - lb(c._range[0]));
}

// The public time-scale API object (chart.timeAxis()). Body is the shell's verbatim -- it already
// closed over `c = this`; here `c` is the parameter.
/** @param {any} c @returns {any} */
export function timeAxisApi(c) {
  return {
    // ib: convert time<->index via the candle DATA (_logicalToTime/_timeToLogical), NOT ti_map —
    // works before the first layout exists (the app restores a saved range right after feed).
    timeWindow: () => (!c._range ? null : (c._ib ? { from: c._logicalToTime(c._range[0]) / 1000, to: c._logicalToTime(c._range[1]) / 1000 } : { from: c._range[0] / 1000, to: c._range[1] / 1000 })),
    setTimeWindow: (/** @type {{ from: number, to: number }|null} */ r) => { if (!r) return; c._range = c._ib ? [c._timeToLogical(r.from * 1000), c._timeToLogical(r.to * 1000)] : [r.from * 1000, r.to * 1000]; c._invalidate(); },
    // like setTimeWindow but CLAMPS the zoom and EMITS the range change (so sync + viewport studies react) --
    // for a user zoom-to-area, not the silent programmatic sync that setTimeWindow is used for.
    zoomTimeWindow: (/** @type {{ from: number, to: number }|null} */ r) => { if (!r) return; c._range = c._clampZoom(c._ib ? [c._timeToLogical(r.from * 1000), c._timeToLogical(r.to * 1000)] : [r.from * 1000, r.to * 1000]); c._emitRange(); c._invalidate(); },
    barWindow: () => (!c._range ? null : (c._ib ? { from: c._range[0], to: c._range[1] } : { from: c._timeToLogical(c._range[0]), to: c._timeToLogical(c._range[1]) })),
    setBarWindow: (/** @type {{ from: number, to: number }|null} */ r) => { if (!r) return; c._range = c._clampZoom(c._ib ? [r.from, r.to] : [c._logicalToTime(r.from), c._logicalToTime(r.to)]); c._emitRange(); c._invalidate(); },
    onTimeWindow: (/** @type {Function} */ cb) => c._cbs.range.add(cb),
    offTimeWindow: (/** @type {Function} */ cb) => c._cbs.range.delete(cb),
    onBarWindow: (/** @type {Function} */ cb) => c._cbs.logical.add(cb),
    offBarWindow: (/** @type {Function} */ cb) => c._cbs.logical.delete(cb),
    timeToX: (/** @type {number} */ t) => (c._g ? c._g.t2screen(t * 1000) : null),   // t2screen auto-converts (smth2i) in ib
    xToTime: (/** @type {number} */ x) => (c._g ? c._i2t(c._g.screen2t(x)) / 1000 : null),
    // logical = fractional bar index. Drawing engine uses these heavily (cross-timeframe
    // anchors, whitespace, magnet/snap). ib: index IS logical; regular: bar-index <-> time <-> x.
    barToX: (/** @type {number} */ i) => (!c._g ? null : (c._ib ? c._g.t2screen(i) : c._g.t2screen(c._logicalToTime(i)))),
    xToBar: (/** @type {number} */ x) => { if (!c._g) return null; const t = c._g.screen2t(x); return c._ib ? t : c._timeToLogical(t); },
    fitAll: () => { c._range = null; c._fitToData(); c._invalidate(); },
    scrollToNow: () => { c._fitToData(); c._invalidate(); }, scrollToBar: () => {},
    // height = the time-axis (botbar) strip only. NOT _h - _chartH: _chartH is just the MAIN
    // grid, so with sub-panes that subtraction wrongly includes every sub-pane's height (which
    // made the app treat the whole lower area as "over the time scale" -> no drawing there).
    width: () => c._chartW, height: () => { if (!c._showTime) return 0; const L = c._comp.$props.layout; return (L && L.botbar && L.botbar.height) || 0; },
    // time-scale configure: barSpacing (px/bar -> zoom), rightOffset
    configure: (/** @type {any} */ o = {}) => {
      if (o.rightOffset != null) c._options.timeAxis.rightOffset = o.rightOffset;
      if (o.barSpacing != null && o.barSpacing > 0 && c._chartW > 0) {
        const cs = c._ds();
        if (cs && cs._rows.length) {
          const off = c._options.timeAxis.rightOffset != null ? c._options.timeAxis.rightOffset : 6, wB = c._chartW / o.barSpacing, n = cs._rows.length;
          if (c._ib) { const last = n - 1; c._range = [last + off - wB, last + off]; }
          else { const iv = c._iv(), last = cs._rows[n - 1][0], t1 = last + off * iv; c._range = [t1 - wB * iv, t1]; }
          c._invalidate();
        }
      }
    },
    getConfig: () => ({ ...c._options.timeAxis }),
  };
}
