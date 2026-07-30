// @ts-check
// Low-level canvas draw helpers shared by the series renderers and the chart shell. Pure functions,
// no engine state -- lifted verbatim out of index.js so the drawing vocabulary lives in one small
// place beside the painters that use it, instead of at the top of the 1600-line shell.

// hex (#rgb / #rrggbb) -> rgba(...) with alpha; passes other formats through untouched
/**
 * @param {string} c   a color; #rgb / #rrggbb is converted, anything else is passed through
 * @param {number} a   alpha 0..1
 * @returns {string}
 */
export function hexA(c, a) {
  if (typeof c !== 'string' || c[0] !== '#') return c;
  let h = c.slice(1);
  if (h.length === 3)
    h = h
      .split('')
      .map((x) => x + x)
      .join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const TRANSPARENT = 'rgba(0,0,0,0)';

// line style (0 Solid,1 Dotted,2 Dashed,3 LargeDashed,4 SparseDotted) -> canvas dash pattern
/**
 * @param {number} [style]   line-style code (0..4); anything else -> solid
 * @returns {number[]}       a canvas setLineDash pattern (empty = solid)
 */
export function dashFor(style) {
  switch (style) {
    case 1:
      return [1, 2];
    case 2:
      return [5, 2];
    case 3:
      return [8, 5];
    case 4:
      return [1, 4];
    default:
      return [];
  }
}

// one bar-marker glyph at screen (x,y). shape: 'tick' (short horizontal dash, scaled to bar
// width), 'text' (m.text), 'circle', 'square', 'arrowUp', 'arrowDown'.
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} bw   bar body width (tick glyph spans it)
 * @param {import('../../types.js').Marker} m
 * @param {string} [font]
 */
export function drawMarkerGlyph(ctx, x, y, bw, m, font) {
  const color = m.color || '#b2b5be';
  const shape = m.shape || (m.text != null ? 'text' : 'tick');
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (shape === 'text') {
    ctx.font = m.fontSize ? m.fontSize + 'px sans-serif' : font || '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(m.text == null ? '' : m.text), x, y);
    return;
  }
  const size = m.size != null ? m.size : 10;
  if (shape === 'tick') {
    // span the full bar width (bw is already the bar body width), thin + pixel-crisp
    const w = Math.max(3, bw),
      xc = Math.round(x),
      yy = Math.round(y) + 0.5;
    ctx.lineWidth = m.lineWidth || 1;
    ctx.beginPath();
    ctx.moveTo(xc - w / 2, yy);
    ctx.lineTo(xc + w / 2, yy);
    ctx.stroke();
  } else if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'square') {
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  } else if (shape === 'arrowUp') {
    ctx.beginPath();
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x - size / 2, y + size / 2);
    ctx.lineTo(x + size / 2, y + size / 2);
    ctx.closePath();
    ctx.fill();
  } else if (shape === 'arrowDown') {
    ctx.beginPath();
    ctx.moveTo(x, y + size / 2);
    ctx.lineTo(x - size / 2, y - size / 2);
    ctx.lineTo(x + size / 2, y - size / 2);
    ctx.closePath();
    ctx.fill();
  }
}

// series/chart candle-style resolver: option keys (upColor/borderColor/showBorder/showWick/...) ->
// the author's Candle primitive colour keys. Shared by the Series model and the Chart shell.
/**
 * @param {any} [o]   a style/options bag (upColor/borderColor/showBorder/showWick/...)
 * @returns {{ colorCandleUp: string, colorCandleDw: string, colorCandleBorderUp: string|null,
 *   colorCandleBorderDw: string|null, colorWickUp: string, colorWickDw: string }}
 */
export function candleStyle(o = {}) {
  // showBorder / showWick are booleans the app toggles. Honor them: border -> null
  // (the primitive skips a null border); wick -> transparent (the primitive always strokes the wick).
  const border = o.showBorder === false;
  const wick = o.showWick === false;
  return {
    colorCandleUp: o.upColor || '#26a69a',
    colorCandleDw: o.downColor || '#ef5350', // body (transparent when bodyVisible off, set by the app)
    colorCandleBorderUp: border ? null : o.borderUpColor || o.borderColor || null,
    colorCandleBorderDw: border ? null : o.borderDownColor || o.borderColor || null,
    colorWickUp: wick ? TRANSPARENT : o.wickUpColor || o.wickColor || o.upColor || '#26a69a',
    colorWickDw: wick ? TRANSPARENT : o.wickDownColor || o.wickColor || o.downColor || '#ef5350',
  };
}
