// @ts-check
// Rectangle — a 2-point box (drag/click opposite corners) with optional fill and
// an optional middle line through the vertical center.
import { pin, pinHandles } from './pin.js';
// (`Tools`, `ToolDrawing`, `ToolView`, `ToolScreenPoint`, `ToolDataPoint`, … are ambiently typed in tools-global.d.ts.)

Tools.register({
  id: 'rect',
  name: 'Rectangle',
  description: 'A tool that draws a rectangle.',
  icon: 'rect.png',
  glyph: '▭',
  kind: 'draw',
  points: 2,
  defaultStyle: {
    color: '#2962ff', width: 2, lineStyle: 'solid',
    fillOn: true, fill: 'rgba(41,98,255,0.10)',
    midLine: false, midColor: '#787b86', midWidth: 1, midStyle: 'dashed',
  },
  settings: {
    style: [
      { name: 'Border', controls: [{ key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' }] },
      { name: 'Middle line', toggle: 'midLine', controls: [{ key: 'midColor', type: 'color', width: 'midWidth', lineStyle: 'midStyle' }] },
      { name: 'Background', toggle: 'fillOn', toggleDefault: true, controls: [{ key: 'fill', type: 'color' }] },
    ],
    text: {
      defaults: { vAlign: 'middle', hAlign: 'right' },
      vAlign: [{ key: 'top', name: 'Top' }, { key: 'middle', name: 'Inside' }, { key: 'bottom', name: 'Bottom' }],
      hAlign: [{ key: 'left', name: 'Left' }, { key: 'center', name: 'Center' }, { key: 'right', name: 'Right' }],
    },
  },
  // Declarative: the box is a data-anchored closed path (fill + border); the optional middle line is
  // a horizontal segment at the mid price that splits around centered on-line text.
  /** @param {ToolDrawing} d @param {ToolView} view */
  marks(d, view) {
    const P = d.points || [];
    if (P.length < 2) return [];
    const s = d.style || {};
    const b = bounds(d);
    /** @type {{ closed:boolean, stroke:any, width:number, dash:number[], path:any[], fill?:any }} */
    const box = { closed: true, stroke: s.color, width: s.width || 2, dash: Tools.dash(s.lineStyle),
      path: [{ t: b.left, p: b.top }, { t: b.right, p: b.top }, { t: b.right, p: b.bottom }, { t: b.left, p: b.bottom }] };
    if (s.fillOn !== false && s.fill) box.fill = s.fill;
    /** @type {any[]} */
    const out = [box];
    if (s.midLine) {
      const mid = (b.top + b.bottom) / 2;
      /** @param {any} a @param {any} c */
      const seg = (a, c) => ({ path: [a, c], stroke: s.midColor || '#787b86', width: s.midWidth || 1, dash: Tools.dash(/** @type {any} */ (s.midStyle)) });
      const band = this.textBand(d, view);
      if (band) {
        // NOTE: xL/xR are used unconditionally as numbers here (unlike the null-guarded sibling tools).
        // timeToX can return null; the existing runtime relies on Math.max/compare coercing that to 0.
        // Cast to keep that behavior verbatim — see the report's "bug noticed" note.
        const xL = /** @type {number} */ (view.timeToX(b.left)), xR = /** @type {number} */ (view.timeToX(b.right));
        const b0 = Math.max(xL, band[0]), b1 = Math.min(xR, band[1]);
        if (b0 > xL) out.push(seg({ t: b.left, p: mid }, { vpx: 0, dx: b0, p: mid }));
        if (b1 < xR) out.push(seg({ vpx: 0, dx: b1, p: mid }, { t: b.right, p: mid }));
      } else {
        out.push(seg({ t: b.left, p: mid }, { t: b.right, p: mid }));
      }
    }
    return out;
  },
  // horizontal extent (screen x) the label occupies when it sits ON the middle line (vAlign middle) so
  // marks() can break the line around it; null otherwise. Measures via an offscreen ctx.
  /** @param {ToolDrawing} d @param {ToolView} view @returns {[number, number]|null} */
  textBand(d, view) {
    if (!d.text) return null;
    const ts = d.textStyle || {};
    if ((ts.vAlign || 'middle') !== 'middle') return null;   // text isn't on the middle line
    const b = bounds(d);
    const x1 = view.timeToX(b.left), x2 = view.timeToX(b.right);
    if (x1 == null || x2 == null) return null;
    const size = ts.size || 14, pad = 5, gap = 5, ha = ts.hAlign || 'center';
    const lines = String(d.text).split('\n');
    const mc = measureCtx();
    mc.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    const textW = Math.max(0, ...lines.map((l) => mc.measureText(l).width));
    let bx1;
    if (ha === 'left') bx1 = x1 + pad;
    else if (ha === 'right') bx1 = x2 - pad - textW;
    else bx1 = (x1 + x2) / 2 - textW / 2;
    return [bx1 - gap, bx1 + textW + gap];
  },
  // 8 resize handles (4 corners + 4 edge midpoints) declared as pins (see helpers below).
  /** @param {ToolScreenPoint[]} pts */
  handles(pts) { return pts.length >= 2 ? PINS.handles({ bb: bb(pts) }) : pts; },
  // No hitTest: a recipe with custom handles. engine.hitTestFromMarks tests those 8 pins (its index
  // feeds reshape below) then the box marks for the body -- interior when filled, near any edge always.
  /** @param {ToolDrawing} d @param {number} index @param {ToolDataPoint} dp */
  reshape(d, index, dp) { PINS.reshape(d, index, dp); },
});

// ---------------------------------------------------------------- geometry + reshape helpers
// screen bbox of the 2 corners + the edge midpoints
/** @param {ToolScreenPoint[]} pts */
const bb = (pts) => {
  const x1 = Math.min(pts[0].x, pts[1].x), x2 = Math.max(pts[0].x, pts[1].x);
  const y1 = Math.min(pts[0].y, pts[1].y), y2 = Math.max(pts[0].y, pts[1].y);
  return { x1, x2, y1, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
};
// current data bounds [normalized] and a writer
/** @param {ToolDrawing} d */
const bounds = (d) => {
  // bounds() only runs on committed 2-point rects, so points is always the full pair here.
  const p = /** @type {ToolDataPoint[]} */ (d.points);
  return {
    left: Math.min(p[0].time, p[1].time), right: Math.max(p[0].time, p[1].time),
    top: Math.max(p[0].price, p[1].price), bottom: Math.min(p[0].price, p[1].price),
  };
};
/** @param {ToolDrawing} d @param {Partial<{left:number, right:number, top:number, bottom:number}>} ch */
const edit = (d, ch) => { const b = bounds(d); Object.assign(b, ch); d.points = [{ time: b.left, price: b.top }, { time: b.right, price: b.bottom }]; };

/** @type {CanvasRenderingContext2D|null} */
let _mctx = null;   // offscreen ctx so textBand can measure the label without a render ctx
const measureCtx = () => (_mctx || (_mctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'))));

// 8 reshape pins: 4 corners + 4 edge midpoints. Each declares its position (from the
// screen bbox) and how a drag rewrites the data bounds — no index switch.
const PINS = pinHandles([
  pin({ at: (c) => ({ x: c.bb.x1, y: c.bb.y1 }), drag: (d, dp) => edit(d, { left: dp.time, top: dp.price }) }),       // TL
  pin({ at: (c) => ({ x: c.bb.x2, y: c.bb.y1 }), drag: (d, dp) => edit(d, { right: dp.time, top: dp.price }) }),      // TR
  pin({ at: (c) => ({ x: c.bb.x2, y: c.bb.y2 }), drag: (d, dp) => edit(d, { right: dp.time, bottom: dp.price }) }),   // BR
  pin({ at: (c) => ({ x: c.bb.x1, y: c.bb.y2 }), drag: (d, dp) => edit(d, { left: dp.time, bottom: dp.price }) }),    // BL
  pin({ at: (c) => ({ x: c.bb.mx, y: c.bb.y1 }), drag: (d, dp) => edit(d, { top: dp.price }) }),                      // top
  pin({ at: (c) => ({ x: c.bb.x2, y: c.bb.my }), drag: (d, dp) => edit(d, { right: dp.time }) }),                     // right
  pin({ at: (c) => ({ x: c.bb.mx, y: c.bb.y2 }), drag: (d, dp) => edit(d, { bottom: dp.price }) }),                   // bottom
  pin({ at: (c) => ({ x: c.bb.x1, y: c.bb.my }), drag: (d, dp) => edit(d, { left: dp.time }) }),                      // left
]);
