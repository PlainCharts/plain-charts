// @ts-check
// Horizontal ray — a single-anchor horizontal line that starts at the clicked
// point and extends to the right edge (unlike the full-width Horizontal Line).
// Optional price label rendered in the price axis (style.priceLabels) by the engine.
Tools.register({
  id: 'hray',
  glyph: '⊢',
  kind: 'draw',
  points: 1,
  sliceable: true,   // Slice → Level Line from this point to the cut candle
  defaultStyle: { color: '#2962ff', width: 2, lineStyle: 'solid', priceLabels: false },
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
  // Declarative: a horizontal ray from the anchor to the right edge (vpx:1) at the anchor's price.
  /** @param {ToolDrawing} d @returns {ToolMark[]} */
  marks(d) {
    const P = d.points || [];
    if (!P.length) return [];
    const s = d.style || {};
    return [{
      path: [{ t: P[0].time, p: P[0].price }, { vpx: 1, p: P[0].price }],
      stroke: s.color, width: s.width || 2, dash: Tools.dash(s.lineStyle),
    }];
  },
  // Geometry of the label: the text anchor (cx,cy) + align/baseline that drawText uses,
  // and — for the clickable hit box — a forgiving strip spanning the whole ray (anchor ->
  // right edge) at the text's vertical band, so the "+ Add text" area is easy to click
  // (the 1-point analog of the trend line's whole-line box). angle 0 (horizontal).
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d @param {ToolView} [view] */
  textGeom(c, pts, d, view) {
    if (!pts.length) return null;
    const x0 = pts[0].x, y = pts[0].y, W = view ? view.width : x0;
    const ts = d.textStyle || {}, size = ts.size || 14, pad = 6;
    const def = (/** @type {any} */ (this.settings) && /** @type {any} */ (this.settings).text && /** @type {any} */ (this.settings).text.defaults) || {};
    const ha = ts.hAlign || def.hAlign || 'center', va = ts.vAlign || def.vAlign || 'middle';
    const lines = String(d.text || '').split('\n'), lh = size * 1.25;
    c.save();
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    const w = Math.max(1, ...lines.map((l) => c.measureText(l).width));
    c.restore();
    const totalH = size + (lines.length - 1) * lh;
    let cx, tAlign;
    if (ha === 'left') { cx = x0 + pad; tAlign = 'left'; }
    else if (ha === 'right') { cx = W - pad; tAlign = 'right'; }
    else { cx = (x0 + W) / 2; tAlign = 'center'; }
    let cy, baseline;
    if (va === 'top') { cy = y - pad; baseline = 'bottom'; }
    else if (va === 'bottom') { cy = y + pad; baseline = 'top'; }
    else { cy = y; baseline = 'middle'; }
    const yTop = baseline === 'top' ? 0 : baseline === 'bottom' ? -totalH : -totalH / 2;
    // hit box: just the text's own extent (width w at its align), so it covers exactly
    // the "+ Add text" / label and nothing more.
    const lx0 = tAlign === 'left' ? 0 : tAlign === 'right' ? -w : -w / 2;
    return {
      cx, cy, angle: 0, tAlign, baseline, va, size, w, totalH,
      lx0: lx0 - pad, lx1: lx0 + w + pad,
      ly0: yTop - pad, ly1: yTop + totalH + pad,
    };
  },
  // label spans the ray (anchor → right edge); vAlign above/on/below, hAlign across it
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d @param {ToolView} [view] */
  drawText(c, pts, d, view) {
    const g = this.textGeom(c, pts, d, view);
    if (!g) return;
    const ts = d.textStyle || {}, size = g.size, lh = size * 1.25;
    const lines = String(d.text).split('\n');
    c.save();
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    c.fillStyle = ts.color || '#787b86';
    c.textAlign = g.tAlign; c.textBaseline = g.baseline;
    let y0;
    if (g.va === 'top') y0 = g.cy - (lines.length - 1) * lh;
    else if (g.va === 'bottom') y0 = g.cy;
    else y0 = g.cy - (lines.length - 1) * lh / 2;
    lines.forEach((ln, i) => c.fillText(ln, g.cx, y0 + i * lh));
    c.restore();
  },
  // No hitTest: a pure recipe. The ray mark (anchor -> right edge) gives the body, and the
  // anchor is the default handle — both derived by engine.hitTestFromMarks.
});
