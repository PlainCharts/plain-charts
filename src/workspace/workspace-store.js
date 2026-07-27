// @ts-check
// Workspace store: one workspace = one file under settings/workspaces/<id>.json, keyed by a
// stable id. A workspace IS the persistent memory -- its layout, panes, studies, drawings, object
// tree, ranges and settings all live in that one file, and it is AUTOSAVED continuously. Tabs are
// just viewports that load a workspace by id (see tabs.js); a workspace is never owned by a tab.
//
// File record shape:  { id, name, createdMs, updatedMs, ws }
//   where `ws` is exactly the getWorkspace()/applyWorkspace() shape from layout.js
//   (layout, sizes, grid?, sync, panes:[{symbol,tfId,broker,range,settings}], synced, trees).
import { getJSON, postJSON } from '../api.js';

// A stored workspace record: the durable file under settings/workspaces/<id>.json. `ws` is the
// serialized layout payload (getWorkspace()/applyWorkspace() shape from chart/layout.js). The index
// (listWorkspaces) also carries derived display fields (summary/isBoard) added server-side.
/**
 * @typedef {Object} Workspace
 * @property {string} id
 * @property {string} name
 * @property {number=} createdMs
 * @property {number=} updatedMs
 * @property {import('../chart/layout.js').Workspace=} ws
 * @property {string=} summary   index-only: short description for the manager list
 * @property {boolean=} isBoard  index-only: true when the workspace is a study board
 */

const EP = '/api/workspaces';

// unique-enough id for a filename; app runtime, so Date/Math are fine here.
/** @returns {string} */
function newId() {
  return 'ws_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// light index for the manager dialog: [{ id, name, createdMs, updatedMs, summary }]
/** @returns {Promise<Workspace[]>} */
export async function listWorkspaces() {
  const r = await getJSON(EP);
  return Array.isArray(r && r.workspaces) ? r.workspaces : [];
}

// full record { id, name, createdMs, updatedMs, ws } (or null if missing)
/** @param {string=} id @returns {Promise<Workspace|null>} */
export async function readWorkspace(id) {
  if (!id) return null;
  const r = await getJSON(EP + '/' + encodeURIComponent(id));
  return (r && r.id) ? r : null;
}

// create a brand-new workspace from a getWorkspace() payload; returns the stored record. An explicit
// `id` may be passed for singleton workspaces (e.g. a surface panel's stable per-kind id); omitted -> a
// fresh unique id.
/** @param {string=} name @param {import('../chart/layout.js').Workspace=} ws @param {string=} id @returns {Promise<Workspace>} */
export async function createWorkspace(name, ws, id) {
  const now = Date.now();
  const rec = { id: id || newId(), name: name || 'Untitled', createdMs: now, updatedMs: now, ws: ws || {} };
  await postJSON(EP + '/save', rec);
  return rec;
}

// AUTOSAVE: persist a workspace's current ws. Debounced PER id so rapid edits coalesce. createdMs
// is preserved by the caller passing the existing record's value (or omitted -> stamped once).
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const _timers = new Map();
/** @param {string=} id @param {string=} name @param {import('../chart/layout.js').Workspace=} ws @param {number=} createdMs @returns {void} */
export function saveWorkspace(id, name, ws, createdMs) {
  if (!id) return;
  clearTimeout(_timers.get(id));
  _timers.set(id, setTimeout(() => {
    postJSON(EP + '/save', { id, name: name || 'Untitled', createdMs: createdMs || Date.now(), updatedMs: Date.now(), ws: ws || {} });
  }, 300));
}

// flush any pending autosave for an id immediately (e.g. before closing a tab / switching away)
/** @param {string=} id @param {string=} name @param {import('../chart/layout.js').Workspace=} ws @param {number=} createdMs @returns {Promise<void>} */
export async function flushWorkspace(id, name, ws, createdMs) {
  if (!id) return;
  clearTimeout(_timers.get(id)); _timers.delete(id);
  await postJSON(EP + '/save', { id, name: name || 'Untitled', createdMs: createdMs || Date.now(), updatedMs: Date.now(), ws: ws || {} });
}

/** @param {string} id @param {string=} name @returns {Promise<Workspace|null>} */
export async function renameWorkspace(id, name) {
  const rec = await readWorkspace(id); if (!rec) return null;
  rec.name = name || rec.name; rec.updatedMs = Date.now();
  await postJSON(EP + '/save', rec);
  return rec;
}

/** @param {string} id @param {string=} newName @returns {Promise<Workspace|null>} */
export async function copyWorkspace(id, newName) {
  const rec = await readWorkspace(id); if (!rec) return null;
  const now = Date.now();
  const copy = { id: newId(), name: newName || (rec.name + ' copy'), createdMs: now, updatedMs: now, ws: rec.ws };
  await postJSON(EP + '/save', copy);
  return copy;
}

/** @param {string=} id @returns {Promise<void>} */
export async function deleteWorkspace(id) {
  if (!id) return;
  clearTimeout(_timers.get(id)); _timers.delete(id);
  await postJSON(EP + '/delete', { id });
}

/** @returns {Promise<any>} */
export function openWorkspacesFolder() { return postJSON(EP + '/open', {}); }
