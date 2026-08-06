// @ts-check
// Callout — a leader line with a text box at its end. Two points: [0] = the tip (what it
// points at), [1] = the box anchor (the box's left-middle). Both are reshape handles, so
// it's editable like a trend line. The line meets the box at the middle of its nearest
// side. Plain line, no arrowhead. The box (wrap/bg/border/edit) is the shared text box.
import { PADX, measureBox, drawBoxText, boxTextGeom } from './text-box.js';
import { pin, pinHandles } from './pin.js';
// (`Tools`, `ToolDrawing`, `ToolView`, `ToolScreenPoint`, `ToolDataPoint`, … are ambiently typed in tools-global.d.ts.)
/** @typedef {ReturnType<typeof measureBox> & { wrap?: boolean }} Box   measured text box (+ our wrap flag) */

Tools.register({
  id: 'callout',
  glyph: '⤴',
  kind: 'draw',
  points: 2,
  noAlert: true, // annotation, not a price object
  editOnCreate: true, // a callout is a text box -> open the in-place editor as soon as it's placed
  defaultStyle: {
    lineColor: '#787b86',
    lineWidth: 1,
    lineStyle: 'solid',
    bgOn: false,
    bg: '#1e222d',
    borderOn: true,
    border: '#2962ff',
    borderWidth: 1,
    wrap: false,
  },
  settings: {
    style: [
      { name: 'Line', controls: [{ key: 'lineColor', type: 'color', width: 'lineWidth', lineStyle: 'lineStyle' }] },
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

  // Declarative: the leader line + box background + border as marks; the wrapped text stays on
  // drawText. boxFor (measured via an offscreen ctx here) refreshes the boxCache handles/hitTest read.
  /** @param {ToolDrawing} d @param {ToolView} view */
  marks(d, view) {
    const P = d.points || [];
    if (P.length < 2) return [];
    // screen pts; the .some() guard below rejects any null map result, so treat them as ToolScreenPoint after.
    const pts = /** @type {ToolScreenPoint[]} */ (
      P.map((p) => ({ x: view.timeToX(p.time), y: view.priceToY(p.price) }))
    );
    if (pts.some((p) => p.x == null || p.y == null)) return [];
    const box = boxFor(measureCtx(), pts, d);
    if (!box) return [];
    /** @type {any[]} */
    const out = [];
    const tip = pts[0],
      mid = nearestSideMid(box, tip),
      s = d.style || {};
    /** @param {number} x @param {number} y */
    const sv = (x, y) => ({ vpx: 0, dx: x, vp: 0, dy: y });
    out.push({
      path: [sv(tip.x, tip.y), sv(mid.x, mid.y)],
      stroke: s.lineColor || '#787b86',
      width: s.lineWidth || 1,
      dash: Tools.dash(s.lineStyle),
    });
    if (s.bgOn !== false && s.bg)
      out.push({
        closed: true,
        fill: s.bg,
        path: [sv(box.x, box.y), sv(box.x + box.w, box.y), sv(box.x + box.w, box.y + box.h), sv(box.x, box.y + box.h)],
      });
    if (s.borderOn !== false)
      out.push({
        closed: true,
        stroke: s.border || '#2962ff',
        width: s.borderWidth || 1,
        path: [
          sv(box.x + 0.5, box.y + 0.5),
          sv(box.x + box.w - 0.5, box.y + 0.5),
          sv(box.x + box.w - 0.5, box.y + box.h - 0.5),
          sv(box.x + 0.5, box.y + box.h - 0.5),
        ],
      });
    return out;
  },
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d */
  drawText(c, pts, d) {
    const b = boxFor(c, pts, d);
    if (b) drawBoxText(c, b, d.textStyle);
  },
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d */
  textGeom(c, pts, d) {
    const b = boxFor(c, pts, d);
    return b ? boxTextGeom(b, d.style, b.wrap) : null;
  },

  /** @param {ToolScreenPoint[]} pts @param {ToolDrawing} [d] */
  handles(pts, d) {
    const b = d && boxCache.get(d);
    return pts.length >= 2 ? PINS.handles({ pts, box: b }) : pts;
  },
  /** @param {ToolScreenPoint[]} pts @param {number} x @param {number} y @param {number} tol @param {ToolDrawing} d */
  hitTest(pts, x, y, tol, d) {
    if (pts.length < 2) return null;
    // Measure the box HERE from the current screen pts, rather than trusting the render cache. A cache
    // miss/stale box left `b` undefined, so the leader-line hit fell back to pts[1] (the box's left-mid)
    // instead of the nearestSideMid the line is actually drawn to -- and the body box was skipped -- which
    // made the whole callout nearly un-grabbable. Measuring here keeps the hit region matching the render.
    const b = boxFor(measureCtx(), pts, d) || (d && boxCache.get(d));
    const i = PINS.hitPin({ pts, box: b }, x, y, tol); // tip / box-anchor / width pins
    if (i >= 0) return { part: 'point', index: i };
    if (b && x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol) return { part: 'body' };
    const mid = b ? nearestSideMid(b, pts[0]) : pts[1];
    if (Tools.geom.distToSegment(x, y, pts[0].x, pts[0].y, mid.x, mid.y) <= tol) return { part: 'body' };
    return null;
  },
  /** @param {ToolDrawing} d @param {number} index @param {ToolDataPoint} dp */
  reshape(d, index, dp) {
    PINS.reshape(d, index, dp);
  },

  // Grabbing the box/label and dragging relocates the box only — the attachment tip (points[0])
  // stays put, so you can swing the callout around its anchor by the label. The leader line
  // re-anchors to the box automatically. (Drag the tip's handle to move the attachment; a
  // group/multi-select move still translates the whole callout.)
  /** @param {ToolDataPoint[]} orig @param {(p:ToolDataPoint)=>ToolDataPoint} move */
  bodyMove(orig, move) {
    return [{ ...orig[0] }, move(orig[1]), ...(orig[2] ? [move(orig[2])] : [])];
  },
});

// ---------------------------------------------------------------- drawing helpers
/** @type {WeakMap<ToolDrawing, Box>} */
const boxCache = new WeakMap();
/** @type {CanvasRenderingContext2D|null} */
let _mctx = null; // offscreen ctx so marks() can measure the box without a render ctx
const measureCtx = () =>
  _mctx || (_mctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d')));

// reshape pins: tip, box anchor, and (only when wrapping) the right-edge width handle.
// The tip/anchor drags preserve the optional 3rd (width) point so resizing isn't lost.
/** @param {ToolDrawing} d */
const keep3 = (d) =>
  /** @type {ToolDataPoint[]} */ (d.points)[2] ? [{ .../** @type {ToolDataPoint[]} */ (d.points)[2] }] : [];
const PINS = pinHandles([
  // tip: moves the leader-line tip only (box + width point stay put)
  pin({
    at: (ctx) => ctx.pts[0],
    drag: (d, dp) => {
      d.points = [{ time: dp.time, price: dp.price }, { ...d.points[1] }, ...keep3(d)];
    },
  }),
  // box anchor (left side): MOVES the whole box — shift the right-edge width point by the
  // same delta so the width is preserved (left handle = move, not resize).
  pin({
    at: (ctx) => ctx.pts[1],
    drag: (d, dp) => {
      const p = d.points,
        dt = dp.time - p[1].time;
      const right = p[2] ? [{ time: p[2].time + dt, price: dp.price }] : [];
      d.points = [{ ...p[0] }, { time: dp.time, price: dp.price }, ...right];
    },
  }),
  pin({
    show: (ctx) => !!(ctx.box && ctx.box.wrap),
    at: (ctx) => ({ x: ctx.box.x + ctx.box.w, y: ctx.box.y + ctx.box.h / 2 }),
    drag: (d, dp) => {
      d.points = [{ ...d.points[0] }, { ...d.points[1] }, { time: dp.time, price: d.points[1].price }];
    },
  }),
]);

// box rect with pts[1] anchored at its left-middle (box extends right, centered on pts[1].y).
// Wrap off: hug the text. Wrap on: word-wrap to the right-edge handle (3rd point), or a
// default ~160px until that handle is dragged — same as the Text tool.
/** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d @returns {Box|null} */
function boxFor(c, pts, d) {
  if (pts.length < 2) return null;
  const wrap = !!(d.style && d.style.wrap);
  /** @type {number|null} */
  let wrapW = null;
  if (wrap) {
    const rightX = pts.length >= 3 ? pts[2].x : pts[1].x + 160;
    wrapW = Math.max(8, rightX - pts[1].x - PADX * 2);
  }
  const box = /** @type {Box} */ (measureBox(c, pts[1].x, 0, d.text, d.textStyle, wrapW));
  box.y = pts[1].y - box.h / 2;
  box.wrap = wrap;
  boxCache.set(d, box);
  return box;
}
// the middle of whichever box side is nearest the tip
/** @param {Box} box @param {ToolScreenPoint} p */
function nearestSideMid(box, p) {
  const mids = [
    { x: box.x, y: box.y + box.h / 2 }, // left
    { x: box.x + box.w, y: box.y + box.h / 2 }, // right
    { x: box.x + box.w / 2, y: box.y }, // top
    { x: box.x + box.w / 2, y: box.y + box.h }, // bottom
  ];
  let best = mids[0],
    bd = Infinity;
  mids.forEach((m) => {
    const dx = m.x - p.x,
      dy = m.y - p.y,
      dd = dx * dx + dy * dy;
    if (dd < bd) {
      bd = dd;
      best = m;
    }
  });
  return best;
}
