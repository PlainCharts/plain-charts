// @ts-check
// The user's toolbar layout — which tools appear, their order, and any custom
// icon overrides. User data, separate from the tool modules. Persisted to
// settings/toolbar.json.
import { createStore } from '../store.js';

/**
 * @typedef {Object} ToolbarData
 * @property {string[]} tools               tool ids on the bar, in order
 * @property {Record<string, string>} icons    toolId -> custom icon url
 * @property {Record<string, string>} hotkeys  toolId -> combo string (e.g. 'Alt+T')
 * @property {string[]} features            platform feature ids, in order
 * @property {string} newDrawingSync        'none' | 'layout' | 'global'
 * @property {string} magnet                'off' | 'weak' | 'strong'
 * @property {boolean} hideDrawings
 * @property {boolean} hideIndicators
 * @property {boolean} lockDrawings
 */

const DEFAULT_TOOLS = ['cursor', 'zoom', 'trendline', 'arrow', 'path', 'hline', 'hray', 'levelray', 'vline', 'rect'];
const DEFAULT_FEATURES = ['lock', 'trash', 'eye', 'magnet', 'sync'];   // platform features (always present)
const store = createStore('/api/toolbar', { tools: DEFAULT_TOOLS, icons: {}, hotkeys: {}, features: DEFAULT_FEATURES, newDrawingSync: 'none', magnet: 'off', hideDrawings: false, hideIndicators: false, lockDrawings: false });
/** @type {ToolbarData} */
let data = { tools: DEFAULT_TOOLS.slice(), icons: {}, hotkeys: {}, features: DEFAULT_FEATURES.slice(), newDrawingSync: 'none', magnet: 'off', hideDrawings: false, hideIndicators: false, lockDrawings: false };

export async function loadToolbar() {
  const d = await store.load();
  data.tools = Array.isArray(d.tools) && d.tools.length ? d.tools : DEFAULT_TOOLS.slice();
  data.icons = d.icons || {};
  data.hotkeys = d.hotkeys || {};   // toolId -> combo string (e.g. 'Alt+T')
  // keep only known features, in saved order, then append any new ones (robust to changes)
  const saved = Array.isArray(d.features) ? d.features.filter((f) => DEFAULT_FEATURES.includes(f)) : [];
  data.features = [...saved, ...DEFAULT_FEATURES.filter((f) => !saved.includes(f))];
  data.newDrawingSync = d.newDrawingSync || 'none';
  data.magnet = d.magnet || 'off';
  data.hideDrawings = !!d.hideDrawings;
  data.hideIndicators = !!d.hideIndicators;
  data.lockDrawings = !!d.lockDrawings;
  return data;
}
const save = () => { store.set('tools', data.tools); store.set('icons', data.icons); store.set('hotkeys', data.hotkeys); store.set('features', data.features); store.set('newDrawingSync', data.newDrawingSync); store.set('magnet', data.magnet); store.set('hideDrawings', data.hideDrawings); store.set('hideIndicators', data.hideIndicators); store.set('lockDrawings', data.lockDrawings); };

// platform features order (reorderable, never added/removed)
export const featureOrder = () => data.features.slice();
/** Drop-reorder: insert feature `id` before (or after) `targetId`. @param {string} id @param {string} targetId @param {boolean} [after] */
export function placeFeature(id, targetId, after) {
  const from = data.features.indexOf(id);
  if (from < 0 || !data.features.includes(targetId) || id === targetId) return;
  const [f] = data.features.splice(from, 1);
  data.features.splice(data.features.indexOf(targetId) + (after ? 1 : 0), 0, f);
  save();
}

// sync mode applied to newly-created drawings ('none' | 'layout' | 'global')
export const newDrawingSync = () => data.newDrawingSync || 'none';
/** @param {string | null | undefined} mode */
export function setNewDrawingSync(mode) { data.newDrawingSync = mode || 'none'; save(); }

// magnet (snap drawing anchors to candle OHLC): 'off' | 'weak' | 'strong'
export const magnetMode = () => data.magnet || 'off';
/** @param {string | null | undefined} mode */
export function setMagnetMode(mode) { data.magnet = mode || 'off'; save(); }

// view toggles: hide (not delete) all drawings / all indicators
export const drawingsHidden = () => !!data.hideDrawings;
export const indicatorsHidden = () => !!data.hideIndicators;
/** @param {any} v */
export function setHideDrawings(v) { data.hideDrawings = !!v; save(); }
/** @param {any} v */
export function setHideIndicators(v) { data.hideIndicators = !!v; save(); }

// lock all drawings (no move / reshape / delete; clicks pass through to the chart)
export const drawingsLocked = () => !!data.lockDrawings;
/** @param {any} v */
export function setLockDrawings(v) { data.lockDrawings = !!v; save(); }

export const toolbarTools = () => data.tools;
/** @param {string} id */
export const onBar = (id) => data.tools.includes(id);
/** @param {string} id @returns {string | undefined} */
export const iconFor = (id) => data.icons[id];

/** @param {string} id @param {boolean} on */
export function setOnBar(id, on) {
  if (on) { if (!data.tools.includes(id)) data.tools.push(id); }
  else { data.tools = data.tools.filter((x) => x !== id); }
  save();
}
/** Drop-reorder: insert tool `id` before (or after) `targetId` (both on the bar). @param {string} id @param {string} targetId @param {boolean} [after] */
export function placeTool(id, targetId, after) {
  const from = data.tools.indexOf(id);
  if (from < 0 || !data.tools.includes(targetId) || id === targetId) return;
  const [t] = data.tools.splice(from, 1);
  data.tools.splice(data.tools.indexOf(targetId) + (after ? 1 : 0), 0, t);
  save();
}
/** @param {string} id @param {string | null | undefined} icon */
export function setIcon(id, icon) {
  if (icon) data.icons[id] = icon; else delete data.icons[id];
  save();
}

// ---- per-tool hotkeys (combo string like 'Alt+T') ----
/** @param {string} id @returns {string} */
export const toolHotkey = (id) => data.hotkeys[id] || '';
export const toolHotkeys = () => ({ ...data.hotkeys });
/** @param {string} combo @returns {string | null} */
export const toolForCombo = (combo) => Object.keys(data.hotkeys).find((id) => data.hotkeys[id] === combo) || null;
/** @param {string} id @param {string | null | undefined} combo */
export function setToolHotkey(id, combo) {
  if (!combo) { delete data.hotkeys[id]; save(); return; }
  // a combo maps to one tool only — clear it from any other tool first
  Object.keys(data.hotkeys).forEach((k) => { if (data.hotkeys[k] === combo) delete data.hotkeys[k]; });
  data.hotkeys[id] = combo;
  save();
}
