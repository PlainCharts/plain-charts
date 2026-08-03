// @ts-check
// settings/trading/money-management.json -- per-account money-management config, keyed by SAVED ACCOUNT NAME
// (the same identity accounts.js uses). Holds the sizing SYSTEM and the zone/ladder params.
//
// The account's origin is NOT here: it is the saved account's `startingBalance` (Connections dialog). MM only
// adds the drawdown, grid, ceilings and breakeven band. Sizing state (zone, ladder) is never persisted -- it
// is replayed from the account's closed-trade history by the engine (data_engine/orders/sizing/mm).
import { getJSON, postJSON } from '../api.js';
import { IPC } from '../ipc-contract.js'; // ui-bus: a save broadcasts the new store to every window (no polling)

/**
 * @typedef {Object} MMConfig
 * @property {'manual'|'mm'} system  sizing system for the account: hand-set qty/stake, or money-management
 * @property {number} increment      grid step above the origin
 * @property {number} maxDd          max drawdown -> hard floor (origin - maxDd)
 * @property {number} baseMaxPct     BASE-zone ceiling percent
 * @property {number} shotMaxPct     SHOT-zone ceiling percent
 * @property {number} beThreshold    breakeven dollar band
 */

/** @type {MMConfig} */
export const MM_DEFAULTS = {
  system: 'manual',
  increment: 5000,
  maxDd: 10000,
  baseMaxPct: 2.0,
  shotMaxPct: 3.0,
  beThreshold: 25,
};

/** @type {Record<string, MMConfig>} */
let store = {};

/** @type {Set<() => void>} */
const listeners = new Set();
/** Subscribe to config changes -- local saves AND broadcasts from other windows. @param {() => void} fn */
export function onMMConfigChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () =>
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {}
  });

// Cross-window sync: saving in one window (the Money Man tab) broadcasts the NEW store on the ui-bus; every
// other window (order worker, ticket) applies it directly -- no server round-trip, no polling. A received
// broadcast never re-broadcasts (no loop) and never re-writes settings (the sender did that). Same pattern
// as the theme re-skin (theme.js).
/** @type {BroadcastChannel | false | null} */
let chan = null;
function ensureChan() {
  if (chan !== null) return chan;
  try {
    chan = new BroadcastChannel(IPC.UI_BUS);
    chan.onmessage = (/** @type {MessageEvent} */ e) => {
      const m = e.data;
      if (m && m.type === 'mm-config' && m.store && typeof m.store === 'object') {
        store = m.store;
        notify();
      }
    };
  } catch (_) {
    chan = false;
  }
  return chan;
}

/** Load the whole map from disk (name -> config) and start listening for saves from other windows.
 *  @returns {Promise<Record<string, MMConfig>>} */
export async function loadMMConfigs() {
  const s = await getJSON('/api/money-management');
  store = s && typeof s === 'object' ? s : {};
  ensureChan();
  return store;
}

/** An account's config with defaults filled in. @param {string} name @returns {MMConfig} */
export function getMMConfig(name) {
  return { ...MM_DEFAULTS, ...(store[name] || {}) };
}

/** True when the account is set to money-management sizing. @param {string} name @returns {boolean} */
export function isMMAccount(name) {
  return getMMConfig(name).system === 'mm';
}

/** Merge a patch into an account's config and persist. @param {string} name @param {Partial<MMConfig>} patch */
export function setMMConfig(name, patch) {
  store[name] = { ...getMMConfig(name), ...patch };
  return saveMMConfigs();
}

/** Drop an account's config (e.g. the account was deleted). @param {string} name */
export function removeMMConfig(name) {
  delete store[name];
  return saveMMConfigs();
}

export const saveMMConfigs = () => {
  const ch = ensureChan();
  if (ch) ch.postMessage({ type: 'mm-config', store }); // sync the other windows instantly
  notify();
  return postJSON('/api/money-management', store);
};
