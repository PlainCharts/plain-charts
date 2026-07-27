// @ts-check
// Addon TOOLBAR state — which icon, what order, and any hotkey for each addon's rail button.
// Mirrors src/tools/toolbar-store.js. The addon's ON/OFF (enabled) state lives in the Node
// addon-host (settings/addons.json); this store only holds the presentation/arrangement so the
// rail and the manager agree. Backed by settings/addons-toolbar.json via the generic store.
import { createStore } from '../store.js';

/** @typedef {{ order: string[], icons: Record<string, string>, hotkeys: Record<string, string> }} AddonBar */

/** @type {AddonBar} */
const data = { order: [], icons: {}, hotkeys: {} };
const store = createStore('/api/addons-toolbar', { order: [], icons: {}, hotkeys: {} });

/** @returns {Promise<AddonBar>} */
export async function loadAddonBar() {
  const d = await store.load();
  data.order = Array.isArray(d.order) ? d.order.slice() : [];
  data.icons = d.icons || {};       // id -> PNG data URL (or '' / undefined for the letter badge)
  data.hotkeys = d.hotkeys || {};   // id -> combo string, e.g. 'Alt+1'
  return data;
}
const saveOrder = () => store.set('order', data.order);

// ---- icon (a normalized PNG data URL; absent -> the manager/rail draw a letter badge) ----
/** @param {string} id @returns {string | undefined} */
export const iconFor = (id) => data.icons[id];
/** @param {string} id @param {string | null | undefined} dataUrl */
export function setIcon(id, dataUrl) {
  if (dataUrl) data.icons[id] = dataUrl; else delete data.icons[id];
  store.set('icons', data.icons);
}

// ---- hotkey ----
/** @param {string} id @returns {string} */
export const hotkeyFor = (id) => data.hotkeys[id] || '';
/** @param {string} id @param {string | null | undefined} combo */
export function setHotkey(id, combo) {
  if (combo) data.hotkeys[id] = combo; else delete data.hotkeys[id];
  store.set('hotkeys', data.hotkeys);
}

// ---- order: a saved id list; unknown/new ids sort after, in their given order ----
/** @param {string[]} ids @returns {string[]} */
export function orderedIds(ids) {
  const known = data.order.filter((id) => ids.includes(id));
  const rest = ids.filter((id) => !known.includes(id));
  return [...known, ...rest];
}
/** @param {string} id @param {number} dir @param {string[]} allIds */
export function moveAddon(id, dir, allIds) {
  const ord = orderedIds(allIds);
  const i = ord.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ord.length) return;
  ord.splice(j, 0, ord.splice(i, 1)[0]);
  data.order = ord;
  saveOrder();
}
// Move `dragId` to sit immediately before/after `targetId` (drag-to-reorder).
/** @param {string} dragId @param {string} targetId @param {boolean} after @param {string[]} allIds */
export function placeAddon(dragId, targetId, after, allIds) {
  if (dragId === targetId) return;
  const ord = orderedIds(allIds);
  const from = ord.indexOf(dragId);
  if (from < 0) return;
  ord.splice(from, 1);
  let to = ord.indexOf(targetId);
  if (to < 0) { data.order = ord; saveOrder(); return; }
  if (after) to += 1;
  ord.splice(to, 0, dragId);
  data.order = ord;
  saveOrder();
}

// normalize an uploaded image file to a small square PNG data URL (for crisp rail icons)
/** @param {Blob} file @param {(dataUrl: string | null) => void} cb */
export function fileToIcon(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const N = 64;
      const c = document.createElement('canvas'); c.width = c.height = N;
      const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      const s = Math.min(N / img.width, N / img.height);
      const w = img.width * s, h = img.height * s;
      g.drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
      cb(c.toDataURL('image/png'));
    };
    img.onerror = () => cb(null);
    img.src = /** @type {string} */ (fr.result);
  };
  fr.onerror = () => cb(null);
  fr.readAsDataURL(file);
}
