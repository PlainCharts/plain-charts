// @ts-check
// Pure colour conversions and value parsing for the picker family -- no DOM. Values are '#rrggbb'
// (opaque) or 'rgba(...)'; the SV square works in HSV (not HSL).

/** @param {number} n @param {number} a @param {number} b @returns {number} */
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
/** @param {string} h @returns {[number, number, number]} */
export const hexToRgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
/** @param {number} r @param {number} g @param {number} b @returns {string} */
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');

/** @param {number} h @param {number} s @param {number} v @returns {[number, number, number]} */
export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** @param {number} r @param {number} g @param {number} b @returns {[number, number, number]} */
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, max ? d / max : 0, max];
}
/** @param {number} h @param {number} s @param {number} v @returns {string} */
export const hsvToHex = (h, s, v) => { const [r, g, b] = hsvToRgb(h, s, v); return rgbToHex(r, g, b); };
/** @param {string} hex @returns {[number, number, number]} */
export const hexToHsv = (hex) => { const [r, g, b] = hexToRgb(hex); return rgbToHsv(r, g, b); };

/** @param {string} [s] @returns {string|null} */
export function normHex(s) {
  s = (s || '').trim(); if (s[0] !== '#') s = '#' + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}
/** @param {string} a @param {string} b @returns {boolean} */
export const sameHex = (a, b) => { const x = normHex(a), y = normHex(b); return !!(x && y && x === y); };

/** parse a stored value into its opaque hex + alpha @param {string} [value] @returns {{ hex: string, alpha: number }} */
export function parseColor(value) {
  if (!value) return { hex: '#2962ff', alpha: 1 };
  if (value[0] === '#') return { hex: normHex(value) || '#2962ff', alpha: 1 };
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/.exec(value);
  if (m) return { hex: rgbToHex(+m[1], +m[2], +m[3]), alpha: m[4] != null ? parseFloat(m[4]) : 1 };
  return { hex: '#2962ff', alpha: 1 };
}
/** compose hex + alpha back into a stored value @param {string} hex @param {number} alpha @returns {string} */
export function composeColor(hex, alpha) {
  if (alpha >= 1) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})`;
}
/** normalise a line-style value (name or legacy number) @param {string|number} [v] @returns {'solid'|'dashed'|'dotted'} */
export const normLS = (v) => (v === 'dashed' || v === 2) ? 'dashed' : (v === 'dotted' || v === 1) ? 'dotted' : 'solid';
