// @ts-check
// The appearance layer for a Pane -- the settings -> chart application methods, split out of pane.js as
// a prototype mixin (`this` is the Pane instance). Convention: applyX = committed state; previewX =
// transient (dialog preview); commitAppearance persists a draft. Covers candles, canvas (+ nav/pane
// button modes), the time-axis formatter (applyTz), scales, the flat "Scales and lines" keys, the
// indicator-legend options, the status line (+ OHLC values), and the appearance snapshot the chart
// templates use. State lives on the pane; these methods only push it into the engine/DOM.
import { broker } from '../../../data_engine/index.js';
import { bus } from '../../bus.js';
import { getOffsetMin } from '../../workspace/timezone.js';
import { MON, DOW, fmtTime, fmtDateLabel } from '../pane-format.js';
import { dashToStroke, candleOptions, canvasOptions, LINE_KEYS } from '../pane-defaults.js';

// The methods below run with `this` bound to the Pane instance. The Pane wraps the vendored kapelka
// chart engine and has no TS types here, so `this` is the engine `any` boundary.
/** @type {Record<string, any> & ThisType<any>} */
export const appearanceMethods = {
  // appearance: applyX = committed state; previewX = transient (dialog preview)
  /** @param {any} c */
  applyCandlesObj(c) {
    if (this._series) this._series.configure(candleOptions(c));
  },
  applyCandles() {
    this.applyCandlesObj(this.settings.candles);
  },
  /** @param {any} c */
  previewCandles(c) {
    this.applyCandlesObj(c);
  },

  // the pane's OWN display offset (minutes east of UTC). Falls back to the global default when this
  // pane hasn't set its own, so existing charts are unchanged until a per-pane offset is assigned.
  tzOffset() {
    return this.settings.tzOffsetMin != null ? this.settings.tzOffsetMin : getOffsetMin();
  },

  // set THIS pane's display offset (minutes east of UTC) and apply it live (bottom-bar tz picker)
  /** @param {number} offsetMin */
  setTz(offsetMin) {
    this.settings.tzOffsetMin = offsetMin;
    this.applyTz();
    bus.emit('pane:changed');
  },

  // display the time axis in this pane's UTC offset (data stays UTC). offOverride (minutes) lets the
  // settings dialog preview a draft offset without committing it to the pane's settings.
  /** @param {number} [offOverride] */
  applyTz(offOverride) {
    const off = (offOverride != null ? offOverride : this.tzOffset()) * 60; // seconds
    const s = this.settings;
    const h24 = s.tsHours24 !== false;
    // On daily+ timeframes a bar IS a whole trading session, so the axis + crosshair show a DATE, never
    // a time (daily bars are date-keyed). And the date is the TRADE DAY: our
    // feeds stamp a daily bar at the session OPEN (CME futures ~17:30 ET Sunday for the Monday session),
    // so we roll the evening open forward before taking the date -- otherwise the week starts on "Sun".
    // +12h reliably crosses midnight for an evening open and is a no-op for a midnight/morning open.
    // (The exact per-instrument boundary is available from the broker session info --
    // a precise upgrade for later.)
    const daily = () => {
      const t = this.tf();
      return !!t && (t.unit === 'D' || t.unit === 'W' || t.unit === 'M');
    };
    const TRADE_ROLL = 12 * 3600; // seconds; rolls an evening session-open into the day it belongs to
    /** @param {Date} d */
    const dow = (d) => (s.tsDowAxis ? DOW[d.getUTCDay()] + ' ' : '');
    this.chart.configure({
      localization: {
        timeFormatter: (/** @type {number} */ t) => {
          if (daily()) return fmtDateLabel(new Date((t + TRADE_ROLL + off) * 1000), s); // date only, trade day
          const d = new Date((t + off) * 1000);
          const date = fmtDateLabel(d, s);
          return (date ? date + '  ' : '') + fmtTime(d, h24);
        },
      },
      timeAxis: {
        timezone: off / 3600, // hours east of UTC -> kapelka anchors day/month/year ticks to LOCAL time
        labelGap: s.tsLabelGap > 0 ? s.tsLabelGap : 48, // min px between time labels before one is dropped
        tickFormatter: (/** @type {number} */ t, /** @type {number} */ type) => {
          const isD = daily();
          const d = new Date((t + (isD ? TRADE_ROLL : 0) + off) * 1000);
          if (type === 0) return String(d.getUTCFullYear());
          if (type === 1) return MON[d.getUTCMonth()];
          if (type === 2) return dow(d) + d.getUTCDate();
          if (isD) return dow(d) + d.getUTCDate(); // daily+ never shows a time-of-day tick
          if (type === 3) return fmtTime(d, h24);
          return fmtTime(d, h24, true);
        },
      },
    });
  },

  /** @param {any} c */
  applyCanvasObj(c) {
    this.chart.configure(canvasOptions(c));
    this.applyNavButtons(c.navButtons);
    this.applyPaneButtons(c.paneButtons);
  },
  /** @param {string} mode */
  applyNavButtons(mode) {
    if (!this.controls) return;
    this.controls.classList.toggle('always', mode === 'always');
    this.controls.classList.toggle('never', mode === 'never');
  },
  // sub-pane + compare control rows (.pane-compare-ctrls): hover (default) | always | never
  /** @param {string} mode */
  applyPaneButtons(mode) {
    this.el.classList.toggle('pane-btns-always', mode === 'always');
    this.el.classList.toggle('pane-btns-never', mode === 'never');
  },
  applyCanvas() {
    this.applyCanvasObj(this.settings.canvas);
  },
  /** @param {any} c */
  previewCanvas(c) {
    this.applyCanvasObj(c);
  },
  // shift end of chart from right border: toggle the right margin on/off (the marginRight value
  // is preserved so re-enabling restores your gap). Returns the new on-state.
  shiftEndOn() {
    return this.settings.canvas.shiftEnd !== false;
  },
  toggleShiftEnd() {
    const c = this.settings.canvas;
    c.shiftEnd = c.shiftEnd === false;
    this.applyCanvas();
    bus.emit('pane:changed');
    return c.shiftEnd;
  },
  // auto-scroll: follow the latest bar as new bars arrive (only while at the right edge). Returns the new on-state.
  autoScrollOn() {
    return this.settings.canvas.autoScroll !== false;
  },
  toggleAutoScroll() {
    const c = this.settings.canvas;
    c.autoScroll = c.autoScroll === false;
    this.applyCanvas();
    bus.emit('pane:changed');
    return c.autoScroll;
  },

  getAppearance() {
    return {
      candles: structuredClone(this.settings.candles),
      canvas: structuredClone(this.settings.canvas),
      statusLine: structuredClone(this.settings.statusLine),
      indicators: structuredClone(this.settings.indicators),
      trades: structuredClone(this.settings.trades),
      tzOffsetMin: this.settings.tzOffsetMin, // per-pane display offset (undefined = inherit the global default)
    };
  },
  // flat line/scale settings ("Scales and lines" tab) — snapshot for chart templates,
  // and a batch apply (live, like setLineSetting but one repaint for the whole set).
  getLineSettings() {
    const o = /** @type {Record<string, any>} */ ({});
    LINE_KEYS.forEach((k) => {
      o[k] = this.settings[k];
    });
    return structuredClone(o);
  },
  /** @param {Record<string, any>} obj */
  applyLineSettings(obj) {
    if (!obj) return;
    LINE_KEYS.forEach((k) => {
      if (k in obj) this.settings[k] = obj[k];
    });
    this.applySettings();
    bus.emit('pane:changed');
  },
  /** @param {any} a */
  previewAppearance(a) {
    this.previewCandles(a.candles);
    this.previewCanvas(a.canvas);
    this.previewStatus(a.statusLine);
    this.previewIndicators(a.indicators);
    if (a.trades) this.previewTrades(a.trades);
    this.applyTz(a.tzOffsetMin);
  },
  applyAppearance() {
    this.applyCandles();
    this.applyCanvas();
    this.applyStatus();
    this.applyIndicators();
    this.applyTrades();
    this.applyTz();
  }, // revert to committed
  /** @param {any} a */
  commitAppearance(a) {
    this.settings.candles = a.candles;
    this.settings.canvas = a.canvas;
    this.settings.statusLine = a.statusLine;
    this.settings.indicators = a.indicators;
    if (a.trades) this.settings.trades = a.trades;
    this.settings.tzOffsetMin = a.tzOffsetMin; // per-pane display offset (undefined keeps inheriting the global)
    this.applyAppearance();
    bus.emit('pane:changed');
  },

  // push the indicator-legend display options to kapelka/skin; bgColor follows the chart background
  applyIndicators() {
    this.applyIndicatorsObj(this.settings.indicators);
  },
  /** @param {any} ind */
  previewIndicators(ind) {
    this.applyIndicatorsObj(ind);
  },
  /** @param {any} ind */
  applyIndicatorsObj(ind) {
    if (!this.skin || !ind) return;
    this.skin.setLegendOptions({
      title: ind.title !== false,
      inputs: ind.inputs !== false,
      values: ind.values !== false,
      bg: ind.bg !== false,
      bgColor: this.settings.canvas && this.settings.canvas.background,
      bgOpacity: (ind.bgOpacity != null ? ind.bgOpacity : 60) / 100,
    });
  },

  // top-left status line: title (symbol · tf) + live OHLC values
  /** @param {any} s */
  applyStatusObj(s) {
    if (!this.statusEl) return;
    // An oscillator board pane has no candles, so its OHLC status line reads "O NaN H NaN ...".
    // Always hide the status line there (the study's own legend carries the label); a COMPARE/price
    // board pane (pricePane) is a real chart, so it keeps its status line.
    const osc = this.board && !this.settings.pricePane;
    const show = !osc && !!(s && (s.title || s.chartValues));
    this.statusEl.style.display = show ? 'inline-block' : 'none';
    const fs = (s && s.fontSize) || 13;
    // explicit color overrides; otherwise inherit the theme Text (--tx). Treat the
    // old hardcoded default '#cccccc' as "follow theme" so existing charts update too.
    this.statusEl.style.color = s && s.color && s.color !== '#cccccc' ? s.color : '';
    this.statusEl.style.fontSize = fs + 'px';
    // padding scales with font size so the strip stays proportional
    this.statusEl.style.padding = `${Math.round(fs * 0.25)}px ${Math.round(fs * 0.55)}px`;
    this.statusEl.style.borderRadius = '4px';
    // opacity now lives in the colour itself (picker returns rgba); a bare hex is opaque.
    // The legacy bgOpacity field is retired and intentionally ignored.
    this.statusEl.style.background = s && s.bgColor ? s.bgColor : 'transparent';
    // titleEl/valuesEl are created alongside statusEl in addControls (always present when statusEl is),
    // so cast off the `undefined` the checker can't rule out here.
    /** @type {HTMLElement} */ (this.titleEl).style.display = s && s.title ? 'inline' : 'none';
    const bl = broker.labelOf(this.broker);
    /** @type {HTMLElement} */ (this.titleEl).textContent =
      this.symbol + ' · ' + (this.tfId || '') + (bl ? ' · ' + bl : '');
    /** @type {HTMLElement} */ (this.valuesEl).style.display = s && s.chartValues ? 'inline' : 'none';
    this.updateValues();
    this.updateMarketDot(s); // reflect the previewed status draft (toggle + market colours) live
  },
  applyStatus() {
    this.applyStatusObj(this.settings.statusLine);
  },
  /** @param {any} s */
  previewStatus(s) {
    this.applyStatusObj(s);
  },

  /** @param {any} [bar] an OHLC bar; falls back to the latest */
  updateValues(bar) {
    if (!this.valuesEl || !this.settings.statusLine.chartValues) return;
    const b = bar || this.lastBar;
    if (!b) {
      this.valuesEl.textContent = '';
      return;
    }
    const dec = this.priceDecimals;
    /** @param {number} v */
    const f = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    /** @param {string} lbl @param {number} v */
    const item = (lbl, v) => `<span class="ps-ohlc">${lbl} ${f(v)}</span>`;
    this.valuesEl.innerHTML = item('O', b.open) + item('H', b.high) + item('L', b.low) + item('C', b.close);
  },

  applyScale() {
    const s = this.settings;
    const left = !!s.scaleLeft;
    const showPrice = s.priceScale !== false;
    const mode = s.priceScaleMode || 0;
    const invertScale = !!s.invertScale;
    // visibility + mode only — border colors are owned by the canvas appearance
    this.chart.configure({
      leftPriceAxis: { visible: showPrice && left, mode, invert: invertScale },
      rightPriceAxis: { visible: showPrice && !left, mode, invert: invertScale },
      timeAxis: { visible: s.timeScale !== false },
    });
    if (this.series) this.series.configure({ axisId: left ? 'left' : 'right' });
    this._positionBoardCtrls(); // keep the compare-pane controls clear of the price scale
  },

  // ---- line + label settings ----
  /** @param {string} key @param {any} value */
  setLineSetting(key, value) {
    this.settings[key] = value;
    this.applySettings();
    bus.emit('pane:changed');
  },
  applySettings() {
    const s = this.settings;
    this.series.configure({
      showPriceLine: !!s.priceLine,
      showLastValue: !!s.lastPriceLabel,
      priceLineColor: s.priceLineColor || '#787b86',
      priceLineWidth: s.priceLineWidth || 1,
      priceLineStyle: dashToStroke(s.priceLineDash),
    });
    this.chart.configure({ noOverlapLabels: s.noOverlapLabels !== false });
    this.applyScale();
    this.refreshMd();
    this.applyCountdown();
    this.applySpread();
    this.applyTz();
    if (this.plus) this.plus.setEnabled(s.plusButton && !this.board); // board panes: no price-scale "+" (alert)
  },
};
