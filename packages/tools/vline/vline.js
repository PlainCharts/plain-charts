// @ts-check
// Vertical line — a single-anchor shape (one click) spanning the full pane height
// at the clicked time. Its geometry is emitted as marks (data); it pierces every pane.
// (`Tools`, `ToolDrawing`, `ToolView`, `ToolScreenPoint`, … are ambiently typed in tools-global.d.ts.)

Tools.register({
  id: 'vline',
  name: 'Vertical Line',
  description: 'A tool that draws a vertical line down the whole chart.',
  icon: 'vline.png',
  glyph: '│',
  kind: 'draw',
  points: 1,
  snapToBar: true,   // anchor renders on the nearest bar of each pane (always visible)
  spanPanes: true,   // the line pierces through every pane (studies/compare)
  timeOnly: true,    // anchor is a time only; the Coordinates tab hides the (meaningless) price
  defaultStyle: { color: '#2962ff', width: 2, lineStyle: 'solid', timeLabel: true, labelText: '' },
  settings: {
    style: [
      { name: 'Line', controls: [{ key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' }] },
      // axis label: leave the text empty for the date/time, or type a custom label to show instead
      { name: 'Axis label', toggle: 'timeLabel', controls: [{ key: 'labelText', type: 'text', placeholder: 'Date' }] },
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
      orientation: [
        { key: 'horizontal', name: 'Horizontal' },
        { key: 'vertical', name: 'Vertical' },
      ],
      orientationDefault: 'vertical',
    },
  },
  // Declarative: a full-height line at the anchor time (snapped to the nearest bar), spanning vp 0..1.
  // Splits into two segments around centered on-line text. The x is held as an absolute-screen offset
  // so the snap survives; recomputed each frame (also used across panes via spanPanes).
  /** @param {ToolDrawing} d @param {ToolView} view */
  marks(d, view) {
    const P = d.points || [];
    if (!P.length) return [];
    const s = d.style || {};
    let x = view.timeToX(P[0].time);
    if (x == null) return [];
    if (view.snapX) x = view.snapX(x);
    /** @param {any} y0 @param {any} y1 */
    const seg = (y0, y1) => ({ path: [y0, y1], stroke: s.color, width: s.width || 2, dash: Tools.dash(s.lineStyle) });
    const top = { vpx: 0, dx: x, vp: 0 }, bot = { vpx: 0, dx: x, vp: 1 };
    const band = this.textBand(d, view);
    if (band) {
      const out = [];
      if (band[0] > 0) out.push(seg(top, { vpx: 0, dx: x, vp: 0, dy: band[0] }));
      if (band[1] < view.height) out.push(seg({ vpx: 0, dx: x, vp: 0, dy: band[1] }, bot));
      return out;
    }
    return [seg(top, bot)];
    // the time label (style.timeLabel) is rendered in the time axis by the engine primitive.
  },
  // vertical extent (screen y) the label occupies when it sits ON the line (hAlign center), so marks()
  // can break the line around it; null otherwise. Measures via an offscreen ctx.
  /** @param {ToolDrawing} d @param {ToolView} view @returns {[number, number]|null} */
  textBand(d, view) {
    if (!d.text || (d.textStyle && d.textStyle.hAlign && d.textStyle.hAlign !== 'center')) return null;
    const ts = d.textStyle || {}, size = ts.size || 14, pad = 6, H = view.height;
    const va = ts.vAlign || 'middle', orient = ts.orientation || 'vertical';
    const lines = String(d.text).split('\n'), lh = size * 1.25;
    const mc = measureCtx();
    mc.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    const len = orient === 'vertical' ? Math.max(0, ...lines.map((l) => mc.measureText(l).width)) : lines.length * lh;
    let start;
    if (va === 'top') start = pad;
    else if (va === 'bottom') start = H - pad - len;
    else start = (H - len) / 2;
    return [start - pad, start + len + pad];
  },
  // Hit box for the label, matching where drawText renders it. Returned as an
  // axis-aligned screen footprint (angle 0) for both orientations, so clicking the
  // "+ Add text" / label edits it (1-point shape; generic bbox is degenerate).
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d @param {ToolView} [view] */
  textGeom(c, pts, d, view) {
    if (!pts.length) return null;
    const x = pts[0].x, H = view ? view.height : 0;
    const ts = d.textStyle || {}, size = ts.size || 14, pad = 6;
    const cfg = (/** @type {any} */ (this.settings) && /** @type {any} */ (this.settings).text) || {};
    const dflt = cfg.defaults || {};
    const va = ts.vAlign || dflt.vAlign || 'middle';
    const ha = ts.hAlign || dflt.hAlign || 'center';
    const orient = ts.orientation || cfg.orientationDefault || 'vertical';
    const lines = String(d.text || '').split('\n'), lh = size * 1.25;
    c.save();
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    const textW = Math.max(1, ...lines.map((l) => c.measureText(l).width));
    c.restore();

    if (orient === 'vertical') {
      const thickness = lines.length * lh;
      let y0;
      if (va === 'top') y0 = pad + textW;
      else if (va === 'bottom') y0 = H - pad;
      else y0 = (H + textW) / 2;
      let lyoff;
      if (ha === 'left') lyoff = -thickness - pad;
      else if (ha === 'right') lyoff = pad;
      else lyoff = -thickness / 2;
      // screen footprint: x in [x+lyoff, x+lyoff+thickness], y in [y0-textW, y0]
      return {
        cx: x, cy: y0, angle: 0, tAlign: 'left', baseline: 'top', va, size, w: textW, totalH: thickness,
        lx0: lyoff - pad, lx1: lyoff + thickness + pad,
        ly0: -textW - pad, ly1: pad,
      };
    }
    // horizontal orientation (mirror of hline, on a vertical line)
    let cx, tAlign;
    if (ha === 'left') { cx = x - pad; tAlign = 'right'; }
    else if (ha === 'right') { cx = x + pad; tAlign = 'left'; }
    else { cx = x; tAlign = 'center'; }
    const totalH = size + (lines.length - 1) * lh;
    let cy, baseline;
    if (va === 'top') { cy = pad; baseline = 'top'; }
    else if (va === 'bottom') { cy = H - pad - (lines.length - 1) * lh; baseline = 'bottom'; }
    else { cy = H / 2 - (lines.length - 1) * lh / 2; baseline = 'middle'; }
    const lx0 = tAlign === 'left' ? 0 : tAlign === 'right' ? -textW : -textW / 2;
    const yTop = baseline === 'top' ? 0 : baseline === 'bottom' ? -totalH : -totalH / 2;
    return {
      cx, cy, angle: 0, tAlign, baseline, va, size, w: textW, totalH,
      lx0: lx0 - pad, lx1: lx0 + textW + pad,
      ly0: yTop - pad, ly1: yTop + totalH + pad,
    };
  },
  // label along the vertical line. vAlign = top/middle/bottom (position along the
  // line), hAlign = left/on/right of the line, orientation = horizontal | vertical
  // (vertical runs the text up the line, reading bottom-to-top).
  /** @param {CanvasRenderingContext2D} c @param {ToolScreenPoint[]} pts @param {ToolDrawing} d @param {ToolView} [view] */
  drawText(c, pts, d, view) {
    if (!pts.length) return;
    const x = pts[0].x, H = view ? view.height : 0;
    const ts = d.textStyle || {}, size = ts.size || 14, pad = 6;
    const va = ts.vAlign || 'middle', ha = ts.hAlign || 'center';
    const orient = ts.orientation || 'vertical';
    const lines = String(d.text).split('\n'), lh = size * 1.25;
    c.save();
    c.font = (ts.italic ? 'italic ' : '') + (ts.bold ? 'bold ' : '') + size + 'px sans-serif';
    c.fillStyle = ts.color || '#787b86';

    if (orient === 'vertical') {
      const textW = Math.max(0, ...lines.map((l) => c.measureText(l).width));
      const thickness = lines.length * lh;
      // start y along the line (bottom of the reading direction, which points up)
      let y0;
      if (va === 'top') y0 = pad + textW;
      else if (va === 'bottom') y0 = H - pad;
      else y0 = (H + textW) / 2;
      // across-line offset (block stacks toward screen-right from local y=0)
      let lyoff;
      if (ha === 'left') lyoff = -thickness - pad;
      else if (ha === 'right') lyoff = pad;
      else lyoff = -thickness / 2;
      c.translate(x, y0); c.rotate(-Math.PI / 2);
      c.textAlign = 'left'; c.textBaseline = 'top';
      lines.forEach((ln, i) => c.fillText(ln, 0, lyoff + i * lh));
    } else {
      let tx;
      if (ha === 'left') { tx = x - pad; c.textAlign = 'right'; }
      else if (ha === 'right') { tx = x + pad; c.textAlign = 'left'; }
      else { tx = x; c.textAlign = 'center'; }
      let y0;
      if (va === 'top') { c.textBaseline = 'top'; y0 = pad; }
      else if (va === 'bottom') { c.textBaseline = 'bottom'; y0 = H - pad - (lines.length - 1) * lh; }
      else { c.textBaseline = 'middle'; y0 = H / 2 - (lines.length - 1) * lh / 2; }
      lines.forEach((ln, i) => c.fillText(ln, tx, y0 + i * lh));
    }
    c.restore();
  },
  // No hitTest: a pure recipe. The full-height line marks give the body (near the line at the
  // snapped x) and the single anchor is the default handle -- both derived by engine.hitTestFromMarks.
});

// ---------------------------------------------------------------- drawing helpers
/** @type {CanvasRenderingContext2D|null} */
let _mctx = null;   // offscreen ctx so textBand can measure the label without a render ctx
const measureCtx = () => (_mctx || (_mctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'))));

// Loaded via dynamic import() (an ES module at runtime); the empty export marks it a module for the
// checker too, giving it its own scope (no clash with sibling globals). No-op.
export {};
