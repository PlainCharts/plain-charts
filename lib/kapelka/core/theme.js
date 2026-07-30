// @ts-check
// Theme resolvers: chart options -> the author's render-class color keys, and the canvas font for
// axis/scale text. Pure functions of the options object; lifted out of the Chart shell unchanged.
import { dashFor } from './components/renderers/draw-util.js';

// canvas font for axis/scale text, from layout.fontSize / layout.fontFamily
// `options` is the merged options bag (DEFAULTS-filled), so its groups are present; typed loosely here.
/** @param {any} options @returns {string} */
export function fontFor(options) {
  const l = (options && options.layout) || {};
  return `${l.fontSize || 11}px ${l.fontFamily || '-apple-system, BlinkMacSystemFont, Arial, sans-serif'}`;
}

// map chart options -> the author's color keys (single grid color; scale=axis border; cross/panel/textHL=cursor)
/** @param {any} options @returns {import('./types.js').Colors} */
export function colorsFor(options) {
  const o = options;
  const hz = o.grid.horzLines || {},
    vt = o.grid.vertLines || {};
  const ch = o.cursor || {};
  ch.vertLine = ch.vertLine || {};
  ch.horzLine = ch.horzLine || {};
  const gridColor = hz.color || vt.color || '#1a1a20';
  const HIDDEN = 'rgba(0,0,0,0)'; // visible:false -> transparent (the author's grid always strokes)
  return {
    back: (o.layout.background && o.layout.background.color) || '#fff',
    grid: gridColor,
    gridVert: vt.visible === false ? HIDDEN : vt.color || gridColor, // per-direction (gridMode none/vert/horz/both)
    gridHorz: hz.visible === false ? HIDDEN : hz.color || gridColor,
    gridDashVert: dashFor(vt.style || 0),
    gridDashHorz: dashFor(hz.style || 0), // line style (solid/dotted/dashed)
    scale: (o.rightPriceAxis && o.rightPriceAxis.borderColor) || (o.timeAxis && o.timeAxis.borderColor) || '#333',
    text: o.layout.textColor || '#888',
    // cursor: the app sets cursor.vertLine / horzLine, not cursor.color
    cross: ch.vertLine.color || ch.horzLine.color || ch.color || '#758696',
    crossWidth: ch.vertLine.width || ch.horzLine.width || 1,
    crossDash: dashFor(
      ch.vertLine.style != null ? ch.vertLine.style : ch.horzLine.style != null ? ch.horzLine.style : 2,
    ),
    panel: ch.vertLine.labelBg || ch.horzLine.labelBg || ch.labelBg || '#363a45',
    textHL: ch.labelText || '#e6e6e6',
  };
}
