// @ts-check
// Quantize a price to the instrument's tick grid (minMove, e.g. 0.25 for E-mini S&P) and render it
// with the instrument's decimals -- so every price the engine prints (crosshair label, price-axis
// ticks, last-value tag, price lines) lands on a valid tick.
//
// Round to whole ticks, then fixed decimals. Integer-tick rounding avoids float drift;
// round(value/minMove)*minMove is the same net
// result for the value ranges charts deal with. A falsy minMove -> plain toFixed(prec), so non-price
// scales (study panes, percentage/indexed) are left untouched.
/**
 * @param {number} value the raw price to render
 * @param {number} minMove instrument tick size (e.g. 0.25); falsy -> no quantization
 * @param {number} [prec] decimal places (default 2)
 * @returns {string}
 */
export function fmtTickPrice(value, minMove, prec) {
  const p = prec != null ? prec : 2;
  if (minMove && minMove > 0) value = Math.round(value / minMove) * minMove;
  return Number(value).toFixed(p);
}
