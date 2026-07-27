// @ts-check
// The ether: a stateless renderer for an OPEN geometry vocabulary. Instead of a fixed catalog of
// shapes (vline/hline/box/...), an author describes geometry as data — "marks" — and this paints them.
// A mark is either a `path` (anchored vertices, optionally closed / filled / stroked) or `text`.
// Everything a creator draws is composed from these; the substance is the floor, the shapes are theirs.
//
// A vertex anchors in the chart's own coordinate space, so a mark scales and moves with the chart:
//   t   -> x   (time, unix seconds; via scope.timeToX, extrapolates into the future whitespace)
//   p   -> y   (price; via scope.priceToY, the anchor pane's price scale)
//   vpx -> x   (viewport fraction 0..1 of the pane WIDTH)   -- pin to the left/right edge
//   vp  -> y   (viewport fraction 0..1 of the pane HEIGHT)   -- pin to the top/bottom edge
//   dx, dy     pixel offsets on x / y  -- non-scaling bits (arrowheads, insets, callout bodies)
// The mix is the point: a callout tip at {t,p} with its body held at {t,p,dx,dy} pinned in pixels.
//
// `paintMark`/`paintMarks` are the SHARED render core: given a canvas ctx + a coordinate `scope`
// ({ timeToX, priceToY, width, height }), they paint marks. Both the study mark primitive (below) and
// the app's drawing-tools engine render through this one function — one renderer under everything drawn.
import { timeToX } from './geometry.js';

/** A coordinate scope: the mappers + pane size a mark resolves against. `timeToX`/`priceToY` may return
 * null when the anchor can't be placed (off-axis / no series). Callers that always resolve pass mappers
 * returning plain numbers — assignable to number|null.
 * @typedef {{ timeToX: (t: number) => number|null|undefined, priceToY: (p: number) => number|null|undefined,
 *   width: number, height: number }} Scope */

/** One vertex of a mark. Anchors in chart space (t/p), viewport fraction (vpx/vp), plus pixel offsets.
 * Open bag — authors add fields. @typedef {{ t?: number, p?: number, vpx?: number, vp?: number,
 *   dx?: number, dy?: number, [k: string]: any }} Vertex */

/** One mark: a `path` (vertices, optionally closed/filled/stroked) OR `text` anchored at `at`. Open bag.
 * @typedef {{ path?: Vertex[], closed?: boolean, fill?: string, stroke?: string, width?: number,
 *   dash?: any, back?: boolean, text?: any, at?: Vertex, italic?: boolean, bold?: boolean, size?: number,
 *   font?: string, color?: string, align?: CanvasTextAlign, baseline?: CanvasTextBaseline, rotate?: number,
 *   [k: string]: any }} Mark */

/** @param {any} dash @param {number} w @returns {number[]} */
const dashArr = (dash, w) => {
  if (Array.isArray(dash)) return dash;
  return dash === 'dashed' ? [Math.max(4, w * 2), Math.max(4, w * 2)]
    : dash === 'dotted' ? [Math.max(1, w), Math.max(2, w * 2)]
    : [];
};

// one vertex -> {x, y} in pane pixels, or null if it can't be resolved (the mark then skips).
// Exported so the drawing engine can resolve a tool's marks to screen geometry for generic
// hit-testing (a tool with no hitTest of its own is hit-tested from the very marks it draws).
/** @param {Vertex|null|undefined} v @param {Scope} scope @returns {{ x: number, y: number }|null} */
export function resolveVertex(v, scope) {
  if (!v) return null;
  let x;
  if (v.t != null) x = scope.timeToX(v.t);
  else if (v.vpx != null) x = v.vpx * scope.width;
  else x = 0;
  if (x == null) return null;
  x += (v.dx || 0);
  let y;
  if (v.p != null) y = scope.priceToY(v.p);
  else if (v.vp != null) y = v.vp * scope.height;
  else y = 0;
  if (y == null) return null;
  y += (v.dy || 0);
  return { x, y };
}

// paint ONE mark (path or text) through the coordinate scope.
/** @param {CanvasRenderingContext2D} c @param {Mark|null|undefined} m @param {Scope} scope */
export function paintMark(c, m, scope) {
  if (!m) return;
  if (m.path) {
    /** @type {{ x: number, y: number }[]} */
    const pts = [];
    for (const v of m.path) { const q = resolveVertex(v, scope); if (!q) return; pts.push(q); }
    if (pts.length < 1) return;
    c.save();
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    if (m.closed) c.closePath();
    if (m.fill) { c.fillStyle = m.fill; c.fill(); }
    if (m.stroke) {
      c.strokeStyle = m.stroke; c.lineWidth = m.width || 1;
      c.setLineDash(dashArr(m.dash, m.width || 1));
      c.stroke();
    }
    c.restore();
  } else if (m.text != null) {
    const q = resolveVertex(m.at, scope); if (!q) return;
    c.save();
    c.font = (m.italic ? 'italic ' : '') + (m.bold ? 'bold ' : '') + (m.size || 12) + 'px ' + (m.font || 'sans-serif');
    c.fillStyle = m.color || '#787b86';
    c.textAlign = m.align || 'left';
    c.textBaseline = m.baseline || 'top';
    if (m.rotate) { c.translate(q.x, q.y); c.rotate(m.rotate); c.translate(-q.x, -q.y); }
    // multi-line: stack in the direction that keeps the block on the anchor's side. With
    // baseline 'bottom' (text sits ABOVE the anchor) the block must grow UP so EVERY line clears
    // the anchor, not just the first; 'middle' centers; 'top' grows down (the default).
    const lines = String(m.text).split('\n'), lh = (m.size || 12) * 1.25, base = m.baseline || 'top';
    const y0 = base === 'bottom' ? q.y - (lines.length - 1) * lh
             : base === 'middle' ? q.y - (lines.length - 1) * lh / 2
             : q.y;
    lines.forEach((ln, i) => c.fillText(ln, q.x, y0 + i * lh));
    c.restore();
  }
}

// paint an array of marks in order.
/** @param {CanvasRenderingContext2D} c @param {Mark[]|null|undefined} marks @param {Scope} scope */
export function paintMarks(c, marks, scope) { if (marks) for (const m of marks) paintMark(c, m, scope); }

// The study primitive: renders a live marks array on a series' pane through the primitive seam.
// Takes the engine `chart` + getBarTimes() for the time axis, and a live getMarks() closure so it
// repaints from current data every frame (same contract as the shapes primitive).
/**
 * @param {any} chart  the engine chart (drives geometry.timeToX)
 * @param {() => number[]} getBarTimes
 * @param {() => ({ priceToY: (p: number) => number|null } | null | undefined)} getSeries
 * @param {() => (Mark[] | null | undefined)} getMarks
 */
export function createMarkPrimitive(chart, getBarTimes, getSeries, getMarks) {
  /** @type {(() => void) | null} */
  let requestUpdate = null;
  /** @param {number} t */
  const xOfTime = (t) => timeToX(chart, getBarTimes(), t);

  // two z-layers: marks flagged `back:true` paint behind the candles, the rest in front.
  /** @param {boolean} back @returns {(c: CanvasRenderingContext2D, W: number, H: number) => void} */
  const painter = (back) => (c, W, H) => {
    const series = getSeries();
    const scope = { timeToX: xOfTime, priceToY: (/** @type {number} */ p) => (series ? series.priceToY(p) : null), width: W, height: H };
    const marks = getMarks();
    if (marks) for (const m of marks) { if (!!m.back === back) paintMark(c, m, scope); }
  };

  /** @param {string} zOrder @param {(c: CanvasRenderingContext2D, W: number, H: number) => void} paint @param {(() => boolean)=} isEmpty */
  const makeView = (zOrder, paint, isEmpty) => ({
    renderer: () => ({
      /** @param {any} target */
      draw(target) { target.useMediaCoordinateSpace((/** @type {any} */ s) => paint(s.context, s.mediaSize.width, s.mediaSize.height)); },
    }),
    zOrder: () => zOrder,
    ...(isEmpty ? { isEmpty } : {}),
  });

  return {
    updateAllViews() {},
    // the bottom view reports emptiness so the engine's objects-only repaint tier can skip the data
    // sheet when no mark is sent behind the bars
    paneViews() { return [makeView('bottom', painter(true), () => { const ms = getMarks(); return !ms || !ms.some((/** @type {any} */ m) => m.back); }), makeView('top', painter(false))]; },
    /** @param {{ requestUpdate: () => void }} p */
    attached(p) { requestUpdate = p.requestUpdate; },
    detached() { requestUpdate = null; },
    repaint() { if (requestUpdate) requestUpdate(); },
  };
}
