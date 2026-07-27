// @ts-check
// Chart THEME = the sharable "colours and styles" of a chart: candle body/border/wick + a subset of
// canvas (background, grid, crosshair line, scale text/font/border). The chart-side parallel of an app
// theme. Each theme is its OWN file under packages/chart-themes/ -- a sharable, installable library.
// Distinct from a personal chart TEMPLATE, which is the WHOLE per-chart setup saved to the user's own
// settings/ folder (see chart-snapshot.js).
//
// A theme applies by MERGING: candles are replaced wholesale, but only the theme's own canvas keys are
// merged into the chart -- margins, zoom, nav buttons and everything outside the theme's scope stay
// untouched. Editing goes through the settings dialog's draft, so it previews live and commits with the
// rest of the dialog on Ok.
import { getJSON, postJSON } from '../api.js';
import { getSetting, setSetting } from './settings.js';

/**
 * A chart theme: candle appearance + a subset of canvas colours / fonts + the price/bid/ask line styles.
 * @typedef {{ name: string, description?: string, candles?: any, canvas?: Record<string, any>, lines?: Record<string, any> }} ChartTheme
 */

// The ONLY canvas keys a chart theme owns. Everything else on canvas (margins, zoom, nav buttons,
// crosshair labels, ...) is layout / behaviour and stays out of themes.
export const THEME_CANVAS_KEYS = [
  'background',
  'gridMode', 'gridColor', 'gridStyle',
  'crosshairColor', 'crosshairWidth', 'crosshairStyle',
  'scaleTextColor', 'scaleFontSize', 'scaleFontFamily', 'scaleLineColor',
];

// The flat line keys a chart theme owns: the price / bid / ask lines -- visibility + stroke (colour,
// width, dash). These live directly on pane.settings (the live "Scales and lines" path), not on canvas.
export const THEME_LINE_KEYS = [
  'priceLine', 'priceLineColor', 'priceLineWidth', 'priceLineDash',
  'bidLine', 'bidLineColor', 'bidLineWidth', 'bidLineDash',
  'askLine', 'askLineColor', 'askLineWidth', 'askLineDash',
];

/** @type {ChartTheme[]} */
let themes = [];
let currentName = '';

/** @returns {Promise<ChartTheme[]>} */
export async function loadChartThemes() {
  const d = await getJSON('/api/chart-themes');
  themes = Array.isArray(d.themes) ? d.themes.filter((/** @type {any} */ t) => t && t.name) : [];
  currentName = getSetting('currentChartTheme') || (themes[0] && themes[0].name) || '';
  if (!themes.find((t) => t.name === currentName)) currentName = (themes[0] && themes[0].name) || '';
  return themes;
}

export const listChartThemes = () => themes.map((t) => t.name);
/** @param {string} name @returns {ChartTheme | undefined} */
export const getChartTheme = (name) => themes.find((t) => t.name === name);
export const currentChartThemeName = () => currentName;

/** @param {string} name */
export function selectChartTheme(name) {
  currentName = name;
  setSetting('currentChartTheme', name);
}

// upsert one theme -> one file (keeps the package-manager description across an edit)
/** @param {string} name @param {ChartTheme} theme */
export function saveChartTheme(name, theme) {
  name = (name || '').trim();
  if (!name) return;
  const prev = themes.find((t) => t.name === name);
  const description = prev && prev.description;
  const body = { candles: theme.candles, canvas: theme.canvas, lines: theme.lines };
  const rec = { name, ...(description ? { description } : {}), ...body };
  themes = [...themes.filter((t) => t.name !== name), rec];
  currentName = name;
  setSetting('currentChartTheme', name);
  postJSON('/api/chart-themes/save', { name, data: { ...(description ? { description } : {}), ...body } });
}

/** @param {string} name */
export function deleteChartTheme(name) {
  themes = themes.filter((t) => t.name !== name);
  postJSON('/api/chart-themes/delete', { name });
  if (currentName === name) selectChartTheme((themes[0] && themes[0].name) || '');
}

// open packages/chart-themes/ in the OS file manager (grab / drop theme files)
export function openChartThemesFolder() { postJSON('/api/chart-themes/open', {}); }

/** @param {any} obj @returns {boolean} */
export function importChartTheme(obj) {
  if (!obj || !obj.name || !isChartTheme(obj)) return false;
  saveChartTheme(obj.name, obj);
  return true;
}

/** @param {any} obj @returns {boolean} */
export function isChartTheme(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return !!obj.candles || (!!obj.canvas && typeof obj.canvas === 'object') || (!!obj.lines && typeof obj.lines === 'object');
}

// ---- draft bridge: the dialog edits candles/canvas in an uncommitted draft, while the price/bid/ask
// lines are LIVE on pane.settings. These capture from / apply to both. ----

/** @param {Record<string, any>} src @param {string[]} keys @returns {Record<string, any>} */
const pick = (src, keys) => {
  /** @type {Record<string, any>} */
  const o = {};
  keys.forEach((k) => { if (src && src[k] !== undefined) o[k] = src[k]; });
  return o;
};

/** Capture a theme: candles + canvas subset from the dialog draft, line subset from the live pane.
 * @param {any} draft @param {any} pane @returns {ChartTheme} */
export function themeFromDraft(draft, pane) {
  return {
    name: '',
    candles: structuredClone(draft.candles),
    canvas: structuredClone(pick(draft.canvas || {}, THEME_CANVAS_KEYS)),
    lines: structuredClone(pick(pane ? pane.getLineSettings() : {}, THEME_LINE_KEYS)),
  };
}

/** Apply a theme: candles replaced wholesale and canvas keys merged into the draft (previewed, commits
 * on Ok); the line subset applied LIVE to the pane. Everything outside the theme's scope is kept.
 * @param {any} draft @param {any} pane @param {ChartTheme} theme */
export function mergeThemeIntoDraft(draft, pane, theme) {
  if (!theme) return;
  if (theme.candles) draft.candles = structuredClone(theme.candles);
  if (theme.canvas) draft.canvas = { ...draft.canvas, ...structuredClone(pick(theme.canvas, THEME_CANVAS_KEYS)) };
  if (theme.lines && pane) pane.applyLineSettings(structuredClone(pick(theme.lines, THEME_LINE_KEYS)));
}
