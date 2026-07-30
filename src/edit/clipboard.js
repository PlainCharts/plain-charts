// @ts-check
// Copy / paste / select-all for drawing objects -- the ACTIVE-CHART orchestration + keyboard shortcuts. Ctrl+C
// copies the current selection into the in-memory clipboard; Ctrl+V pastes fresh copies onto the active chart and
// selects them; Ctrl+A selects every drawing on the active chart. Pasting goes through engine.add, so it's a normal
// undoable change. Keys are ignored while typing in inputs, and we only preventDefault when we actually act.
//
// The in-memory BUFFER + the pure copy op live in clip-buffer.js (a leaf, no chart import); this layer adds the
// active-pane resolution on top. That split keeps the module DAG acyclic (lint-enforced).
import { getActivePane } from '../chart/layout.js';
import { getTool } from '../tools/registry.js';
import { getSelectedDrawingIds } from '../panels/objects.js';
import { copyIds, getClip, getClipSource, hasClip, initBuffer } from './clip-buffer.js';

/** @returns {any} */
const activeEngine = () => {
  const p = getActivePane();
  return p && p.drawings;
};

/** @returns {boolean} */
function copy() {
  const e = activeEngine();
  if (!e) return false;
  // prefer the canvas selection (Ctrl+click multi-select); fall back to the object tree's multi-selection, then the
  // lone selected drawing.
  let ids = e.selectedIds().filter((/** @type {string} */ id) => e.get(id));
  if (!ids.length) ids = getSelectedDrawingIds().filter((/** @type {string} */ id) => e.get(id));
  if (!ids.length) ids = e.selectedId && e.get(e.selectedId) ? [e.selectedId] : [];
  return copyIds(e, ids);
}

// copy a single specific drawing on the active chart (used by the right-click menu's Copy)
/** @param {string} id @returns {boolean} */
export function copyDrawing(id) {
  const e = activeEngine();
  if (!e) return false;
  return copyIds(e, [id]);
}

// nudge the copy down ~0.2% in price so it doesn't sit exactly on the original
/** @param {any} points @returns {any} */
function offsetPoints(points) {
  if (!Array.isArray(points) || !points.length) return points;
  const avg = points.reduce((/** @type {number} */ s, /** @type {any} */ p) => s + (p.price || 0), 0) / points.length;
  const d = Math.abs(avg) * 0.002;
  return points.map((/** @type {any} */ p) => ({ ...p, price: (p.price || 0) - d }));
}

/** @returns {boolean} */
function paste() {
  const e = activeEngine();
  const clip = getClip();
  if (!e || !clip.length) return false;
  // nudge only when pasting back onto the SAME chart (so the copy doesn't sit exactly under the original); a
  // different chart / tab / window pastes at the exact copied coordinates.
  const sameChart = e === getClipSource();
  /** @type {string[]} */
  const ids = [];
  clip.forEach((o) => {
    const c = JSON.parse(JSON.stringify(o)); // deep copy so each paste is independent
    const { tool, ...rest } = c;
    if (!getTool(tool)) return;
    if (sameChart) rest.points = offsetPoints(rest.points);
    const nd = e.add(tool, { ...rest, z: e.nextZ() });
    if (nd) ids.push(nd.id);
  });
  if (ids.length === 1) e.select(ids[0]);
  else if (ids.length) e.setSelection(ids);
  return ids.length > 0;
}

// paste from the right-click menu; same path as Ctrl+V. Returns true if it placed anything.
/** @returns {boolean} */
export function pasteClipboard() {
  return paste();
}
// whether the clipboard currently holds any copied drawings (to enable the menu item)
/** @returns {boolean} */
export function hasClipboard() {
  return hasClip();
}

// Ctrl+A — select every drawing on the active chart (draw-kind, not hidden).
/** @returns {boolean} */
export function selectAll() {
  const e = activeEngine();
  if (!e) return false;
  const ids = e
    .objects()
    .filter((/** @type {any} */ d) => {
      const t = getTool(d.tool);
      return t && t.kind === 'draw' && !d.hidden;
    })
    .map((/** @type {any} */ d) => d.id);
  if (!ids.length) return false;
  if (ids.length === 1) e.select(ids[0]);
  else e.setSelection(ids);
  return true;
}

export function initClipboard() {
  initBuffer(); // set up the shared cross-window buffer (BroadcastChannel)

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const a = /** @type {HTMLElement | null} */ (document.activeElement);
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable))
      return;
    const k = e.key.toLowerCase();
    if (k === 'c' && !e.shiftKey) {
      if (copy()) e.preventDefault();
    } else if (k === 'v' && !e.shiftKey) {
      if (paste()) e.preventDefault();
    }
    // Ctrl+A over the chart selects all drawings; always preventDefault so it never falls through to the browser's
    // select-all-page-text.
    else if (k === 'a' && !e.shiftKey) {
      selectAll();
      e.preventDefault();
    }
  });
}
