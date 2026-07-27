// @ts-check
// Price-scale overlays for a Pane: the bid/ask price lines + axis labels, the countdown-to-bar-close
// box and the live spread meter (ask-bid), both pinned to the bottom of the price scale. Split out of
// pane.js as a prototype mixin -- these methods run with `this` bound to the Pane instance.
import { barMs } from '../../workspace/timeframes.js';
import { dashToStroke } from '../pane-defaults.js';

// The subset of pane.settings this mixin reads. Bid/ask line + label toggles, per-line stroke,
// the countdown box colours and the spread meter thresholds. spreadMax may arrive as a string
// (a text-input value), so parseFloat can consume it.
/**
 * @typedef {Object} PriceLineSettings
 * @property {boolean} [bidLine] @property {boolean} [askLine]
 * @property {boolean} [bidLabel] @property {boolean} [askLabel]
 * @property {string} [bidLineColor] @property {string} [askLineColor]
 * @property {number} [bidLineWidth] @property {number} [askLineWidth]
 * @property {string} [bidLineDash] @property {string} [askLineDash]
 * @property {boolean} [countdown]
 * @property {string} [countdownColor] @property {string} [countdownBg]
 * @property {boolean} [spreadMeter]
 * @property {number|string} [spreadMax]
 * @property {string} [spreadColor] @property {string} [spreadMaxColor]
 * @property {boolean} [scaleLeft]
 */
// The Pane surface this mixin drives via `this`. Engine handles (series/chart level+axis handles)
// are the `any` boundary; the price-line level handles (bidLineObj/askLineObj) are likewise `any`.
/**
 * @typedef {Object} PriceLineCtx
 * @property {PriceLineSettings} settings
 * @property {number|null} bid @property {number|null} ask
 * @property {number|null} bidSize @property {number|null} askSize
 * @property {number|null} priceDecimals
 * @property {any} bidLineObj @property {any} askLineObj
 * @property {any} series               engine candle/plot handle (addLevel/removeLevel)
 * @property {any} chart                engine chart handle (priceAxis)
 * @property {HTMLDivElement} countdownEl
 * @property {HTMLDivElement} spreadEl
 * @property {ReturnType<typeof setInterval>|null} cdTimer   setInterval id (null = none)
 * @property {() => any} tf             active timeframe descriptor ({ unit, n }) or undefined
 * @property {(prop: 'bidLineObj'|'askLineObj', lineOn: any, labelOn: any, price: number|null, color: string, title: string, width: number|undefined, dash: string|undefined) => any} lineFor
 * @property {(prop: 'bidLineObj'|'askLineObj') => void} removeLine
 * @property {() => void} tickCountdown
 * @property {() => void} updateSpread
 */

export const priceLineMethods = {
  /** @this {PriceLineCtx} */
  updateLines() {
    const s = this.settings;
    // the axis chip shows the side and, when the feed carries it, the size at that price ("Bid x12").
    /** @param {number|null} n */
    const sz = (n) => (n == null ? '' : ' x' + (Number.isInteger(n) ? n : +n.toFixed(2)));
    this.bidLineObj = this.lineFor('bidLineObj', s.bidLine, s.bidLabel, this.bid, s.bidLineColor || '#26a69a', 'Bid' + sz(this.bidSize), s.bidLineWidth, s.bidLineDash);
    this.askLineObj = this.lineFor('askLineObj', s.askLine, s.askLabel, this.ask, s.askLineColor || '#ef5350', 'Ask' + sz(this.askSize), s.askLineWidth, s.askLineDash);
  },
  // line and label are independent: keep the price line if either is wanted,
  // and toggle the line vs the axis tag separately.
  /**
   * @this {PriceLineCtx}
   * @param {'bidLineObj'|'askLineObj'} prop @param {any} lineOn @param {any} labelOn
   * @param {number|null} price @param {string} color @param {string} title
   * @param {number} [width] @param {string} [dash]
   */
  lineFor(prop, lineOn, labelOn, price, color, title, width, dash) {
    if ((!lineOn && !labelOn) || price == null) { this.removeLine(prop); return null; }
    const opts = { price, color, lineWidth: width || 1, lineStyle: dashToStroke(/** @type {string} */ (dash)), showLine: lineOn, showAxisLabel: labelOn, title };
    if (this[prop]) { this[prop].configure(opts); return this[prop]; }
    return this.series ? this.series.addLevel(opts) : null;   // board pane may have no series yet
  },
  /** @this {PriceLineCtx} @param {'bidLineObj'|'askLineObj'} prop */
  removeLine(prop) { if (this[prop]) { if (this.series) this.series.removeLevel(this[prop]); this[prop] = null; } },

  // ---- countdown to bar close ----
  /** @this {PriceLineCtx} */
  applyCountdown() {
    if (this.settings.countdown) {
      this.countdownEl.style.color = this.settings.countdownColor || '#e8e8e8';
      this.countdownEl.style.background = this.settings.countdownBg || '#363a45';
      if (!this.cdTimer) { this.tickCountdown(); this.cdTimer = setInterval(() => this.tickCountdown(), 1000); }
    } else {
      if (this.cdTimer) { clearInterval(this.cdTimer); this.cdTimer = null; }
      this.countdownEl.style.display = 'none';
    }
  },
  /** @this {PriceLineCtx} */
  tickCountdown() {
    const tf = this.tf();
    if (!tf) { this.countdownEl.style.display = 'none'; return; }
    const ms = barMs(tf);
    const remaining = Math.max(0, Math.ceil(Date.now() / ms) * ms - Date.now());
    const secs = Math.floor(remaining / 1000);
    const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
    /** @param {number} n */
    const pad = (n) => String(n).padStart(2, '0');
    this.countdownEl.textContent = hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
    this.countdownEl.style.display = 'block';
    // pin to the bottom of whichever side the price scale is on
    const left = !!this.settings.scaleLeft;
    this.countdownEl.style.width = this.chart.priceAxis(left ? 'left' : 'right').width() + 'px';
    this.countdownEl.style.left = left ? '0' : '';
    this.countdownEl.style.right = left ? '' : '0';
    if (this.settings.spreadMeter) this.updateSpread();   // keep the spread label stacked above
  },

  // ---- spread meter: live ask-bid on the price scale, above the countdown ----
  /** @this {PriceLineCtx} */
  applySpread() {
    if (this.settings.spreadMeter) this.updateSpread();
    else if (this.spreadEl) this.spreadEl.style.display = 'none';
  },
  /** @this {PriceLineCtx} */
  updateSpread() {
    const el = this.spreadEl; if (!el) return;
    if (!this.settings.spreadMeter || this.bid == null || this.ask == null) { el.style.display = 'none'; return; }
    const spread = this.ask - this.bid;
    const max = parseFloat(/** @type {string} */ (this.settings.spreadMax)) || 0;
    const over = max > 0 && spread >= max;
    el.style.background = over ? (this.settings.spreadMaxColor || '#ef5350') : (this.settings.spreadColor || '#363a45');
    el.textContent = spread.toFixed(/** @type {number} */ (this.priceDecimals));
    el.style.display = 'block';
    // pin to the price-scale side, sitting just above the countdown (when it's shown)
    const left = !!this.settings.scaleLeft;
    el.style.width = this.chart.priceAxis(left ? 'left' : 'right').width() + 'px';
    el.style.left = left ? '0' : '';
    el.style.right = left ? '' : '0';
    const cdShown = this.settings.countdown && this.countdownEl.style.display !== 'none';
    el.style.bottom = (28 + (cdShown ? this.countdownEl.offsetHeight : 0)) + 'px';
  },
};
