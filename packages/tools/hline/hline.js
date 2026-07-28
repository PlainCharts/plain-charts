// @ts-check
// Horizontal line — a single-anchor shape (one click) spanning the full pane width
// at the clicked price. Its geometry is emitted as marks (data); the optional price
// label is rendered in the price axis by the engine (style.priceLabels).
// (`Tools`, `ToolDrawing`, `ToolView`, `ToolScreenPoint`, … are ambiently typed in tools-global.d.ts.)

Tools.register({
  id: 'hline',
  glyph: '─',
  kind: 'draw',
  points: 1,
  priceOnly: true,   // anchor is a price only; the line spans the full pane WIDTH (mirror of vline's timeOnly)
  defaultStyle: { color: '#2962ff', width: 2, lineStyle: 'solid', priceLabels: true },
  settings: {
    style: [
      { name: 'Line', controls: [{ key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' }] },
      { name: 'Price label', toggle: 'priceLabels' },
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
  // Declarative: a full-width line at the price (vpx 0..1). When centered text sits ON the line,
  // it splits into two segments around the label's extent — the `vpx:0, dx` vertex pins a segment
  // end to an exact screen-x, so no per-pixel canvas math is needed.
  /** @param {ToolDrawing} d @param {ToolView} view */
  marks(d, view) {
    const P = d.points || [];
    if (!P.length) return [];
    const s = d.style || {}, price = P[0].price;
    /** @param {any} a @param {any} b */
    const seg = (a, b) => ({ path: [a, b], stroke: s.color, width: s.width || 2, dash: Tools.dash(s.lineStyle) });
    const band = this.textBand(d, view);
    if (band) {
      const out = [];
      if (band[0] > 0) out.push(seg({ vpx: 0, p: price }, { vpx: 0, dx: band[0], p: price }));
      if (band[1] < view.width) out.push(seg({ vpx: 0, dx: band[1], p: price }, { vpx: 1, p: price }));
      return out;
    }
    return [seg({ vpx: 0, p: price }, { vpx: 1, p: price })];
  },
  // horizontal extent (screen x) the label occupies when it sits ON the line (vAlign middle),
  // so marks() can break the line around it; null otherwise. Measures via an offscreen ctx.
  /** @param {ToolDrawing} d @param {ToolView} view @returns {[number, number]|null} */
  textBand(d, view) {
    if (!d.text || (d.textStyle && (d.textStyle.vAlign || 'middle') !== 'middle')) return null;
    const ts = d.textStyle || {}, size = ts.size || 14, pad = 6, W = view.width;
    const ha = ts.hAlign || 'center';
    const lines = String(d.text).split('\n');
    const mc = measureCtx();
    mc.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    const textW = Math.max(0, ...lines.map((l) => mc.measureText(l).width));
    let x1;
    if (ha === 'left') x1 = pad;
    else if (ha === 'right') x1 = W - pad - textW;
    else x1 = (W - textW) / 2;
    return [x1 - pad, x1 + textW + pad];
  },
  // Geometry of the label: the text anchor (cx,cy) + align/baseline that drawText uses,
  // and a hit box sized to the text's own extent (width w at its align) at the text's
  // vertical band, so the "+ Add text" / label is clickable (1-point shape, generic bbox
  // is degenerate). angle 0 (horizontal). The line spans the full pane width.
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d @param {ToolView} [view] */
  textGeom(c, pts, d, view) {
    if (!pts.length) return null;
    const y = pts[0].y, W = view ? view.width : 0;
    const ts = d.textStyle || {}, size = ts.size || 14, pad = 5;
    const def = (/** @type {any} */ (this.settings) && /** @type {any} */ (this.settings).text && /** @type {any} */ (this.settings).text.defaults) || {};
    const ha = ts.hAlign || def.hAlign || 'center', va = ts.vAlign || def.vAlign || 'middle';
    const lines = String(d.text || '').split('\n'), lh = size * 1.25;
    c.save();
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    const w = Math.max(1, ...lines.map((l) => c.measureText(l).width));
    c.restore();
    const totalH = size + (lines.length - 1) * lh;
    let cx, tAlign;
    if (ha === 'left') { cx = pad; tAlign = 'left'; }
    else if (ha === 'right') { cx = W - pad; tAlign = 'right'; }
    else { cx = W / 2; tAlign = 'center'; }
    let cy, baseline;
    if (va === 'top') { cy = y - pad; baseline = 'bottom'; }
    else if (va === 'bottom') { cy = y + pad; baseline = 'top'; }
    else { cy = y; baseline = 'middle'; }
    const yTop = baseline === 'top' ? 0 : baseline === 'bottom' ? -totalH : -totalH / 2;
    const lx0 = tAlign === 'left' ? 0 : tAlign === 'right' ? -w : -w / 2;
    return {
      cx, cy, angle: 0, tAlign, baseline, va, size, w, totalH,
      lx0: lx0 - pad, lx1: lx0 + w + pad,
      ly0: yTop - pad, ly1: yTop + totalH + pad,
    };
  },
  // label spans the full width; vAlign = above/on/below the line, hAlign across width
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d @param {ToolView} [view] */
  drawText(c, pts, d, view) {
    const g = this.textGeom(c, pts, d, view);
    if (!g) return;
    const ts = d.textStyle || {}, size = g.size, lh = size * 1.25;
    const lines = String(d.text).split('\n');
    c.save();
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    c.fillStyle = ts.color || '#787b86';
    c.textAlign = /** @type {CanvasTextAlign} */ (g.tAlign); c.textBaseline = /** @type {CanvasTextBaseline} */ (g.baseline);
    let y0;
    if (g.va === 'top') y0 = g.cy - (lines.length - 1) * lh;
    else if (g.va === 'bottom') y0 = g.cy;
    else y0 = g.cy - (lines.length - 1) * lh / 2;
    lines.forEach((ln, i) => c.fillText(ln, g.cx, y0 + i * lh));
    c.restore();
  },
  // No hitTest: a pure recipe. The full-width line marks give the body (near the line),
  // and the single anchor is the default handle — both derived by engine.hitTestFromMarks.
});

// ---------------------------------------------------------------- drawing helpers
/** @type {CanvasRenderingContext2D|null} */
let _mctx = null;   // offscreen ctx so textBand can measure the label without a render ctx
const measureCtx = () => (_mctx || (_mctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'))));

// Loaded via dynamic import() (an ES module at runtime); the empty export marks it a module for the
// checker too, giving it its own scope (no clash with sibling globals). No-op.
export {};
