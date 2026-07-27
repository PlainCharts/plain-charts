// @ts-check
// Cumulative Volume Delta (CVD). Unlike the per-bar Volume Delta (which zeroes every bar), CVD ACCUMULATES the buy/sell
// delta across bars within an ANCHOR period (default Day) and resets to 0 at each anchor boundary. It's
// drawn as candles: each bar is the OHLC of the running cumulative during that bar --
//   open  = cumulative at the bar's start
//   high  = intrabar high of the cumulative      low = intrabar low
//   close = cumulative at the bar's end
// Coloured teal when close >= open (net buying this bar), red otherwise. Zero line marks buying vs selling.
//
// The anchor boundary is the trading SESSION, which differs by instrument (CME futures roll ~18:00 ET, spot
// FX ~17:00 ET, crypto = UTC midnight). The reset hour is configurable and interpreted in the CHART's
// display timezone (the same clock the axis shows), so you enter the session open as you read it. Scans
// lower-timeframe sub-bars (ctx.intrabar) for the up/down volume split.
import { getOffsetMin } from '../../../src/workspace/timezone.js';

Studies.register({
  id: 'cvd',
  name: 'Cumulative Volume Delta',
  description: 'A study that tracks the running sum of buy minus sell volume.',
  overlay: false,      // its own sub-pane (the cumulative swings above/below zero)
  intrabar: true,      // needs lower-timeframe sub-bars for the buy/sell split
  requires: { bars: true, intrabars: true },
  inputs: [
    { key: 'anchor', type: 'select', name: 'Anchor period', default: 'day', options: [
      { key: 'day', name: 'Day' }, { key: 'week', name: 'Week' }, { key: 'month', name: 'Month' } ] },
    // the session-open hour, in the CHART's timezone (e.g. 18 for CME futures on an ET chart; 0 for crypto)
    { key: 'resetHour', type: 'number', name: 'Session reset (hour)', default: 0, min: 0, max: 23 },
    { key: 'chartColors', type: 'bool', name: 'Use chart colors', default: false },   // match the chart candles
    { key: 'upColor', type: 'color', name: 'Buy color', default: 'rgba(38,166,154,0.9)', legend: false },
    { key: 'downColor', type: 'color', name: 'Sell color', default: 'rgba(239,83,80,0.9)', legend: false },
  ],
  /**
   * @param {StudyBar[]} bars
   * @param {Record<string, any>} p
   * @param {Record<string, any>} [ctx]
   * @returns {StudyResult}
   */
  calc(bars, p, ctx) {
    const subs = (/** @type {Record<string, any>} */ (ctx)).intrabar || [];
    // candle colours: the chart's up/down candles when "Use chart colors" is on, else the custom Buy/Sell
    const cc = (p.chartColors && ctx && ctx.candle) ? ctx.candle : null;
    const up = cc ? cc.up : (p.upColor || 'rgba(38,166,154,0.9)');
    const down = cc ? cc.down : (p.downColor || 'rgba(239,83,80,0.9)');
    const anchor = p.anchor || 'day';
    const resetSec = (Math.max(0, Math.min(23, p.resetHour | 0))) * 3600;
    let offSec = 0; try { offSec = (getOffsetMin() || 0) * 60; } catch (_) {}   // chart display-tz offset (data is UTC)
    // anchor key for a bar time: a change means a new anchor period -> reset the cumulative to 0. Computed in
    // the chart's local time (t + offSec), with the session-open hour subtracted so the boundary lands there.
    const keyOf = (/** @type {number} */ t) => {
      const t2 = t + offSec - resetSec;
      const day = Math.floor(t2 / 86400);
      if (anchor === 'week') return Math.floor((day + 3) / 7);   // Monday-aligned week (epoch day 0 = Thursday)
      if (anchor === 'month') { const d = new Date(t2 * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
      return day;
    };

    let cvd = 0;
    /** @type {number | null} */
    let prevKey = null;
    /** @type {StudyPlotPoint[]} */
    const data = [];
    bars.forEach((b, i) => {
      const key = keyOf(b.time);
      if (prevKey === null || key !== prevKey) { cvd = 0; prevKey = key; }   // anchor boundary -> reset
      const open = cvd;
      let hi = open, lo = open;
      const sb = subs[i];
      if (sb && sb.length) {
        for (const s of sb) {
          const buy = (s.open != null && s.close != null) ? s.close >= s.open : true;
          cvd += buy ? (s.volume || 0) : -(s.volume || 0);
          if (cvd > hi) hi = cvd; if (cvd < lo) lo = cvd;
        }
      } else {
        // no sub-bars yet (forming / most-recent bars — intrabar fetch lags): approximate from the chart bar
        const vol = b.volume || 0;
        const buy = (b.close != null && b.open != null) ? b.close >= b.open : true;
        cvd += buy ? vol : -vol;
        if (cvd > hi) hi = cvd; if (cvd < lo) lo = cvd;
      }
      const close = cvd, col = close >= open ? up : down;
      data.push({
        time: b.time, value: close,
        segments: [{ from: open, to: close, color: col }],       // candle body: open -> close
        wicks: [{ from: lo, to: hi, color: col, width: 1 }],     // wick: intrabar cumulative low -> high
      });
    });

    return {
      plots: [{ key: 'cvd', name: 'CVD', type: 'segmented', precision: 0, data }],
      shapes: [{ type: 'hline', price: 0, color: 'rgba(120,123,134,0.5)', width: 1, lineStyle: 'solid' }],   // zero axis
    };
  },

  // ---- step form: the cumulative advanced one bar at a time over the shared window (running state) ----
  /** @param {Record<string, any>} p @param {Record<string, any>} [ctx] */
  init(p, ctx) {
    const cc = (p.chartColors && ctx && ctx.candle) ? ctx.candle : null;
    const anchor = p.anchor || 'day';
    const resetSec = (Math.max(0, Math.min(23, p.resetHour | 0))) * 3600;
    let offSec = 0; try { offSec = (getOffsetMin() || 0) * 60; } catch (_) {}
    const keyOf = (/** @type {number} */ t) => {
      const t2 = t + offSec - resetSec;
      const day = Math.floor(t2 / 86400);
      if (anchor === 'week') return Math.floor((day + 3) / 7);
      if (anchor === 'month') { const d = new Date(t2 * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
      return day;
    };
    return {
      up: cc ? cc.up : (p.upColor || 'rgba(38,166,154,0.9)'),
      down: cc ? cc.down : (p.downColor || 'rgba(239,83,80,0.9)'),
      keyOf, cvd: 0, /** @type {number | null} */ prevKey: null,
    };
  },
  plots() { return [{ key: 'cvd', name: 'CVD', type: 'segmented', precision: 0 }]; },
  shapes() { return [{ type: 'hline', price: 0, color: 'rgba(120,123,134,0.5)', width: 1, lineStyle: 'solid' }]; },
  /** @param {number} i @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  step(i, sh, p, ctx, s) {
    const key = s.keyOf(sh.time[i]);
    if (s.prevKey === null || key !== s.prevKey) { s.cvd = 0; s.prevKey = key; }   // anchor boundary -> reset
    const open = s.cvd;
    let hi = open, lo = open;
    const sb = sh.sub && sh.sub[i];
    if (sb && sb.length) {
      for (const x of sb) {
        const buy = (x.open != null && x.close != null) ? x.close >= x.open : true;
        s.cvd += buy ? (x.volume || 0) : -(x.volume || 0);
        if (s.cvd > hi) hi = s.cvd; if (s.cvd < lo) lo = s.cvd;
      }
    } else {
      const vol = sh.volume[i] || 0;
      const buy = (sh.close[i] != null && sh.open[i] != null) ? sh.close[i] >= sh.open[i] : true;
      s.cvd += buy ? vol : -vol;
      if (s.cvd > hi) hi = s.cvd; if (s.cvd < lo) lo = s.cvd;
    }
    const close = s.cvd, col = close >= open ? s.up : s.down;
    return { cvd: { value: close, segments: [{ from: open, to: close, color: col }], wicks: [{ from: lo, to: hi, color: col, width: 1 }] } };
  },
});
