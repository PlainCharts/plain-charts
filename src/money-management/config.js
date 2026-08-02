// @ts-check
// settings/trading/money-management.json -- per-account money-management config, keyed by SAVED ACCOUNT NAME
// (the same identity accounts.js uses). Holds the sizing SYSTEM and the zone/ladder params.
//
// The account's origin is NOT here: it is the saved account's `startingBalance` (Connections dialog). MM only
// adds the drawdown, grid, ceilings and breakeven band. Sizing state (zone, ladder) is never persisted -- it
// is replayed from the account's closed-trade history by the engine (data_engine/orders/sizing/mm).
import { getJSON, postJSON } from '../api.js';

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

/** Load the whole map from disk (name -> config). @returns {Promise<Record<string, MMConfig>>} */
export async function loadMMConfigs() {
  const s = await getJSON('/api/money-management');
  store = s && typeof s === 'object' ? s : {};
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

export const saveMMConfigs = () => postJSON('/api/money-management', store);
