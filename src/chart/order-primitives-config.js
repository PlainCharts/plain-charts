// @ts-check
// ORDER-PRIMITIVES config -- settings/trading/order-primitives.json (served at /api/order-primitives). Two things:
//   active      the GLOBAL choice of on-chart order primitive (registry id, e.g. 'string-beads') -- every chart
//               renders orders through this one
//   primitives  per-primitive config namespaces, keyed by primitive id: whatever THAT primitive's settings are
//               (string-beads: dot colours; pill: per-order-type colour/label/qty presets). A primitive reads its
//               own namespace; the Settings > Trading > Primitives tab edits it via the primitive's renderSettings.
// The module caches the loaded config (one GET per window) and emits on any change so live views can rebuild.
import { createStore } from '../store.js';
import { t } from '../i18n/i18n.js'; // vocabulary lookup -- the order-type abbreviations are overridable words

const store = createStore('/api/order-primitives', { active: 'string-beads', primitives: {} });

/** @type {any} */
let cache = null; // loaded config (live object; primitiveConfig hands out its sub-objects)
/** @type {Promise<any>|null} */
let loadP = null; // in-flight/settled load -- one fetch per window
/** @type {Set<() => void>} */
const subs = new Set();
const emit = () => {
  for (const fn of subs) {
    try {
      fn();
    } catch (_) {}
  }
};

/** Load (once per window) and cache the config. Emits so views created before the load pick it up. */
export function loadOrderPrimitives() {
  if (!loadP)
    loadP = store.load().then((d) => {
      cache = d;
      if (!cache.primitives) cache.primitives = {};
      emit();
      return cache;
    });
  return loadP;
}
/** Any change to the active primitive or a primitive's config. @param {() => void} fn @returns {() => void} */
export function subscribePrimitives(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** The GLOBAL active primitive id (sync; default until the store loads). @returns {string} */
export function activePrimitiveId() {
  return (cache && cache.active) || 'string-beads';
}
/** @param {string} id */
export function setActivePrimitive(id) {
  if (!cache) cache = { primitives: {} };
  cache.active = id;
  store.set('active', id);
  emit();
}

/** ONE primitive's config namespace -- a LIVE object (mutate it, then savePrimitiveConfig). @param {string} id @returns {any} */
export function primitiveConfig(id) {
  if (!cache) cache = { primitives: {} };
  if (!cache.primitives) cache.primitives = {};
  return cache.primitives[id] || (cache.primitives[id] = {});
}
/** Persist the primitives map (after mutating a primitiveConfig object) and notify live views. */
export function savePrimitiveConfig() {
  if (!cache) return;
  store.set('primitives', cache.primitives);
  emit();
}

// ---- the PILL primitive's vocabulary --------------------------------------------------------------------------
// COLOURS are the only user config (primitives.pill.colors, the Settings > Trading > Primitives swatches):
//   PLANNING legs: planStop / planTarget (the pre-trade rung pills + the projection kebab pieces)
//   LIVE: buy / sell (every entry-role pill by side -- projection controller, armed, placed position, working
//   entry orders) and stop / target (placed exits: hedge SL/TP, armed rungs, the entry-pill kebab pieces).
// Type ABBREVIATIONS and the qty picker's step/min/max/presets are fixed vocabulary, not settings.
/** @type {Record<string, string>} */
export const PILL_COLOR_DEFAULTS = {
  buy: '#2962ff',
  sell: '#9c27b0',
  planStop: '#ef5350',
  planTarget: '#26a69a',
  stop: '#f5c518',
  target: '#26a69a',
};
/** one pill colour, user value over default. @param {string} key @returns {string} */
export function pillColor(key) {
  return (primitiveConfig('pill').colors || {})[key] || PILL_COLOR_DEFAULTS[key] || '#2962ff';
}

/** @type {Record<string, string>} */
const TYPE_LABELS = { market: 'MKT', limit: 'LMT', stop: 'STP', takeProfit: 'TP', stopLoss: 'SL' };
/** the pill's abbreviation for an order type -- routed through the vocabulary so a pack can neutralize
 *  the loaded words (e.g. "SL" -> "INVAL"). @param {string} type @returns {string} */
export const typeLabel = (type) => t(TYPE_LABELS[type] || String(type).toUpperCase());
/** the qty picker's config: fixed step/min/max, USER-CONFIGURABLE additive presets (primitives.pill.qtyPresets). */
const QTY_PICKER_DEFAULT = { step: 1, min: 1, max: 1000, decimals: 0, presets: [1, 2, 5] };
/** @returns {{ step: number, min: number, max: number, decimals: number, presets: number[] }} */
export function qtyPicker() {
  const p = primitiveConfig('pill').qtyPresets;
  return {
    ...QTY_PICKER_DEFAULT,
    presets: Array.isArray(p) && p.length ? p.map(Number).filter((n) => isFinite(n)) : QTY_PICKER_DEFAULT.presets,
  };
}
export const QTY_PRESET_DEFAULTS = QTY_PICKER_DEFAULT.presets;

/** the pill's PLACEMENT (primitives.pill.layout): which side of the chart it sits on, how far it sits from the
 * price scale (offset 0 = flush; for the left side, offset from the left edge), and whether the price line
 * EXTENDS across the whole chart (the connector pill->scale always draws; extend adds the rest). */
const LAYOUT_DEFAULT = { extend: false, side: 'right', offset: 50 };
/** the pill's price LINE styling (primitives.pill.line): thickness, solid/dashed/dotted, and colour -- an
 * empty colour means "match the pill" (the per-role colour), a hex fixes every line to that colour. */
const LINE_DEFAULT = { width: 1, style: 'solid', color: '' };
/** @returns {{ width: number, style: 'solid'|'dashed'|'dotted', color: string }} */
export function pillLine() {
  const l = primitiveConfig('pill').line || {};
  const w = Number(l.width);
  return {
    width: Number.isFinite(w) && w >= 1 && w <= 6 ? Math.round(w) : LINE_DEFAULT.width,
    style: l.style === 'dashed' || l.style === 'dotted' ? l.style : 'solid',
    color: typeof l.color === 'string' ? l.color : '',
  };
}
/** @returns {{ extend: boolean, side: 'left'|'right', offset: number }} */
export function pillLayout() {
  const l = primitiveConfig('pill').layout || {};
  return {
    extend: !!l.extend,
    side: l.side === 'left' ? 'left' : 'right',
    offset: Number.isFinite(Number(l.offset)) ? Math.max(0, Number(l.offset)) : LAYOUT_DEFAULT.offset,
  };
}
