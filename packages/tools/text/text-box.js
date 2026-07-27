// @ts-check
// Shared text-box rendering for the Text and Callout tools: word wrap, box sizing
// (hug-the-text or fixed-width wrap), background + border, the wrapped text, and the
// edit hit/editor geometry. Both tools import this so their boxes behave identically.

// Text appearance: colour/size + bold/italic flags (all optional; sensible fallbacks apply).
/** @typedef {{ color?: string, size?: number, bold?: boolean, italic?: boolean, [key: string]: any }} TextStyle */
// Box appearance: background + border, each with an on/off flag.
/** @typedef {{ bg?: string, bgOn?: boolean, border?: string, borderOn?: boolean, borderWidth?: number, [key: string]: any }} BoxStyle */
// Measured box geometry (top-left origin) plus the wrapped lines to paint.
/** @typedef {{ x: number, y: number, w: number, h: number, lines: string[], size: number, lh: number }} Box */

export const PADX = 6;
export const PADY = 4;

/** @param {TextStyle | null | undefined} ts */
const fontOf = (ts) => ((ts && ts.italic) ? 'italic ' : '') + ((ts && ts.bold) ? 'bold ' : '') + ((ts && ts.size) || 14) + 'px sans-serif';

// WORD wrap: break lines at spaces only (a word is atomic). Honors explicit newlines.
/** @param {CanvasRenderingContext2D} c @param {string} text @param {number} maxW @returns {string[]} */
export function wrapWords(c, text, maxW) {
  /** @type {string[]} */
  const out = [];
  String(text).split('\n').forEach((para) => {
    let line = '';
    para.split(' ').forEach((word) => {
      const cand = line ? line + ' ' + word : word;
      if (line && c.measureText(cand).width > maxW) { out.push(line); line = word; }
      else line = cand;
    });
    out.push(line);
  });
  return out.length ? out : [''];
}

// Box metrics from top-left (x,y). wrapW = inner width (px) to wrap to, or null to hug
// the text (width = widest explicit line). Empty text is sized to the "+ Add text" hint.
// When wrapping, the inner width floors at the widest single word (words never split).
/**
 * @param {CanvasRenderingContext2D} c
 * @param {number} x @param {number} y
 * @param {string | null | undefined} text
 * @param {TextStyle | null | undefined} textStyle
 * @param {number | null | undefined} wrapW   inner width to wrap to, or null to hug the text
 * @returns {Box}
 */
export function measureBox(c, x, y, text, textStyle, wrapW) {
  const ts = textStyle || {}, size = ts.size || 14, lh = size * 1.25;
  const t = (text != null && text !== '') ? text : '+ Add text';
  c.save();
  c.font = fontOf(ts);
  let lines, w;
  if (wrapW != null) {
    let widestWord = 0;
    t.split(/\s+/).forEach((wd) => { const ww = c.measureText(wd).width; if (ww > widestWord) widestWord = ww; });
    const innerW = Math.max(wrapW, widestWord);
    lines = wrapWords(c, t, innerW);
    w = innerW + PADX * 2;
  } else {
    lines = String(t).split('\n');
    const longest = Math.max(0, ...lines.map((l) => c.measureText(l).width));
    w = Math.max(20, longest + PADX * 2);
  }
  c.restore();
  const h = lines.length * lh + PADY * 2;
  return { x, y, w, h, lines, size, lh };
}

/** @param {CanvasRenderingContext2D} c @param {Box} box @param {BoxStyle | null | undefined} style */
export function drawBox(c, box, style) {
  const s = style || {};
  c.save();
  if (s.bgOn !== false && s.bg) { c.fillStyle = s.bg; c.fillRect(box.x, box.y, box.w, box.h); }
  if (s.borderOn !== false) {
    c.strokeStyle = s.border || '#2962ff'; c.lineWidth = s.borderWidth || 1;
    c.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  }
  c.restore();
}

/** @param {CanvasRenderingContext2D} c @param {Box} box @param {TextStyle | null | undefined} textStyle */
export function drawBoxText(c, box, textStyle) {
  const ts = textStyle || {};
  c.save();
  c.font = fontOf(ts);
  c.fillStyle = ts.color || '#d1d4dc';
  c.textAlign = 'left'; c.textBaseline = 'top';
  box.lines.forEach((ln, i) => c.fillText(ln, box.x + PADX, box.y + PADY + i * box.lh));
  c.restore();
}

// Edit hit-region (box interior, inset from the border) + in-place editor geometry. The
// editor underlay always uses the background COLOUR so the text is readable while typing.
/** @param {Box} box @param {BoxStyle | null | undefined} style @param {boolean} [wrap] */
export function boxTextGeom(box, style, wrap) {
  const EDGE = Math.max(4, Math.min(10, box.w / 3, box.h / 3));
  const bg = (style && style.bg) || '#1e222d';
  return {
    cx: box.x, cy: box.y, angle: 0, tAlign: 'left', baseline: 'top', va: 'top',
    size: box.size, w: box.w, totalH: box.h,
    lx0: EDGE, lx1: box.w - EDGE, ly0: EDGE, ly1: box.h - EDGE,
    editor: wrap
      ? { wrap: true, width: Math.max(8, box.w - PADX * 2), offX: PADX, offY: PADY, bg }
      : { wrap: false, offX: PADX, offY: PADY, bg },
  };
}
