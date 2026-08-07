// @ts-check
// Undo/redo for the drawing canvas. Snapshot-based: every committed drawing change
// (engine.persist / saveTree) records a JSON snapshot of the active chart's whole
// drawing set — local + synced drawings + the full layer set (every layer's folder
// tree), same serialization as Save/Load — onto a per-pane stack. Undo restores the
// previous snapshot; any new action drops the redo branch. In-memory only (cleared
// on reload), capped depth. Drawings are re-created under their ORIGINAL ids so
// tree refs in every layer stay valid across a restore.
// A restore suppresses the commit events it triggers so it never pollutes history.
//
// Scope is per active chart. Caveat: with two panes on the SAME symbol, a change
// to a shared (synced) drawing is recorded only on the pane that made it.
import { bus } from '../bus.js';
import { $ } from '../dom.js';
import { getActivePane } from '../chart/layout.js';
import { getTool } from '../tools/registry.js';

const FIELDS = ['tool', 'points', 'style', 'textStyle', 'text', 'name', 'hidden', 'locked', 'z', 'visibility', 'sync'];
const MAX = 100;
/**
 * One pane's undo history: a stack of drawing-set snapshots (JSON strings) and the
 * index of the currently-applied one.
 * @typedef {{ stack: string[], idx: number }} History
 */
/** @type {WeakMap<any, History>} */
const histories = new WeakMap(); // pane -> { stack: [snapJSON], idx }  (GC'd with the pane)
let restoring = false;

/** @param {any} pane @returns {string} */
function snapshot(pane) {
  const e = pane && pane.drawings;
  if (!e) return '{}';
  const drawings = e.objects().map((/** @type {any} */ d) => {
    const o = /** @type {Record<string, any>} */ ({ id: d.id });
    FIELDS.forEach((k) => {
      if (d[k] !== undefined) o[k] = d[k];
    });
    return o;
  });
  // main chart: the whole layer set (every layer's tree); no-layer surface (study board): its single tree
  const layers = e.layersSnapshot && e.layersSnapshot();
  return JSON.stringify(layers ? { drawings, layers } : { drawings, tree: e.getTree() });
}

/** @param {any} pane @param {string} snapJSON */
function restore(pane, snapJSON) {
  const e = pane && pane.drawings;
  if (!e) return;
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(snapJSON);
  } catch (_) {
    return;
  }
  restoring = true;
  try {
    e.clear();
    (data.drawings || []).forEach((/** @type {any} */ d) => {
      if (!d || !d.tool || !getTool(d.tool)) return;
      /** @type {Record<string, any>} */
      const params = { id: d.id }; // keep the original id — every layer's tree refs stay valid
      FIELDS.forEach((k) => {
        if (k !== 'tool' && d[k] !== undefined) params[k] = d[k];
      });
      e.add(d.tool, params);
    });
    if (data.layers) {
      // keep the user's current active layer when it still exists in the restored set —
      // undo restores the drawings/organization, not which layer they're working on
      const cur = e.layers() && e.layers().active;
      if (cur && (data.layers.list || []).some((/** @type {any} */ x) => x.id === cur)) data.layers.active = cur;
      e.loadLayerSet(data.layers);
    } else {
      const tree = e.getTree();
      tree.length = 0;
      (data.tree || []).forEach((/** @type {any} */ n) => tree.push(n));
      e.saveTree();
    }
  } finally {
    restoring = false;
  }
  bus.emit('objects:changed', { pane }); // refresh the object tree
}

/** @param {any} pane @returns {History} */
function ensure(pane) {
  let h = histories.get(pane);
  if (!h) {
    h = { stack: [snapshot(pane)], idx: 0 };
    histories.set(pane, h);
  }
  return h;
}

/** @param {any} pane */
function record(pane) {
  if (restoring || !pane || !pane.drawings) return;
  const h = ensure(pane);
  const snap = snapshot(pane);
  if (h.stack[h.idx] === snap) return; // nothing actually changed
  h.stack.length = h.idx + 1; // drop the redo branch
  h.stack.push(snap);
  if (h.stack.length > MAX) h.stack.shift();
  h.idx = h.stack.length - 1;
  updateButtons();
}

export function undo() {
  const p = getActivePane();
  const h = p && histories.get(p);
  if (!h || h.idx <= 0) return;
  h.idx -= 1;
  restore(p, h.stack[h.idx]);
  updateButtons();
}
export function redo() {
  const p = getActivePane();
  const h = p && histories.get(p);
  if (!h || h.idx >= h.stack.length - 1) return;
  h.idx += 1;
  restore(p, h.stack[h.idx]);
  updateButtons();
}

function updateButtons() {
  const p = getActivePane();
  const h = p && histories.get(p);
  const u = /** @type {HTMLButtonElement | null} */ ($('btnUndo'));
  const r = /** @type {HTMLButtonElement | null} */ ($('btnRedo'));
  if (u) u.disabled = !(h && h.idx > 0);
  if (r) r.disabled = !(h && h.idx < h.stack.length - 1);
}

export function initUndo() {
  bus.on('drawings:committed', (pane) => record(pane));
  bus.on('pane:active', () => {
    const p = getActivePane();
    if (p) ensure(p);
    updateButtons();
  });

  const u = $('btnUndo'),
    r = $('btnRedo');
  if (u) u.onclick = undo;
  if (r) r.onclick = redo;

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault();
      redo();
    }
  });

  const p = getActivePane();
  if (p) ensure(p); // seed the active chart's baseline
  updateButtons();
}
