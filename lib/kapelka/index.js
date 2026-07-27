// @ts-check
// trading_vue_vanilla_js
// Zero-dependency vanilla-JS charting engine with its own chart API.
// Rendering is the ORIGINAL author's (trading-vue-js, MIT): Grid / Sidebar / Botbar / Crosshair
// render classes + CursorUpdater, driven on layered canvases. The shell sets up the canvas layers,
// wires native pointer input, and drives the author's update()/sync() (the Vue-reactivity
// replacement). Multi-pane: one grid+sidebar canvas stack PER grid (main + offchart), stacked by
// each grid's offset/height, sharing one botbar (time axis) at the bottom. Layout is CACHED —
// rebuilt on data/range/size change; cursor moves just repaint.
// Internal time = MILLISECONDS (native); public API = SECONDS.
import { applyOvStyle, refreshOverlay, drawCandles } from './core/components/renderers/candles.js';   // main candle overlay
import { buildLayout } from './core/build_layout.js';
import { wireInput } from './core/components/input.js';   // native pointer input (mouse/touch/wheel)
import { drawAxisViews, drawTimeAxisViews } from './core/components/renderers/axis-labels.js';   // axis tags
import { buildScaleViews } from './core/overlay-scales.js';   // per-study overlay price-scale views
import { colorsFor, fontFor } from './core/theme.js';   // options -> author color keys + axis font
import Botbar from './core/components/js/botbar.js';
import CursorUpdater from './core/components/js/updater.js';
import Const from './core/stuff/constants.js';
import Utils from './core/stuff/utils.js';
import * as SeriesRenderers from './core/components/renderers/series.js';   // value-series painters
import { dashFor, TRANSPARENT, candleStyle } from './core/components/renderers/draw-util.js';   // shared canvas helpers
import { Series } from './core/series.js';   // the series data-model
import { CursorMode, Stroke, Candles, Line, Area, Baseline, Columns, Segments, HBars } from './core/enums.js';
import { drawPriceLines, drawPrimitives, hitTest as hitTestPrimitives } from './core/components/primitives-host.js';   // series-attached primitives
import { emitCross, emitClick } from './core/events.js';   // crosshair / click consumer callbacks
// time / index / zoom / range cluster (coordinate transforms, fit/auto-scroll, zoom clamps, timeAxis API)
import { i2t, t2i, timeToLogical, logicalToTime, fitToData, autoScrollAppend, emitRange, maxZoom, minZoom, maxVZoom, visibleHiLo, clampVZoom, clampZoom, visibleCount, timeAxisApi } from './core/time-axis.js';
// pane lifecycle + layout geometry + pane-ops API
import { offcharts, ensurePanes, makePane, destroyPane, sizeLayers, place, resetPanes, panes as panesApi, removePane as removePaneApi, movePane, addPane as addPaneApi } from './core/panes.js';

// public enums + series type tags (defined in core/enums.js) -- re-exported as the API surface
export { CursorMode, Stroke, Candles, Line, Area, Baseline, Columns, Segments, HBars };

const DEFAULT_FONT = '11px -apple-system, BlinkMacSystemFont, Arial, sans-serif';
/** @param {any} x @returns {boolean} */
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
/** Deep-merge b onto a (plain-object keys recurse, everything else overwrites). @param {any} a @param {any} b @returns {any} */
function deepMerge(a, b) { const o = isObj(a) ? { ...a } : {}; for (const k in b) o[k] = (isObj(a[k]) && isObj(b[k])) ? deepMerge(a[k], b[k]) : b[k]; return o; }

const DEFAULTS = {
  layout: { background: { color: '#ffffff' }, textColor: '#888' },
  grid: { vertLines: { color: '#1a1a20' }, horzLines: { color: '#1a1a20' } },
  cursor: { mode: CursorMode.Free, color: '#758696', labelBg: '#363a45', labelText: '#e6e6e6' },
  timeAxis: { timeVisible: true, secondsVisible: false, rightOffset: 6, borderColor: '#333', followNewBars: true },   // auto-scroll on new bar (default on)
  rightPriceAxis: { borderColor: '#333' },
  // conflation: minimum ms between renders (0 = once per animation frame, the default). Under a
  // high-frequency feed, set e.g. 100 to coalesce a burst of feedBar()s into one paint every 100ms.
  // Data is applied immediately (reads stay current); only the render cadence is bounded.
  conflate: 0,
};

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// candleStyle, hexA, TRANSPARENT, dashFor, drawMarkerGlyph live in core/components/renderers/draw-util.js
// (candleStyle/dashFor/TRANSPARENT imported above). The Series data-model lives in core/series.js.

class Chart {
  /** @param {HTMLElement} el  @param {import('./core/types.js').ChartOptions} [options] */
  constructor(el, options = {}) {
    if (!el) throw new Error('mountChart: a container element is required');
    /** @type {HTMLElement} */
    this.el = el;
    /** merged options bag (DEFAULTS deep-merged with the caller's options); open-ended so the app can extend it @type {any} */
    this._options = deepMerge(DEFAULTS, options);
    /** @type {import('./core/series.js').Series[]} */
    this._series = [];
    /** visible window in layout units: [t0, t1] MS (regular) or [i0, i1] index (ib) @type {[number, number]|null} */
    this._range = null;            // [t0, t1] MS
    /** app-supplied future whitespace rows [t_ms, null,...] (ib mode) -> gapless future axis @type {import('./core/types.js').Row[]|null} */
    this._future = null;           // app-supplied future whitespace rows [t_ms, null,...] (ib mode) -> gapless future axis
    /** @type {import('./core/types.js').GridLayout|null} */
    this._g = null; this._chartW = 0; this._chartH = 0; this._interval = 60000;
    this._layoutDirty = true;
    /** per-grid Y-scale state: paneId -> { auto, range:[hi,lo]|null, zoom } @type {Record<number, { auto: boolean, range: [number, number]|null, zoom: number }>} */
    this._y = {};              // per-grid Y-scale state: gridIndex -> { auto, range:[hi,lo], zoom }
    /** @type {any} */
    this._yDrag = null; /** @type {any} */
    this._yStartRange = null;   // transient price-axis drag state (incl. pane k)
    this._panPane = -1;        // grid the current pan started in (for vertical pan)
    /** {x, y} CSS px, or null @type {{ x: number, y: number }|null} */
    this._mouse = null;            // {x, y} CSS px, or null
    /** @type {{ crosshair: Set<Function>, click: Set<Function>, range: Set<Function>, logical: Set<Function> }} */
    this._cbs = { crosshair: new Set(), click: new Set(), range: new Set(), logical: new Set() };
    /** pane ID -> relative height weight (setStretchFactor) @type {Record<number, number>} */
    this._stretch = {};            // pane ID -> relative height weight (setStretchFactor)
    /** pane ID -> keep its grid even when all its series are invisible @type {Record<number, boolean>} */
    this._preserve = {};           // pane ID -> keep its grid even when all its series are invisible
                                   // (preserveEmptyPane): a COLLAPSED pane stays as an empty bar;
                                   // a HIDDEN pane (not preserved) drops out entirely.
    /** grid POSITION -> pane ID (top->bottom); rebuilt each layout @type {number[]} */
    this._paneIds = [0];           // grid POSITION -> pane ID (top->bottom); rebuilt each layout.
                                   // Decouples series._pane (stable id, keys state) from grid index
                                   // (position), so a hidden/removed middle pane can drop out cleanly.
    this._dirty = false;
    /** paint gate: while true, feeds/updates still apply to the data model but NO paint runs (see setPaused) @type {boolean} */
    this._paused = false;
    /** @type {any} */
    this._style = candleStyle({});
    /** targeted shaders (price-tag -> main sidebar): grid layer / sidebar layer / empty (suppress) @type {any[]} */
    this._gridShaders = /** @type {any[]} */ ([]); this._sbShaders = /** @type {any[]} */ ([]); this._noShaders = /** @type {any[]} */ ([]);   // targeted shaders (price-tag -> main sidebar)
    /** per-grid render bundles @type {any[]} */
    this._panes = [];              // per-grid render bundles
    /** offchart descriptors [{ paneIndex, series:[...] }] ordered -> grids[1..N] @type {Array<{ paneIndex: number, series: import('./core/series.js').Series[] }>} */
    this._ocs = [];               // offchart descriptors [{ paneIndex, series:[...] }] ordered -> grids[1..N]
    /** pane id -> price-scale mode (0 Regular, 1 Log, 2 Percent, 3 Indexed-to-100) @type {Record<number, number>} */
    this._scaleMode = {};         // pane id -> price-scale mode (0 Regular, 1 Log, 2 Percent, 3 Indexed-to-100)
    /** main price scale scaleMargins {top,bottom} (0..1); null -> full height @type {{ top?: number, bottom?: number }|null} */
    this._mainMargins = null;     // main price scale scaleMargins {top,bottom} (0..1); null -> full height
    /** pane ID -> y_range fn (hi,lo)=>[hi,lo]: shapes a pane's AUTO-fit range @type {Record<number, Function>} */
    this._scaleProviders = {};    // pane ID -> y_range fn (hi,lo)=>[hi,lo]: shapes a pane's AUTO-fit
                                   // range (the author's overlay y_range hook). Manual drag overrides it.
    this._invert = false;         // invertScale (flip Y)
    /** price axis side ('right' | 'left') @type {'right'|'left'} */
    this._scaleSide = 'right';    // price axis side ('right' | 'left')
    this._showPrice = true; this._showTime = true;   // price-scale / time-scale visibility
    this._showLastValue = true;
    this._sbPx = 0; this._chartLeftPx = 0;   // sidebar width + chart left-offset (left-scale) in CSS px
    this._ib = !!(options.ib || (options.timeAxis && /** @type {any} */ (options.timeAxis).indexBased));   // index-based mode (gap-collapsed x-axis); _range is in INDEX units
    this._readScaleOpts(this._options);   // seed log/invert/side/visibility from initial options

    // root container; one botbar canvas now, grid+sidebar canvases per pane (created in _rebuild)
    const root = document.createElement('div');
    root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;cursor:crosshair;touch-action:none;';
    root.style.background = (this._options.layout.background && this._options.layout.background.color) || '#fff';
    el.appendChild(root);
    /** @type {HTMLDivElement} */
    this._root = root;
    /** canvas layers: bb = shared botbar @type {{ bb: HTMLCanvasElement }} */
    this._cv = { bb: this._mkcv() };

    // --- late-set members (assigned outside the constructor; declared here for the checker) ---
    /** device pixel ratio (resize) @type {number} */
    this._dpr;
    /** viewport width CSS px (resize) @type {number} */
    this._w;
    /** viewport height CSS px (resize) @type {number} */
    this._h;
    /** last paint timestamp (ms), for conflation @type {number} */
    this._lastPaint;
    /** the Vue-component surrogate the author's render classes read off @type {import('./core/types.js').Comp} */
    this._comp;
    /** ResizeObserver on the container @type {ResizeObserver} */
    this._ro;
    /** shared botbar (time axis) render class @type {any} */
    this._bb;
    /** the author's CursorUpdater (magnet-snap), rebuilt each layout @type {any} */
    this._cu;
    /** main candle overlay surrogate (buildOverlay) @type {any} */
    this._ov;
    /** transient separator-drag state (grid resize) @type {any} */
    this._sepDrag;
    /** grid index whose top-separator the cursor is near (row-resize affordance) @type {number} */
    this._sepHover;
    /** programmatic crosshair { price, time, series } (setCursor / cross-pane sync) @type {any} */
    this._forcedCross;
    /** cursor-only repaint pending (cross layers + axes; grids untouched) @type {boolean} */
    this._cursorDirty = false;
    /** objects-only repaint pending (objects sheets + axes + cross; grids untouched) @type {boolean} */
    this._objDirty = false;
    /** crosshair active this frame -> painted on the pane cross layers @type {boolean} */
    this._crossActive = false;
    /** pin the cursor vertical line to a screen x (fn|number|null) while grabbing an anchored object @type {(() => number|null)|number|null} */
    this._cursorSnapX = null;
    /** carried pointer-leave event, emitted once so the app clears the synced crosshair @type {any} */
    this._leaveEvent;
    /** true on the redraw right after a real pointer move (user vs programmatic) @type {boolean} */
    this._pointerMoved;
    /** last raw pointer event (sourceEvent for onCursorMove) @type {any} */
    this._lastPointerEvent;

    this._buildComp();
    wireInput(this);
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(el);
    this.resize();
  }

  _mkcv() { const c = document.createElement('canvas'); c.style.cssText = 'position:absolute;display:block;'; this._root.appendChild(c); return c; }

  // The render-input surrogate the author's classes read off (comp + comp.$props). Originally a Vue
  // component stand-in; the reactivity shims ($emit no-op, $set) are gone now that native input owns
  // the interaction and CursorUpdater writes cursor.values directly.
  _buildComp() {
    /** @type {import('./core/types.js').Cursor} */
    const cursor = { x: undefined, y: undefined, t: undefined, y$: undefined, grid_id: 0, locked: false, values: {} };
    /** @type {import('./core/types.js').CompProps} */
    const $props = {
      width: 0, height: 0,
      layout: null, sub: [], range: this._range || [0, 0],
      grid_id: 0, interval: 60000,
      cursor,                       // SHARED ref (CursorUpdater writes it, render classes read it)
      colors: colorsFor(this._options),
      font: DEFAULT_FONT, config: Const.ChartConfig,
      shaders: [], timezone: (this._options.timeAxis && this._options.timeAxis.timezone) || 0, meta: {},
    };
    this._comp = {
      config: Const.ChartConfig, bot_shaders: [],
      _layout: null, cursor,
      main_section: { sub: [], data: [] }, sub_section: { data: [] },
      interval: 60000, $props,
    };
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    this._dpr = window.devicePixelRatio || 1;
    this._w = Math.max(1, r.width); this._h = Math.max(1, r.height);
    this._invalidate(); return this;
  }
  _invalidate() { this._layoutDirty = true; this._schedule(); }
  // Coalesce paints. Many update()/invalidate() calls collapse into ONE render: normally once per
  // animation frame; with options.conflate > 0, at most once per that many ms (bounding rebuild cost
  // under a high-frequency feed). The _dirty flag holds until the paint runs, so bursts merge.
  _schedule() {
    if (this._dirty) return;
    this._dirty = true;
    if (this._paused) return;   // paused: data applied, paint deferred until setPaused(false) catches up
    const ms = this._options.conflate | 0;
    if (ms > 0) {
      const wait = ms - (nowMs() - (this._lastPaint || 0));
      if (wait > 0) { setTimeout(() => requestAnimationFrame(() => this._flushPaint()), wait); return; }
    }
    requestAnimationFrame(() => this._flushPaint());
  }
  // Cursor-only schedule: the crosshair moved but no data/layout changed. The flush repaints just
  // the cross overlay canvases + the axis bars (cursor bubbles) -- the grid canvases (candles,
  // series, drawings) keep their last paint. A pending full paint absorbs it. Deliberately not
  // conflated: the cross must track the pointer even while feed paints are being throttled.
  _scheduleCursor() {
    if (this._dirty || this._objDirty || this._cursorDirty) return;
    this._cursorDirty = true;
    if (this._paused) return;
    requestAnimationFrame(() => this._flushPaint());
  }
  // Objects-only schedule: a price line moved or a primitive (drawing/alert/order line) changed,
  // but no data/layout did. The flush repaints the objects sheets + axes + cross -- the data
  // sheets (gridlines, candles, series) keep their last paint. Dragging a line costs this instead
  // of a full repaint per move.
  // A paneView sent to back ('bottom' zOrder) paints on the DATA sheet -- so when the REQUESTING
  // primitive currently has content back there, its request must be a full paint. A bottom view
  // can report `isEmpty()`; one that can't is assumed to have content. Other primitives' bottom
  // content is untouched by an objects flush (the data sheet isn't cleared), so only the requester
  // is checked.
  /** @param {any} [prim] the primitive requesting the repaint (none for price lines) */
  _scheduleObjects(prim) {
    if (prim && this._primHasActiveBelow(prim)) { this._schedule(); return; }
    if (this._dirty || this._objDirty) return;
    this._objDirty = true;
    if (this._paused) return;
    requestAnimationFrame(() => this._flushPaint());
  }
  // does this primitive currently paint anything in the sent-to-back band (the data sheet)?
  /** @param {any} prim */
  _primHasActiveBelow(prim) {
    try {
      const views = (prim.paneViews ? prim.paneViews() : []) || [];
      for (const v of views) {
        if (v.zOrder && v.zOrder() === 'bottom' && (!v.isEmpty || !v.isEmpty())) return true;
      }
    } catch (_) { return true; }   // a misbehaving view -> stay safe, paint fully
    return false;
  }
  _flushPaint() {
    if (this._paused) return;
    const full = this._dirty, obj = this._objDirty, cur = this._cursorDirty;
    this._dirty = false; this._objDirty = false; this._cursorDirty = false;
    if (!full && !obj && !cur) return;   // flags consumed by an earlier flush (double-rAF)
    this._lastPaint = nowMs();
    if (full) this._redraw(); else if (obj) this._redrawObjects(); else this._redrawCursor();
  }
  // Pause/resume painting. While paused, feeds and updates still apply to the data model (reads stay
  // current), but no paint runs -- an off-screen chart (e.g. a split pane hidden behind a maximized
  // sibling) costs zero render CPU. Resuming runs one catch-up paint if anything changed while paused.
  /** @param {boolean} on */
  setPaused(on) {
    const p = !!on;
    if (p === this._paused) return this;
    this._paused = p;
    if (!p && (this._dirty || this._objDirty || this._cursorDirty)) { this._dirty = false; this._objDirty = false; this._cursorDirty = false; this._schedule(); }   // replay the deferred paint (full covers all tiers)
    return this;
  }
  _cs() { return this._series.find((s) => s._isCandle() && s._rows.length); }
  // Domain series — owner of the x-axis / bar grid. A candle series owns it when present; otherwise the
  // FIRST series with rows (a Line/histogram) owns it, so an oscillator can stand entirely on its own
  // with no candles behind it (chart-less study window). Only the x-domain uses this; candle-specific
  // bits (styling, last-price line, the candle painter) still key off _cs().
  _ds() { return this._cs() || this._series.find((s) => s._rows.length); }
  /** @param {import('./core/series.js').Series} s */
  _restyle(s) { if (s === this._cs()) { this._style = s._style; if (this._ov) applyOvStyle(this); } }

  // robust bar interval (author's detect_interval = min positive gap; survives leading session gaps)
  _iv() { const cs = this._ds(); return (cs && Utils.detect_interval(cs._rows)) || this._interval || 60000; }
  // fit-to-data, append auto-scroll, and the layout-unit <-> time/logical coordinate transforms live
  // in core/time-axis.js; delegated here (the render loop + input/series call them via `this`).
  _fitToData() { return fitToData(this); }
  /** @param {import('./core/series.js').Series} s  @param {number|null} oldLastTime */
  _autoScrollAppend(s, oldLastTime) { return autoScrollAppend(this, s, oldLastTime); }
  /** @param {number} v @returns {number} */
  _i2t(v) { return i2t(this, v); }
  /** @param {number} v @returns {number} */
  _t2i(v) { return t2i(this, v); }
  /** @param {number} t @returns {number} */
  _timeToLogical(t) { return timeToLogical(this, t); }
  /** @param {number} i @returns {number} */
  _logicalToTime(i) { return logicalToTime(this, i); }

  /** @param {number} k pane ID */
  _yOf(k) { return this._y[k] || (this._y[k] = { auto: true, range: null, zoom: 1 }); }
  /** @param {number} k pane ID */
  _resetPaneAuto(k) { const y = this._yOf(k); y.auto = true; y.range = null; y.zoom = 1; this._invalidate(); }   // price scale -> auto-fit (autoScale)
  /** @param {number} y CSS px @returns {number} grid POSITION under y, or -1 */
  _paneAt(y) { const L = this._comp.$props.layout; if (!L) return -1; const gs = L.grids; for (let k = 0; k < gs.length; k++) { const g = gs[k]; if (y >= g.offset && y < g.offset + g.height) return k; } return -1; }
  // boundary between two stacked panes: the LOWER grid index k (1..N-1) if y is within the grab
  // zone of grids[k].offset, else -1. Drives separator-drag resizing + the row-resize cursor.
  /** @param {number} y CSS px @returns {number} */
  _separatorAt(y) {
    const L = this._comp.$props.layout; if (!L || !L.grids || L.grids.length < 2) return -1;
    const grids = L.grids;
    for (let k = 1; k < grids.length; k++) if (Math.abs(y - grids[k].offset) <= 4) return k;
    return -1;
  }
  // tvjs-xp grid-resize (Splitter.vue): grow the pane ABOVE the boundary by the drag offset,
  // shrink the one below (guarded by a min height), then renormalize every grid's pixel height
  // into stretch weights (his calc_heights). _stretch feeds the next layout build.
  /** @param {number} clientY */
  _resizePanes(clientY) {
    const d = this._sepDrag, L = this._comp.$props.layout; if (!d || !L || !L.grids) return;
    const off = clientY - d.y0, nh1 = d.h1 + off, nh2 = d.h2 - off, MIN = 30;
    if (nh1 < MIN || nh2 < MIN) return;
    const px = L.grids.map((/** @type {any} */ g) => g.height); px[d.k - 1] = nh1; px[d.k] = nh2;
    const sum = px.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0) || 1;
    for (let i = 0; i < px.length; i++) this._stretch[this._idAt(i)] = px[i] / sum;   // key by pane ID
  }
  // switch a pane from auto-fit to a manual price window, seeded with its current visible extent
  /** @param {number} pos grid POSITION */
  _ensureManual(pos) { const y = this._yOf(this._idAt(pos)); if (y.auto) { const g = this._gridAt(pos); y.range = g ? [g.$_hi, g.$_lo] : null; y.auto = false; } }

  // offchart series grouped by pane index (core/panes.js: offcharts) -> [{ paneIndex, series:[...] }]
  _offcharts() { return offcharts(this); }

  _rebuild() {
    const cs = this._ds(); if (!cs || !this._range) { this._g = null; return; }
    const colors = colorsFor(this._options);
    this._ocs = this._offcharts();
    this._paneIds = [0, ...this._ocs.map((o) => o.paneIndex)];   // grid position -> pane id (main + offcharts)
    // manual Y windows keyed by grid POSITION (the layout indexes per grid). _y is keyed by pane
    // ID; a hidden pane (not in _paneIds) is skipped — its window restores when it reappears.
    /** @type {Record<number, any>} */
    const yTransforms = {};
    for (const k in this._y) { const y = this._y[k]; if (!y.auto && y.range) { const pos = this._paneIds.indexOf(+k); if (pos >= 0) yTransforms[pos] = { auto: false, range: y.range }; } }
    // per-pane auto-range shaping, keyed by grid POSITION as one layer carrying a y_range fn
    // (grid_maker applies the first y_range it finds, auto mode only). Two inputs compose:
    //   votes -- an attached primitive may report a price range to keep visible
    //     (autoscaleInfo() -> { priceRange: { minValue, maxValue } } | null), and a price line
    //     opts in with `autoscale: true`. Votes extend the data hi/lo FIRST, as if they were data.
    //   scale provider -- the study `scale` fn then shapes/locks the result, so a pinned
    //     oscillator range (RSI 0-100) stays pinned regardless of votes.
    // A manual (dragged) scale ignores y_range entirely, votes included.
    /** @type {Record<number, any>} */
    const layersMeta = {};
    for (let pos = 0; pos < this._paneIds.length; pos++) {
      const id = this._paneIds[pos];
      const sp = this._scaleProviders[id];
      const scaleFn = typeof sp === 'function' ? sp : null;
      /** @type {{ minValue: number, maxValue: number }[]} */
      const votes = [];
      for (const s of this._series) {
        if (s._pane !== id) continue;
        for (const prim of s._primitives) {
          if (typeof prim.autoscaleInfo !== 'function') continue;
          try {
            const a = prim.autoscaleInfo(); const r = a && a.priceRange;
            if (r && isFinite(r.minValue) && isFinite(r.maxValue)) votes.push(r);
          } catch (_) {}   // a misbehaving primitive must not break the scale
        }
        for (const pl of s._priceLines) { const o = pl._opts; if (o.autoscale && o.price != null && isFinite(o.price)) votes.push({ minValue: o.price, maxValue: o.price }); }
      }
      if (!scaleFn && !votes.length) continue;
      layersMeta[pos] = { scale: { y_range: (/** @type {number} */ hi, /** @type {number} */ lo) => {
        for (const v of votes) { if (v.maxValue > hi) hi = v.maxValue; if (v.minValue < lo) lo = v.minValue; }
        return scaleFn ? scaleFn(hi, lo) : [hi, lo];
      } } };
    }
    const offcharts = this._ocs.map((o) => {
      const id = o.paneIndex;   // pane ID (keys per-pane state, survives reorder/hide)
      const s0 = o.series[0];   // candle pane: drop volume so the y-range scan = [high, low], not volume
      const rows = s0._isCandle() ? s0._rows.map((/** @type {any[]} */ r) => [r[0], r[1], r[2], r[3], r[4]]) : s0._rows;
      return { rows, grid: { logScale: this._modeOf(id) === 1, scaleMode: this._modeOf(id), height: this._stretch[id] } };
    });
    // the main series' tick size + decimals (priceFormat) -> the main price grid, so every price label
    // on it quantizes to the instrument tick. Only grid 0 gets these; study/offchart scales stay free.
    const mainPf = (cs._opts && cs._opts.priceFormat) || {};
    const { layout, sub, interval } = buildLayout({
      rows: cs._rows, range: /** @type {[number, number]} */ (this._range), width: this._w, height: this._h,
      colors, font: fontFor(this._options), timezone: this._comp.$props.timezone, yTransforms, layersMeta, offcharts, logScale: this._modeOf(0) === 1, scaleMode: this._modeOf(0), scaleMargins: /** @type {any} */ (this._mainMargins), ib: this._ib, mainGridHeight: this._stretch[0],
      minMove: mainPf.minMove, tickPrec: mainPf.precision,
      future: /** @type {any} */ (this._future),   // future whitespace rows -> gapless session-following axis past the last bar (ib)
      hidePrice: !this._showPrice, hideTime: !this._showTime,   // reclaim freed space when a scale is hidden
      candleWidth: this._candleWidth(),   // user-set candle body width (fraction of bar step)
      labelGap: this._labelGap(),         // user-set min gap (px) before time labels collide
    });
    const grids = layout.grids; const g = grids[0]; this._g = g || null;
    if (!g) return;
    if (this._invert) for (const gr of grids) this._invertGrid(gr);   // flip Y before anything reads the layout
    this._chartW = g.width; this._chartH = g.height; this._interval = interval;
    this._sbPx = this._showPrice ? (g.sb || 0) : 0;
    this._chartLeftPx = (this._scaleSide === 'left') ? this._sbPx : 0;
    this._showLastValue = !cs._opts || cs._opts.showLastValue !== false;
    this._style = cs._style;

    // feed the author's comp/$props the freshly built layout + frame state
    const p = this._comp.$props;
    p.layout = layout; p.sub = sub; p.range = /** @type {[number, number]} */ (this._range); p.interval = interval; p.colors = colors;
    p.width = this._w; p.height = this._h; p.font = fontFor(this._options);
    // app's time formatters (the botbar uses these for the axis ticks + crosshair time label)
    p.timeFormatter = (this._options.localization && this._options.localization.timeFormatter) || null;
    p.tickMarkFormatter = (this._options.timeAxis && this._options.timeAxis.tickFormatter) || null;
    this._comp._layout = layout; this._comp.interval = interval; this._comp.main_section.sub = sub;
    // offchart overlay descriptors — CursorUpdater.overlay_data reads sub_section.data per offchart grid
    this._comp.sub_section.data = this._ocs.map((o) => ({ type: 'line', grid: {}, data: o.series[0]._rows }));
    this._root.style.background = colors.back;

    if (!this._bb) this._bb = new Botbar(this._cv.bb, this._comp);
    this._bb.layout = layout;                  // botbar captures $props.layout in its ctor — refresh
    this._cu = new CursorUpdater(this._comp);   // captures _layout.grids — refresh on rebuild

    this._ensurePanes(grids.length);
    for (const pane of this._panes) {
      const gk = grids[pane.k];
      pane.id = this._idAt(pane.k);             // pane.k = grid POSITION; pane.id = pane ID
      pane.crossComp.$props.layout = gk;        // crosshair reads grid-level layout.id/.width/.height
      pane.crossComp.$props.colors = colors;
      if (pane.k === 0) refreshOverlay(this, g, cs._rows, colors);
      pane.series = this._seriesInPane(pane.id);
      buildScaleViews(gk, pane.series);   // assign overlay-scaled series their own coord view
      // overlay z-order: [primitives sent-to-back] -> candles -> value series -> price lines ->
      // primitive host (under crosshair). The grid paints overlays sorted by z (grid.js), so a z<0
      // band renders BELOW the candles -- that's what puts a "Send to back" drawing behind the bars.
      /** @type {any[]} */
      const overlays = [];
      overlays.push({ z: -1, display: true, renderer: { draw: (/** @type {any} */ ctx) => drawPrimitives(this, ctx, pane, 'below') } });   // drawings sent behind the candles
      if (pane.k === 0) overlays.push({ z: 0, display: true, renderer: { draw: (/** @type {any} */ ctx) => drawCandles(this, ctx) } });
      for (const s of pane.series) overlays.push({ z: 10, display: true, renderer: { draw: (/** @type {any} */ ctx) => this._drawSeries(ctx, pane.k, s) } });
      // markers can sit on the candle series too (it's excluded from _seriesInPane, which is only
      // the value/overlay series) -- so include it here, else setMarkers on the candles never draws.
      overlays.push({ z: 20, display: true, renderer: { draw: (/** @type {any} */ ctx) => { const cs = this._cs(); const list = (cs && cs._pane === pane.id && cs._markers && cs._markers.length) ? [cs, ...pane.series] : pane.series; SeriesRenderers.drawMarkers(ctx, this._gridAt(pane.k), list, this._comp.$props.font); } } });
      overlays.push({ z: 1e5, display: true, renderer: { draw: (/** @type {any} */ ctx) => drawPriceLines(this, ctx, pane.k) } });
      overlays.push({ z: 1e6, display: true, renderer: { draw: (/** @type {any} */ ctx) => drawPrimitives(this, ctx, pane, 'above') } });
      // split the stack across the pane's sheets: z < 1e5 (grid/candles/series/markers + sent-to-back
      // drawings) paints on the data sheet; z >= 1e5 (price lines + primitives) on the objects sheet,
      // so dragging a line repaints only its own sheet (_paintObjects), not the candles.
      pane.grid.overlays = overlays.filter((o) => o.z < 1e5);
      pane.objOverlays = overlays.filter((o) => o.z >= 1e5).sort((a, b) => a.z - b.z);
    }

    this._sizeLayers(layout);
    this._layoutDirty = false;
  }

  // pane-bundle create/destroy + canvas-layer sizing/placement live in core/panes.js; delegated here.
  /** @param {number} n */
  _ensurePanes(n) { return ensurePanes(this, n); }
  /** @param {number} k grid POSITION @returns {any} the pane render bundle */
  _makePane(k) { return makePane(this, k); }
  /** @param {any} pane */
  _destroyPane(pane) { return destroyPane(this, pane); }
  /** @param {any} layout */
  _sizeLayers(layout) { return sizeLayers(this, layout); }
  /** @param {HTMLCanvasElement} cv  @param {number} w  @param {number} h  @param {number} left  @param {number} top */
  _place(cv, w, h, left, top) { return place(this, cv, w, h, left, top); }

  // The main candle overlay (the `_ov` surrogate, the candle draw loop with per-pixel conflation,
  // and the current-price line) lives in core/components/renderers/candles.js: buildOverlay(this) /
  // refreshOverlay(this,...) / drawCandles(this,ctx) / applyOvStyle(this).

  // ---- series-type renderers (value series; candles use the Candles overlay) ----
  // series to render in a pane via _drawSeries — excludes the MAIN candle (drawn by the Candles overlay)
  /** @param {number} k pane ID */
  _seriesInPane(k) { const main = this._cs(); return this._series.filter((s) => s._pane === k && s._rows.length && s !== main && s._opts.visible !== false); }

  // overlay price scales (a non-main priceScaleId -> an independent, region-confined _scaleView per
  // study) live in core/overlay-scales.js; _rebuild calls buildScaleViews(grid, paneSeries).

  /** @param {any} ctx  @param {number} k grid POSITION  @param {import('./core/series.js').Series} s */
  _drawSeries(ctx, k, s) {
    const base = this._gridAt(k); if (!base || !s._rows.length) return;
    const g = s._scaleView || base;
    if (s._isCandle()) return SeriesRenderers.drawCandleSeries(ctx, g, s, this._candleWidth());   // candle in an offchart pane (compare)
    if (s._view) return this._drawCustom(ctx, g, s);               // user-registered primitive (addCustomPlot)
    switch (s._type.type) {
      case 'Area': return SeriesRenderers.drawArea(ctx, g, s);
      case 'Baseline': return SeriesRenderers.drawBaseline(ctx, g, s);
      case 'Histogram': return SeriesRenderers.drawHistogram(ctx, g, s);
      case 'Segmented': return SeriesRenderers.drawSegmented(ctx, g, s);
      case 'HBar': return SeriesRenderers.drawHBar(ctx, base, s);   // horizontal: price->y via the pane scale
      default: return SeriesRenderers.drawLine(ctx, g, s);   // Line
    }
  }
  // Drive a custom-series view's renderer with THIS pane's coordinate space (overlay-scale aware via g).
  // The view supplies the pixels; the engine supplies the transforms + isolates a throwing renderer so
  // one bad plug-in can't blank the chart. See addCustomPlot for the view contract.
  /** @param {any} ctx  @param {any} g coord-space (pane grid or overlay scale view)  @param {import('./core/series.js').Series} s */
  _drawCustom(ctx, g, s) {
    const view = s._view; if (!view || typeof view.draw !== 'function') return;
    const bw = Math.max(1, (g.px_step || 6) * 0.7);
    const scope = {
      ctx, series: s, options: s._opts,
      width: g.width, height: g.height, barWidth: bw,
      priceToY: (/** @type {number} */ p) => g.$2screen(p),                       // price -> y pixel
      yToPrice: (/** @type {number} */ y) => g.screen2$(y),                       // y pixel -> price
      timeToX: (/** @type {number} */ tSec) => g.t2screen(Math.round(tSec * 1000)),  // time (sec) -> x pixel
      xToTime: (/** @type {number} */ x) => g.screen2t(x) / 1000,                 // x pixel -> time (sec)
      // every data point, pre-mapped; `point` is the caller's original object (row payload)
      data: s._rows.map((/** @type {any[]} */ r) => ({ time: r[0] / 1000, x: g.t2screen(r[0]), point: r[3] })),
    };
    try { view.draw(scope); }
    catch (e) { if (!(/** @type {any} */ (s))._drawWarned) { (/** @type {any} */ (s))._drawWarned = true; try { console.error('[kapelka] custom series draw() threw:', e); } catch (_) {} } }
  }
  // the value-series painters (line / area / baseline / histogram / hbar / segmented / candle /
  // markers) now live in core/components/renderers/series.js and are driven from _drawSeries above.

  // Series-attached primitives (drawings/tools/alerts/study-shapes via addLayer) -- their renderer
  // host, hit-test, price-lines, and the coord-space target -- live in core/components/primitives-host.js:
  // drawPriceLines(this,ctx,k) / drawPrimitives(this,ctx,pane). hitTest stays public (delegator below).
  /** @param {number} x  @param {number} y */
  hitTest(x, y) { return hitTestPrimitives(this, x, y); }
  // (price/time axis-label drawing lives in core/components/renderers/axis-labels.js.)

  _clearCursor() { const c = this._comp.cursor; c.x = undefined; c.y = undefined; c.t = undefined; c.y$ = undefined; }

  _redraw() {
    if (this._layoutDirty) this._rebuild();
    const layout = this._comp.$props.layout;
    if (!layout || !this._panes.length || !this._g) return;
    this._syncCursor(layout.grids);
    // paint: each pane's grid (gridlines, shader pass, overlay z-stack), then separators, the
    // objects sheets, axes, cross.
    const p = this._comp.$props;
    for (const pane of this._panes) { p.shaders = this._gridShaders; pane.grid.update(); }
    this._drawSeparators();
    this._paintObjects();
    this._paintAxes();
    this._paintCross();
  }

  // Objects-only repaint: a price line / primitive changed but data/layout didn't. Sync the cursor
  // (a drag moves it too), then repaint the objects sheets + axes + cross. The data sheets --
  // gridlines, candles, series, separators -- keep their last paint untouched.
  _redrawObjects() {
    const layout = this._comp.$props.layout;
    if (!layout || !this._panes.length || !this._g) return;
    this._syncCursor(layout.grids);
    this._paintObjects();
    this._paintAxes();
    this._paintCross();
  }

  // Cursor-only repaint: the pointer moved but data/layout didn't. Sync the cursor, then repaint
  // just the cross overlay canvases + the axis bars (price/time bubbles). The grid canvases --
  // candles, series, drawings, separators -- keep their last paint untouched.
  _redrawCursor() {
    const layout = this._comp.$props.layout;
    if (!layout || !this._panes.length || !this._g) return;
    this._syncCursor(layout.grids);
    this._paintAxes();
    this._paintCross();
  }

  // paint the objects sheet of each pane: price lines + primitives (drawings, alert/order lines),
  // in z order, save/restore around each renderer like the grid's overlay loop.
  _paintObjects() {
    for (const pane of this._panes) {
      const cv = pane.objCv; if (!cv) continue;
      const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const l of (pane.objOverlays || [])) {
        if (!l.display) continue;
        ctx.save();
        const r = l.renderer;
        if (r.pre_draw) r.pre_draw(ctx);
        r.draw(ctx);
        if (r.post_draw) r.post_draw(ctx);
        ctx.restore();
      }
    }
  }

  // active pane = the grid the cursor is over; drive the author's CursorUpdater (magnet-snap).
  // Writes the shared cursor, fires the crosshair callbacks, and flags _crossActive for _paintCross.
  /** @param {any[]} grids */
  _syncCursor(grids) {
    const m = this._mouse; let active = -1;
    const gx = m ? m.x - this._chartLeftPx : 0;   // grid-local x (chart is offset by sb when scale is on the left)
    if (m && gx >= 0 && gx < this._chartW) {
      for (let k = 0; k < grids.length; k++) { const gk = grids[k]; if (m.y >= gk.offset && m.y < gk.offset + gk.height) { active = k; break; } }
    }
    if (active >= 0) {
      this._cu.sync({ grid_id: active, x: gx, y: /** @type {{ x: number, y: number }} */ (m).y });   // updater subtracts grid.offset itself
      const c = this._comp.cursor;
      // the magnet clamps to the last bar in the future whitespace; let the vertical line follow the
      // mouse there and project the time from the raw x (grids share one time axis, so grid 0 works).
      const g0 = grids[0], cn0 = g0 && g0.candles;
      if (cn0 && cn0.length && gx > cn0[cn0.length - 1].x) { c.x = gx; c.t = g0.screen2t(gx); }
      // Snap the vertical line onto a grabbed time-anchored object (thread bead/vline): x is fixed to
      // the object, the horizontal price line still follows the mouse y. See setCursorSnapX.
      if (this._cursorSnapX != null && g0) { const sx = typeof this._cursorSnapX === 'function' ? this._cursorSnapX() : this._cursorSnapX; if (sx != null && isFinite(sx)) { c.x = sx; c.t = g0.screen2t(sx); } }
      for (const pane of this._panes) pane.cross.visible = true;
      this._crossActive = true;
      const hit = this.hitTest(gx, /** @type {{ x: number, y: number }} */ (m).y);
      this._root.style.cursor = (this._sepHover > 0) ? 'row-resize' : ((hit && hit.cursorStyle) ? hit.cursorStyle : 'crosshair');
      // sourceEvent only on the redraw right after a real pointer move (distinguishes user vs programmatic)
      const srcEv = this._pointerMoved ? this._lastPointerEvent : undefined; this._pointerMoved = false;
      emitCross(this, /** @type {any} */ ({ time: c.t != null ? this._i2t(c.t) / 1000 : null, point: { x: c.x, y: c.y }, hoveredObjectId: hit ? hit.externalId : undefined, sourceEvent: srcEv }));
    } else if (this._forcedCross && this._forcedCross.time != null) {   // programmatic cross (setCursor, cross-pane sync)
      const fc = this._forcedCross, pos = fc.series ? this._posOf(fc.series._pane) : 0, gk = grids[pos];
      const c = this._comp.cursor;
      // cursor.t must be in the layout's x units: a bar INDEX in ib mode (the botbar does i2t(cursor.t)),
      // or time-ms in regular mode. fc.time is seconds from the other pane. grid_id is the POSITION.
      c.grid_id = pos; c.t = this._ib ? this._timeToLogical(fc.time * 1000) : fc.time * 1000;
      c.x = gk ? gk.t2screen(c.t) : undefined;
      c.y$ = fc.price; c.y = (gk && fc.price != null) ? gk.$2screen(fc.price) : undefined;
      for (const pane of this._panes) pane.cross.visible = true;
      this._crossActive = true;
      emitCross(this, /** @type {any} */ ({ time: fc.time, point: { x: c.x, y: c.y } }));
    } else {
      this._clearCursor();
      this._crossActive = false;
      emitCross(this, null, this._leaveEvent);   // carry the leave event once so the app clears the synced crosshair
      this._leaveEvent = null;
    }
  }

  // axis bars: each pane's sidebar (+ primitive/price-line axis views), then the shared botbar.
  // Swap $props.shaders so the price-tag shader (target:'sidebar') runs ONLY where intended.
  _paintAxes() {
    // cursor label toggles: horzLine.showLabel -> sidebar price tag, vertLine.showLabel ->
    // botbar time tag. Suppress by clearing the cursor field each author panel checks (line stays).
    const o = this._options, cur = this._comp.cursor, sY$ = cur.y$, sT = cur.t;
    const showPriceLbl = !(o.cursor && o.cursor.horzLine && o.cursor.horzLine.showLabel === false);
    const showTimeLbl = !(o.cursor && o.cursor.vertLine && o.cursor.vertLine.showLabel === false);
    if (!showPriceLbl) cur.y$ = undefined;
    const p = this._comp.$props;
    for (const pane of this._panes) {
      if (this._showPrice) {   // skip the price axis entirely when hidden (its space is already reclaimed)
        // The author's last-price label is its own sidebar shader; we draw the SAME label in
        // drawAxisViews so every label lives in one system (and can be decluttered). So never
        // apply the sidebar shader here — drawAxisViews owns all price-axis labels.
        p.shaders = this._noShaders; pane.sb.update();
        drawAxisViews(this, pane);
      }
    }
    cur.y$ = sY$; if (!showTimeLbl) cur.t = undefined;
    if (this._showTime) { p.shaders = this._gridShaders; this._bb.update(); drawTimeAxisViews(this); }
    cur.t = sT;
  }

  // paint the crosshair onto each pane's dedicated overlay canvas (stacked above the grid canvas).
  // Clearing/redrawing this layer never touches the candles underneath.
  _paintCross() {
    for (const pane of this._panes) {
      const cv = pane.crossCv; if (!cv) continue;
      const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (this._crossActive) pane.cross.draw(ctx);
    }
  }

  // Boundary at the top of each sub-pane (k>=1): a PLAIN thin line normally; only when the cursor
  // is near it (the drag-to-resize separator) does a soft transparent highlight appear. Drawn on
  // each sub-pane's gridCv, whose y=0 sits exactly at the boundary (canvas placed at grid.offset).
  _drawSeparators() {
    const grids = this._comp.$props.layout && this._comp.$props.layout.grids;
    if (!grids || grids.length < 2) return;
    const colors = this._comp.$props.colors || {};
    for (const pane of this._panes) {
      if (pane.k < 1 || !pane.gridCv) continue;
      const g = grids[pane.k]; if (!g) continue;
      const ctx = pane.gridCv.getContext('2d');
      ctx.save();
      // plain subtle boundary line, always
      ctx.strokeStyle = colors.scale || '#3a3a44'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(g.width, 0.5); ctx.stroke();
      // soft transparent highlight only when the cursor is near (grab affordance)
      if (this._sepHover === pane.k) { ctx.fillStyle = 'rgba(128,128,128,0.18)'; ctx.fillRect(0, 0, g.width, 5); }
      ctx.restore();
    }
  }
  // consumer event emission -- the crosshair-move (onCursorMove) and click (onClick) callbacks, plus
  // the per-series data snapshot at the hovered time -- lives in core/events.js: emitCross(this,...) /
  // emitClick(this,...). (_emitRange stays below; it is called from far more places.)

  // Theme resolvers (chart options -> the author's color keys, and the axis/scale font) live in
  // core/theme.js: colorsFor(this._options) / fontFor(this._options), called from _rebuild + ctor.

  /** @param {number} pos grid POSITION @returns {import('./core/types.js').GridLayout|null} */
  _gridAt(pos) { const L = this._comp.$props.layout; return (L && L.grids[pos]) || null; }   // by grid POSITION
  // pane ID <-> grid POSITION mapping (identity when no pane is hidden/removed)
  /** @param {number} pos grid POSITION @returns {number} pane ID */
  _idAt(pos) { const v = this._paneIds[pos]; return v != null ? v : pos; }
  /** @param {number} id pane ID @returns {number} grid position, or -1 if hidden */
  _posOf(id) { return this._paneIds.indexOf(id); }   // grid position, or -1 if the pane is hidden (no grid)
  /** @param {number} id pane ID @returns {any} grid for a pane ID (null when hidden) */
  _gridOf(id) { return this._gridAt(this._posOf(id)); }   // grid for a pane ID (null when hidden)
  _sbWidth() { return (this._showPrice && this._g) ? /** @type {any} */ (this._g).sb : 0; }
  // is root-relative x over the price-axis strip? (left strip when scale is on the left, else right)
  /** @param {number} x root-relative x */
  _inSidebarZone(x) { return this._showPrice && (this._scaleSide === 'left' ? x < this._sbPx : x >= this._chartLeftPx + this._chartW); }
  /** @param {number} id pane ID @param {number} price @returns {number|null} */
  _priceToCoord(id, price) { const g = this._gridOf(id); return g ? Math.floor(price * g.A + g.B) : null; }   // id = pane ID
  /** @param {number} id pane ID @param {number} y @returns {number|null} */
  _coordToPrice(id, y) { const g = this._gridOf(id); return g ? (y - g.B) / g.A : null; }

  // ---- interaction (native; feeds range/cursor, drives ported calc_zoom/range) ----
  // The native pointer input (mouse / touch / wheel / pan / zoom / pinch / kinetic fling) lives in
  // core/components/input.js; it is wired once from the constructor via wireInput(this).
  // Zoom bounds (maxZoom/minZoom/maxVZoom), the visible-range measures (_visibleHiLo/_visibleCount),
  // the horizontal + vertical zoom clamps, and _emitRange all live in core/time-axis.js; delegated
  // here (input.js drives most of them via `this`).
  _maxZoom() { return maxZoom(this); }
  _minZoom() { return minZoom(this); }
  _maxVZoom() { return maxVZoom(this); }
  /** @param {number} id pane ID @returns {number[]|null} [hi, lo] */
  _visibleHiLo(id) { return visibleHiLo(this, id); }
  /** @param {number[]|null} range [hi, lo] @param {number} id pane ID @returns {number[]|null} */
  _clampVZoom(range, id) { return clampVZoom(this, range, id); }
  // candle body width as a fraction of the bar step (CANDLEW); user-settable, default 0.7.
  _candleWidth() { const v = this._options.candleWidth; return v > 0 ? v : Const.ChartConfig.CANDLEW; }
  _labelGap() { const t = this._options.timeAxis; const v = t && t.labelGap; return v > 0 ? v : Const.ChartConfig.MIN_LABEL_PX; }
  /** @param {[number, number]|null} r [t0, t1] @param {number} [anchor] @returns {[number, number]|null} */
  _clampZoom(r, anchor) { return clampZoom(this, r, anchor); }
  _visibleCount() { return visibleCount(this); }
  _emitRange() { return emitRange(this); }

  // ---- ENGINE_API.md surface ----
  /** @param {import('./core/types.js').SeriesType} type  @param {any} [opts]  @param {number} [paneIndex] */
  addPlot(type, opts = {}, paneIndex = 0) { const s = new Series(this, type, opts, paneIndex); this._series.push(s); this._invalidate(); return s; }
  // Register a user-defined DATA-FED primitive as a first-class series (our open plug-in seam for
  // authoring custom series). The renderer lives in the CALLER's code — the engine drives it with
  // the pane's coordinate space and auto-scales/crosshairs it via priceValues. `view`:
  //   draw(scope)            REQUIRED — paint the series. scope = { ctx, options, series, width,
  //                          height, barWidth, priceToY, yToPrice, timeToX, xToTime, data:[{time,x,point}] }
  //   priceValues(point)     REQUIRED — [..values]; min/max drive auto-scale, last drives the crosshair
  //   defaultOptions()?      base options merged under the caller's opts
  //   destroy()?             called on removePlot
  // Feed it like any series: s.feed([{ time, ...yourFields }]).
  /** @param {any} view custom-series plug-in view  @param {any} [opts]  @param {number} [paneIndex] */
  addCustomPlot(view, opts = {}, paneIndex = 0) {
    const base = (view && typeof view.defaultOptions === 'function') ? view.defaultOptions() : {};
    const s = new Series(this, { type: 'Custom' }, { ...base, ...opts }, paneIndex);
    s._view = view || null;
    this._series.push(s); this._invalidate(); return s;
  }
  /** @param {import('./core/series.js').Series} s */
  removePlot(s) { const i = this._series.indexOf(s); if (i >= 0) this._series.splice(i, 1); if (s && s._view && typeof s._view.destroy === 'function') { try { s._view.destroy(); } catch (_) {} } this._invalidate(); }
  // Shape a pane's AUTO-fit price range (the engine author's overlay y_range hook). fn is
  // (hi, lo) => [hi, lo, exp?]: given the data-driven high/low, return the range to use (and an
  // optional expansion factor). Pass null to clear. Ignored while the user has manually zoomed
  // that pane's scale (manual drag wins). paneId = the paneIndex the series was added with.
  /** @param {number} paneId  @param {Function|null} fn (hi, lo) => [hi, lo, exp?], or null to clear */
  setPaneScale(paneId, fn) { if (fn) this._scaleProviders[paneId] = fn; else delete this._scaleProviders[paneId]; this._invalidate(); }
  /** @param {any} [o] partial chart options to merge live */
  configure(o = {}) {
    const prevOffset = (this._options.timeAxis && this._options.timeAxis.rightOffset) || 0;
    this._options = deepMerge(this._options, o);
    const prevSide = this._scaleSide;
    this._readScaleOpts(o);                          // log mode / invert / side / visibility (runtime)
    // display timezone (hours east of UTC) for tick-mark CLASSIFICATION only (day/month/year
    // boundaries land on local time). Data + coordinates stay UTC; the app's tickFormatter still
    // formats the label. Live-settable so the tz chip updates the axis without a full rebuild.
    if (o.timeAxis && o.timeAxis.timezone != null && this._comp) this._comp.$props.timezone = o.timeAxis.timezone;
    if (this._scaleSide !== prevSide) this._resetPanes();   // side flip -> rebuild sidebars with the new side
    // rightOffset changed (e.g. the "shift end of chart" toggle or the right-margin setting): shift the
    // visible range by the delta so the last-bar gap updates IN PLACE — no reset, scroll position kept
    // (shift the scale, not the data). Only when a range exists and it actually moved.
    if (o.timeAxis && o.timeAxis.rightOffset != null && this._range) {
      const d = ((this._options.timeAxis.rightOffset || 0) - prevOffset);
      if (d) { const shift = this._ib ? d : d * this._iv(); this._range = [this._range[0] + shift, this._range[1] + shift]; this._emitRange(); }
    }
    if (this._root) this._root.style.background = colorsFor(this._options).back;
    this._invalidate(); return this;
  }
  getConfig() { return { ...this._options, localization: this._options.localization || {} }; }   // chart options snapshot
  // parse the price/time-scale options the app uses (applyScale): mode(log), invertScale,
  // left-vs-right side, scale/time-axis visibility
  /** @param {any} o chart options (or a partial from configure) */
  _readScaleOpts(o) {
    const rp = o.rightPriceAxis, lp = o.leftPriceAxis, t = o.timeAxis;
    if (rp && rp.mode != null) this._setPaneMode(0, rp.mode);        // also forces auto-fit on switch to %/indexed
    else if (lp && lp.mode != null) this._setPaneMode(0, lp.mode);
    if (rp && rp.margins) this._mainMargins = rp.margins;   // main-scale margins (top/bottom empty fraction)
    else if (lp && lp.margins) this._mainMargins = lp.margins;
    if ((rp && rp.invert != null) || (lp && lp.invert != null)) this._invert = !!((rp && rp.invert) || (lp && lp.invert));
    if (lp || rp) {
      const leftVis = lp && lp.visible === true, rightVis = rp && rp.visible === true;
      if (leftVis && !rightVis) { this._scaleSide = 'left'; this._showPrice = true; }
      else if (rightVis && !leftVis) { this._scaleSide = 'right'; this._showPrice = true; }
      else if ((lp && lp.visible === false) && (rp && rp.visible === false)) this._showPrice = false;
    }
    if (t && t.visible != null) this._showTime = t.visible !== false;
  }
  // invertScale (flip Y): mutate the pane layout in-place. $2screen/screen2$ read A/B live, so flipping
  // A/B + the precomputed candle/tick y-coords keeps everything consistent (the author has no native flag).
  /** @param {any} g one built grid (mutated in place) */
  _invertGrid(g) {
    const H = g.height, fy = (/** @type {number} */ y) => H - y;
    if (g.candles) for (const c of g.candles) { c.o = fy(c.o); c.h = fy(c.h); c.l = fy(c.l); c.c = fy(c.c); }
    if (g.ys) for (const tk of g.ys) tk[0] = fy(tk[0]);
    g.A = -g.A; g.B = H - g.B;
  }
  _resetPanes() { return resetPanes(this); }
  rootEl() { return this.el; }
  // the pane-ops surface (panes()/removePane/_movePane) lives in core/panes.js; delegated here.
  panes() { return panesApi(this); }
  /** @param {number} index pane ID */
  removePane(index) { return removePaneApi(this, index); }
  /** @param {number} from  @param {number} to */
  _movePane(from, to) { return movePane(this, from, to); }
  /** @param {number} k pane ID  @param {number} mode price-scale mode */
  _setPaneMode(k, mode) {
    mode = mode | 0;
    const changed = (this._scaleMode[k] || 0) !== mode;
    this._scaleMode[k] = mode;
    // switching TO Percentage/IndexedTo100 forces autoScale on. The axis is
    // rebased to the first visible value, so a stale manual price range / zoom left over from Regular
    // (panes go manual on pan/zoom) must be dropped or the % axis lands way off. Only on the change.
    if (changed && (mode === 2 || mode === 3)) this._resetPaneAuto(k);
    this._invalidate();
  }
  /** @param {number} k pane ID @returns {number} */
  _modeOf(k) { return this._scaleMode[k] || 0; }
  /** @param {number} k pane ID */
  _paneLogOf(k) { return this._modeOf(k) === 1; }   // log branch (y-drag zoom) — only mode 1
  // Percentage/IndexedTo100 axes are rebased-to-first-visible and AUTO-FIT ONLY: the manual
  // price-axis zoom/scroll is disabled (scale/scroll gestures all
  // early-return in these modes). pos = grid POSITION.
  /** @param {number} pos grid POSITION */
  _scaleLockedAt(pos) { const m = this._modeOf(this._idAt(pos)); return m === 2 || m === 3; }
  /** @param {import('./core/series.js').Series} [s] @returns {number} pane ID */
  paneIndexOf(s) { return s ? s._pane : 0; }
  addPane() { return addPaneApi(this); }
  /** @param {number} p price @returns {number|null} */
  priceToY(p) { return this._priceToCoord(0, p); }
  /** @param {number} y @returns {number|null} price */
  yToPrice(y) { return this._coordToPrice(0, y); }
  /** @param {Function} cb */
  onCursorMove(cb) { this._cbs.crosshair.add(cb); }
  /** @param {Function} cb */
  offCursorMove(cb) { this._cbs.crosshair.delete(cb); }
  /** @param {Function} cb */
  onClick(cb) { this._cbs.click.add(cb); }
  /** @param {Function} cb */
  offClick(cb) { this._cbs.click.delete(cb); }
  // Future whitespace: session-following time slots (unix SECONDS) past the last real bar. Each becomes a
  // [t_ms, null, null, null, null, null] row appended to the INDEXED stream in _rebuild, so i2t/t2i resolve
  // future indices by lookup instead of extrapolating real clock time (which drags weekend gaps back in).
  // ib mode only; the app owns the session model that generates these. Pass [] / null to clear.
  /** @param {number[]|null} times session-following time slots (unix SECONDS), or [] / null to clear */
  setFutureWhitespace(times) {
    this._future = (this._ib && Array.isArray(times) && times.length)
      ? times.map((t) => [Math.round(t * 1000), null, null, null, null, null])
      : null;
    this._invalidate();
  }
  /** @param {number} price  @param {number} time seconds  @param {import('./core/series.js').Series} [series] */
  setCursor(price, time, series) { this._forcedCross = { price, time, series }; this._scheduleCursor(); }
  clearCursor() { this._forcedCross = null; this._scheduleCursor(); }
  // Pin the cursor's VERTICAL line to a screen x (the horizontal price line still tracks the mouse y).
  // Used while grabbing a time-anchored on-chart object (a thread's bead/vline): the vertical crosshair
  // sticks to the object instead of wandering with the pointer in the whitespace. Pass a function that
  // returns the live screen x each frame (so it tracks pan), a fixed number, or null to release.
  /** @param {(() => number|null)|number|null} x */
  setCursorSnapX(x) { this._cursorSnapX = x; this._scheduleCursor(); }
  snapshot() { return this._panes[0] ? this._panes[0].gridCv : null; }
  // the public time-scale API object (window/zoom/scroll/coord/configure) lives in core/time-axis.js.
  timeAxis() { return timeAxisApi(this); }
  /** @param {number} [id] pane ID */
  priceAxis(id) {
    const c = this;
    return { width: () => c._sbWidth(), configure: (/** @type {any} */ o = {}) => { if (o.mode != null) c._setPaneMode(0, o.mode); }, getConfig: () => ({ mode: c._modeOf(0) }) };
  }
  destroy() {
    try { this._ro.disconnect(); } catch (_) {}
    try { this.el.removeChild(this._root); } catch (_) {}
    for (const k in this._cbs) { try { (/** @type {Record<string, Set<Function>>} */ (this._cbs))[k].clear(); } catch (_) {} }   // drop all subscriptions (no lingering callbacks)
  }
}

/** Mount a chart into a container element. @param {HTMLElement} el  @param {import('./core/types.js').ChartOptions} [options]  @returns {Chart} */
export function mountChart(el, options) { return new Chart(el, options); }
export default { mountChart, CursorMode, Stroke, Candles, Line, Area, Baseline, Columns, Segments, HBars };
