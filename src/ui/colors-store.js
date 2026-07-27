// @ts-check
// User's saved custom colours — shared by every color picker in the app.
// Persisted to settings/colors.json.
import { createStore } from '../store.js';

/** @typedef {{ custom: string[] }} ColorsData */

const store = createStore('/api/colors', { custom: [] });
/** @type {ColorsData} */
let data = { custom: [] };

/** @returns {Promise<ColorsData>} */
export async function loadColors() {
  const d = await store.load();
  data.custom = Array.isArray(d.custom) ? d.custom.slice(0, 9) : [];   // trim any pre-existing overflow
  return data;
}
const save = () => store.set('custom', data.custom);

/** @returns {string[]} */
export const customColors = () => data.custom;
// newest first, deduped, capped at 9 (one palette-row wide) — a 10th pushes the oldest out
/** @param {string} v @returns {void} */
export function addColor(v) {
  if (!v) return;
  data.custom = [v, ...data.custom.filter((c) => c !== v)].slice(0, 9);
  save();
}
/** @param {string} v @returns {void} */
export function removeColor(v) {
  data.custom = data.custom.filter((c) => c !== v);
  save();
}
