// @ts-check
// A single chart pane: its own chart, symbol, timeframe, and bar subscription.
// Layouts simply create N of these and arrange them in a grid.
import { broker } from '../../data_engine/index.js';
import { getSetting } from '../settings/settings.js';
import { sharedMarketHours } from '../market/market-hours.js';
import { byId, barMs } from '../workspace/timeframes.js';
import { bus } from '../bus.js';
import { log } from '../dom.js';
import { StudyHost } from '../studies/host.js';
import { createSkin } from '../../lib/kapelka/skin/index.js';
import { openStudySettings } from '../studies/settings.js';
import { DrawingEngine } from '../tools/engine/engine.js';
import { createAlertPrimitive } from '../alerts/alert-primitive.js';
import { PlusButton } from '../settings/plus-button.js';

// Chart engine: the de-Vue vanilla port — imported DIRECTLY from source (lib/kapelka/),
// not a bundle. Edit a source file -> reload.
import { mountChart, Candles, CursorMode } from '../../lib/kapelka/index.js';

// Pure formatters + appearance defaults live in sibling modules (lifted out of this file). Import the
// ones the Pane uses internally; re-export the public names so external import paths stay unchanged.
import { DATE_FMT_DEFAULT } from './pane-format.js';
import { candleOptions,
         CANDLES_DEFAULT, CANVAS_DEFAULT, STATUS_DEFAULT, INDICATORS_DEFAULT, TRADES_DEFAULT,
         LINE_DEFAULTS, LINE_STYLE_DEFAULT } from './pane-defaults.js';
export { DATE_FMT_DEFAULT, DATE_FMT_EXAMPLES } from './pane-format.js';
export { CANDLES_DEFAULT, LINE_STYLE_DEFAULT, PRICE_SOURCE_OPTIONS, CANVAS_DEFAULT, STATUS_DEFAULT,
         INDICATORS_DEFAULT, TRADES_DEFAULT, LINE_DEFAULTS, LINE_KEYS, SCALE_FONT_DEFAULT } from './pane-defaults.js';
// Feature subsystems split out into ./pane/*.js as prototype mixins -- each is a plain object of
// methods that run with `this` bound to the Pane instance. Object.assign puts them on the prototype,
// so `this` and every cross-method call behave exactly as when they were inline.
import { compareMethods } from './pane/compare.js';
import { tradesMethods } from './pane/trades.js';
import { dataMethods } from './pane/data.js';
import { chartTypeMethods } from './pane/chart-type.js';
import { priceLineMethods } from './pane/price-lines.js';
import { controlMethods } from './pane/controls.js';
import { surfaceMethods } from './pane/surfaces.js';
import { marketDotMethods } from './pane/market-dot.js';
import { appearanceMethods } from './pane/appearance.js';
import { createOrderOverlay } from './order-view/order-overlay.js';

// ---- App-side type shapes -----------------------------------------------------------------------
// The vendored kapelka chart engine (the chart instance, series/plots, price/time axes, level +
// overlay handles, and every engine options object) carries NO TS types here, so those are `any` at
// this boundary -- honest, not a shortcut. The app's OWN structured state (settings, bars, surfaces)
// gets real types below.

// An OHLC(V) bar as the pane holds it (broker/cache times in epoch SECONDS on `time`).
/**
 * @typedef {Object} Bar
 * @property {number} time
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} [volume]
 */

// Per-series line/area style (settings.line, and settings.compare.line).
/**
 * @typedef {Object} LineStyle
 * @property {string} source
 * @property {string} color
 * @property {number} lineWidth
 * @property {string} lineStyle
 * @property {string} highColor
 * @property {string} lowColor
 */

// The compare-overlay config persisted under settings.compare.
/**
 * @typedef {Object} CompareSettings
 * @property {string} [chartType]
 * @property {number} [paneIdx]
 * @property {LineStyle} line
 * @property {any} [brokerId]
 * @property {any} [symbol]
 */

// The pane's persisted appearance/behaviour settings. The structured nested groups (candles/canvas/…)
// and the app-side flags below are typed; the `& Record<string, any>` tail covers the remaining flat
// "Scales and lines" (LINE_DEFAULTS) + mixin-owned keys -- this object is spread from arbitrary saved
// settings, so it stays extensible.
// The constructor always populates the nested groups (candles/canvas/statusLine/indicators/trades/line)
// and the chartType flag, so on the live `this.settings` they are REQUIRED; the incoming constructor
// arg is a Partial of this (any subset of saved keys).
/**
 * @typedef {{
 *   chartType: 'candles'|'line',
 *   candles: Record<string, any>,
 *   canvas: Record<string, any>,
 *   statusLine: Record<string, any>,
 *   indicators: Record<string, any>,
 *   trades: Record<string, any>,
 *   line: LineStyle,
 *   board?: boolean,
 *   pricePane?: boolean,
 *   compare?: CompareSettings,
 *   mainPaneIdx?: number,
 *   tsDateFmt?: string,
 *   priceLine?: boolean,
 *   lastPriceLabel?: boolean,
 *   plusButton?: boolean,
 *   scaleLeft?: boolean,
 *   priceScale?: boolean,
 *   timeScale?: boolean,
 *   invertScale?: boolean,
 *   priceScaleMode?: number
 * } & Record<string, any>} PaneSettings
 */

// The live market state returned by MarketHours.stateAt(); the engine/session boundary is `any`,
// so the several state-specific fields (nextOpen/msToOpen/session/progress/…) are read off it loosely.
/** @typedef {any} MarketState */

// A drawable surface entry (main pane + sub-panes), top->bottom.
/**
 * @typedef {Object} Surface
 * @property {any} engine                        the surface's DrawingEngine (engine boundary)
 * @property {() => number} top                  routing boundary (global y)
 * @property {() => number} yOffset              global y -> this surface's local (price-scale) y
 * @property {() => Map<number, Bar>} bars       the bar map this surface draws against
 */

export class Pane {
  /**
   * @param {{ symbol?: string, tfId?: string|null, range?: { from: number, to: number }|null,
   *           settings?: Partial<PaneSettings>, broker?: any }} [opts]
   */
  constructor({ symbol = '', tfId = null, range = null, settings = {}, broker: brokerId = null } = {}) {   // no symbol until a broker is connected and one is picked (blank slate has none)
    /** @type {string} */
    this.symbol = symbol;
    /** @type {string|null} */
    this.tfId = tfId;
    this.broker = brokerId;      // which broker this pane's data comes from (null = active)
    /** @type {{ from: number, to: number }|null} */
    this.range = range;          // saved pan/zoom (visible time range)
    // the nested groups + chartType are populated on the lines below, so cast the partial seed to the
    // fully-populated shape here (its required members are all filled in before the constructor returns).
    /** @type {PaneSettings} */
    this.settings = /** @type {PaneSettings} */ ({
      ...structuredClone(LINE_DEFAULTS),
      ...settings,
    });
    // migrate legacy date-format preset ids (non-empty, no '%') to a strftime pattern; blank stays blank
    const tdf = this.settings.tsDateFmt;
    if (tdf && !String(tdf).includes('%')) this.settings.tsDateFmt = DATE_FMT_DEFAULT;
    this.settings.candles = { ...CANDLES_DEFAULT, ...(settings.candles || {}) };
    this.settings.canvas = { ...CANVAS_DEFAULT, ...(settings.canvas || {}) };
    this.settings.statusLine = { ...STATUS_DEFAULT, ...(settings.statusLine || {}) };
    this.settings.indicators = { ...INDICATORS_DEFAULT, ...(settings.indicators || {}) };
    this.settings.trades = { ...TRADES_DEFAULT, ...(settings.trades || {}) };
    this._trades = [];        // fills for this.symbol (from the broker), drawn as arrow markers
    /** @type {{ refresh: () => void, destroy: () => void }|null} */
    this.orderView = null;    // per-pane order-book overlay (position + exits, drawn from the platform book)
    this._tradeCb = null;     // live-fill subscription callback (unsubscribed on hide/destroy)
    this._tradeSym = null;    // symbol the current fills were fetched for
    // chart type: 'candles' (OHLC) | 'line'. Line draws a price-source value per bar.
    this.settings.chartType = settings.chartType === 'line' ? 'line' : 'candles';
    this.settings.line = { ...LINE_STYLE_DEFAULT, ...(settings.line || {}) };
    // Study-board pane: no candle series -- a single study owns pane 0 (a chart-less window). Every
    // candle-specific path below is gated on this; regular panes are entirely unaffected.
    this.board = this.settings.board === true;
    /** @type {any} */
    this.contractId = null;
    /** @type {any} shared per-instrument trading-session model (set on resolve); engine/session boundary */
    this.marketHours = null;   // feeds the status dot + corrector
    /** @type {(() => void)|null} */
    this._mhUnsub = null;      // unsubscribe from the shared model's onUpdate (it outlives the pane -> must detach)
    this.priceDecimals = 2;
    /** @type {number|null} */
    this.tickSize = null;   // instrument min price increment (e.g. 0.25 for ES); drawings snap price to it
    this.reqId = 0;
    this.olderReqId = 0;         // in-flight lazy-history fetch (dropped on destroy)
    /** @type {number|null} */
    this.olderCursorMs = null;   // backward cursor for lazy history (skips empty gaps)
    this.gapHops = 0;            // consecutive empty older-windows skipped
    this.cached = false;         // is this (broker, symbol) in the persistent cache library?
    this.lastStored = 0;         // newest bar time written to the cache (avoids re-POSTing)
    this.destroyed = false;      // guards async bar callbacks after teardown
    this.blanked = false;        // board pane: anchored chart closed -> blanked (no data/subscription)
    /** @type {Map<number, Bar>} */
    this.bars = new Map();
    /** @type {Bar[]} */
    this.barArr = [];
    /** @type {number[]} */
    this.barTimes = [];
    this.seeded = false;
    this._openPending = false;   // opening-fill hold (set in requestBars for uncached, non-board panes)
    /** @type {number|null} */
    this._boardWantFrom = null;  // board pane: deepest anchor-pushed left edge (secs) history must cover
    /** @type {number|null} */
    this.earliest = null;        // oldest loaded DISPLAY bar time (for lazy history)
    // ---- clock-anchored aggregation (session-anchored feeds like RTH futures) ----
    this._aggregate = false;     // this feed is off the clock grid -> derive display bars from a base TF
    /** @type {string|null} */
    this._baseTf = null;         // the base TF we fetch/cache/subscribe when aggregating (else display TF)
    /** @type {Map<number, Bar>} */
    this._base = new Map();      // base-TF bars (source of truth), keyed by time; display bars are derived
    /** @type {number|null} */
    this._baseEarliest = null;   // oldest base-bar time (the older-history cursor in aggregate mode)
    this.loadingOlder = false;
    this.exhausted = false;
    this.barCount = 0;
    /** @type {number|null} */
    this.bid = null;
    /** @type {number|null} */
    this.ask = null;
    /** @type {number|null} */
    this.bidSize = null;
    /** @type {number|null} */
    this.askSize = null;
    /** @type {number|null} */
    this.lastSize = null;   // top-of-book / last-trade size, when the feed carries it
    /** @type {any} */
    this.bidLineObj = null;
    /** @type {any} */
    this.askLineObj = null;
    this.mdSubscribed = false;
    /** @type {number|null} */
    this.lastClose = null;
    /** @type {Bar|null} */
    this.lastBar = null;
    this.hovering = false;
    /** @type {ReturnType<typeof setInterval>|null} */
    this.cdTimer = null;
    /** @type {any} { brokerId, symbol, contractId, reqId, bars, series } when comparing (engine boundary) */
    this.compare = null;
    /** @type {HTMLElement|null} */
    this.compareEl = null;
    /** @type {string|null} */
    this.compareHlMode = null;   // quick High/Low DISPLAY override for the compare overlay (mirrors hlMode)
    /** @type {Surface[]} */
    this.surfaces = [];      // drawable surfaces (main pane + sub-panes), top→bottom

    // ---- late-bound fields (assigned by prototype-mixin methods / addControls). Declared as bare typed
    // statements so the strict checker sees them on the instance: a bare `this.x;` is a no-op property
    // READ (no assignment), so there is ZERO runtime effect -- these lines exist only for the type. ----
    /** @type {any} the pane's live quote callback (set in ensureMd) */
    this.mdCb;
    /** @type {HTMLElement|undefined} on-chart control chrome (addControls) */
    this.controls;
    /** @type {HTMLElement|undefined} */
    this.statusEl;
    /** @type {HTMLElement|undefined} */
    this.titleEl;
    /** @type {HTMLElement|undefined} */
    this.valuesEl;
    /** @type {HTMLElement|undefined} market-status dot in the status line */
    this.mktDotEl;
    /** @type {HTMLElement|undefined} scroll-to-realtime button */
    this.forwardBtn;
    /** @type {ReturnType<typeof setInterval>|undefined} market-dot refresh timer */
    this._mktTimer;
    /** @type {ReturnType<typeof setTimeout>|undefined} opening-fill settle timer */
    this._openSettle;
    /** @type {ReturnType<typeof setTimeout>|undefined} opening-fill hard-cap timer */
    this._openMax;
    /** @type {{ from: number, to: number }|undefined} pending visible range for viewport studies */
    this._vrPending;
    /** @type {number|undefined} rAF handle throttling the viewport-range push */
    this._vrRaf;
    /** @type {number|undefined} timestamp of the last REAL user pan/zoom on this pane */
    this._userRangeAt;
    /** @type {string|undefined} cache key for the projected future-whitespace grid */
    this._fwKey;
    /** @type {boolean|undefined} opening-fill: deep-history load already kicked */
    this._openFillKicked;
    /** @type {Bar[]|'full'|null|undefined} last-bar ops accumulated by _ingest for redraw's fast path */
    this._fastOps;
    /** @type {number|null|undefined} working last-bar time while _fastOps accumulates */
    this._fastLastTime;
    /** @type {HTMLElement|undefined} board-pane "main chart not open" overlay */
    this._blankEl;
    /** @type {any} open market-hours popup element (null when closed) */
    this._mktPopup;
    /** @type {((e: PointerEvent) => void)|null|undefined} outside-click handler while the popup is open */
    this._mktPopupOff;

    // ---- prototype-mixin methods (Object.assign'd onto the prototype from ./pane/*.js at the bottom of
    // this file). Declared here as bare typed statements -- a no-op property READ, zero runtime effect --
    // so the strict checker resolves the cross-method calls to their real signatures. ----
    /** @type {() => void} */ this.applyChartType;
    /** @type {(param: any) => void} */ this._hoverTrade;
    /** @type {() => void} */ this.loadOlder;
    /** @type {() => void} */ this.addControls;
    /** @type {() => void} */ this._scheduleApplyOrder;
    /** @type {(series: any) => number} */ this.paneTopOf;
    /** @type {() => void} */ this.applyTrades;
    /** @type {(t: any) => void} */ this.previewTrades;
    /** @type {() => void} */ this.applyCountdown;
    /** @type {() => void} */ this.applySpread;
    /** @type {() => void} */ this.updateLines;
    /** @type {() => void} */ this.updateSpread;
    /** @type {(key: string) => void} */ this.removeLine;
    /** @type {() => void} */ this._positionBoardCtrls;
    /** @type {() => void} */ this.requestBars;
    /** @type {() => void} */ this._compareRequest;
    /** @type {() => void} */ this._compareFollow;
    /** @type {() => void} */ this._restoreCompare;
    /** @type {() => void} */ this.removeCompare;
    /** @type {() => void} */ this._stopTradeFeed;
    /** @type {() => void} */ this._armOpenSettle;
    /** @type {() => void} */ this._feedLine;
    /** @type {() => (b: Bar) => number} */ this._priceSource;
    /** @type {(slOverride?: any) => void} */ this.updateMarketDot;
    /** @type {() => void} */ this._hideMarketPopup;
    /** @type {(c: any) => void} */ this.applyCandlesObj;
    /** @type {() => void} */ this.applyCandles;
    /** @type {(c: any) => void} */ this.previewCandles;
    /** @type {() => void} */ this.applyTz;
    /** @type {(c: any) => void} */ this.applyCanvasObj;
    /** @type {(mode: string) => void} */ this.applyNavButtons;
    /** @type {(mode: string) => void} */ this.applyPaneButtons;
    /** @type {() => void} */ this.applyCanvas;
    /** @type {(c: any) => void} */ this.previewCanvas;
    /** @type {() => boolean} */ this.shiftEndOn;
    /** @type {() => boolean} */ this.toggleShiftEnd;
    /** @type {() => boolean} */ this.autoScrollOn;
    /** @type {() => boolean} */ this.toggleAutoScroll;
    /** @type {() => any} */ this.getAppearance;
    /** @type {() => Record<string, any>} */ this.getLineSettings;
    /** @type {(obj: Record<string, any>) => void} */ this.applyLineSettings;
    /** @type {(a: any) => void} */ this.previewAppearance;
    /** @type {() => void} */ this.applyAppearance;
    /** @type {(a: any) => void} */ this.commitAppearance;
    /** @type {() => void} */ this.applyIndicators;
    /** @type {(ind: any) => void} */ this.previewIndicators;
    /** @type {(ind: any) => void} */ this.applyIndicatorsObj;
    /** @type {(s: any) => void} */ this.applyStatusObj;
    /** @type {() => void} */ this.applyStatus;
    /** @type {(s: any) => void} */ this.previewStatus;
    /** @type {(bar?: Bar) => void} */ this.updateValues;
    /** @type {() => void} */ this.applyScale;
    /** @type {(key: string, value: any) => void} */ this.setLineSetting;
    /** @type {() => void} */ this.applySettings;
    /** render gate: hidden behind a maximized sibling -> paint + study recompute paused @type {boolean} */
    this._renderPaused = false;
    /** a redraw was skipped while render-paused; replay it on un-hide @type {boolean} */
    this._pendingRedraw = false;

    this.el = document.createElement('div');
    this.el.className = 'pane';
    /** @type {any} the kapelka chart instance (engine boundary) */
    this.chart = mountChart(this.el, {
      autoSize: true,
      // GLOBAL paint conflation (Settings > App > Optimization): minimum ms between canvas repaints; 0 = every
      // data change paints on the next frame. Live changes reach running panes via applyOptimization().
      conflate: Math.max(0, Number(getSetting('optPaintConflateMs')) || 0),
      // Index-based time axis: bars sit side-by-side by
      // index, so session/overnight/weekend gaps collapse instead of opening empty space.
      ib: true,
      layout: { background: { color: '#0e0e11' }, textColor: '#ddd' },
      grid: { vertLines: { color: '#1a1a20' }, horzLines: { color: '#1a1a20' } },
      cursor: { mode: CursorMode.Free },
      timeAxis: { timeVisible: true, secondsVisible: false, borderColor: '#333' },
      rightPriceAxis: { borderColor: '#333' },
    });
    // Regular pane: the candlestick series owns the axes. Board pane: skip it -- the study claims pane 0
    // (kapelka now lets a non-candle series own the axis) and `this.series` (getter) resolves to it.
    // A regular pane gets a candle series. A STUDY board pane gets none (a study owns the axis). A
    // COMPARE/price board pane (settings.pricePane) DOES get candles -- it's a mini price chart of its
    // symbol, stacked in the board and synced to the anchor like the "+ compare" feature.
    /** @type {any} the candlestick plot handle, or null on a study board pane (engine boundary) */
    this._series = (this.board && !this.settings.pricePane) ? null : this.chart.addPlot(Candles, {
      ...candleOptions(/** @type {any} */ (this.settings.candles)),
      showPriceLine: this.settings.priceLine,
      showLastValue: this.settings.lastPriceLabel,
    });
    /** @type {any} Line-chart overlay (created on demand by applyChartType) */
    this.lineSeries = null;
    if ((!this.board || this.settings.pricePane) && this.settings.chartType === 'line') this.applyChartType();

    // Shift + wheel = scroll left/right without zoom is now a native ENGINE gesture (handled in the
    // engine's wheel handler), so the app no longer intercepts it here.

    // Scale cursors: the right price scale rescales vertically (ns-resize) and the
    // bottom time scale rescales horizontally (ew-resize). Set it inline on the scale
    // canvas (inline beats the global crosshair CSS); clear it over the main area so
    // the crosshair shows again.
    this.el.addEventListener('pointermove', (e) => {
      if (!e.target || /** @type {HTMLElement} */ (e.target).tagName !== 'CANVAS') return;
      const r = this.el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let pw = 0, th = 0;
      try { pw = this.chart.priceAxis('right').width(); th = this.chart.timeAxis().height(); } catch (_) {}
      const cur = y > r.height - th ? 'ew-resize' : (x > r.width - pw ? 'ns-resize' : '');
      if (/** @type {HTMLElement} */ (e.target).style.cursor !== cur) /** @type {HTMLElement} */ (e.target).style.cursor = cur;
    });

    // Broadcast only real user hovers; programmatic moves have no sourceEvent
    // (this is what prevents a sync feedback loop between panes).
    this.chart.onCursorMove((/** @type {any} */ param) => {
      // status-line OHLC values: hovered bar, or latest when not over data
      this.hovering = param.time != null;
      if (this.settings.statusLine.chartValues) {
        const d = (this.hovering && param.seriesData) ? param.seriesData.get(this.series) : null;
        this.updateValues(d);
      }
      // onCrosshair is a no-op stub (StudyHost) whose typed signature takes no args; the ignored
      // `param` is passed at runtime, so cast the receiver to keep the exact (harmless) call form
      // (also keeps the original always-present guard from being flagged as always-true).
      if (this.studies && /** @type {any} */ (this.studies).onCrosshair) /** @type {any} */ (this.studies).onCrosshair(param);   // sub-pane legend values
      this._hoverTrade(param);   // execution-tick tooltip
      if (param.sourceEvent === undefined) return;
      // free price under the cursor (not snapped to a candle), so the mirrored
      // crosshair floats at the same price/time rather than locking to a bar
      const price = (param.point && this.series) ? this.series.yToPrice(param.point.y) : null;
      bus.emit('crosshair', { source: this, time: param.time, price });
    });

    // remember pan/zoom so reopening the layout restores the exact view.
    // Only after seeding — ignore the range churn during initial data load.
    this.chart.timeAxis().onTimeWindow((/** @type {{ from: number, to: number }|null} */ r) => {
      if (!this.seeded || !r) return;
      this.range = { from: r.from, to: r.to };
      bus.emit('pane:range', this);   // pass the source pane so the layout can time-sync the others
      // feed the visible window to viewport-reactive studies (throttled to one recompute per frame)
      this._vrPending = { from: r.from, to: r.to };
      if (!this._vrRaf) this._vrRaf = requestAnimationFrame(() => { this._vrRaf = 0; if (this.studies && this.studies.setVisibleRange) this.studies.setVisibleRange(this._vrPending); });
    });

    // mark a REAL user pan/zoom on this pane (wheel = zoom, drag = pan). The study-board sync uses this so
    // only genuine scrolls push to the anchored chart -- programmatic range shifts (data-feed prepend that
    // keeps the newest bar pinned, seed auto-fit, adopt) must NOT move the linked chart.
    const markUserRange = () => { this._userRangeAt = Date.now(); };
    this.el.addEventListener('wheel', markUserRange, { capture: true, passive: true });
    this.el.addEventListener('pointermove', (e) => { if (e.buttons) markUserRange(); }, { capture: true, passive: true });

    // lazy-load older history near the left edge; toggle the forward button
    this.chart.timeAxis().onBarWindow((/** @type {{ from: number, to: number }|null} */ lr) => {
      if (!lr) return;
      if (this.seeded && !this.loadingOlder && !this.exhausted && lr.from < 10) this.loadOlder();
      this.updateForward(lr);
    });

    // right-click → context menu (handled by chart-dialog via the bus)
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      bus.emit('pane:contextmenu', { event: e, pane: this });
    });

    // chart clicks → tool controller (with chart coords), for drawing tools
    this.chart.onClick((/** @type {any} */ param) => {
      if (!param.point) return;
      const price = this.series ? this.series.yToPrice(param.point.y) : null;
      bus.emit('pane:click', { pane: this, time: param.time ?? null, price, x: param.point.x, y: param.point.y });
    });

    this.addControls();

    // attached indicators + drawings (restored from saved pane settings)
    this.studies = new StudyHost(this);
    // GLOBAL study recompute throttle (Settings > App > Optimization); live changes via applyOptimization()
    /** @type {any} */ (this.studies).setThrottle(Math.max(0, Number(getSetting('optStudyRecomputeMs')) || 0));
    // kapelka/skin: adopt the library's sub-pane legend (first piece of the chrome migration).
    // openSettings is pointed at the app's richer settings window, not the library's config.
    this.skin = createSkin(this.studies, { chart: this.chart, container: this.el, pieces: ['legend', 'controls', 'overlay'], overlayTop: 32 });
    // openSettings is an app-added hook on the skin (not part of createSkin's returned shape) -> cast.
    /** @type {any} */ (this.skin).openSettings = (/** @type {any} */ a) => { const i = this.studies.attached.indexOf(a); if (i >= 0) openStudySettings(this, i); };
    this.applyIndicators();   // push saved legend display options (title/values/bg) to the skin
    this.studies.restore();
    this._scheduleApplyOrder();   // arrange restored oscillator panes to the saved order
    this.drawings = new DrawingEngine(this);
    this.drawings.restore();
    this.plus = new PlusButton(this);
    this.plus.setEnabled(this.settings.plusButton && !this.board);   // no price-scale "+" (alert) on board panes
    // Alert markers: the alert engine's OWN on-chart layer (NOT a drawing). It renders every price-level alert
    // for this symbol that has no chart object -- quick "Add alert at <price>" and Value alerts from the manager --
    // as a dashed line + bell badge + price tag. Drawing-anchored alerts are marked by the badge on their drawing.
    this.alertLayer = this._series ? createAlertPrimitive(this) : null;   // chart panes only (board panes have no candle series)
    if (this.alertLayer) { try { this.series.addLayer(this.alertLayer); } catch (_) {} }
    // the main pane is surface 0 (top of the chart); sub-panes register below it.
    // top() = routing boundary; yOffset() = how much to subtract from a global y to get
    // this surface's local (price-scale) y.
    this.surfaces = [{ engine: this.drawings, top: () => this.paneTopOf(this.series), yOffset: () => this.paneTopOf(this.series), bars: () => this.bars }];
    // ORDER-BOOK overlay: draws this pane's position + exits straight from the platform book (app-owned, not the
    // addon). Chart panes only -- board/oscillator panes have no price context for it.
    if (!this.board) this.orderView = createOrderOverlay(this);
  }

  // The pane's MAIN series. Regular pane -> the candlestick series. Board pane -> the study that owns
  // pane 0, resolved lazily (a study's plot is created asynchronously after it first computes). Every
  // this.series READER goes through here; the few candle-specific WRITERS are gated on _series/board.
  get series() {
    if (this._series) return this._series;
    if (this.board && this.studies) {
      const a = this.studies.attached && this.studies.attached[0];
      if (a && a.plots && a.plots.size) return a.plots.values().next().value;
    }
    return null;
  }

  // Multi-pane surfaces + persisted ordering + per-series pane-height modes (surfaceAt / paneIndexOf /
  // paneTopOf / applyPaneMode / addPaneSurface / _orderOccupants / _applyPaneOrder / …) are split into
  // ./pane/surfaces.js and Object.assign'd onto the prototype below.

  // The appearance layer (applyX = committed / previewX = transient: candles, canvas + nav/pane
  // buttons, applyTz, scales, "Scales and lines" keys, indicator-legend options, status line + OHLC
  // values, the appearance snapshot + commit) is split into ./pane/appearance.js and Object.assign'd
  // onto the prototype below.

  // ---- chart type: OHLC candles vs Line ----
  // The candlestick series is never replaced (it owns the axis + price range); a line chart hides the
  // candle body/border/wick and overlays a Line series (one price-source value per bar). That plus the
  // quick High/Low source toggle, the dialog setters, the shared chart-type dialog target factory
  // (_ctTarget, also used by the compare mixin) and the H/L button are split into ./pane/chart-type.js
  // and Object.assign'd onto the prototype below.

  // Executed-trades overlay (applyTrades/_updateTrades/_startTradeFeed/…/_hideTradeTip) is split into
  // ./pane/trades.js and Object.assign'd onto the prototype below.

  // The on-chart control chrome (addControls / _buildBoardCtrls / _buildMainHL / _positionBoardCtrls /
  // setBoardCollapsed) is split into ./pane/controls.js and Object.assign'd onto the prototype below.

  // The market-status dot + its info popup (updateMarketDot / _toggleMarketPopup / _hideMarketPopup /
  // _renderMarketPopup) are split into ./pane/market-dot.js and Object.assign'd onto the prototype below.
  // The dot element + its refresh timer are built in ./pane/controls.js (addControls).

  /** @param {{ from: number, to: number }} lr */
  updateForward(lr) {
    if (!this.forwardBtn) return;
    // Study board panes don't own their scroll -- the anchored chart's sync drives the window -- so the
    // scroll-to-realtime button is meaningless here; keep it hidden.
    const back = !this.board && this.seeded && this.barCount > 0 && lr.to < this.barCount - 1;
    this.forwardBtn.style.display = back ? 'flex' : 'none';
  }

  refreshMd() {
    const s = this.settings;
    const want = s.bidLine || s.askLine || s.bidLabel || s.askLabel || s.spreadMeter;   // line/label/spread needs quotes
    if (want && this.contractId) this.ensureMd();
    else this.teardownMd();
  }
  /** @returns {any} this pane's broker adapter (or active) -- the broker/adapter boundary is untyped here */
  api() { return broker.for(this.broker); }
  ensureMd() {
    if (!this.mdSubscribed) {
      this.mdSubscribed = true;
      this.mdCb = (/** @type {any} */ q) => this.onQuotes(q);
      this.api() && this.api().subscribeQuotes(this.contractId, this.mdCb);
    }
    this.updateLines();
  }
  teardownMd() {
    if (this.mdSubscribed) { this.api() && this.api().unsubscribeQuotes(this.contractId, this.mdCb); this.mdSubscribed = false; }
    this.removeLine('bidLineObj'); this.removeLine('askLineObj');
    this.bid = this.ask = null;
    this.bidSize = this.askSize = this.lastSize = null;
  }
  /** @param {any} q */
  onQuotes(q) {
    if (q.bid != null) this.bid = q.bid;
    if (q.ask != null) this.ask = q.ask;
    if (q.bidSize != null) this.bidSize = q.bidSize;
    if (q.askSize != null) this.askSize = q.askSize;
    if (q.lastSize != null) this.lastSize = q.lastSize;
    this.updateLines();
    this.updateSpread();
  }
  // Price-scale overlays (bid/ask lines, countdown-to-close, spread meter) are split into
  // ./pane/price-lines.js and Object.assign'd onto the prototype below.

  /** @param {number} factor */
  zoom(factor) {
    const ts = this.chart.timeAxis();
    const lr = ts.barWindow();
    if (!lr) return;
    const center = (lr.from + lr.to) / 2;
    const half = ((lr.to - lr.from) / 2) * factor;
    ts.setBarWindow({ from: center - half, to: center + half });
  }
  scrollStep() {
    const lr = this.chart.timeAxis().barWindow();
    return lr ? Math.max(1, Math.round((lr.to - lr.from) * 0.25)) : 10;
  }
  /** @param {number} bars */
  scroll(bars) {
    const ts = this.chart.timeAxis();
    const lr = ts.barWindow();
    if (!lr) return;
    ts.setBarWindow({ from: lr.from + bars, to: lr.to + bars });
  }

  tf() { return byId(this.tfId); }

  // auto-fit recent data to the screen: re-enable price auto-scale (respecting
  // the top/bottom margins) and reset to a default zoom at the latest bar
  resetView() {
    try { this.series.priceAxis().configure({ autoScale: true }); } catch (_) {}
    const ts = this.chart.timeAxis();
    ts.configure({ barSpacing: 6 });
    ts.scrollToNow();
  }

  /** @param {HTMLElement} parent */
  mount(parent) {
    parent.appendChild(this.el);
    // apply scale/countdown after the chart is in the DOM and sized — doing it
    // during construction hits null internals in the engine (autoSize not ready yet)
    requestAnimationFrame(() => { this.applyScale(); this.applyCanvas(); this.applyTz(); this.applyCountdown(); this.applySpread(); });
  }

  // crosshair sync ----------------------------------------------------------
  /** @param {number|null} time @param {number|null} price @param {any} [series] */
  setCrosshair(time, price, series) {
    if (time == null || price == null) { this.chart.clearCursor(); return; }
    // the series decides which pane's price scale the horizontal line sits on
    this.chart.setCursor(price, time, series || this.series);
  }
  clearCrosshair() { this.chart.clearCursor(); }

  /** @param {string} sym */
  setSymbol(sym) {
    this.teardownMd();        // drop quotes for the old contract
    this.symbol = sym;
    this.contractId = null;
    this.applyStatus();
    if (this.drawings) this.drawings.requestUpdate();   // render synced drawings for the new symbol
    if (this.orderView) this.orderView.refresh();       // re-project the book for the new symbol
    if (broker.isConnected(this.broker)) this.resolve();
  }

  // pick a (broker, symbol) — the symbol-search result. Switches the data source.
  /** @param {any} brokerId @param {string} sym */
  setSource(brokerId, sym) {
    this.teardownMd();
    this.broker = brokerId || null;
    this.symbol = sym;
    this.contractId = null;
    if (this.reqId) { this.api() && this.api().drop(this.reqId); this.reqId = 0; }
    this.applyStatus();
    if (this.drawings) this.drawings.requestUpdate();
    if (this.orderView) this.orderView.refresh();       // re-project the book for the new source
    if (broker.isConnected(this.broker)) this.resolve();
  }

  /** @param {string} id */
  setTimeframe(id) {
    this.tfId = id;
    this.range = null;   // new bar size -> refit (old time window wouldn't fit)
    this.applyStatus();
    if (this.drawings) this.drawings.requestUpdate();   // re-evaluate per-tf drawing visibility
    this.applyTrades();                                 // re-evaluate per-tf trade-mark visibility
    if (this.contractId) this.requestBars();
    if (this.compare) this._compareRequest();           // comparison follows the same timeframe
  }

  // ---- Study-board hard off-switch. A board pane exists only to study its anchored chart; when that
  // chart is closed the board has nothing to study, so it goes blank: drop the subscription, clear the
  // data (studies compute to nothing), and show a placeholder. Re-anchoring re-subscribes. Only board
  // panes ever blank. ----
  blank() {
    if (!this.board || this.blanked) return;
    this.blanked = true;
    clearTimeout(this._openSettle); clearTimeout(this._openMax); this._openPending = false; this._boardWantFrom = null;   // cancel any in-flight opening fill / board follow
    if (this.reqId) { this.api() && this.api().drop(this.reqId); this.reqId = 0; }
    this.bars = new Map();
    this.seeded = false;
    if (this._series) this._series.feed([]);   // compare/price board pane: clear its candles too
    try { if (this.studies) this.studies.update([]); } catch (_) {}   // empty input -> studies render blank
    this._blankOverlay(true);
  }
  unblank() {
    if (!this.blanked) return;
    this.blanked = false;
    this._blankOverlay(false);
    if (broker.isConnected(this.broker)) this.resolve();   // re-subscribe and reload
  }
  /** @param {boolean} show */
  _blankOverlay(show) {
    if (show) {
      if (!this._blankEl) {
        this._blankEl = document.createElement('div');
        this._blankEl.className = 'pane-blank';
        this._blankEl.textContent = 'Main chart not open';
        this.el.appendChild(this._blankEl);
      }
      this._blankEl.style.display = '';
    } else if (this._blankEl) {
      this._blankEl.style.display = 'none';
    }
  }

  resolve() {
    if (this.blanked) return;   // a board pane whose anchored chart is closed stays blank (no subscribe)
    this._restoreCompare();   // bring back a persisted comparison once connected
    if (!this.symbol || !this.api()) return;
    this.api().resolveSymbol(this.symbol, (/** @type {any} */ inst, /** @type {any} */ err) => {
      if (!inst) {
        log('[' + this.symbol + '] symbol not resolved' + (err ? ' (status ' + err.status + ')' : '') + '.', true);
        return;
      }
      // resolve() runs on EVERY 'logon' (layout.js), and auto-connect logs on to several brokers --
      // so one broker's pane resolves AGAIN when another broker connects. Guard the reload: if we already hold
      // a live subscription to this exact contract, only refresh quotes -- don't tear the chart down
      // and re-request. That re-request wiped this.bars -> feed([]) -> blank -> re-seed from the local
      // cache, i.e. the startup "jerk" (only visible on cached symbols, which re-seed instantly). A
      // real change still reloads: setSymbol/setSource clear contractId; setTimeframe calls requestBars
      // directly; a dropped broker clears reqId (see layout.js connections:changed), so reconnect reloads.
      const alreadyLive = this.reqId && this.contractId === inst.id;
      this.contractId = inst.id;
      // Trading-session model for this contract. ONE shared instance per broker/symbol for the whole
      // window (the session belongs to the instrument, not the pane) -> fetched once and reused by every
      // pane/tab/compare on the same contract. It costs a HISTORICAL look-back fetch (learn the session
      // from ~10 days of 15m bars), so it's built ONLY for a main chart pane that shows the dot + anchors
      // daily bars. BOARD panes are excluded entirely: they hide the dot and don't need the anchor, and a
      // board's several panes × several windows firing that look-back at once floods the broker's
      // historical-request limit (boards otherwise only lazy-cache). Study sub-panes (no _series) also skip.
      const wantMH = this._series && !this.board;
      if (wantMH && (!this.marketHours || this.marketHours.contractId !== inst.id)) {
        if (this._mhUnsub) { this._mhUnsub(); this._mhUnsub = null; }   // detach from the previous symbol's shared model
        this.marketHours = sharedMarketHours(this.api(), inst.id, this.broker, this.symbol);
        this._mhUnsub = this.marketHours.onUpdate(() => {
          this.updateMarketDot();   // repaint the dot when the hours arrive
          const t = this.tf();      // ...and re-anchor daily+ bars now that we know the real session opens
          if (t && (t.unit === 'D' || t.unit === 'W' || t.unit === 'M')) this.redraw(true);
        });
      }
      if (this.marketHours && wantMH) {
        const now = (this.api().serverNow && this.api().serverNow()) || Date.now();
        this.marketHours.ensure(now - 7 * 86400000, now + 7 * 86400000);
      }
      this.priceDecimals = inst.priceDecimals;
      this.tickSize = inst.tickSize || null;   // kept so drawings can snap their price to the tick grid
      if (this._series) this._series.configure({ priceFormat: { type: 'price', precision: inst.priceDecimals, minMove: inst.tickSize } });
      if (!alreadyLive) this.requestBars();
      this.refreshMd();       // (re)start quotes if bid/ask lines are on
      this.applyTrades();     // (re)fetch this symbol's fills once connected, if trades are shown
    });
  }

  // The bar data pipeline (data-TF routing / ingest / requestBars / onReport / seedFromCache /
  // storeClosed / older-history paging / opening-fill) is split into ./pane/data.js and Object.assign'd
  // onto the prototype below. The static fill/gap thresholds it reads (via this.constructor) stay here.

  // how many empty windows to skip before accepting we've hit the start of data.
  static GAP_HOPS = 6;

  // Opening fill (see requestBars / redraw).
  static FILL_MIN = 160;        // bars needed to fill the initial ~150-slot window before the first paint
  static OPEN_SETTLE_MS = 600;  // frame the view this long after deep history stops arriving (stream settled)
  static OPEN_MAX_MS = 6000;    // hard cap: never hold a blank opening longer than this

  // Re-stamp daily+ bars to the true session open (from the market-hours model). Native OHLCV kept;
  // only `time` moves off the broker's raw anchor onto the real open, so drawings/labels sit on the day
  // start and line up across timeframes. Bars with no session match keep their native time.
  /** @param {Bar[]} bars @returns {Bar[]} */
  _anchorDaily(bars) {
    const mh = this.marketHours;
    const out = bars.map((b) => { const o = mh.openForBarSec(b.time); return o != null ? { ...b, time: Math.round(o / 1000) } : b; });
    out.sort((a, b) => a.time - b.time);
    /** @type {Map<number, Bar>} */
    const m = new Map(); for (const b of out) m.set(b.time, b); return [...m.values()];   // dedup by re-anchored time (defensive)
  }

  // Future whitespace: hand the engine session-following time slots past the last bar, so its index axis
  // stays gapless into the future (weekends collapsed like the past) instead of linear-extrapolating real
  // clock time (which reintroduces the weekend gap). Generated from the SAME session model as the daily
  // anchor. Covers ~2 weeks so day-marker's future separators land on a real grid. No-op without a session.
  /** @param {Bar[]} arr @param {any} dtf */
  _feedFutureWhitespace(arr, dtf) {
    if (!this.chart || !this.chart.setFutureWhitespace) return;
    const mh = this.marketHours;
    if (!mh || !mh.openRule || !arr.length || !dtf) {
      if (this._fwKey !== 'none') { this._fwKey = 'none'; this.chart.setFutureWhitespace([]); }
      return;
    }
    const tfSec = Math.round(barMs(dtf) / 1000);
    const lastSec = arr[arr.length - 1].time;
    // The projected future grid only changes when a NEW bar arrives, the timeframe changes, or the learned
    // open rule changes -- NOT on every redraw/tick. Regenerating it per tick ran a heavy DST projection
    // (thousands of Intl calls) on every frame. Key on those inputs and skip when unchanged.
    const key = lastSec + '/' + tfSec + '/' + mh.openRule.hh + ':' + mh.openRule.mm;
    if (key === this._fwKey) return;
    this._fwKey = key;
    const HORIZON_DAYS = 21;   // margin past day-marker's 1-2 future weeks (closing boundary can be ~14d out)
    const count = Math.min(1500, Math.ceil((HORIZON_DAYS * 86400) / tfSec));
    this.chart.setFutureWhitespace(mh.projectFutureBars(lastSec, tfSec, count));
  }

  /** @param {boolean} [complete] */
  redraw(complete) {
    if (this.destroyed) return;
    // Fast path: a live tick only replaced/appended the LAST bar (classified by _ingest). Patch the
    // sorted arrays and feed the engine that one bar instead of rebuilding + re-sorting + re-feeding
    // the whole loaded history (thousands of bars after a cache seed) on every tick. Only when the
    // display bars ARE the native bars: intraday (no daily session re-anchor) and non-aggregate
    // (_ingest pins 'full' there). Any structural change falls through to the full rebuild below.
    const ops = this._fastOps; this._fastOps = null; this._fastLastTime = null;
    const ftf = this.tf();
    const anchored = ftf && (ftf.unit === 'D' || ftf.unit === 'W' || ftf.unit === 'M');
    if (Array.isArray(ops) && this.seeded && !this._openPending && !anchored
        && this.barArr && this.barArr.length) { this._redrawFast(ops, ftf); return; }
    const raw = [...this.bars.values()].sort((a, b) => a.time - b.time);   // NATIVE broker times (cache + paging identity)
    // Daily+ anchor correction: re-stamp display bars to the TRUE session open from the market-hours
    // model (the broker stamps a daily bar at its own anchor -- e.g. 17:30, in the maintenance gap --
    // not the 18:00 open). Only the DISPLAY array changes; this.bars/earliest stay native.
    let arr = raw;
    const dtf = this.tf();
    if (dtf && (dtf.unit === 'D' || dtf.unit === 'W' || dtf.unit === 'M') && this.marketHours && raw.length) {
      this.marketHours.ensure(raw[0].time * 1000, raw[raw.length - 1].time * 1000);   // cover the loaded range
      if (this.marketHours.hasData()) arr = this._anchorDaily(raw);
    }
    this.barArr = arr;                          // sorted bars (for ray-stop / level tools)
    this.barTimes = arr.map((b) => b.time);    // sorted bar times for drawing interpolation
    this.barCount = arr.length;
    this.lastBar = arr.length ? arr[arr.length - 1] : null;
    if (raw.length) { this.earliest = raw[0].time; this.lastClose = raw[raw.length - 1].close; }   // paging uses native times
    // Opening fill (uncached): hold the first paint while we pull deep history, so the view opens on a
    // full window instead of the live subscription's thin recent sliver. On the first complete batch we
    // kick loadOlder once; _armOpenSettle then finishes as soon as the window is full (or the deep pull
    // exhausts / a max wait elapses). No paint happens until _finishOpen flips _openPending off and
    // re-enters redraw. See requestBars.
    if (this._openPending) {
      if (complete && !this._openFillKicked && !this.exhausted && this.barCount > 0 && this.barCount < Pane.FILL_MIN) {
        this._openFillKicked = true;
        this.loadOlder();   // deep history via getBars (subscribe only returned the recent session)
      }
      this._armOpenSettle();
      return;
    }
    // Hold the FIRST paint until the full history batch is in (complete). Some brokers stream history
    // newest-to-oldest over several partial reports; painting those chunks shows a thin, sparse
    // window (a handful of bars pinned right) that the full-history fit then corrects -- the startup
    // flash. Uncached symbols have no cache seed to hide it, so the delay-then-fit lives here: skip
    // the partials, paint once complete. After seeding, every later report (live ticks, older
    // prepends via onOlder/seedFromCache, all complete=true) paints normally.
    if (!this.seeded && !complete) return;
    // Render-gated: this pane is hidden behind a maximized sibling. The data bookkeeping above stays
    // current (this.lastBar/barArr/earliest feed tools + paging), but skip the visual work -- no series
    // feed, no study-worker recompute, no paint. setRenderActive(true) replays one redraw on un-hide.
    if (this._renderPaused) { this._pendingRedraw = true; return; }
    if (this.compare) this._compareFollow();   // extend the compare history to match the main's
    if (this._series) this._series.feed(arr);   // board pane has no candle series; the study is fed below
    this._feedFutureWhitespace(arr, dtf);       // session-following future slots -> gapless axis past the last bar
    if (this.lineSeries) this._feedLine();          // keep the line chart in sync with the bars
    if (this.studies) this.studies.update(arr);   // recompute attached indicators
    if (!this.hovering) this.updateValues();   // keep values on the latest bar
    // Fit only once the full history batch has arrived. Some brokers stream history
    // newest-to-oldest over several reports; fitting on the first partial chunk
    // would zoom into just the latest few bars.
    if (!this.seeded && complete && arr.length) {
      // Open at exactly what a manual RESET shows: the tight recent window (newest bar at the right
      // edge). This is a LIVE chart -- reopening shows the latest price, NOT a restored pan/zoom.
      // Restoring the saved window here yanked the view to last session's position on startup: the
      // backward "jump". scrollToNow is timing-independent, so the view is the same regardless of
      // whether the cache or the live batch seeded first. (Restores the 2c96b49 fix that commit
      // 8226374 reverted; per-session pan/zoom is intentionally not restored on startup.)
      try { this.chart.timeAxis().scrollToNow(); } catch (_) {}
      this.seeded = true;
    }
    // bars (and barTimes) just changed → re-render drawings so synced ones, which
    // need barTimes for cross-timeframe interpolation, appear once data is loaded.
    if (this.drawings) this.drawings.requestUpdate();
    this._positionBoardCtrls();   // price labels widen the scale once data loads → keep controls clear of it
  }

  // Live-tick redraw: apply the classified last-bar ops in place and run the same follow-ups as the
  // full path, at O(ops) instead of O(history). barArr/barTimes keep their identity (tools and
  // drawings read them live); studies get a fresh top-level copy because the study host diffs the
  // passed array against the previously passed one by reference.
  /** @param {Bar[]} ops @param {any} dtf */
  _redrawFast(ops, dtf) {
    const arr = this.barArr, times = this.barTimes;
    for (const b of ops) {
      const n = arr.length;
      if (n && b.time === arr[n - 1].time) arr[n - 1] = b;
      else if (!n || b.time > arr[n - 1].time) { arr.push(b); times.push(b.time); }
    }
    this.barCount = arr.length;
    this.lastBar = arr[arr.length - 1];
    this.lastClose = this.lastBar.close;   // earliest is untouched: ops never reach older bars
    if (this._renderPaused) { this._pendingRedraw = true; return; }   // bookkeeping done; replay on un-hide
    if (this.compare) this._compareFollow();
    if (this._series) for (const b of ops) this._series.feedBar(b);
    this._feedFutureWhitespace(arr, dtf);   // keyed: regenerates only when a NEW bar arrived
    if (this.lineSeries) {
      const src = this._priceSource();
      for (const b of ops) this.lineSeries.feedBar({ time: b.time, value: src(b) });
    }
    if (this.studies) this.studies.update(arr.slice());
    if (!this.hovering) this.updateValues();
    if (this.drawings) this.drawings.requestUpdate();
    this._positionBoardCtrls();
  }

  // ---- Compare symbols: plot another instrument's candles in a sub-pane below,
  // on the same timeframe. One comparison at a time (kept simple). ----
  // Compare lifecycle + sub-pane control UI (addCompare / removeCompare / _compareRequest / … /
  // _positionCompareUI) are split into ./pane/compare.js and Object.assign'd onto the prototype below.

  // _setPaneMode (compare pane height mode) lives in ./pane/compare.js (prototype mixin).

  // Render gating for split layouts: a pane hidden behind a maximized sibling (display:none) stops
  // painting entirely -- expanding one chart in a 3-split should cost the same as a single-chart window,
  // not keep all three render pipelines running. Data keeps flowing (bars ingest, tools stay current);
  // only paint + study recompute pause. On un-hide we re-measure (size was 0 while display:none) and
  // replay one redraw to catch up. Called by the layout on every maximize/restore/Tab-cycle.
  /** @param {boolean} visible */
  setRenderActive(visible) {
    if (this.destroyed || !this.chart) return;
    const paused = !visible;
    if (paused === !!this._renderPaused) return;   // no-op if already in the target state
    this._renderPaused = paused;
    try { this.chart.setPaused(paused); } catch (_) {}   // gate every paint source (bars, quotes, trade beads)
    if (visible) {
      try { this.chart.resize(); } catch (_) {}          // re-measure: the container was 0-sized while hidden
      if (this._pendingRedraw) { this._pendingRedraw = false; this.redraw(true); }   // replay latest data / seed
    }
  }

  destroy() {
    this.destroyed = true;   // stop any late bar/history reply from touching the removed chart
    if (this.skin) this.skin.destroy();
    if (this.studies) this.studies.destroy();
    if (this.drawings) this.drawings.destroy();
    if (this.orderView) this.orderView.destroy();
    this.removeCompare();
    this.teardownMd();
    this._stopTradeFeed();   // drop the live-fills subscription
    if (this.cdTimer) clearInterval(this.cdTimer);
    if (this._mktTimer) clearInterval(this._mktTimer);
    if (this._mhUnsub) { this._mhUnsub(); this._mhUnsub = null; }   // detach from the shared market-hours model (it outlives us)
    this._hideMarketPopup();
    clearTimeout(this._openSettle); clearTimeout(this._openMax);   // opening-fill timers
    if (this.reqId) this.api() && this.api().drop(this.reqId);
    if (this.olderReqId) this.api() && this.api().drop(this.olderReqId);   // cancel in-flight lazy history
    this.chart.destroy();
    this.el.remove();
  }
}

// Attach the split-out feature subsystems (see ./pane/*.js) onto the prototype. `this` and every
// cross-method call behave exactly as when these were inline methods of the class.
Object.assign(Pane.prototype, compareMethods, tradesMethods, dataMethods, chartTypeMethods, priceLineMethods, controlMethods, surfaceMethods, marketDotMethods, appearanceMethods);
