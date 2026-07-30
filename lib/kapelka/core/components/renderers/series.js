// @ts-check
// Series-plot painters -- the value-series renderers (line / area / baseline / histogram / hbar /
// segmented / candle-in-offchart) plus the on-bar markers. Lifted out of the chart shell so each
// painter sits beside the author's core/components/primitives/*, not buried in index.js.
//
// Every painter is a PURE function of (ctx, grid[, series][, extras]) -- no chart state, no `this`.
// The shell's Chart._drawSeries picks the coordinate space (pane grid or overlay scale view) and
// dispatches here; behavior is identical to the inlined originals (this is code-motion, not a rewrite).
import Candle from '../primitives/candle.js';
import { dashFor, hexA, drawMarkerGlyph } from './draw-util.js';

// Trace a value polyline (caller has begun the path). lineType: 0 simple (straight segments),
// 1 stepped (hold each value flat, then jump), 2 curved (Catmull-Rom spline through
// the points).
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   coordinate view (pane grid or overlay scale)
 * @param {import('../../types.js').Row[]} rows
 * @param {number} [lineType]   0 simple, 1 stepped, 2 curved
 */
export function polyline(ctx, g, rows, lineType) {
  const n = rows.length;
  if (!n) return;
  const xs = new Array(n),
    ys = new Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = g.t2screen(rows[i][0]);
    ys[i] = g.$2screen(rows[i][1]);
  }
  ctx.moveTo(xs[0], ys[0]);
  if (lineType === 1) {
    // stepped: horizontal hold to the next x, then vertical jump
    for (let i = 1; i < n; i++) {
      ctx.lineTo(xs[i], ys[i - 1]);
      ctx.lineTo(xs[i], ys[i]);
    }
  } else if (lineType === 2 && n > 2) {
    // curved: Catmull-Rom -> cubic bezier through each point pair
    for (let i = 0; i < n - 1; i++) {
      const a = i > 0 ? i - 1 : 0,
        d = i + 2 < n ? i + 2 : n - 1;
      ctx.bezierCurveTo(
        xs[i] + (xs[i + 1] - xs[a]) / 6,
        ys[i] + (ys[i + 1] - ys[a]) / 6,
        xs[i + 1] - (xs[d] - xs[i]) / 6,
        ys[i + 1] - (ys[d] - ys[i]) / 6,
        xs[i + 1],
        ys[i + 1],
      );
    }
  } else {
    // simple
    for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   coordinate view (pane grid or overlay scale)
 * @param {any} s   the Series (reads s._opts / s._rows)
 */
export function drawLine(ctx, g, s) {
  const o = s._opts;
  ctx.beginPath();
  polyline(ctx, g, s._rows, o.lineType);
  ctx.lineWidth = o.lineWidth || 1.5;
  ctx.strokeStyle = o.color || o.lineColor || '#4d88ff';
  ctx.setLineDash(dashFor(o.lineStyle || 0));
  ctx.stroke();
  ctx.setLineDash([]); // honor solid/dotted/dashed
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   coordinate view (pane grid or overlay scale)
 * @param {any} s   the Series (reads s._opts / s._rows)
 */
export function drawArea(ctx, g, s) {
  const o = s._opts,
    rows = s._rows,
    base = g.height;
  const line = o.lineColor || o.color || '#4d88ff';
  const top = o.topColor || hexA(line, 0.4),
    bot = o.bottomColor || hexA(line, 0.04);
  const x0 = g.t2screen(rows[0][0]),
    x1 = g.t2screen(rows[rows.length - 1][0]);
  ctx.beginPath();
  polyline(ctx, g, rows, o.lineType);
  ctx.lineTo(x1, base);
  ctx.lineTo(x0, base);
  ctx.closePath();
  let fill = top;
  if (ctx.createLinearGradient) {
    const gr = ctx.createLinearGradient(0, 0, 0, base);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bot);
    fill = gr;
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  polyline(ctx, g, rows, o.lineType);
  ctx.lineWidth = o.lineWidth || 2;
  ctx.strokeStyle = line;
  ctx.setLineDash(dashFor(o.lineStyle || 0));
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   coordinate view (pane grid or overlay scale)
 * @param {any} s   the Series (reads s._opts / s._rows)
 */
export function drawBaseline(ctx, g, s) {
  const o = s._opts,
    rows = s._rows;
  const bv = o.baseValue && o.baseValue.price != null ? o.baseValue.price : o.baseValue != null ? o.baseValue : 0;
  const topLine = o.topLineColor || '#26a69a',
    botLine = o.bottomLineColor || '#ef5350';
  const yBase = g.$2screen(bv),
    x0 = g.t2screen(rows[0][0]),
    x1 = g.t2screen(rows[rows.length - 1][0]);
  // fill: line -> base, split at the baseline (top half vs bottom half) via a 2-stop gradient
  if (ctx.createLinearGradient) {
    ctx.beginPath();
    polyline(ctx, g, rows);
    ctx.lineTo(x1, yBase);
    ctx.lineTo(x0, yBase);
    ctx.closePath();
    const f = Math.max(0, Math.min(1, yBase / g.height));
    const gr = ctx.createLinearGradient(0, 0, 0, g.height);
    gr.addColorStop(0, o.topFillColor1 || hexA(topLine, 0.28));
    gr.addColorStop(f, o.topFillColor2 || hexA(topLine, 0.05));
    gr.addColorStop(f, o.bottomFillColor1 || hexA(botLine, 0.05));
    gr.addColorStop(1, o.bottomFillColor2 || hexA(botLine, 0.28));
    ctx.fillStyle = gr;
    ctx.fill();
  }
  // line, colored per segment by side of the baseline
  ctx.lineWidth = o.lineWidth || 2;
  let prev = null;
  for (const r of rows) {
    const x = g.t2screen(r[0]),
      y = g.$2screen(r[1]);
    if (prev) {
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.strokeStyle = r[1] >= bv ? topLine : botLine;
      ctx.stroke();
    }
    prev = { x, y };
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   coordinate view (pane grid or overlay scale)
 * @param {any} s   the Series (reads s._opts / s._rows)
 */
export function drawHistogram(ctx, g, s) {
  const o = s._opts,
    rows = s._rows,
    base = o.base != null ? o.base : 0;
  const yBase = g.$2screen(base);
  // bar width from the grid's per-bar pixel step (like candles) — robust to sparse/non-uniform
  // data, unlike inferring it from rows[0]/rows[1] which balloons on a gap.
  const bw = Math.max(1, (g.px_step || 6) * 0.7);
  const dft = o.color || '#4d88ff';
  for (const r of rows) {
    const x = g.t2screen(r[0]),
      y = g.$2screen(r[1]);
    ctx.fillStyle = r[2] || dft;
    ctx.fillRect(Math.floor(x - bw / 2), yBase, Math.max(1, Math.floor(bw)), y - yBase);
  }
}

// horizontal bars: each row [price, length, color] sits at price->y and extends horizontally by
// length (auto-scaled to the widest bar), anchored at a chart edge (o.side) within o.widthFrac of
// the width. The Y-axis twin of the histogram — for volume profiles and anything drawn on Y.
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   coordinate view (pane grid or overlay scale)
 * @param {any} s   the Series (reads s._opts / s._rows)
 */
export function drawHBar(ctx, g, s) {
  const o = s._opts,
    rows = s._rows;
  if (!rows.length) return;
  const W = g.width,
    side = o.side || 'right';
  const frac = o.widthFrac != null ? o.widthFrac : 0.25;
  // thickness: explicit px, else a fraction (o.fill, default 0.82) of one price-bin's pixel height
  // (rows are price-sorted) — <1 leaves a gap between rows so they don't touch.
  let thick = o.thickness;
  if (!thick && rows.length > 1)
    thick = Math.abs(g.$2screen(rows[1][0]) - g.$2screen(rows[0][0])) * (o.fill != null ? o.fill : 0.82);
  thick = Math.max(1, Math.round(thick || 3));
  const dft = o.color || 'rgba(120,120,120,0.5)';
  let maxV = 0;
  for (const r of rows) if (r[1] > maxV) maxV = r[1]; // r[1] = total per row
  if (maxV <= 0) return;
  const maxLen = frac * W,
    anchor = side === 'left' ? 0 : W,
    dir = side === 'left' ? 1 : -1;
  const px = (/** @type {number} */ v) => Math.max(0, (v / maxV) * maxLen);
  for (const r of rows) {
    const y = Math.round(g.$2screen(r[0]) - thick / 2); // price -> y (pane price scale)
    const b = r[2];
    const segs =
      b && b.segments ? b.segments : [{ value: (b && b.value) != null ? b.value : r[1], color: b && b.color }];
    let cursor = anchor; // march inward from the anchor edge, stacking segments
    for (const seg of segs) {
      const len = px(seg.value || 0);
      const x = dir === 1 ? cursor : cursor - len;
      ctx.fillStyle = seg.color || dft;
      ctx.fillRect(Math.round(x), y, Math.max(1, Math.round(len)), thick);
      cursor += dir * len;
    }
  }
}

// segmented bar: filled partitions + bar-width delineation lines + a thin centered wick, all
// sharing the bar's exact geometry (so a delineation can never drift off the bar edges).
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   coordinate view (pane grid or overlay scale)
 * @param {any} s   the Series (reads s._rows)
 */
export function drawSegmented(ctx, g, s) {
  const rows = s._rows;
  if (!rows.length) return;
  // bar width from the grid's per-bar pixel step (like candles) — robust to sparse/non-uniform
  // data, unlike inferring it from rows[0]/rows[1] which balloons on a gap.
  const bw = Math.max(1, (g.px_step || 6) * 0.7);
  // width factor f (0..1 of the bar) -> [left, pixelWidth], centered at x. Lets layers stack:
  // wide volume boxes in back, a narrow delta candle/line in front, all zero-anchored.
  const span = (/** @type {number} */ cx, /** @type {number|undefined} */ f) => {
    const w = Math.max(1, Math.floor(bw * (f != null ? f : 1)));
    return [cx - Math.floor(w / 2), w];
  };
  for (const r of rows) {
    const p = r[3];
    if (!p) continue;
    const cx = Math.round(g.t2screen(r[0])); // one integer bar center: body, wick, and lines all share it
    // filled partitions (each can be narrower than the bar via seg.width -> layering). A segment
    // with fill:false is stroked as a hollow outline instead -- the "absorbed/opposing" portion.
    for (const seg of p.segments || []) {
      if (seg.from == null || seg.to == null) continue;
      const [left, w] = span(cx, seg.width);
      const y1 = g.$2screen(seg.from),
        y2 = g.$2screen(seg.to);
      const top = Math.min(y1, y2),
        h = Math.max(1, Math.abs(y2 - y1));
      if (seg.fill === false) {
        ctx.strokeStyle = seg.color || '#888';
        ctx.lineWidth = seg.lineWidth || 1;
        ctx.strokeRect(left + 0.5, top + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
      } else {
        ctx.fillStyle = seg.color || '#888';
        ctx.fillRect(left, top, w, h);
      }
    }
    // whiskers / stems: an array (p.wicks) or the legacy single p.wick; thin centered verticals,
    // so a slot can carry an up-whisker AND a down-whisker.
    const wicks = p.wicks || (p.wick ? [p.wick] : []);
    for (const wk of wicks) {
      if (wk.from == null || wk.to == null) continue;
      const xc = cx + 0.5;
      ctx.strokeStyle = wk.color || '#888';
      ctx.lineWidth = wk.width || 1;
      ctx.beginPath();
      ctx.moveTo(xc, g.$2screen(wk.from));
      ctx.lineTo(xc, g.$2screen(wk.to));
      ctx.stroke();
    }
    // delineations (delta / median); ln.span (0..1) narrows the line to a layer's width
    for (const ln of p.lines || []) {
      if (ln.level == null) continue;
      const [left, w] = span(cx, ln.span);
      const yy = Math.round(g.$2screen(ln.level)) + 0.5;
      ctx.strokeStyle = ln.color || '#000';
      ctx.lineWidth = ln.width || 1;
      ctx.setLineDash(dashFor(ln.lineStyle || 0));
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(left + w, yy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// glyphs on bars (setMarkers): for each visible series in the pane, draw its markers. price =
// exact level; otherwise the marker sits relative to the series' value at that time. g = the pane
// grid (looked up by the shell); font = the axis font.
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   the pane grid
 * @param {any[]} series   visible series in the pane
 * @param {string} [font]
 */
export function drawMarkers(ctx, g, series, font) {
  if (!g) return;
  for (const s of series) {
    const ms = s._markers;
    if (!ms || !ms.length || s._opts.visible === false) continue;
    const rows = s._rows;
    let bw = 8;
    if (rows.length > 1) bw = Math.max(2, Math.abs(g.t2screen(rows[1][0]) - g.t2screen(rows[0][0])) * 0.7);
    const valAt = (/** @type {number} */ tms) => {
      const d = rows;
      if (!d.length) return null;
      let lo = 0,
        hi = d.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (d[m][0] < tms) lo = m + 1;
        else hi = m;
      }
      let i = lo;
      if (i > 0 && Math.abs(d[i - 1][0] - tms) <= Math.abs(d[i][0] - tms)) i = i - 1;
      return d[i];
    };
    ctx.save();
    for (const m of ms) {
      const tms = Math.round(m.time * 1000);
      const x = g.t2screen(tms);
      let y;
      if (m.price != null) {
        y = g.$2screen(m.price);
      } else {
        const r = valAt(tms);
        y = g.$2screen(r ? r[1] : 0);
        const off = (m.size != null ? m.size : 10) + 4;
        if (m.position === 'aboveBar') y -= off;
        else if (m.position === 'belowBar') y += off;
      }
      drawMarkerGlyph(ctx, x, y, bw, m, font);
    }
    ctx.restore();
  }
}

// candle series in an offchart pane (e.g. a compare instrument): coords from the pane's grid + the
// author's Candle. candleW = the chart's candle-body width fraction (Chart._candleWidth()).
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} g   the pane grid
 * @param {any} s   the candle Series (reads s._rows / s._style)
 * @param {number} candleW   candle-body width fraction
 */
export function drawCandleSeries(ctx, g, s, candleW) {
  const rows = s._rows,
    w = (g.px_step || 6) * candleW;
  for (const r of rows) {
    const x = g.t2screen(r[0]) + 0.5;
    new Candle(s._style, ctx, {
      x,
      w,
      o: g.$2screen(r[1]),
      h: g.$2screen(r[2]),
      l: g.$2screen(r[3]),
      c: g.$2screen(r[4]),
      raw: r,
    });
  }
}
