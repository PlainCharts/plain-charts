// @ts-check
// User colour palettes (Excel/LibreOffice-style). Each palette is { id, name, rows: [[hex...], ...] } --
// a palette is a set of ROWS (sub-palettes), so the user can group colours by theme and break to a new row
// whenever they like (the picker's "new row" button). A row holds up to ROW_MAX colours; adding past that
// wraps to a fresh row. The picker is built entirely on palettes -- the defaults below ("Standard" plus an
// empty "My Colors") ship as data and are written to settings/appearance/palettes.json on first run; from
// then on that file is the user's own. Old palettes stored as a flat `colors` array are migrated to rows.
import { createStore } from '../store.js';

/**
 * A colour palette: a set of ROWS (sub-palettes), each row an array of hex strings.
 * @typedef {{ id: string, name: string, rows: string[][] }} Palette
 */
/**
 * @typedef {Object} PalettesData
 * @property {Palette[]} palettes
 * @property {string|null} activeId
 * @property {string[]} favorites
 */

const ROW_MAX = 9; // colours per row before an add wraps to a new one; the user can break earlier
/** @param {string[]} arr @param {number} n @returns {string[][]} */
const chunk = (arr, n) => {
  /** @type {string[][]} */ const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Shipped defaults. "Standard" is the classic 10-greys + 8 shade rows across 10 hues, kept as its natural
// rows of 10 so the grid looks the same while being a normal, editable palette.
/** @returns {PalettesData} */
const seed = () => ({
  palettes: [
    {
      id: 'p_standard',
      name: 'Standard',
      rows: [
        ['#ffffff', '#d1d4dc', '#b2b5be', '#9aa0aa', '#787b86', '#5d606b', '#434651', '#2a2e39', '#1b1f2b', '#000000'],
        ['#fccfd3', '#ffdfcc', '#ffeacc', '#fff2cc', '#e6f1da', '#cffcf5', '#ccf9ff', '#ccdaff', '#e2d8f3', '#f8d3e9'],
        ['#f99fa6', '#ffbe99', '#ffd699', '#ffe699', '#cde4b4', '#9efaeb', '#99f3ff', '#99b4ff', '#c5b2e6', '#f1a7d3'],
        ['#f56671', '#ff975c', '#ffbd5c', '#ffd65c', '#aed388', '#64f7df', '#5cedff', '#5c87ff', '#a283d8', '#e873b9'],
        ['#f23140', '#ff7424', '#ffa624', '#ffc824', '#93c45f', '#2ff4d3', '#24e6ff', '#245eff', '#8158ca', '#e042a1'],
        ['#e10f1f', '#f05700', '#f08f00', '#f0b400', '#79af41', '#0ce4c0', '#00d5f0', '#0040f0', '#663ab6', '#ce2189'],
        ['#b60c19', '#c24700', '#c27400', '#c29100', '#628e34', '#0ab89b', '#00acc2', '#0034c2', '#532f93', '#a71b6f'],
        ['#8b0913', '#943600', '#945800', '#946f00', '#4b6c28', '#078d77', '#008394', '#002794', '#3f2470', '#7f1555'],
        ['#60060d', '#662500', '#663d00', '#664d00', '#344b1b', '#056152', '#005a66', '#001b66', '#2c194d', '#580e3a'],
      ],
    },
    { id: 'p_mycolors', name: 'My Colors', rows: [] },
  ],
  activeId: 'p_standard',
  favorites: [], // hex colours the user starred -- they get a highlight wherever they appear
});

const store = createStore('/api/palettes', seed());
/** @type {PalettesData} */
let data = seed();
let seq = 0;

// normalise a stored palette to the rows model (migrating an old flat `colors` array if present).
/** @param {any} p @returns {Palette} */
const normPalette = (p) => ({
  id: p.id,
  name: p.name || 'Palette',
  rows: Array.isArray(p.rows)
    ? p.rows.filter(Array.isArray).map((/** @type {string[]} */ r) => r.slice())
    : chunk(Array.isArray(p.colors) ? p.colors : [], ROW_MAX),
});

/** @returns {Promise<PalettesData>} */
export async function loadPalettes() {
  const d = await store.load();
  if (d && Array.isArray(d.palettes)) {
    data.palettes = d.palettes.filter((p) => p && p.id).map(normPalette);
    data.activeId = d.activeId || (data.palettes[0] && data.palettes[0].id) || null;
    data.favorites = Array.isArray(d.favorites) ? d.favorites.slice() : [];
  }
  if (!data.palettes.length) {
    data = seed();
    save();
  } // never leave the user with zero palettes
  return data;
}
const save = () => {
  store.set('palettes', data.palettes);
  store.set('activeId', data.activeId);
  store.set('favorites', data.favorites);
};

/** @returns {Palette[]} */
export const paletteList = () => data.palettes;
/** @returns {string|null} */
export const activePaletteId = () => data.activeId;
/** @param {string|null} id @returns {Palette|null} */
export const getPalette = (id) => data.palettes.find((p) => p.id === id) || null;
/** @param {string|null} id @returns {string[][]} */
export const paletteRows = (id) => {
  const p = getPalette(id);
  return p ? p.rows : [];
};
/** @param {string|null} id @returns {string[]} */
export const paletteFlat = (id) => {
  const p = getPalette(id);
  return p ? p.rows.flat() : [];
};
/** @param {string|null} id @returns {void} */
export function setActivePalette(id) {
  if (getPalette(id)) {
    data.activeId = id;
    save();
  }
}

/** @param {string} [name] @returns {Palette} */
export function createPalette(name) {
  const id = 'p_' + Date.now().toString(36) + (seq++).toString(36);
  const p = { id, name: name || 'Palette ' + (data.palettes.length + 1), rows: [] };
  data.palettes.push(p);
  data.activeId = id;
  save();
  return p;
}
/** @param {string} id @param {string} name @returns {void} */
export function renamePalette(id, name) {
  const p = getPalette(id);
  if (p && name) {
    p.name = name;
    save();
  }
}
/** @param {string} id @returns {void} */
export function removePalette(id) {
  data.palettes = data.palettes.filter((p) => p.id !== id);
  if (data.activeId === id) data.activeId = (data.palettes[0] && data.palettes[0].id) || null;
  save();
}
// Add a colour to a TARGET row (rowIndex; defaults to the last row). If that row is missing or full, a new
// row is appended and used. Returns the index of the row the colour landed in, so the picker can keep that
// row selected.
/** @param {string} id @param {string} color @param {number|null} [rowIndex] @returns {number} */
export function addColorToPalette(id, color, rowIndex) {
  const p = getPalette(id);
  if (!p || !color) return -1;
  const fallback = () => (p.rows.length ? p.rows.length - 1 : -1);
  if (p.rows.flat().includes(color)) return rowIndex != null ? rowIndex : fallback(); // dedup, no change
  let idx = rowIndex != null && rowIndex >= 0 && rowIndex < p.rows.length ? rowIndex : p.rows.length - 1;
  let row = p.rows[idx];
  if (!row || row.length >= ROW_MAX) {
    row = [];
    p.rows.push(row);
    idx = p.rows.length - 1;
  }
  row.push(color);
  save();
  return idx;
}
// start a fresh row -- the next added colour lands here (like pressing Enter). No-op if the last row is
// already empty, so it never stacks blank rows.
/** @param {string} id @returns {void} */
export function addRowToPalette(id) {
  const p = getPalette(id);
  if (!p) return;
  if (p.rows.length && p.rows[p.rows.length - 1].length === 0) return;
  p.rows.push([]);
  save();
}
/** @param {string} id @param {string} color @returns {void} */
export function removeColorFromPalette(id, color) {
  const p = getPalette(id);
  if (!p) return;
  p.rows = p.rows.map((r) => r.filter((c) => c !== color)).filter((r) => r.length); // drop rows left empty
  save();
}

// Favorites: a global set of hex colours the user starred (highlighted wherever they appear).
/** @returns {string[]} */
export const favoriteColors = () => data.favorites;
/** @param {string} hex @returns {boolean} */
export const isFavorite = (hex) => data.favorites.includes(hex);
/** @param {string} hex @returns {void} */
export function toggleFavorite(hex) {
  if (!hex) return;
  const i = data.favorites.indexOf(hex);
  if (i >= 0) data.favorites.splice(i, 1);
  else data.favorites.push(hex);
  save();
}
