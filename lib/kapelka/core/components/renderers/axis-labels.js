// @ts-check
// Axis-label drawing -- the price-scale tags (last value, price-line tags, primitive priceAxisViews)
// on each pane's sidebar, and the time-scale tags (primitive timeAxisViews) on the shared botbar.
// This is the single label system: the author's last-price shader is disabled in the paint loop, so
// every price-axis label flows through drawAxisViews and can be decluttered (no-overlap stacking).
// Lifted verbatim out of the Chart shell; the two entry points take the chart reference `c`.
import Const from '../../stuff/constants.js';
import { fmtTickPrice } from '../../price-fmt.js';

// percentage/indexed panes carry a y_format (price -> "+5.00%" / "103.50"); every axis label (last
// value, price-line tags) rides it so the tags match the gridline units. Otherwise the price is
// quantized to the instrument tick grid (g.minMove, main scale only) with the instrument decimals.
/**
 * @param {any} g   a built grid / overlay scale-view (carries y_format/minMove/tickPrec/prec)
 * @param {number} price
 * @returns {string}
 */
function fmt(g, price) {
  if (g.y_format) return g.y_format(price);
  const prec = (g.minMove > 0 && g.tickPrec != null) ? g.tickPrec : (g.prec != null ? g.prec : 2);
  return fmtTickPrice(price, g.minMove, prec);
}

/** A decluttered axis-label box: a price/time tag with its resolved colors + optional side chip.
 * @typedef {{ y: number, text: string, fg: string, bg: string, chip: string|null }} Tag */

// 1-D label declutter: sort by desired y, push boxes (height h) apart so none overlap, then
// clamp into [h/2, maxY - h/2]. A handful of labels, so two passes are plenty.
/**
 * @param {Tag[]} tags
 * @param {number} h
 * @param {number} [maxY]
 */
function stackTags(tags, h, maxY) {
  if (tags.length < 2) return;
  tags.sort((a, b) => a.y - b.y);
  for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < h) tags[i].y = tags[i - 1].y + h;
  const bot = (maxY || Infinity) - h / 2;
  for (let i = tags.length - 1; i >= 0; i--) {
    if (tags[i].y > bot) tags[i].y = bot;
    if (i > 0 && tags[i].y - tags[i - 1].y < h) tags[i - 1].y = tags[i].y - h;
  }
  for (let i = 0; i < tags.length; i++) if (tags[i].y < h / 2) tags[i].y = h / 2;
}

// ALL price-axis labels for a pane (last value, price-line tags, primitive views) -> tags on
// the sidebar (drawn after sb.update).
/**
 * @param {any} c      the Chart hub (index.js -- untyped)
 * @param {any} pane   a built pane (grid position `k`, id, sbCv/gridCv canvases)
 */
export function drawAxisViews(c, pane) {
  const g = c._gridAt(pane.k); if (!g) return;
  const h = Const.ChartConfig.PANHEIGHT;   // match the crosshair price panel height (not a squat 16px)
  /** @type {Tag[]} */
  const tags = [];
  // chip = a small title badge (e.g. "Bid"/"Ask") that pokes OUT of the price scale into the
  // chart, attached to the label — so the title never steals the price's width inside the box.
  // A price-axis label shows only while its price is within the pane's visible range: drop any tag
  // whose y falls outside [0, height] BEFORE the declutter/clamp below. Otherwise stackTags would pull
  // an off-range label back into view and park it at the edge (labels stacking at top/bottom as you
  // scroll a level out of view). Draw at the true coordinate and let the canvas clip off-screen labels away.
  /**
   * @param {number|null} y
   * @param {string} text
   * @param {string} [fg]
   * @param {string} [bg]
   * @param {string|null} [chip]
   */
  const add = (y, text, fg, bg, chip) => {
    if (y == null || !isFinite(y) || y < 0 || y > g.height) return;
    tags.push({ y, text, fg: fg || '#fff', bg: bg || '#363a45', chip: chip || null });
  };
  for (const s of c._series) {
    if (s._pane !== pane.id) continue;
    // last-value label (showLastValue): the current price tag on the axis (any candle series)
    if (s._isCandle() && s._rows.length && s._opts.showLastValue !== false) {
      const last = s._rows[s._rows.length - 1], price = last[4], st = s._style;
      add(g.$2screen(price), fmt(g, price), '#fff', s._opts.priceLineColor || (price >= last[1] ? st.colorCandleUp : st.colorCandleDw));
    }
    for (const pl of s._priceLines) {
      const o = pl._opts; if (o.showAxisLabel === false || o.price == null) continue;
      // the title becomes a side chip; the box shows only the price (full width, readable)
      add(g.$2screen(o.price), fmt(g, o.price), o.axisLabelTextColor || '#fff', o.axisLabelColor || o.color || '#363a45', o.title || null);
    }
    for (const prim of s._primitives) {
      const views = /** @type {any[]} */ ([].concat(prim.priceAxisViews ? prim.priceAxisViews() : [], prim.priceAxisPaneViews ? prim.priceAxisPaneViews() : []));
      for (const v of views) { if (!v || (v.visible && !v.visible())) continue; add(v.coordinate ? v.coordinate() : null, v.text ? v.text() : '', v.textColor ? v.textColor() : '#fff', v.backColor ? v.backColor() : '#363a45'); }
    }
  }
  if (!tags.length) return;
  // "No overlapping labels": push overlapping label boxes apart so each stays readable. The
  // price LINES don't move (drawn separately) — only the labels give up exact alignment.
  if (c._options.noOverlapLabels !== false) stackTags(tags, h, g.height);
  const ctx = pane.sbCv.getContext('2d'); ctx.font = c._comp.$props.font;
  const gctx = pane.gridCv.getContext('2d'); gctx.font = c._comp.$props.font;
  const sb = g.sb, left = c._scaleSide === 'left', r = 3;
  for (const t of tags) {
    const ty = Math.round(t.y);
    // price label fills the price-scale box (full width -> stays readable)
    ctx.fillStyle = t.bg; ctx.fillRect(0, ty - h / 2, sb, h);
    ctx.fillStyle = t.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(t.text, 6, ty);
    // title chip: a rounded badge butted against the scale, poking into the chart (on gridCv)
    if (t.chip) {
      const cw = Math.ceil(gctx.measureText(t.chip).width) + 12;
      const cx = left ? 0 : (g.width - cw);
      gctx.fillStyle = t.bg; gctx.beginPath();
      gctx.roundRect(cx, ty - h / 2, cw, h, left ? [0, r, r, 0] : [r, 0, 0, r]);   // round the chart-facing corners
      gctx.fill();
      gctx.fillStyle = t.fg; gctx.textAlign = 'left'; gctx.textBaseline = 'middle';
      gctx.fillText(t.chip, cx + 6, ty);
    }
  }
}

// primitive timeAxisViews -> tags on the shared botbar (drawn after bb.update)
/** @param {any} c   the Chart hub (index.js -- untyped) */
export function drawTimeAxisViews(c) {
  const g = c._g; if (!g) return;
  const ctx = c._cv.bb.getContext('2d'); ctx.font = c._comp.$props.font;
  /**
   * @param {number|null} x
   * @param {string} text
   * @param {string} [fg]
   * @param {string} [bg]
   */
  const tag = (x, text, fg, bg) => {
    if (x == null || !isFinite(x)) return;
    const w = ctx.measureText(text).width + 10, tx = Math.round(x), h = Const.ChartConfig.PANHEIGHT;
    ctx.fillStyle = bg || '#363a45'; ctx.fillRect(tx - w / 2, 0, w, h);   // match the crosshair time panel height (not a squat 16px)
    ctx.fillStyle = fg || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, tx, h / 2);
  };
  for (const s of c._series) for (const prim of s._primitives) {
    const views = (prim.timeAxisViews ? prim.timeAxisViews() : []) || [];
    for (const v of views) { if (v.visible && !v.visible()) continue; tag(v.coordinate ? v.coordinate() : null, v.text ? v.text() : '', v.textColor ? v.textColor() : '#fff', v.backColor ? v.backColor() : '#363a45'); }
  }
}
