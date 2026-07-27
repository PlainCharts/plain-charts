// @ts-check
// App theme = chrome colors only (toolbar, menus, dialogs, bottom bar). Applied
// as CSS variables. Built-in Dark/Light + user themes, each its OWN file under
// settings/themes/ (a shareable library). The selected theme name is app state, so
// it lives in settings.json (currentTheme), not in the theme files.
// NOTE: chart appearance (candles, background, grid, crosshair, scales) is a
// separate concern — per-pane Canvas settings + the chart-templates library.
import { getJSON, postJSON } from '../api.js';
import { IPC } from '../ipc-contract.js';   // cross-window channel names (single source of truth)
import { getSetting, setSetting } from './settings.js';

/**
 * A theme palette: a map of palette-key -> colour string (plus numeric frameWidth).
 * All keys are optional because older/user themes may predate newly-added keys.
 * @typedef {Record<string, string|number|undefined>} Palette
 */
/**
 * A named theme (one file under settings/themes/).
 * @typedef {{ name: string, description?: string, palette: Palette }} Theme
 */

const CSS_VARS = {
  bg: '--bg', panel: '--panel', field: '--field', btn: '--btn', btnH: '--btn-h',
  accent: '--accent', accentH: '--accent-h', accentTx: '--accent-tx',   // primary/accent button
  hover: '--hover', active: '--active', bd: '--bd', bdSoft: '--bd-soft',
  tx: '--tx', txDim: '--tx-dim', tx2: '--tx2',
  ctrl: '--ctrl', ctrlTx: '--ctrl-tx', ctrlOn: '--ctrl-on', ctrlOnTx: '--ctrl-on-tx',
  pos: '--pos', neg: '--neg',
  conn: '--conn', disc: '--disc',   // connection status: connected / disconnected (one colour each, dot + text)
};

// editor rows, grouped into labeled sections so it's clear at a glance what each colour paints.
// Shape: [sectionTitle, [[paletteKey, rowLabel], ...]]
export const PALETTE_APP = [
  ['Surfaces', [
    ['bg', 'App background'], ['panel', 'Panels / menus / dialogs'], ['field', 'Input fields'],
  ]],
  ['Buttons', [
    ['btn', 'Button'], ['btnH', 'Button (hover)'], ['btnTx', 'Button text'],
    ['accent', 'Accent (primary buttons)'], ['accentH', 'Accent (hover)'], ['accentTx', 'Accent text'],
  ]],
  ['States', [
    ['accentUi', 'Accent (interface)'], ['hover', 'Row / item hover'], ['active', 'Selected / active'],
  ]],
  ['Borders', [
    ['bd', 'Border'], ['bdSoft', 'Border (soft)'],
  ]],
  ['Text', [
    ['tx', 'Text'], ['txDim', 'Dim text'], ['tx2', 'Muted text'], ['icon', 'Icons'],
  ]],
  ['Connection', [
    ['conn', 'Connected'], ['disc', 'Disconnected'],
  ]],
];

// on-chart nav controls (zoom/maximize/scroll/reset) — inactive + active states
export const PALETTE_CONTROLS = [
  ['ctrl', 'Control'], ['ctrlTx', 'Control icon'],
  ['ctrlOn', 'Control active'], ['ctrlOnTx', 'Control active icon'],
];

// value-sign colors: anything above 0 (positive) vs below 0 (negative)
export const PALETTE_SIGN = [
  ['pos', 'Positive (above 0)'], ['neg', 'Negative (below 0)'],
];

/** @type {Palette} */
const DARK = {
  bg: '#0e0e11', panel: '#15151b', field: '#16161c', btn: '#1c1c22', btnH: '#2a2a33', btnTx: '#dddddd',
  accent: '#2962ff', accentH: '#1e53e5', accentTx: '#ffffff', accentUi: '#2962ff',
  hover: '#23232b', active: '#1e2a4a', bd: '#333333', bdSoft: '#222222',
  tx: '#dddddd', txDim: '#888888', tx2: '#aaaaaa', icon: '#aaaaaa',
  ctrl: '#1c1c22', ctrlTx: '#cccccc', ctrlOn: '#dddddd', ctrlOnTx: '#0e0e11',
  pos: '#26a69a', neg: '#ef5350',
  conn: '#4caf50', disc: '#888888',
  frameColor: '#2962ff', frameWidth: 1,
};
/** @type {Palette} */
const LIGHT = {
  bg: '#ffffff', panel: '#f6f6f8', field: '#ffffff', btn: '#ededf1', btnH: '#e2e2e8', btnTx: '#1a1a1f',
  accent: '#2962ff', accentH: '#1e53e5', accentTx: '#ffffff', accentUi: '#2962ff',
  hover: '#ececf1', active: '#dbe6ff', bd: '#d3d3da', bdSoft: '#e6e6ea',
  tx: '#1a1a1f', txDim: '#777777', tx2: '#555555', icon: '#555555',
  ctrl: '#ffffff', ctrlTx: '#555555', ctrlOn: '#1a1a1f', ctrlOnTx: '#ffffff',
  pos: '#089981', neg: '#e0485a',
  conn: '#2e9e4f', disc: '#999999',
  frameColor: '#2962ff', frameWidth: 1,
};
// Dark/Light are just the DEFAULT themes shipped with the app — seeded into the
// theme list on first run and fully editable like any other (no read-only built-ins).
const DEFAULTS = [{ name: 'Dark', palette: DARK }, { name: 'Light', palette: LIGHT }];

/** @type {Theme[]} */
let themes = [];          // all themes (every one is a normal, editable theme)
let currentName = 'Dark';
/** @type {Palette} */
let live = DARK;

/** @param {string} name @returns {Palette} */
const paletteOf = (name) => (themes.find((t) => t.name === name) || {}).palette || DARK;

/** @param {Palette} p */
function applyLive(p) {
  live = p;
  const root = document.documentElement.style;
  for (const [k, cssVar] of Object.entries(CSS_VARS)) root.setProperty(cssVar, /** @type {string} */ (p[k] || DARK[k]));
  // button text: for themes that predate this key, fall back to the theme's OWN text colour
  // (NOT Dark's -- that would put light text on a light theme's buttons).
  root.setProperty('--btn-tx', /** @type {string} */ (p.btnTx || p.tx || DARK.tx));
  // icon colour: themes that predate this key fall back to their OWN muted text colour (not Dark's)
  root.setProperty('--icon', /** @type {string} */ (p.icon || p.tx2 || DARK.tx2));
  // interface accent (active tabs / focus rings / selection) -- distinct from the primary-button accent.
  // themes that predate this key fall back to their OWN accent, so nothing changes until it's set.
  root.setProperty('--accent-ui', /** @type {string} */ (p.accentUi || p.accent || DARK.accent));
  root.setProperty('--pane-frame', /** @type {string} */ (p.frameColor || '#2962ff'));
  root.setProperty('--pane-frame-w', (p.frameWidth || 1) + 'px');
}

// Cross-window: selecting a theme in one window re-skins EVERY open window (same-origin
// BroadcastChannel, the mechanism broker-bridge already uses). A received broadcast applies the
// palette WITHOUT re-broadcasting (no loop) and without re-writing settings (the sender did that).
/** @type {BroadcastChannel | false | null} */
let uiChan = null;
function ensureChan() {
  if (uiChan !== null) return uiChan;
  try {
    uiChan = new BroadcastChannel(IPC.UI_BUS);
    uiChan.onmessage = (/** @type {MessageEvent} */ e) => {
      const m = e.data;
      if (m && m.type === 'theme' && m.name) { currentName = m.name; applyLive(structuredClone(paletteOf(m.name))); }
    };
  } catch (_) { uiChan = false; }
  return uiChan;
}

/** @returns {Promise<void>} */
export async function loadThemes() {
  const d = await getJSON('/api/themes');
  themes = Array.isArray(d.themes) ? d.themes.filter((/** @type {Theme} */ t) => t && t.name) : [];
  if (!themes.length) {   // no theme files yet → seed the built-in defaults as files
    DEFAULTS.forEach((t) => { themes.push({ name: t.name, palette: structuredClone(t.palette) }); postJSON('/api/themes/save', { name: t.name, data: { palette: t.palette } }); });
  }
  currentName = getSetting('currentTheme') || (themes[0] && themes[0].name) || 'Dark';
  if (!themes.find((t) => t.name === currentName)) currentName = (themes[0] && themes[0].name) || 'Dark';
  applyLive(structuredClone(paletteOf(currentName)));
  ensureChan();   // start listening so this window re-skins when another window switches theme
}

export const listThemes = () => themes.map((t) => t.name);
export const getCurrentName = () => currentName;
// merge Dark defaults so newly-added keys (pos/neg/…) are populated for older
// themes that predate them — the editor and saves then carry real values.
// EXCEPT button text: if this theme never set it, derive it from the theme's OWN text colour
// (not Dark's) so autosaving a light theme doesn't bake in Dark's light button text.
export const getLivePalette = () => {
  const p = { ...DARK, ...structuredClone(live) };
  if (!live.btnTx) p.btnTx = live.tx || DARK.tx;
  if (!live.icon) p.icon = live.tx2 || DARK.tx2;
  if (!live.accentUi) p.accentUi = live.accent || DARK.accent;
  return p;
};

/** @param {string} name */
export function selectTheme(name) {
  currentName = name;
  setSetting('currentTheme', name);   // selection is app state, not part of the theme
  applyLive(structuredClone(paletteOf(name)));
  const ch = ensureChan(); if (ch) ch.postMessage({ type: 'theme', name });   // re-skin the other windows
}
/** @param {Palette} p */
export function previewPalette(p) { applyLive(p); }

/** @param {string} name @param {Palette} palette */
export function saveUserTheme(name, palette) {   // upsert any theme -> one file
  name = (name || '').trim();
  if (!name) return;
  const prev = themes.find((t) => t.name === name);   // keep the package manager description across an edit
  const description = prev && prev.description;
  themes = themes.filter((t) => t.name !== name);
  themes.push({ name, palette, ...(description ? { description } : {}) });
  currentName = name;
  postJSON('/api/themes/save', { name, data: { ...(description ? { description } : {}), palette } });
  setSetting('currentTheme', name);
}
/** @param {string} name */
export function deleteUserTheme(name) {
  themes = themes.filter((t) => t.name !== name);
  postJSON('/api/themes/delete', { name });
  if (currentName === name) selectTheme((themes[0] && themes[0].name) || 'Dark');
}

// open settings/themes/ in the OS file manager (grab/drop theme files)
export function openThemesFolder() { postJSON('/api/themes/open', {}); }
// import a theme from a picked file's parsed JSON ({ name, palette }) -> writes a file
/** @param {any} obj @returns {boolean} */
export function importTheme(obj) {
  if (!obj || !obj.name || !obj.palette) return false;
  saveUserTheme(obj.name, obj.palette);
  return true;
}
