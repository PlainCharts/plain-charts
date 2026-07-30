// @ts-check
// Series-attached primitive host: runs each attached primitive's paneViews renderer through a
// coordinate-space target, hit-tests them, and draws the series price-lines (addLevel). Primitives
// are the app's drawings / tools / alerts / study-shapes attached via series.addLayer. Lifted out of
// the Chart shell; the entry points take the chart reference `c`. (hitTest stays a thin delegator on
// Chart because it's public API, but its body lives here.)
import { Stroke } from '../enums.js';

// horizontal price lines on a series' pane (addLevel)
/**
 * @param {any} c   the Chart hub (index.js -- untyped)
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} k   grid POSITION
 */
export function drawPriceLines(c, ctx, k) {
  // k = grid POSITION
  const g = c._gridAt(k);
  if (!g) return;
  const id = c._idAt(k);
  for (const s of c._series) {
    if (s._pane !== id || !s._priceLines.length) continue;
    for (const pl of s._priceLines) {
      const o = pl._opts;
      if (o.showLine === false || o.price == null) continue;
      const y = Math.floor(g.$2screen(o.price)) + 0.5;
      ctx.beginPath();
      ctx.lineWidth = o.lineWidth || 1;
      ctx.strokeStyle = o.color || '#888';
      if (o.lineStyle === Stroke.Dotted) ctx.setLineDash([2, 2]);
      else if (o.lineStyle === Stroke.Dashed || o.lineStyle === Stroke.LongDash) ctx.setLineDash([6, 4]);
      ctx.moveTo(0, y);
      ctx.lineTo(g.width, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// primitive host: run each attached primitive's paneViews renderer with a coord-space target.
// `band` selects which paneViews to paint by their zOrder, so the shell can place them in separate
// overlay bands relative to the candles -- a paneView whose
// zOrder() is 'bottom' draws BENEATH the series. 'below' paints only the 'bottom' views (drawings
// sent to back, rendered behind the candles); 'above' (default) paints the rest, in front.
/**
 * @param {any} c      the Chart hub (index.js -- untyped)
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} pane   a built pane (grid position `k`, id)
 * @param {string} [band]   'above' (default) | 'below'
 */
export function drawPrimitives(c, ctx, pane, band = 'above') {
  const g = c._gridAt(pane.k);
  if (!g) return;
  const target = makeTarget(c._dpr, ctx, g.width, g.height);
  /** @param {any} v   a primitive paneView */
  const zval = (v) => {
    const z = v.zOrder && v.zOrder();
    return z === 'bottom' ? 0 : z === 'top' ? 2 : z === 'aboveSeries' ? 3 : 1;
  };
  const wantBottom = band === 'below';
  /** @param {any} v   a primitive paneView */
  const inBand = (v) => ((v.zOrder && v.zOrder()) === 'bottom') === wantBottom;
  /** @type {any[]} */
  const renderers = [];
  for (const s of c._series) {
    if (s._pane !== pane.id || !s._primitives.length) continue;
    for (const prim of s._primitives) {
      try {
        if (prim.updateAllViews) prim.updateAllViews();
        const views = (prim.paneViews ? prim.paneViews() : []) || [];
        for (const v of views
          .slice()
          .filter(inBand)
          .sort((/** @type {any} */ a, /** @type {any} */ b) => zval(a) - zval(b))) {
          const r = v.renderer && v.renderer();
          if (r) renderers.push(r);
        }
      } catch (_) {
        /* a misbehaving primitive must not kill the frame */
      }
    }
  }
  // Within a band, every primitive BACKGROUND paints behind every foreground:
  // renderer.drawBackground(target) (optional) for all, then renderer.draw(target) for all. So a
  // plugin that fills a background and strokes a foreground layers correctly against its neighbours.
  for (const r of renderers) {
    if (r.drawBackground) {
      try {
        r.drawBackground(target);
      } catch (_) {}
    }
  }
  for (const r of renderers) {
    if (r.draw) {
      try {
        r.draw(target);
      } catch (_) {}
    }
  }
}

// best primitive hit at (x, y) in root CSS px -> { externalId, cursorStyle, zOrder } | null.
// A hit may optionally carry `hitTestPriority` (higher wins: point 2 > line 1 > range 0) and
// `distance` (px from the cursor; nearest wins within a priority). Arbitration: priority desc,
// then distance asc, then zOrder desc (ties keep the later hit -- the legacy behavior, which is
// also exactly what happens when no hit carries the optional fields).
/**
 * @param {any} c   the Chart hub (index.js -- untyped)
 * @param {number} x
 * @param {number} y
 * @returns {any}
 */
export function hitTest(c, x, y) {
  const L = c._comp.$props.layout;
  if (!L) return null;
  const grids = L.grids;
  let k = -1;
  for (let i = 0; i < grids.length; i++) {
    const gi = grids[i];
    if (y >= gi.offset && y < gi.offset + gi.height) {
      k = i;
      break;
    }
  }
  if (k < 0) return null;
  const ly = y - grids[k].offset;
  let best = null,
    bp = -Infinity,
    bd = Infinity,
    bz = -Infinity;
  const id = c._idAt(k);
  for (const s of c._series) {
    if (s._pane !== id) continue;
    for (const prim of s._primitives) {
      if (!prim.hitTest) continue;
      const hit = prim.hitTest(x, ly);
      if (!hit) continue;
      const pr = hit.hitTestPriority || 0;
      const d = hit.distance != null && isFinite(hit.distance) ? hit.distance : Infinity;
      const z = hit.zOrder || 0;
      if (pr < bp) continue;
      if (pr === bp) {
        if (d > bd) continue;
        if (d === bd && z < bz) continue;
      }
      bp = pr;
      bd = d;
      bz = z;
      best = hit;
    }
  }
  return best;
}

// CanvasRenderingTarget2D-like: bitmap space = device px (identity), media space = CSS px (dpr)
/**
 * @param {number} dpr
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} mediaW
 * @param {number} mediaH
 */
function makeTarget(dpr, ctx, mediaW, mediaH) {
  return {
    /** @param {(scope: any) => void} f */
    useBitmapCoordinateSpace(f) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      try {
        f({
          context: ctx,
          mediaSize: { width: mediaW, height: mediaH },
          bitmapSize: { width: Math.round(mediaW * dpr), height: Math.round(mediaH * dpr) },
          horizontalPixelRatio: dpr,
          verticalPixelRatio: dpr,
        });
      } finally {
        ctx.restore();
      }
    },
    /** @param {(scope: any) => void} f */
    useMediaCoordinateSpace(f) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try {
        f({ context: ctx, mediaSize: { width: mediaW, height: mediaH } });
      } finally {
        ctx.restore();
      }
    },
  };
}
