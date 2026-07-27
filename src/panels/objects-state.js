// @ts-check
// Object Manager shared state -- the single store for the panel's cross-module UI state
// (drag, selection, rename, engine routing). Every objects-* module reads/writes THIS
// instance; nothing keeps a shadow copy. Two dependency-inversion slots keep the module
// graph a DAG: the renderer (objects.js registers its render at init; actions/layers/menus
// call render()) and the menu closer (objects-menus.js registers closeObjMenu; actions
// close an open menu without importing the menus module).
import { getActivePane } from '../chart/layout.js';

// The vendored kapelka engine surface has no TS types here -- `any` at this boundary.
/** @typedef {any} Engine */
// A drop target while dragging tree rows.
/** @typedef {{ id: string, mode: 'into'|'before'|'after' }} DropTarget */

export const state = {
  /** @type {string|null} */ renamingId: null,        // node (drawing or folder) being renamed inline
  /** @type {string|null} */ dragId: null,            // node being dragged
  /** @type {Engine|null} */ dragEngine: null,        // the engine that owns the dragged node (DnD is within-surface)
  /** @type {DropTarget|null} */ dropTarget: null,    // { id, mode:'into'|'before'|'after' } or null (root)
  /** @type {Set<string>} */ selectedIds: new Set(),  // tree multi-selection (drawing or folder ids)
  /** @type {string|null} */ anchorId: null,          // anchor for Shift-range selection
  /** @type {string[]} */ flatOrder: [],              // flattened visible node ids (for Shift-range)
  // Every rendered node (drawing or folder) maps to the engine that owns it, so the global
  // drag/drop + folder operations target the right surface (main, compare, or a study pane).
  // Rebuilt each render. Within-surface only: a node can't move between engines.
  /** @type {Map<string, Engine>} */ engineById: new Map(),
  /** @type {HTMLInputElement|null} */ pendingFocus: null,   // rename input to focus after a render
  /** @type {HTMLElement|null} */ listEl: null,       // the permanent .obj-list element (drop-marker cleanup)
  seq: 0,                                             // folder id sequence
};

/** @returns {Engine} the active pane's drawing engine */
export const eng = () => { const p = getActivePane(); return p && p.drawings; };
/** @param {string} id @returns {Engine} */
export const engineOf = (id) => state.engineById.get(id) || eng();

// render-dispatch indirection: objects.js owns the render; everything else calls the slot
let renderer = () => {};
/** @param {() => void} fn */
export const setRenderer = (fn) => { renderer = fn; };
export const render = () => renderer();

let menuCloser = () => {};
/** @param {() => void} fn */
export const setMenuCloser = (fn) => { menuCloser = fn; };
export const closeMenu = () => menuCloser();
