// @ts-check
// Symbol — drop a single Unicode glyph on the chart at one anchor point (an
// icon/sticker tool). The glyph is chosen from a palette that opens when the tool is
// picked (see ./symbol-picker.js); it's painted with fillText so it takes the style
// colour and size, and it's recolourable because the palette forces text presentation.
import { initSymbolPicker, renderGlyph, DEFAULT_GLYPH } from './symbol-picker.js';

Tools.register({
  id: 'symbol',
  name: 'Symbol',
  description: 'A tool that drops a Unicode glyph on the chart as a sticker.',
  icon: 'symbol.png',
  glyph: '☺',
  kind: 'draw',
  points: 1,
  defaultStyle: { glyph: DEFAULT_GLYPH, color: '#e8e8e8', size: 28 },
  settings: {
    style: [
      { name: 'Color', controls: [{ key: 'color', type: 'color' }] },
      { name: 'Size', controls: [{ key: 'size', type: 'number', min: 8, max: 200 }] },
    ],
  },

  // Declarative: the glyph is a centered TEXT mark. When selected, a dashed box mark frames it,
  // sized by the measured glyph width and held in pixel offsets so it stays put at any zoom.
  /** @param {ToolDrawing} d @param {ToolView} view @param {boolean} [sel] @returns {ToolMark[]} */
  marks(d, view, sel) {
    const P = d.points || [];
    if (!P.length) return [];
    const s = d.style || {};
    const size = s.size || 28, a = { t: P[0].time, p: P[0].price };
    /** @type {ToolMark[]} */
    const out = [{ text: renderGlyph(s.glyph), at: a, align: 'center', baseline: 'middle', color: s.color || '#e8e8e8', size, font: FONT }];
    if (sel) {
      const hw = glyphWidth(s.glyph, size) / 2 + 4, hh = size / 2 + 4;
      out.push({ closed: true, stroke: '#2962ff', width: 1, dash: [4, 3], path: [
        { ...a, dx: -hw, dy: -hh }, { ...a, dx: hw, dy: -hh }, { ...a, dx: hw, dy: hh }, { ...a, dx: -hw, dy: hh },
      ] });
    }
    return out;
  },

  // a symbol is a single point; selection shows a dashed box (a mark), no reshape handles
  handles() { return []; },
  /** @param {ToolScreenPoint[]} pts @param {number} x @param {number} y @param {number} tol @param {ToolDrawing} [d] @returns {ToolHitResult} */
  hitTest(pts, x, y, tol, d) {
    if (!pts.length) return null;
    const s = (d && d.style) || {}, size = s.size || 28, w = glyphWidth(s.glyph, size);
    const b = { x: pts[0].x - w / 2, y: pts[0].y - size / 2, w, h: size };
    if (x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol) return { part: 'body' };
    return null;
  },
});

// ---------------------------------------------------------------- palette wiring + glyph measurement
initSymbolPicker();   // wire the palette to tool activation (idempotent)

const FONT = "system-ui, 'Noto Sans Symbols2', 'Segoe UI Symbol', 'DejaVu Sans', sans-serif";

// measure the glyph's screen width via an offscreen ctx, so marks() can size the selection box and
// hitTest() can size the hit area — both self-contained, no shared draw-time cache.
/** @type {CanvasRenderingContext2D | null} */
let _mctx = null;
/** @param {string|undefined} glyph @param {number} size @returns {number} */
const glyphWidth = (glyph, size) => {
  if (!_mctx) _mctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
  _mctx.font = size + 'px ' + FONT;
  return Math.max(size * 0.6, _mctx.measureText(renderGlyph(glyph)).width);
};
