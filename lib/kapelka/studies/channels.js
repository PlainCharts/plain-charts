// @ts-check
// Study "channels": the pure transforms that turn a study's calc() output into the
// engine's render vocabulary. No DOM, no app state — just data → render description.
//   plots   -> a series type + options (SERIES_CTOR / styleToOptions / effectiveStyle)
//   fills   -> bands between two named plots (buildFillBands)
//   stack   -> stacked-area bands (applyStacking, mutates the plots to cumulative edges)
//   scale   -> a pane y_range provider (scaleProvider)
//   intrabar-> sub-bars bucketed under each chart bar (bucketIntrabar)
import { Line, Columns, Area, Baseline, Segments, HBars } from '../core/enums.js';
import { resolveShape } from './shape-lib.js';

// plot `type` (and the user's Style-tab override) -> the series constructor to use
export const SERIES_CTOR = { line: Line, histogram: Columns, area: Area, baseline: Baseline, segmented: Segments, hbar: HBars };

// Custom render primitives registered by studies / plug-in packs: a plot `type` -> a view object
// (the addCustomPlot contract). Lets a study pick a caller-supplied primitive as its render type,
// not just the built-in SERIES_CTOR vocabulary. The host resolves this before falling back to SERIES_CTOR.
/** @type {Record<string, any>} */
const CUSTOM_PLOTS = {};
/** @param {string} type @param {any} view */
export function registerCustomPlot(type, view) { if (type && view) CUSTOM_PLOTS[type] = view; }
/** @param {string} type */
export function unregisterCustomPlot(type) { delete CUSTOM_PLOTS[type]; }
/** @param {string} type */
export const getCustomPlot = (type) => CUSTOM_PLOTS[type] || null;

// a study's inputs -> its default param object
/** @param {import('./types.js').StudySpecOpen} study @returns {Record<string, any>} */
export const defaultsFor = (study) => {
  /** @type {Record<string, any>} */
  const d = {};
  (study.inputs || []).forEach((/** @type {import('./types.js').StudyInput} */ i) => { d[i.key] = i.default; });
  return d;
};

// merge two bar arrays, dedup by time, keep sorted ascending
/** @param {import('../core/types.js').Bar[]} a @param {import('../core/types.js').Bar[]} b @returns {import('../core/types.js').Bar[]} */
export function mergeBars(a, b) {
  if (!a.length) return b.slice().sort((/** @type {any} */ x, /** @type {any} */ y) => x.time - y.time);
  if (!b.length) return a;
  const map = new Map();
  for (const r of a) map.set(r.time, r);
  for (const r of b) map.set(r.time, r);
  return [...map.values()].sort((/** @type {any} */ x, /** @type {any} */ y) => x.time - y.time);
}

// 'D' / '5m' / '1h' -> { id, unit, n }
/** @param {string} id @returns {{ id: string, unit: string, n: number } | null} */
export function tfFromId(id) {
  const m = /^(\d*)(m|h|D|W|M)$/.exec(String(id || ''));
  return m ? { id, unit: m[2], n: m[1] ? +m[1] : 1 } : null;
}

// legend value formatting: fixed decimals (tabular-nums keeps widths stable so values don't jitter)
/** @param {number|null|undefined} v @param {number} [prec] @returns {string} */
export function fmtVal(v, prec) {
  if (v == null || !isFinite(v)) return '—';
  return Number(v).toFixed(prec != null ? prec : 2);
}

// line-style values from the color picker ('solid'|'dashed'|'dotted') -> Stroke enum;
// numbers (a plot's declared default) pass through.
/** @type {Record<string, number>} */
const LS_ENUM = { solid: 0, dotted: 1, dashed: 2 };
/** @param {number|string} v @returns {number} */
const lsToEnum = (v) => (typeof v === 'number' ? v : (LS_ENUM[v] != null ? LS_ENUM[v] : 0));

// '#rrggbb' + alpha -> 'rgba(r,g,b,a)' (for area/baseline fills)
/** @param {string} hex @param {number} a @returns {string} */
export function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || 'rgba(0,0,0,' + a + ')';
  const n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

// Merge a plot's declared appearance (the study author's defaults) with the user's per-plot
// Style-tab overrides (style[key]). The override always wins, so styling is host-owned and
// independent of calc(). `style` is the per-plot override map (may be undefined).
/** @param {Record<string, any>|undefined} style @param {import('./types.js').StudyPlot & Record<string, any>} pl @returns {Record<string, any>} */
export function effectiveStyle(style, pl) {
  const ov = (style && style[pl.key]) || {};
  /** @param {string} k @param {any} [dflt] */
  const pick = (k, dflt) => (ov[k] != null ? ov[k] : (pl[k] != null ? pl[k] : dflt));
  const color = pick('color', '#e0a030');
  return {
    key: pl.key,
    name: pl.name || pl.key,
    visible: ov.visible != null ? ov.visible : (pl.visible != null ? pl.visible : true),
    // a composite mark (segmented) is not interchangeable with a scalar series, so a stale Style
    // override can't turn it into a histogram/line (which would render the orange default).
    type: pl.type === 'segmented' ? 'segmented' : pick('type', 'line'),
    color,
    // baseline-only: distinct colors above / below the base. Default to
    // the single color so ordinary baseline/line plots are unchanged.
    colorUp: pick('colorUp', color),
    colorDown: pick('colorDown', color),
    lineWidth: pick('lineWidth', 2),
    lineStyle: pick('lineStyle', 0),
    lineType: pick('lineType', 0),
    markers: pick('markers', false),
    priceLine: pick('priceLine', false),
    lastValue: pick('lastValue', false),
    fillOpacity: pick('fillOpacity', 0.2),
    // overlay price scale (structural, from the plot): render on an independent scale pinned to a
    // region of the pane. Lets any study be a bottom (or any-region) overlay, like volume.
    priceScaleId: pl.priceScaleId,
    scaleMargins: pl.scaleMargins,
    overlayLog: pl.overlayLog,
    // horizontal-bar (hbar) layout: anchor edge, max length as a fraction of width, bar thickness,
    // and fill (0..1 of a row's height; <1 leaves a gap between rows)
    side: pl.side,
    widthFrac: pl.widthFrac,
    thickness: pl.thickness,
    fill: pl.fill,
  };
}

// Effective style -> engine series options for the chosen series type.
/** @param {Record<string, any>} eff @param {boolean} show @returns {Record<string, any>} */
export function styleToOptions(eff, show) {
  const ls = lsToEnum(eff.lineStyle);
  const base = {
    visible: show && eff.visible !== false,
    showPriceLine: !!eff.priceLine,
    showLastValue: !!eff.lastValue,
    axisId: eff.priceScaleId, margins: eff.scaleMargins, overlayLog: eff.overlayLog,
  };
  if (eff.type === 'histogram') return { ...base, color: eff.color };
  if (eff.type === 'segmented') return { ...base };   // colors live per-segment in the data
  if (eff.type === 'hbar') return { ...base, color: eff.color, side: eff.side, widthFrac: eff.widthFrac, thickness: eff.thickness, fill: eff.fill };
  if (eff.type === 'area') return {
    ...base, lineColor: eff.color, lineWidth: eff.lineWidth, lineStyle: ls, lineType: eff.lineType,
    topColor: rgba(eff.color, eff.fillOpacity), bottomColor: rgba(eff.color, 0),
    showCursorMarker: false, showPointMarkers: !!eff.markers,
  };
  if (eff.type === 'baseline') return {
    ...base, lineWidth: eff.lineWidth, lineStyle: ls,
    topLineColor: eff.colorUp, bottomLineColor: eff.colorDown,
    topFillColor1: rgba(eff.colorUp, eff.fillOpacity), topFillColor2: rgba(eff.colorUp, 0),
    bottomFillColor1: rgba(eff.colorDown, eff.fillOpacity), bottomFillColor2: rgba(eff.colorDown, 0),
    showCursorMarker: false, showPointMarkers: !!eff.markers,
  };
  return {   // line
    ...base, color: eff.color, lineWidth: eff.lineWidth, lineStyle: ls, lineType: eff.lineType,
    showCursorMarker: false, showPointMarkers: !!eff.markers,
  };
}

// Stacked area: plots sharing a `stack` id are accumulated in declaration order. Each plot's line
// becomes the running cumulative TOP edge, and a fill band is emitted for its layer
// [previous-cumulative .. this-cumulative] in the plot's color. Mutates the plots in place
// (data -> cumulative, type -> line edge) and returns the bands.
/** @param {Array<import('./types.js').StudyPlot & Record<string, any>>} plots @returns {Array<{ color: string, points: any[] }>} */
export function applyStacking(plots) {
  /** @type {Map<any, Array<import('./types.js').StudyPlot & Record<string, any>>>} */
  const groups = new Map();
  plots.forEach((pl) => { if (pl.stack) { if (!groups.has(pl.stack)) groups.set(pl.stack, []); /** @type {any[]} */ (groups.get(pl.stack)).push(pl); } });
  if (!groups.size) return [];
  /** @type {Array<{ color: string, points: any[] }>} */
  const bands = [];
  groups.forEach((members) => {
    const cum = new Map();   // time -> running total of the layers below + this one
    members.forEach((pl) => {
      /** @type {any[]} */
      const points = [], /** @type {any[]} */ newData = [];
      (pl.data || []).forEach((/** @type {import('./types.js').StudyPlotPoint} */ d) => {
        const prev = cum.get(d.time) || 0;
        const v = (d.value == null || !isFinite(d.value)) ? 0 : d.value;
        const top = prev + v;
        cum.set(d.time, top);
        points.push({ time: d.time, top, bottom: prev });
        newData.push({ time: d.time, value: top });
      });
      pl.data = newData;          // the line is now the cumulative top edge
      pl.type = 'line';           // the fill carries the layer's color; the edge is a thin line
      const op = pl.fillOpacity != null ? pl.fillOpacity : 0.6;
      bands.push({ color: rgba(/** @type {string} */ (pl.color), op), points });
    });
  });
  return bands;
}

// Pair each fill's two named plots into a band of { time, top, bottom } points. Bottom is looked
// up by time so the two lines need not be index-aligned; points where either edge is missing or
// non-finite are dropped (the primitive fills only the contiguous defined runs).
/** @param {Array<import('./types.js').StudyFill & Record<string, any>>} fills @param {Array<import('./types.js').StudyPlot & Record<string, any>>} plots @returns {Array<{ top: string, bottom: string, color: string, gradient: any, points: any[] }>} */
export function buildFillBands(fills, plots) {
  if (!fills.length) return [];
  /** @type {Record<string, import('./types.js').StudyPlotPoint[]>} */
  const byKey = {};
  plots.forEach((pl) => { byKey[pl.key] = pl.data || []; });
  return /** @type {Array<{ top: string, bottom: string, color: string, gradient: any, points: any[] }>} */ (fills.map((/** @type {any} */ f) => {
    const top = byKey[f.top], bot = byKey[f.bottom];
    if (!top || !bot) return null;
    const botByTime = new Map();
    bot.forEach((/** @type {import('./types.js').StudyPlotPoint} */ d) => botByTime.set(d.time, d.value));
    /** @type {any[]} */
    const points = [];
    top.forEach((/** @type {import('./types.js').StudyPlotPoint} */ d) => {
      const bv = botByTime.get(d.time);
      if (d.value == null || bv == null || !isFinite(d.value) || !isFinite(bv)) return;
      points.push({ time: d.time, top: d.value, bottom: bv });
    });
    // `top`/`bottom` (the paired plot keys) ride on the band so a streaming tick can re-pair just the last
    // point. `gradient` (optional): a price-anchored vertical ramp painted through the band instead of a flat
    // color -- { at: [priceTop, priceBottom], colors: [topColor, bottomColor, ...] }.
    return { top: f.top, bottom: f.bottom, color: f.color || 'rgba(38,166,154,0.12)', gradient: f.gradient || null, points };
  }).filter(Boolean));
}

// Expand the `shapes` channel into MARKS (the open geometry the ether renders). A shape is either
// raw geometry ({ marks:[...] } -- draw anything) or one of the convenience forms below, which are
// just SUGAR that expands to the same marks. There is no closed shape catalog: box/vline/hline/band/
// label are shortcuts an author may use, not a limit -- `marks` covers everything else.
// (`overlay` is handled one level up, by the host, choosing which pane the shape renders on.)
/** @param {any[]} shapes @returns {any[]} */
export function shapesToMarks(shapes) {
  /** @type {any[]} */
  const out = [];
  for (const s of (shapes || [])) {
    if (!s) continue;
    if (Array.isArray(s.marks)) { for (const m of s.marks) if (m) out.push(m); continue; }   // raw geometry, pass-through
    if (s.shape) { for (const m of resolveShape(s)) if (m) out.push(m); continue; }           // named recipe from the shape library
    if (s.type === 'band') {
      out.push({ back: true, closed: true, fill: s.color || 'rgba(120,120,120,0.12)',
        path: [{ t: s.from, vp: 0 }, { t: s.to, vp: 0 }, { t: s.to, vp: 1 }, { t: s.from, vp: 1 }] });
    } else if (s.type === 'box') {
      const rt = s.to == null ? { vpx: 1 } : { t: s.to };   // to=null -> right edge (open box)
      out.push({ closed: true, fill: s.color, stroke: s.borderColor, width: s.borderWidth || 1, dash: s.lineStyle,
        path: [{ t: s.from, p: s.top }, { ...rt, p: s.top }, { ...rt, p: s.bottom }, { t: s.from, p: s.bottom }] });
      if (s.label) out.push({ text: s.label, at: { t: s.from, p: s.top, dx: 4, dy: 2 }, color: s.borderColor || s.color, size: 11 });
    } else if (s.type === 'vline') {
      out.push({ stroke: s.color || '#787b86', width: s.width || 1, dash: s.lineStyle,
        path: [{ t: s.time, vp: 0 }, { t: s.time, vp: 1 }] });
      if (s.label) out.push({ text: s.label, at: { t: s.time, vp: 0, dx: 4, dy: 4 }, color: s.color, size: 11 });
    } else if (s.type === 'hline') {
      out.push({ stroke: s.color || '#787b86', width: s.width || 1, dash: s.lineStyle,
        path: [{ vpx: 0, p: s.price }, { vpx: 1, p: s.price }] });
      if (s.label) out.push({ text: s.label, at: { vpx: 1, p: s.price, dx: -4, dy: -2 }, color: s.color, align: 'right', baseline: 'bottom', size: 11 });
    } else if (s.type === 'label') {
      const at = s.y != null ? { t: s.time, vp: 0, dy: s.y } : { t: s.time, p: s.price };
      out.push({ text: s.text, at, color: s.color, align: s.hAlign || 'left', baseline: s.vAlign || 'top', size: s.size, bold: s.bold, italic: s.italic });
    }
  }
  return out;
}

// A study's `scale` declaration -> an engine y_range provider (hi,lo)=>[hi,lo]. Forms:
//   fn (hi,lo)=>[hi,lo]       full control over the pane's auto range
//   { min, max }             ensure the range always spans [min,max] (expand-only; spikes still show)
//   { min, max, hard:true }   clamp the pane to exactly [min,max]
/** @param {any} scale @returns {((hi: number, lo: number) => [number, number]) | null} */
export function scaleProvider(scale) {
  if (typeof scale === 'function') return scale;
  if (scale && typeof scale === 'object') {
    const hasMax = scale.max != null, hasMin = scale.min != null;
    if (scale.hard) return (hi, lo) => [hasMax ? scale.max : hi, hasMin ? scale.min : lo];
    return (hi, lo) => [hasMax ? Math.max(hi, scale.max) : hi, hasMin ? Math.min(lo, scale.min) : lo];
  }
  return null;
}

// align sub-bars under each chart bar by time: bar i owns [bars[i].time, bars[i+1].time).
// chartSec = the chart bar duration in seconds (for the last bar's open-ended window).
/** @param {import('../core/types.js').Bar[]} bars @param {import('../core/types.js').Bar[]} subBars @param {number} chartSec @returns {import('../core/types.js').Bar[][]} */
export function bucketIntrabar(bars, subBars, chartSec) {
  /** @type {import('../core/types.js').Bar[][]} */
  const out = bars.map(() => []);
  if (!subBars.length || !bars.length) return out;
  let j = 0;
  for (let i = 0; i < bars.length; i++) {
    const start = /** @type {number} */ (bars[i].time), end = /** @type {number} */ ((i + 1 < bars.length) ? bars[i + 1].time : start + chartSec);
    while (j < subBars.length && /** @type {number} */ (subBars[j].time) < start) j++;
    while (j < subBars.length && /** @type {number} */ (subBars[j].time) < end) { out[i].push(subBars[j]); j++; }
  }
  return out;
}

