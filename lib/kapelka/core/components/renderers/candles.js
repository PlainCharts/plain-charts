// @ts-check
// The main candlestick overlay: a faithful Candles-overlay surrogate (`_ov`) the author's Candle /
// Price primitives read off, plus the candle draw loop (with per-pixel conflation when zoomed out)
// and the current-price line. Lifted verbatim out of the Chart shell; the entry points take the
// chart reference `chart` (NOT `c` -- that name is the candle loop variable inside these routines).
//
// buildOverlay(chart)   -- build `chart._ov` once per pane-0 (called from _makePane)
// refreshOverlay(...)    -- push the frame's grid/rows/colors/style into `_ov` (called from _rebuild)
// drawCandles(chart,ctx) -- paint the candles + last-price line (the pane-0 overlay renderer)
import Candle from '../primitives/candle.js';   // author's primitive (incl. border patch)
import Price from '../primitives/price.js';
import Const from '../../stuff/constants.js';
import { dashFor } from './draw-util.js';

// Faithful Candles-overlay surrogate: the author's Candle / Price primitives read off it.
// Its $props.layout is the GRID (grids[0]), unlike the render classes whose $props.layout is full.
/** @param {any} chart   the Chart hub (index.js) */
export function buildOverlay(chart) {
  /** @type {any} the author's Candles-overlay surrogate (Vue-reactivity stand-in) */
  const ov = {
    $props: { layout: null, data: [], config: Const.ChartConfig, colors: chart._comp.$props.colors, last: null, meta: {}, tf: undefined },
    data: [],
    $emit: (/** @type {string} */ ev, /** @type {any} */ s) => { if (ev === 'new-shader') (s.target === 'sidebar' ? chart._sbShaders : chart._gridShaders).push(s); },
    price_line: true,
  };
  chart._ov = ov;
  applyOvStyle(chart);
  ov.price = new Price(ov);   // last-price line + (emitted) sidebar price-tag shader
}

/** @param {any} chart */
export function applyOvStyle(chart) {
  const ov = chart._ov, st = chart._style;
  ov.colorCandleUp = st.colorCandleUp; ov.colorCandleDw = st.colorCandleDw;
  ov.colorWickUp = st.colorWickUp; ov.colorWickDw = st.colorWickDw;
  ov.colorCandleBorderUp = st.colorCandleBorderUp; ov.colorCandleBorderDw = st.colorCandleBorderDw;
}

/**
 * @param {any} chart
 * @param {any} g       the built grid (grids[0])
 * @param {import('../../types.js').Row[]} rows
 * @param {Partial<import('../../types.js').Colors>} colors
 */
export function refreshOverlay(chart, g, rows, colors) {
  const ov = chart._ov; if (!ov) return;
  const last = rows && rows.length ? rows[rows.length - 1] : null;
  ov.$props.layout = g; ov.$props.colors = colors;
  ov.$props.data = rows; ov.data = rows;
  ov.$props.last = last; ov.$props.meta = { last };
  const cs = chart._cs(); ov.price_line = !cs || cs._opts.showPriceLine !== false;   // series showPriceLine toggle
  applyOvStyle(chart);
}

// the author's Candles.draw loop: candles, then the last-price line. (Volume is no longer baked in
// here — it's a study on an overlay price scale; the bottom region is open to any study now.)
/**
 * @param {any} chart
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawCandles(chart, ctx) {
  if (!chart._cs()) return;   // no candle series (a Line owns this pane) -> nothing to paint here
  const ov = chart._ov, g = ov && ov.$props.layout; if (!g) return;
  let cands = g.candles || [];
  // per-pixel conflation: zoomed out (px_step < 1 -> >1 bar per pixel), merge the bars sharing a pixel
  // column into one candle, so we draw ~chart-width candles instead of thousands. Purely a render-count
  // optimization — sub, crosshair, drawings and gridlines still use the full data.
  if (g.px_step && g.px_step < 1 && cands.length > 1) cands = conflateCandles(cands);
  for (const c of cands) new Candle(ov, ctx, c);
  drawCurrentPriceLine(chart, ctx, g);
}

// merge candles that fall on the same integer pixel column into one (open of the first, close of the
// last, highest high, lowest low). Candles are x-sorted; a merged candle's raw carries open(1)/close(4)/
// style(6) so the Candle class colours it correctly. Pixel space: smaller y = higher price.
/**
 * @param {any[]} cands   x-sorted candle-geometry objects ({x,w,o,h,l,c,raw})
 * @returns {any[]}
 */
function conflateCandles(cands) {
  const out = [];
  let m = /** @type {any} */ (null), col = null;
  for (const c of cands) {
    const px = Math.round(c.x);
    if (px !== col) {
      if (m) out.push(m);
      m = { x: c.x, w: c.w, o: c.o, h: c.h, l: c.l, c: c.c, raw: [c.raw[0], c.raw[1], 0, 0, c.raw[4], 0, c.raw[6]] };
      col = px;
    } else {
      m.c = c.c; m.raw[4] = c.raw[4];       // extend close to the last bar in this pixel
      if (c.h < m.h) m.h = c.h;             // highest high (smallest y)
      if (c.l > m.l) m.l = c.l;             // lowest low (largest y)
    }
  }
  if (m) out.push(m);
  return out;
}

// the current (last) price line — series showPriceLine/Color/Width/Style at the last close
/**
 * @param {any} chart
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   the built grid (uses $2screen/width)
 */
function drawCurrentPriceLine(chart, ctx, g) {
  const cs = chart._cs(); if (!cs || !cs._rows.length) return;
  const o = cs._opts; if (o.showPriceLine === false) return;
  const last = cs._rows[cs._rows.length - 1], price = last[4];
  const y = Math.floor(g.$2screen(price)) + 0.5;
  ctx.beginPath();
  ctx.strokeStyle = o.priceLineColor || (price >= last[1] ? chart._style.colorCandleUp : chart._style.colorCandleDw);
  ctx.lineWidth = o.priceLineWidth || 1;
  ctx.setLineDash(dashFor(o.priceLineStyle != null ? o.priceLineStyle : 2));   // default = dashed
  ctx.moveTo(0, y); ctx.lineTo(g.width, y); ctx.stroke();
  ctx.setLineDash([]);
}
