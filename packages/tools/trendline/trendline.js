// @ts-check
// Trend-line family — ONE 2-point line, configured three ways via the `extend` rule
// (the same draw/hit logic, like the measure tools share one helper):
//   trendline     — A -> B, no extension
//   ray           — A -> B, extended past B to infinity (a directional ray, any angle)
//   extendedline  — A -> B, extended past BOTH ends
// `extend` stays a style control, so any of them can still be re-configured after drawing.
// (`Tools`, `ToolDrawing`, `ToolView`, `ToolScreenPoint`, … are ambiently typed in tools-global.d.ts.)

// The three variants (makeTrend is a hoisted function declaration, defined below).
Tools.register(makeTrend({ id: 'trendline', name: 'Trend Line', glyph: '╱', extend: 'none', description: 'Three line tools in one — trend line, ray, and extended line.', icon: 'trendline.png' }));
Tools.register(makeTrend({ id: 'ray', name: 'Ray', glyph: '↗', extend: 'right' }));
Tools.register(makeTrend({ id: 'extendedline', name: 'Extended Line', glyph: '⤢', extend: 'both' }));

// ---------------------------------------------------------------- factory + helpers
/** @param {{ id:string, name:string, glyph:string, extend:string, description?:string, icon?:string }} cfg */
function makeTrend({ id, name, glyph, extend, description, icon }) {
  return {
  id,
  name,
  glyph,
  description,
  icon,
  kind: 'draw',
  points: 2,
  sliceable: true,
  shiftConstrain: 'angle',   // hold Shift while drawing/dragging → snap to 45° (H/V/diagonal)
  // `extend` is this tool's IDENTITY (trendline=none / ray=right / extendedline=both), not
  // appearance — never persisted into tool-defaults, so editing one into a ray can't turn
  // the plain trendline default into a ray. Still re-configurable per drawing after the fact.
  identityStyle: ['extend'],
  defaultStyle: { color: '#2962ff', width: 2, lineStyle: 'solid', extend, arrows: 'none', midPoint: false, priceLabels: false },
  settings: {
    style: [
      { name: 'Line', controls: [{ key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' }] },
      { name: 'Extend', controls: [{ key: 'extend', type: 'select', options: [
        { key: 'none', name: "Don't extend" },
        { key: 'left', name: 'Extend left line' },
        { key: 'right', name: 'Extend right line' },
        { key: 'both', name: 'Extend both' },
      ] }] },
      { name: 'Arrows', controls: [{ key: 'arrows', type: 'select', options: [
        { key: 'none', name: 'None' },
        { key: 'end', name: 'End  →' },
        { key: 'start', name: '←  Start' },
        { key: 'both', name: '←  Both  →' },
      ] }] },
      { name: 'Middle point', toggle: 'midPoint' },
      { name: 'Price labels', toggle: 'priceLabels' },
    ],
    text: {
      defaults: { vAlign: 'top', hAlign: 'right' },
      vAlign: [
        { key: 'top', name: 'Top' },
        { key: 'middle', name: 'Middle' },
        { key: 'bottom', name: 'Bottom' },
      ],
      hAlign: [
        { key: 'left', name: 'Left' },
        { key: 'center', name: 'Center' },
        { key: 'right', name: 'Right' },
      ],
    },
  },
  // Declarative: the line (with extension, text-gap break, arrowheads, midpoint) as marks. Geometry
  // that depends on the screen slope (extension, arrowheads, the label gap, the midpoint dot) is
  // computed in screen space via `view` and emitted as absolute-screen vertices ({vpx:0,dx, vp:0,dy}),
  // recomputed each frame — the same math draw() did, output as data instead of ctx calls.
  /** @param {ToolDrawing} d @param {ToolView} view */
  marks(d, view) {
    const P = d.points || [];
    if (P.length < 2) return [];
    const s = d.style || {};
    const A = { x: view.timeToX(P[0].time), y: view.priceToY(P[0].price) };
    const B = { x: view.timeToX(P[1].time), y: view.priceToY(P[1].price) };
    if (A.x == null || A.y == null || B.x == null || B.y == null) return [];
    // A/B are non-null past the guard above; the spread widens them back to number|null, so re-cast.
    let a = /** @type {ToolScreenPoint} */ ({ ...A });
    let b = /** @type {ToolScreenPoint} */ ({ ...B });
    const ext = s.extend;
    if (ext && ext !== 'none') {
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, FAR = 100000;
      if (ext === 'left' || ext === 'both') a = { x: A.x - ux * FAR, y: A.y - uy * FAR };
      if (ext === 'right' || ext === 'both') b = { x: B.x + ux * FAR, y: B.y + uy * FAR };
    }
    /** @param {ToolScreenPoint} p */
    const sv = (p) => ({ vpx: 0, dx: p.x, vp: 0, dy: p.y });
    /** @param {ToolScreenPoint} p0 @param {ToolScreenPoint} p1 */
    const line = (p0, p1) => ({ path: [sv(p0), sv(p1)], stroke: s.color, width: s.width || 2, dash: Tools.dash(s.lineStyle) });
    /** @type {any[]} */
    const out = [];
    const gap = this.textGap(d, /** @type {ToolScreenPoint[]} */ ([A, B]));   // break the line around centered on-line text
    if (gap) {
      const ddx = b.x - a.x, ddy = b.y - a.y, dl2 = ddx * ddx + ddy * ddy || 1;
      /** @param {ToolScreenPoint} p */
      const proj = (p) => ((p.x - a.x) * ddx + (p.y - a.y) * ddy) / dl2;
      let t0 = proj(gap[0]), t1 = proj(gap[1]); if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
      t0 = Math.max(0, Math.min(1, t0)); t1 = Math.max(0, Math.min(1, t1));
      if (t0 > 0) out.push(line(a, { x: a.x + ddx * t0, y: a.y + ddy * t0 }));
      if (t1 < 1) out.push(line({ x: a.x + ddx * t1, y: a.y + ddy * t1 }, b));
    } else {
      out.push(line(a, b));
    }
    if (s.arrows && s.arrows !== 'none') {
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, sz = 13 + (s.width || 2) * 2.2;
      if (s.arrows === 'end' || s.arrows === 'both') out.push(this.arrowMark(/** @type {ToolScreenPoint} */ (B), ux, uy, sz, s.color));
      if (s.arrows === 'start' || s.arrows === 'both') out.push(this.arrowMark(/** @type {ToolScreenPoint} */ (A), -ux, -uy, sz, s.color));
    }
    if (s.midPoint) {
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, pts = [];
      for (let k = 0; k <= 20; k++) { const ang = (k / 20) * Math.PI * 2; pts.push({ vpx: 0, dx: mx + 4 * Math.cos(ang), vp: 0, dy: my + 4 * Math.sin(ang) }); }
      out.push({ path: pts, closed: true, fill: '#fff', stroke: s.color, width: 1.5 });
    }
    return out;
    // price labels (style.priceLabels) are drawn in the price axis by the engine.
  },
  // swept-back barbed arrowhead: tip at screen point `tip`, pointing along (ux,uy).
  /** @param {ToolScreenPoint} tip @param {number} ux @param {number} uy @param {number} sz @param {string|undefined} color */
  arrowMark(tip, ux, uy, sz, color) {
    const a = Math.atan2(uy, ux), sp = Math.PI / 7, back = sz * 0.62;
    /** @param {number} x @param {number} y */
    const sv = (x, y) => ({ vpx: 0, dx: x, vp: 0, dy: y });
    return { closed: true, fill: color, path: [
      sv(tip.x, tip.y),
      sv(tip.x - sz * Math.cos(a - sp), tip.y - sz * Math.sin(a - sp)),
      sv(tip.x - back * Math.cos(a), tip.y - back * Math.sin(a)),
      sv(tip.x - sz * Math.cos(a + sp), tip.y - sz * Math.sin(a + sp)),
    ] };
  },
  // span (two points along the line) the centered on-line label occupies, so marks() can break the
  // line around it. null when the text is offset above/below the line. Measures via an offscreen ctx.
  /** @param {ToolDrawing} d @param {ToolScreenPoint[]} pts @returns {[ToolScreenPoint, ToolScreenPoint]|null} */
  textGap(d, pts) {
    if (!d.text || pts.length < 2) return null;
    const ts = d.textStyle || {};
    if ((ts.vAlign || 'middle') !== 'middle') return null;
    let a = pts[0], b = pts[1]; if (b.x < a.x) { const t = a; a = b; b = t; }
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const ha = ts.hAlign || 'center', size = ts.size || 14, pad = 6;
    const lines = String(d.text).split('\n');
    const mc = measureCtx(); mc.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    const textW = Math.max(0, ...lines.map((l) => mc.measureText(l).width));
    const half = textW / 2 + pad;
    let cx, cy;
    if (ha === 'left') { cx = a.x + ux * (pad + textW / 2); cy = a.y + uy * (pad + textW / 2); }
    else if (ha === 'right') { cx = b.x - ux * (pad + textW / 2); cy = b.y - uy * (pad + textW / 2); }
    else { cx = (a.x + b.x) / 2; cy = (a.y + b.y) / 2; }
    return [{ x: cx - ux * half, y: cy - uy * half }, { x: cx + ux * half, y: cy + uy * half }];
  },
  // Geometry of the slope-aligned label: the rotation anchor (cx,cy), the slope angle,
  // canvas align/baseline, and a hit box sized to the text's own extent (width w at its
  // align). Shared by drawText (render) + the engine (hit box / rotated editor) so the
  // clickable area follows the slope and matches the visible label.
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d */
  textGeom(c, pts, d) {
    if (pts.length < 2) return null;
    let a = pts[0], b = pts[1];
    if (b.x < a.x) { const t = a; a = b; b = t; }                 // read left-to-right
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, angle = Math.atan2(uy, ux);   // |angle| <= 90°
    let px = -uy, py = ux; if (py > 0) { px = -px; py = -py; }    // perpendicular pointing up
    const ts = d.textStyle || {}, size = ts.size || 14, pad = 5;
    const def = (this.settings && this.settings.text && this.settings.text.defaults) || {};
    const ha = ts.hAlign || def.hAlign || 'center', va = ts.vAlign || def.vAlign || 'middle';
    const lines = String(d.text || '').split('\n'), lh = size * 1.25;
    c.save();
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    const w = Math.max(1, ...lines.map((l) => c.measureText(l).width));
    c.restore();
    const totalH = size + (lines.length - 1) * lh;
    let ax, ay, tAlign;
    if (ha === 'left') { ax = a.x + ux * pad; ay = a.y + uy * pad; tAlign = 'left'; }
    else if (ha === 'right') { ax = b.x - ux * pad; ay = b.y - uy * pad; tAlign = 'right'; }
    else { ax = (a.x + b.x) / 2; ay = (a.y + b.y) / 2; tAlign = 'center'; }
    let baseline;
    if (va === 'top') { ax += px * pad; ay += py * pad; baseline = 'bottom'; }
    else if (va === 'bottom') { ax -= px * pad; ay -= py * pad; baseline = 'top'; }
    else { baseline = 'middle'; }
    const lx0 = tAlign === 'left' ? 0 : tAlign === 'right' ? -w : -w / 2;
    const yTop = baseline === 'top' ? 0 : baseline === 'bottom' ? -totalH : -totalH / 2;
    return {
      cx: ax, cy: ay, angle, tAlign, baseline, va, size, w, totalH,
      lx0: lx0 - pad, lx1: lx0 + w + pad,
      ly0: yTop - pad, ly1: yTop + totalH + pad,
    };
  },
  // line-aligned label: rotates to the segment's slope. vAlign top/middle/bottom =
  // above / on / below the line; hAlign left/center/right = start / mid / end.
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d */
  drawText(c, pts, d) {
    const g = this.textGeom(c, pts, d);
    if (!g) return;
    const ts = d.textStyle || {}, size = g.size, lh = size * 1.25;
    const lines = String(d.text).split('\n');
    c.save();
    c.translate(g.cx, g.cy); c.rotate(g.angle);
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    c.fillStyle = ts.color || '#787b86';
    c.textAlign = /** @type {CanvasTextAlign} */ (g.tAlign); c.textBaseline = /** @type {CanvasTextBaseline} */ (g.baseline);
    const y0 = g.va === 'top' ? -(lines.length - 1) * lh : 0;
    lines.forEach((ln, i) => c.fillText(ln, 0, y0 + i * lh));
    c.restore();
  },
  // No hitTest: this tool is a pure recipe. Selecting/reshaping is derived from the marks it
  // draws (engine.hitTestFromMarks) — the line body and the two anchor handles come for free.
  };
}

/** @type {CanvasRenderingContext2D|null} */
let _mctx = null;   // offscreen ctx so textGap can measure the label without a render ctx
const measureCtx = () => (_mctx || (_mctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'))));

// This file is loaded via dynamic import() (an ES module at runtime); the empty export marks it a
// module for the checker too, giving it its own scope (no clash with sibling globals). No-op.
export {};
