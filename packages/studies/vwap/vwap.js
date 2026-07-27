// @ts-check
// VWAP -- Volume Weighted Average Price. Anchored: the volume-weighted
// average of `source` (default hlc3) accumulates from the start of an anchor period and RESETS at each
// boundary. Drawn on the price pane. Optional standard-deviation (or percentage) bands, up to three.
//
//   VWAP  = sum(src * vol) / sum(vol)            (over the anchor period so far)
//   stdev = sqrt( sum(src^2 * vol)/sum(vol) - VWAP^2 )      (volume-weighted)
//   band  = VWAP +/- mult * (stdev | VWAP*0.01)
//
// The anchor boundary is the trading SESSION for the daily anchor, which differs by instrument, so the
// session reset hour is configurable in the CHART's display timezone (like CVD). The Earnings/Dividends/
// Splits anchors from the Pine are omitted -- they need corporate-action data the app doesn't provide.
import { getOffsetMin } from '../../../src/workspace/timezone.js';

/**
 * @param {string} col
 * @param {number} a
 * @returns {string}
 */
function withAlpha(col, a) {
  if (!col) return `rgba(0,0,0,${a})`;
  const hex = /^#?([0-9a-f]{6})$/i.exec(String(col).trim());
  if (hex) { const n = parseInt(hex[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  const m = /rgba?\(([^)]+)\)/i.exec(col);
  if (m) { const q = m[1].split(',').map((s) => parseFloat(s)); return `rgba(${q[0] || 0},${q[1] || 0},${q[2] || 0},${a})`; }
  return col;
}

Studies.register({
  id: 'vwap',
  overlay: true,   // on the price pane
  requires: { bars: true },
  inputs: [
    { key: 'source', type: 'source', name: 'Source', default: 'hlc3' },
    { key: 'anchor', type: 'select', name: 'Anchor period', default: 'session', options: [
      { key: 'session', name: 'Session' }, { key: 'week', name: 'Week' }, { key: 'month', name: 'Month' },
      { key: 'quarter', name: 'Quarter' }, { key: 'year', name: 'Year' } ] },
    // the session-open hour, in the CHART's timezone (e.g. 18 for CME futures on an ET chart; 0 for crypto)
    { key: 'resetHour', type: 'number', name: 'Session reset (hour)', default: 0, min: 0, max: 23 },
    { key: 'calcMode', type: 'select', name: 'Bands calc', default: 'stdev', options: [
      { key: 'stdev', name: 'Standard Deviation' }, { key: 'pct', name: 'Percentage' } ] },
    // full stroke picker for the VWAP line: colour + thickness + style
    { key: 'vwapLine', type: 'stroke', name: 'VWAP', default: { color: '#2962FF', width: 2, style: 'solid' } },
    // limit the drawn line to the last N days so it isn't one continuous line across all history
    // (1 = today only, 2 = today + yesterday, ...). The sums still accumulate over all bars, so the
    // VWAP values are unchanged -- only the older days are hidden.
    { key: 'recentOnly', type: 'bool', name: 'Recent days only', default: false, right: 'recentDays' },
    { key: 'recentDays', type: 'number', name: 'Days to show', default: 5, min: 1, max: 90, hidden: true },
    // ---- Bands tab: each band = [x show] [multiplier], its own line stroke picker, and its OWN
    // fill toggle (fill is opt-in per band, not forced) ----
    { key: 'show1', type: 'bool', name: 'Band 1', default: true, tab: 'Bands', right: 'mult1' },
    { key: 'mult1', type: 'number', name: 'Mult 1', default: 1, min: 0, max: 20, step: 0.5, tab: 'Bands', hidden: true },
    { key: 'band1Line', type: 'stroke', name: 'Band 1 line', default: { color: 'rgba(76,175,80,0.9)', width: 1, style: 'solid' }, tab: 'Bands' },
    { key: 'fill1', type: 'bool', name: 'Band 1 fill', default: false, tab: 'Bands' },
    { key: 'show2', type: 'bool', name: 'Band 2', default: false, tab: 'Bands', right: 'mult2' },
    { key: 'mult2', type: 'number', name: 'Mult 2', default: 2, min: 0, max: 20, step: 0.5, tab: 'Bands', hidden: true },
    { key: 'band2Line', type: 'stroke', name: 'Band 2 line', default: { color: 'rgba(128,128,0,0.9)', width: 1, style: 'solid' }, tab: 'Bands' },
    { key: 'fill2', type: 'bool', name: 'Band 2 fill', default: false, tab: 'Bands' },
    { key: 'show3', type: 'bool', name: 'Band 3', default: false, tab: 'Bands', right: 'mult3' },
    { key: 'mult3', type: 'number', name: 'Mult 3', default: 3, min: 0, max: 20, step: 0.5, tab: 'Bands', hidden: true },
    { key: 'band3Line', type: 'stroke', name: 'Band 3 line', default: { color: 'rgba(0,128,128,0.9)', width: 1, style: 'solid' }, tab: 'Bands' },
    { key: 'fill3', type: 'bool', name: 'Band 3 fill', default: false, tab: 'Bands' },
  ],
  calc(bars, p) {
    const src = p.source || 'hlc3';
    const anchor = p.anchor || 'session';
    const mode = p.calcMode || 'stdev';
    const resetSec = (Math.max(0, Math.min(23, p.resetHour | 0))) * 3600;
    let offSec = 0; try { offSec = (getOffsetMin() || 0) * 60; } catch (_) {}
    // anchor key for a bar time (in the chart's local time): a change resets the running sums.
    const keyOf = (/** @type {number} */ t) => {
      const t2 = t + offSec - resetSec;
      const day = Math.floor(t2 / 86400);
      if (anchor === 'week') return Math.floor((day + 3) / 7);   // Monday-aligned week
      if (anchor === 'month' || anchor === 'quarter' || anchor === 'year') {
        const d = new Date(t2 * 1000), y = d.getUTCFullYear(), mo = d.getUTCMonth();
        if (anchor === 'year') return y;
        if (anchor === 'quarter') return y * 4 + Math.floor(mo / 3);
        return y * 12 + mo;
      }
      return day;   // session / day
    };

    // "Recent days only": a plotting window in whole days, using the SAME day boundary as the session
    // anchor (chart tz + reset hour), so each day's segment starts on a session reset. cutoff = the
    // first day index to draw; -Infinity when off (draw everything).
    const dayIdx = (/** @type {number} */ t) => Math.floor((t + offSec - resetSec) / 86400);
    const cutoffDay = (p.recentOnly === true && bars.length)
      ? dayIdx(bars[bars.length - 1].time) - (Math.max(1, p.recentDays | 0 || 5) - 1) : -Infinity;

    const mult = [p.mult1 != null ? p.mult1 : 1, p.mult2 != null ? p.mult2 : 2, p.mult3 != null ? p.mult3 : 3];
    /** @type {StudyPlotPoint[]} */
    const vw = [];
    /** @type {StudyPlotPoint[][]} */
    const u = [[], [], []];
    /** @type {StudyPlotPoint[][]} */
    const l = [[], [], []];
    let sPV = 0, sV = 0, sP2V = 0;
    /** @type {number | null} */
    let prevKey = null;
    bars.forEach((b) => {
      const key = keyOf(b.time);
      if (prevKey === null || key !== prevKey) { sPV = 0; sV = 0; sP2V = 0; prevKey = key; }   // anchor reset
      const price = Studies.priceOf(b, src), vol = b.volume || 0;
      sPV += price * vol; sV += vol; sP2V += price * price * vol;
      if (sV <= 0) return;
      const vwap = sPV / sV;
      const variance = Math.max(0, sP2V / sV - vwap * vwap);
      const basis = mode === 'pct' ? vwap * 0.01 : Math.sqrt(variance);
      if (dayIdx(b.time) < cutoffDay) return;   // sums already accumulated; just don't plot older days
      vw.push({ time: b.time, value: vwap });
      for (let k = 0; k < 3; k++) { u[k].push({ time: b.time, value: vwap + basis * mult[k] }); l[k].push({ time: b.time, value: vwap - basis * mult[k] }); }
    });

    // a stroke value is { color, width, style }; migrate an older plain-colour param (vwapColor /
    // bandNColor) so existing instances keep their colour.
    const strk = (/** @type {any} */ v) => (typeof v === 'string' ? { color: v } : (v || {}));
    const vs = strk(p.vwapLine || p.vwapColor);
    const bandDflt = ['rgba(76,175,80,0.9)', 'rgba(128,128,0,0.9)', 'rgba(0,128,128,0.9)'];
    const bandS = [strk(p.band1Line || p.band1Color), strk(p.band2Line || p.band2Color), strk(p.band3Line || p.band3Color)];
    const shows = [p.show1 !== false, p.show2 === true, p.show3 === true];
    const fillsOn = [p.fill1 === true, p.fill2 === true, p.fill3 === true];

    const plots = [{ key: 'vwap', name: 'VWAP', type: 'line', color: vs.color || '#2962FF', lineWidth: vs.width || 2, lineStyle: vs.style || 'solid', data: vw }];
    const fills = [];
    for (let k = 0; k < 3; k++) {
      if (!shows[k]) continue;
      const bs = bandS[k], col = bs.color || bandDflt[k], wd = bs.width || 1, st = bs.style || 'solid';
      plots.push({ key: 'u' + k, name: 'Upper ' + (k + 1), type: 'line', color: col, lineWidth: wd, lineStyle: st, data: u[k] });
      plots.push({ key: 'l' + k, name: 'Lower ' + (k + 1), type: 'line', color: col, lineWidth: wd, lineStyle: st, data: l[k] });
      if (fillsOn[k]) fills.push({ top: 'u' + k, bottom: 'l' + k, color: withAlpha(col, 0.06) });   // fill only when opted in
    }
    return { plots, fills };
  },

  // ---- step form: the running volume-weighted sums advanced one bar at a time (anchor reset via keyOf),
  // reading the shared window. The band count/appearance is fixed per run, so plots()/fills() declare it once
  // and step() emits VWAP + each enabled band's upper/lower for THIS bar. ----
  /** @param {Record<string, any>} p @param {Record<string, any>} ctx @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh */
  init(p, ctx, sh) {
    const anchor = p.anchor || 'session';
    const resetSec = (Math.max(0, Math.min(23, p.resetHour | 0))) * 3600;
    let offSec = 0; try { offSec = (getOffsetMin() || 0) * 60; } catch (_) {}
    const keyOf = (/** @type {number} */ t) => {
      const t2 = t + offSec - resetSec;
      const day = Math.floor(t2 / 86400);
      if (anchor === 'week') return Math.floor((day + 3) / 7);
      if (anchor === 'month' || anchor === 'quarter' || anchor === 'year') {
        const d = new Date(t2 * 1000), y = d.getUTCFullYear(), mo = d.getUTCMonth();
        if (anchor === 'year') return y;
        if (anchor === 'quarter') return y * 4 + Math.floor(mo / 3);
        return y * 12 + mo;
      }
      return day;
    };
    const dayIdx = (/** @type {number} */ t) => Math.floor((t + offSec - resetSec) / 86400);
    const strk = (/** @type {any} */ v) => (typeof v === 'string' ? { color: v } : (v || {}));
    const vs = strk(p.vwapLine || p.vwapColor);
    const bandDflt = ['rgba(76,175,80,0.9)', 'rgba(128,128,0,0.9)', 'rgba(0,128,128,0.9)'];
    const bandS = [strk(p.band1Line || p.band1Color), strk(p.band2Line || p.band2Color), strk(p.band3Line || p.band3Color)];
    return {
      src: p.source || 'hlc3', mode: p.calcMode || 'stdev', keyOf, dayIdx,
      mult: [p.mult1 != null ? p.mult1 : 1, p.mult2 != null ? p.mult2 : 2, p.mult3 != null ? p.mult3 : 3],
      shows: [p.show1 !== false, p.show2 === true, p.show3 === true],
      fillsOn: [p.fill1 === true, p.fill2 === true, p.fill3 === true],
      vsColor: vs.color || '#2962FF', vsWidth: vs.width || 2, vsStyle: vs.style || 'solid',
      bandCols: bandS.map((b, k) => b.color || bandDflt[k]), bandWds: bandS.map((b) => b.width || 1), bandStyles: bandS.map((b) => b.style || 'solid'),
      sPV: 0, sV: 0, sP2V: 0, /** @type {number | null} */ prevKey: null,
    };
  },
  /** @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  plots(p, ctx, s) {
    const plots = [{ key: 'vwap', name: 'VWAP', type: 'line', color: s.vsColor, lineWidth: s.vsWidth, lineStyle: s.vsStyle }];
    for (let k = 0; k < 3; k++) {
      if (!s.shows[k]) continue;
      plots.push({ key: 'u' + k, name: 'Upper ' + (k + 1), type: 'line', color: s.bandCols[k], lineWidth: s.bandWds[k], lineStyle: s.bandStyles[k] });
      plots.push({ key: 'l' + k, name: 'Lower ' + (k + 1), type: 'line', color: s.bandCols[k], lineWidth: s.bandWds[k], lineStyle: s.bandStyles[k] });
    }
    return plots;
  },
  /** @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  fills(p, ctx, s) {
    const fills = [];
    for (let k = 0; k < 3; k++) if (s.shows[k] && s.fillsOn[k]) fills.push({ top: 'u' + k, bottom: 'l' + k, color: withAlpha(s.bandCols[k], 0.06) });
    return fills;
  },
  /** @param {number} i @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  step(i, sh, p, ctx, s) {
    const t = sh.time[i], key = s.keyOf(t);
    if (s.prevKey === null || key !== s.prevKey) { s.sPV = 0; s.sV = 0; s.sP2V = 0; s.prevKey = key; }   // anchor reset
    const price = Studies.priceOf({ open: sh.open[i], high: sh.high[i], low: sh.low[i], close: sh.close[i], volume: sh.volume[i] }, s.src);
    const vol = sh.volume[i] || 0;
    s.sPV += price * vol; s.sV += vol; s.sP2V += price * price * vol;
    if (s.sV <= 0) return null;
    const vwap = s.sPV / s.sV;
    const variance = Math.max(0, s.sP2V / s.sV - vwap * vwap);
    const basis = s.mode === 'pct' ? vwap * 0.01 : Math.sqrt(variance);
    // "Recent days only": the cutoff is derived from the CURRENT last bar each step, so it self-advances as
    // bars append (a checkpoint tick never re-runs init). The sums already accumulated; just don't plot older days.
    const cutoffDay = (p.recentOnly === true && sh.n) ? s.dayIdx(sh.time[sh.n - 1]) - (Math.max(1, p.recentDays | 0 || 5) - 1) : -Infinity;
    if (s.dayIdx(t) < cutoffDay) return null;
    /** @type {Record<string, any>} */
    const row = { vwap: { value: vwap } };
    for (let k = 0; k < 3; k++) if (s.shows[k]) { row['u' + k] = { value: vwap + basis * s.mult[k] }; row['l' + k] = { value: vwap - basis * s.mult[k] }; }
    return row;
  },
});
