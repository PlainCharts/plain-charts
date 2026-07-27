// @ts-check
// Persistent cache of the learned trading-session open rule, keyed by `${broker}:${symbol}`. The rule is
// DST-STABLE (it's stored as an exchange-local time-of-day; the projection re-derives the UTC offset per
// date), so it changes only when an exchange revises its hours or a contract rolls to a different session
// -- essentially never. So there's no reason to re-learn it from a historical bar fetch on every chart
// open: we read it from this file (settings/market/market-hours.json) and only re-learn when the stored
// entry is missing or older than STALE_MS. That turns "a look-back fetch per pane, every open" into "one
// fetch per symbol every week or two, shared across every window and restart".
import { createStore } from '../store.js';

/** @typedef {{ hh: number, mm: number }} OpenRule */
/** @typedef {{ openRule: OpenRule, sessionLen?: number, learnedAt: number }} CachedHours */

const STALE_MS = 10 * 86400000;   // re-learn at most ~once every 10 days per symbol
const store = createStore('/api/market-hours', {});
let loaded = false;

// Load the file once at startup (call from app boot). Safe to call repeatedly.
export async function loadMarketHoursStore() {
  if (loaded) return;
  try { await store.load(); } catch (_) {}
  loaded = true;
}

// A fresh cached entry for this key, or null if missing/stale. { openRule:{hh,mm}, sessionLen, learnedAt }.
/** @param {string} key @returns {CachedHours | null} */
export function getCachedHours(key) {
  const e = store.get(key);
  if (!e || !e.openRule || !e.learnedAt) return null;
  if (Date.now() - e.learnedAt > STALE_MS) return null;
  return e;
}

// Persist a freshly learned rule (called after the model derives it from intraday bars).
/** @param {string} key @param {OpenRule} openRule @param {number} [sessionLen] */
export function putCachedHours(key, openRule, sessionLen) {
  if (!key || !openRule) return;
  store.set(key, { openRule, sessionLen, learnedAt: Date.now() });
}
