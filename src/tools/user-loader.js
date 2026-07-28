// @ts-check
// Loads tool FOLDER PACKAGES from packages/tools/<id>/ by dynamic ES-module import (no
// build step). Each package: <id>.js (self-registers) + optional icon PNG (named in meta.json)
// + optional vocab.json. Maps tool id -> folder (for edit/delete/reload) and id -> package icon url.
// The server lists the packages at /api/user-tools. (`file` in the API = the folder name.)
import { setRegisterHook, getTool } from './registry.js';
import { registerVocab } from '../i18n/i18n.js';
import { bus } from '../bus.js';
import { log } from '../dom.js';

/** @type {Map<string, string>} */
const folderOf = new Map();   // toolId -> folder name
/** @type {Map<string, string>} */
const iconOf = new Map();     // toolId -> package icon url (the file named in the package's meta.json)

/** @param {string} id @returns {string | undefined} */
export const fileForTool = (id) => folderOf.get(id);
/** @param {string} folder @returns {string | null} */
export const toolIdForFile = (folder) => { for (const [id, f] of folderOf) if (f === folder) return id; return null; };
export const listUserToolIds = () => [...folderOf.entries()].map(([id, folder]) => ({ id, file: folder }));
// the tool's packaged icon (the PNG named in meta.json's `icon` field, mapped per tool id at load)
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
  // Name/description come ONLY from the package's meta.json -- never the code. No meta -> blank.
  // Multi-tool folders (e.g. range) key their metadata by tool id; single-tool folders are flat.
  let meta = null;
  try { const r = await fetch('/packages/tools/' + folder + '/meta.json', { cache: 'no-store' }); if (r.ok) meta = await r.json(); } catch (_) {}
  for (const id of ids) {
    const tl = getTool(id);
    if (!tl) continue;
    const m = (meta && typeof meta[id] === 'object' && meta[id]) || meta || {};
    tl.name = m.name || ''; tl.description = m.description || '';
    // Default the toolbar button to the package icon named in meta.json -- per tool id for multi-tool
    // folders, else the folder's top-level icon. The user can still override it via Customize toolbar.
    const iconFile = m.icon || (meta && meta.icon) || '';
    if (iconFile) iconOf.set(id, '/packages/tools/' + folder + '/' + iconFile);
  }
  if (hasVocab) {
    // a tool can ship its own vocabulary; merge it as base words (user packs still override)
    try { const v = await fetch('/packages/tools/' + folder + '/vocab.json').then((r) => r.json()); registerVocab(v && v.words ? v.words : v); } catch (_) {}
  }
}

export async function loadUserTools() {
  /** @type {{ folder: string, hasVocab?: boolean }[]} */
  let tools = [];
  try { const d = await fetch('/api/user-tools').then((r) => r.json()); tools = d.tools || []; } catch (_) {}
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
