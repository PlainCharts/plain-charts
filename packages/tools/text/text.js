// @ts-check
// Text — a free-placed text box. Click to drop it, then type. Wrap off (default): the
// box hugs the text (width = widest line). Wrap on: the right-edge handle sets a fixed
// width and the text WORD-wraps to it. Background off by default; border on. The box
// rendering lives in ./text-box.js (shared with the Callout tool).
import { PADX, measureBox, drawBoxText, boxTextGeom } from './text-box.js';
import { pin, pinHandles } from './pin.js';

// A measured box (./text-box.js Box) plus the `wrap` flag this tool tacks on.
/** @typedef {ReturnType<typeof measureBox> & { wrap: boolean }} TextBox */

Tools.register({
  id: 'text',
  glyph: 'T',
  kind: 'draw',
  points: 1,
  noAlert: true, // annotation, not a price object
  editOnCreate: true, // text is the point of the tool -> open the in-place editor as soon as it's placed
  defaultStyle: {
    bgOn: false,
    bg: '#1e222d',
    borderOn: true,
    border: '#2962ff',
    borderWidth: 1,
    wrap: false,
  },
  settings: {
    style: [
      { name: 'Background', toggle: 'bgOn', controls: [{ key: 'bg', type: 'color' }] },
      {
        name: 'Border',
        toggle: 'borderOn',
        toggleDefault: true,
        controls: [{ key: 'border', type: 'color', width: 'borderWidth' }],
      },
      { name: 'Text wrap', toggle: 'wrap' },
    ],
    text: {
      defaults: { vAlign: 'top', hAlign: 'left' },
      vAlign: [{ key: 'top', name: 'Top' }],
      hAlign: [{ key: 'left', name: 'Left' }],
    },
  },
  // one click -> [anchor, rightEdge]; the right edge (used only when wrapping) starts ~160px right
  /** @param {ToolDataPoint} data @param {ToolPane} pane @returns {ToolDataPoint[]} */
  onCreate(data, pane) {
    const ts = pane.chart.timeAxis();
    const x = ts.timeToX(data.time);
    let rightTime = null;
    if (x != null) rightTime = ts.xToTime(x + 160);
    if (rightTime == null || rightTime <= data.time) rightTime = data.time + 1;
    return [{ ...data }, { time: rightTime, price: data.price }];
  },

  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d @returns {TextBox | null} */
  _box(c, pts, d) {
    if (!pts.length) return null;
    const wrap = !!(d.style && d.style.wrap) && pts.length >= 2;
    const wrapW = wrap ? Math.max(8, pts[1].x - pts[0].x - PADX * 2) : null;
    const box = /** @type {TextBox} */ (measureBox(c, pts[0].x, pts[0].y, d.text, d.textStyle, wrapW));
    box.wrap = wrap;
    boxCache.set(d, box);
    return box;
  },
  // Declarative: the box background + border as marks (the wrapped text stays on drawText, which needs
  // a real ctx to measure/wrap). _box (measured here via an offscreen ctx) refreshes the boxCache.
  /** @param {ToolDrawing} d @param {ToolView} view @returns {ToolMark[]} */
  marks(d, view) {
    const P = d.points || [];
    if (!P.length) return [];
    const pts = [{ x: view.timeToX(P[0].time), y: view.priceToY(P[0].price) }];
    if (P.length >= 2) pts.push({ x: view.timeToX(P[1].time), y: view.priceToY(P[1].price) });
    if (pts.some((p) => p.x == null || p.y == null)) return [];
    const b = this._box(measureCtx(), /** @type {ToolScreenPoint[]} */ (pts), d);
    if (!b) return [];
    const s = d.style || {};
    /** @type {ToolMark[]} */
    const out = [];
    /** @param {number} x @param {number} y */
    const sv = (x, y) => ({ vpx: 0, dx: x, vp: 0, dy: y });
    if (s.bgOn !== false && s.bg)
      out.push({
        closed: true,
        fill: s.bg,
        path: [sv(b.x, b.y), sv(b.x + b.w, b.y), sv(b.x + b.w, b.y + b.h), sv(b.x, b.y + b.h)],
      });
    if (s.borderOn !== false)
      out.push({
        closed: true,
        stroke: s.border || '#2962ff',
        width: s.borderWidth || 1,
        path: [
          sv(b.x + 0.5, b.y + 0.5),
          sv(b.x + b.w - 0.5, b.y + 0.5),
          sv(b.x + b.w - 0.5, b.y + b.h - 0.5),
          sv(b.x + 0.5, b.y + b.h - 0.5),
        ],
      });
    return out;
  },
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d */
  drawText(c, pts, d) {
    const b = this._box(c, pts, d);
    if (b) drawBoxText(c, b, d.textStyle);
  },
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d */
  textGeom(c, pts, d) {
    const b = this._box(c, pts, d);
    return b ? boxTextGeom(b, d.style, b.wrap) : null;
  },

  // right-edge width handle (pin) — present only while wrapping; see PINS in the helpers below.
  /** @param {ToolScreenPoint[]} pts @param {ToolDrawing} [d] */
  handles(pts, d) {
    const box = d && boxCache.get(d);
    return box ? PINS.handles({ pts, box }) : [];
  },
  /** @param {ToolScreenPoint[]} pts @param {number} x @param {number} y @param {number} tol @param {ToolDrawing} [d] @returns {ToolHitResult} */
  hitTest(pts, x, y, tol, d) {
    // Measure the box HERE from the current screen pts instead of trusting the render cache -- a cache
    // miss/stale entry made this return null (or the wrong rect), leaving the text box un-grabbable.
    const box = this._box(measureCtx(), pts, d) || (d && boxCache.get(d));
    if (!box) return null;
    const i = PINS.hitPin({ pts, box }, x, y, tol);
    if (i >= 0) return { part: 'point', index: i };
    if (x >= box.x - tol && x <= box.x + box.w + tol && y >= box.y - tol && y <= box.y + box.h + tol)
      return { part: 'body' };
    return null;
  },
  /** @param {ToolDrawing} d @param {number} index @param {ToolDataPoint} dp */
  reshape(d, index, dp) {
    PINS.reshape(d, index, dp);
  },
});

// ---------------------------------------------------------------- box cache + reshape pin
// last rendered box per drawing, so handles()/hitTest() (no canvas) can read its geometry.
/** @type {WeakMap<object, TextBox>} */
const boxCache = new WeakMap();
/** @type {CanvasRenderingContext2D | null} */
let _mctx = null; // offscreen ctx so marks() can measure the box without a render ctx
const measureCtx = () =>
  _mctx || (_mctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d')));

// one pin: the right-edge width handle, present only while wrapping; dragging it sets the
// width (point[1].time) and keeps the anchor. The show() condition lives on the pin.
const PINS = pinHandles([
  pin({
    show: (ctx) => !!(ctx.box && ctx.box.wrap),
    at: (ctx) => ({ x: ctx.box.x + ctx.box.w, y: ctx.box.y + ctx.box.h / 2 }),
    drag: (d, dp) => {
      d.points = [d.points[0], { time: dp.time, price: d.points[0].price }];
    },
  }),
]);
