// @ts-check
// Loads tool FOLDER PACKAGES from packages/tools/<id>/ by dynamic ES-module import (no
// build step). Each package: <id>.js (self-registers) + optional icon.png + optional
// vocab.json. Maps tool id -> folder (for edit/delete/reload) and id -> package icon url.
// The server lists the packages at /api/user-tools. (`file` in the API = the folder name.)
import { setRegisterHook } from './registry.js';
import { registerVocab } from '../i18n/i18n.js';
import { bus } from '../bus.js';
import { log } from '../dom.js';

/** @type {Map<string, string>} */
const folderOf = new Map();   // toolId -> folder name
/** @type {Map<string, string>} */
const iconOf = new Map();     // toolId/folder -> package icon url (folder has icon.png)

/** @param {string} id @returns {string | undefined} */
export const fileForTool = (id) => folderOf.get(id);
/** @param {string} folder @returns {string | null} */
export const toolIdForFile = (folder) => { for (const [id, f] of folderOf) if (f === folder) return id; return null; };
export const listUserToolIds = () => [...folderOf.entries()].map(([id, folder]) => ({ id, file: folder }));
// the tool's packaged icon (a folder's icon.png is the icon for the tool whose id === folder)
/** @param {string} id @returns {string | null} */
export const toolIconUrl = (id) => iconOf.get(id) || null;
// forget a tool's package icon (after its icon.png was deleted server-side) so toolIconUrl() stops returning it
/** @param {string} id */
export const clearToolIconUrl = (id) => { iconOf.delete(id); };

/** @param {string} folder @param {boolean} [hasVocab] */
async function importFolder(folder, hasVocab) {
  /** @type {string[]} */
  const ids = [];
  setRegisterHook((id) => ids.push(id));
  try { await import('/packages/tools/' + folder + '/' + folder + '.js?t=' + Date.now()); }
  finally { setRegisterHook(null); }
  ids.forEach((id) => folderOf.set(id, folder));
  if (hasVocab) {
    // a tool can ship its own vocabulary; merge it as base words (user packs still override)
    try { const v = await fetch('/packages/tools/' + folder + '/vocab.json').then((r) => r.json()); registerVocab(v && v.words ? v.words : v); } catch (_) {}
  }
}

export async function loadUserTools() {
  /** @type {{ folder: string, hasVocab?: boolean }[]} */
  let tools = [];
  /** @type {string[]} */
  let icons = [];
  try { const d = await fetch('/api/user-tools').then((r) => r.json()); tools = d.tools || []; icons = d.icons || []; } catch (_) {}
  icons.forEach((folder) => iconOf.set(folder, '/packages/tools/' + folder + '/icon.png'));
  for (const t of tools) {
    try { await importFolder(t.folder, t.hasVocab); }
    catch (/** @type {any} */ e) { log('Tool "' + t.folder + '" failed to load: ' + (e.message || e), true); }
  }
}

/** @param {string} folder */
export async function reloadUserToolFile(folder) {
  [...folderOf.entries()].forEach(([id, f]) => { if (f === folder) folderOf.delete(id); });
  await importFolder(folder, true);
  bus.emit('tools:reloaded');
}
