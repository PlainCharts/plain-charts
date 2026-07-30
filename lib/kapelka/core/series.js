// @ts-check
// The Series data-model -- one plotted series (candlestick, line/area/baseline/histogram, segmented,
// hbar, or a custom-view plug-in). Holds the row store + feed/feedBar, the per-series options/style,
// price-lines, on-bar markers, and the series-primitive hosts; exposes the app-facing series API
// (feed, configure, priceToY/yToPrice, addLevel, setMarkers, addLayer). All chart-level work is done
// through the `chart` reference passed to the constructor -- the model owns no rendering itself (the
// painters live in components/renderers/series.js). Lifted out of index.js unchanged (code-motion).
import { candleStyle } from './components/renderers/draw-util.js';

export class Series {
  /**
   * @param {any} chart the Chart hub (index.js) -- typed `any`, its `_`-methods are the boundary
   * @param {import('./types.js').SeriesType} type
   * @param {Record<string, any>} [opts]
   * @param {number} [pane]
   */
  constructor(chart, type, opts = {}, pane = 0) {
    /** @type {any} the Chart hub (index.js) */
    this._chart = chart;
    this._type = type;
    this._opts = opts;
    this._pane = pane | 0;
    this._style = candleStyle(opts);
    /** @type {import('./types.js').Row[]} */
    this._rows = [];
    /** @type {any[]} series-primitive hosts (drawings/tools/alerts/study-shapes) */
    this._primitives = []; // series-primitive hosts (drawings/tools/alerts/study-shapes)
    /** @type {any[]} */
    this._priceLines = [];
    /** @type {import('./types.js').Marker[]} glyphs drawn on the bars (setMarkers) */
    this._markers = []; // glyphs drawn on the bars (setMarkers) — ticks/text/shapes
    // overlay price scale: a non-main axisId renders this series on its OWN
    // invisible scale, pinned to a sub-region of the pane via margins {top,bottom} (0..1) and
    // auto-fit over just that scale's series. undefined/''/'right'/'left' -> the pane's main scale.
    this._priceScaleId = opts.axisId;
    this._scaleMargins = opts.margins || null;
    this._overlayLog = !!opts.overlayLog;
    /** @type {import('./types.js').ScaleView|null} g-like coord view, rebuilt each frame on an overlay scale */
    this._scaleView = null; // g-like coord view, rebuilt each frame when on an overlay scale
    /** @type {any} custom-series plug-in view (addCustomPlot); renderer lives in caller code */
    this._view = null; // custom-series plug-in view (addCustomPlot) — renderer lives in caller code
  }
  _isCandle() {
    return this._type.type === 'Candlestick';
  }
  // candlestick -> [t,o,h,l,c,v]; value series (line/area/baseline/histogram) -> [t, value]
  /**
   * @param {import('./types.js').Bar} b
   * @returns {import('./types.js').Row}
   */
  _row(b) {
    // custom series (addCustomPlot): the engine only needs a time + the point's price EXTENT (for
    // auto-scale/crosshair); the renderer gets the original point back untouched. [t, min, max, point]
    // mirrors Segmented, so the existing numeric-column range scans (grid_maker + _scanScaleRange)
    // pick up min/max and ignore the object payload — no scale-core change.
    if (this._view) {
      const t = Math.round(/** @type {number} */ (b.time) * 1000);
      let mn = 0,
        mx = 0;
      try {
        const pv = this._view.priceValues ? this._view.priceValues(b) : [b.value];
        mn = Math.min(...pv);
        mx = Math.max(...pv);
      } catch (_) {}
      if (!isFinite(mn) || !isFinite(mx)) {
        mn = mx = 0;
      }
      return [t, mn, mx, b];
    }
    // horizontal bar: keyed by PRICE, not time -> [price, total, payload]. The payload can carry a
    // single {value,color} or {segments:[{value,color}]} (stacked horizontally — the H twin of Segmented).
    if (b.price != null) {
      const total = b.segments ? b.segments.reduce((a, s) => a + (s.value || 0), 0) : b.value != null ? b.value : 0;
      return [b.price, total, b];
    }
    const t = Math.round(/** @type {number} */ (b.time) * 1000);
    if (b.open != null || b.high != null || b.close != null) return [t, b.open, b.high, b.low, b.close, b.volume || 0];
    // segmented bar: store [t, lo, hi, payload]. lo/hi span every segment/line/wick value so the
    // pane auto-scales to the whole bar (grid_maker scans the numeric columns; payload is ignored).
    if (b.segments || b.wick || b.lines) {
      let lo = Infinity,
        hi = -Infinity;
      const ext = (/** @type {number|undefined} */ v) => {
        if (v != null && isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      };
      (b.segments || []).forEach((s) => {
        ext(s.from);
        ext(s.to);
      });
      (b.lines || []).forEach((l) => ext(l.level));
      if (b.wick) {
        ext(b.wick.from);
        ext(b.wick.to);
      }
      if (lo === Infinity) {
        lo = 0;
        hi = 0;
      }
      return [t, lo, hi, b];
    }
    return b.color != null ? [t, b.value, b.color] : [t, b.value]; // per-point color (histogram/line)
  }
  /** @param {import('./types.js').Bar[]} bars */
  feed(bars) {
    const c = this._chart;
    const oldFirst = this._rows.length ? this._rows[0][0] : null;
    const oldLast = this._rows.length ? this._rows[this._rows.length - 1][0] : null;
    // callers usually feed already-sorted history; detect that in one O(n) pass and skip the
    // O(n log n) sort. Equal keys keep input order either way (Array.sort is stable), so the
    // fallback sort is behavior-identical.
    const rows = (bars || []).map((b) => this._row(b));
    let sorted = true;
    for (let i = 1; i < rows.length; i++)
      if (rows[i][0] < rows[i - 1][0]) {
        sorted = false;
        break;
      }
    this._rows = sorted ? rows : rows.sort((a, z) => a[0] - z[0]);
    // ib lazy-history: older bars prepended at the front shift every existing bar's index up by
    // the prepend count. Shift _range by the same amount so the visible window stays on the same
    // bars (no jerk) and the "near left edge" lazy-load check resets. Main candle series only (its
    // rows define the index axis), and only on a true prepend where the old data is retained.
    if (c._ib && c._range && oldFirst != null && c._ds() === this) {
      const d = this._rows;
      let pre = 0;
      while (pre < d.length && d[pre][0] < oldFirst) pre++;
      if (pre > 0 && d[pre] && d[pre][0] === oldFirst) {
        c._range = [c._range[0] + pre, c._range[1] + pre];
        c._emitRange();
      }
    }
    c._autoScrollAppend(this, oldLast); // new bar(s) appended via feed -> follow the right edge (if we were there)
    if (this._isCandle() && !c._range) c._fitToData();
    c._invalidate();
    return this;
  }
  /** @param {import('./types.js').Bar} b */
  feedBar(b) {
    const row = this._row(b);
    const d = this._rows,
      n = d.length;
    if (n && row[0] === d[n - 1][0]) d[n - 1] = row;
    else if (!n || row[0] > d[n - 1][0]) {
      const prevLast = n ? d[n - 1][0] : null;
      d.push(row);
      this._chart._autoScrollAppend(this, prevLast);
    } // append -> maybe auto-scroll
    else {
      const i = d.findIndex((x) => x[0] >= row[0]);
      if (i >= 0 && d[i][0] === row[0]) d[i] = row;
      else d.splice(i < 0 ? n : i, 0, row);
    }
    if (this._isCandle() && !this._chart._range) this._chart._fitToData();
    this._chart._invalidate();
    return this;
  }
  /** @param {Record<string, any>} [o] */
  configure(o = {}) {
    this._opts = { ...this._opts, ...o };
    this._style = candleStyle(this._opts);
    // keep overlay-scale wiring in sync on reconfigure (it was only read in the constructor), so
    // changing a study's scaleMargins / axisId at runtime -- e.g. Volume "Height %" -- resizes the band.
    this._scaleMargins = this._opts.margins || null;
    this._priceScaleId = this._opts.axisId;
    this._overlayLog = !!this._opts.overlayLog;
    this._chart._restyle(this);
    this._chart._invalidate();
    return this;
  }
  getConfig() {
    return this._opts;
  }
  /** @param {number} p */
  priceToY(p) {
    return this._chart._priceToCoord(this._pane, p);
  }
  /** @param {number} y */
  yToPrice(y) {
    return this._chart._coordToPrice(this._pane, y);
  }
  formatPrice() {
    // honor the series priceFormat: a custom formatter, else round to `precision` decimals
    // (default 2). Was String(p), which leaked raw floats e.g. 7489.0058 into alert/axis labels.
    const pf = this._opts.priceFormat || {};
    if (typeof pf.formatter === 'function') return { format: pf.formatter };
    const prec = pf.precision != null ? pf.precision : 2;
    return { format: (/** @type {number} */ p) => Number(p).toFixed(prec) };
  }
  priceAxis() {
    const c = this._chart,
      k = this._pane;
    return {
      width: () => c._sbWidth(),
      configure: (/** @type {Record<string, any>} */ o = {}) => {
        if (o.mode != null) c._setPaneMode(k, o.mode);
        if (o.autoScale) c._resetPaneAuto(k);
        if (o.range && o.range.length === 2) {
          const y = c._yOf(k);
          y.auto = false;
          y.range = [o.range[0], o.range[1]];
          y.zoom = 1;
          c._invalidate();
        }
      },
      getConfig: () => ({ mode: c._modeOf(k) }),
    };
  }
  // price lines paint on the objects sheet -- adding/moving one repaints that sheet only, not the data
  /** @param {Record<string, any>} [opts] */
  addLevel(opts = {}) {
    const line = {
      _opts: { ...opts },
      configure: (/** @type {any} */ o) => {
        Object.assign(line._opts, o);
        this._chart._scheduleObjects();
        return line;
      },
      getConfig: () => line._opts,
    };
    this._priceLines.push(line);
    this._chart._scheduleObjects();
    return line;
  }
  /** @param {any} line */
  removeLevel(line) {
    const i = this._priceLines.indexOf(line);
    if (i >= 0) this._priceLines.splice(i, 1);
    this._chart._scheduleObjects();
  }
  // Glyphs on the bars (setMarkers). Each marker:
  //   { time, price?, position?, shape?, text?, color?, size?, lineWidth?, fontSize? }
  // price = exact level; else position ('aboveBar'|'belowBar'|'inBar') relative to this series'
  // value at that time. shape: 'tick'|'text'|'circle'|'square'|'arrowUp'|'arrowDown' (default
  // 'text' if text is set, else 'tick'). A 'tick' is the short horizontal dash.
  /** @param {import('./types.js').Marker[]} markers */
  setMarkers(markers) {
    this._markers = Array.isArray(markers) ? markers : [];
    this._chart._invalidate();
    return this;
  }
  markers() {
    return this._markers;
  }
  // series-primitive host: the Engine runs prim.paneViews().renderer().draw(target) each frame
  /** @param {any} prim series-primitive host (boundary -- caller-supplied) */
  addLayer(prim) {
    if (this._primitives.indexOf(prim) >= 0) return;
    this._primitives.push(prim);
    // a primitive's own repaint request (drag preview, hover pill) repaints the objects sheet only
    if (prim.attached)
      prim.attached({ chart: this._chart, series: this, requestUpdate: () => this._chart._scheduleObjects(prim) });
    this._chart._invalidate();
  }
  /** @param {any} prim */
  removeLayer(prim) {
    const i = this._primitives.indexOf(prim);
    if (i < 0) return;
    this._primitives.splice(i, 1);
    if (prim.detached) prim.detached();
    this._chart._invalidate();
  }
}
