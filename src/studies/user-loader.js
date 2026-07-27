// @ts-check
// Loads indicator packages from packages/studies/<id>/<id>.js by dynamic ES-module
// import (no build step). Each module runs Studies.register(); we diff the registry
// to map the new study id(s) back to their package folder (for edit/delete/reload).
import { setRegisterHook, getStudy } from './registry.js';
import { bus } from '../bus.js';
import { log } from '../dom.js';
import { IPC } from '../ipc-contract.js';

/** @type {Map<string, string>} */
const fileOf = new Map();   // studyId -> package folder id (e.g. "bollinger")

/** @param {string} id */
export const fileForStudy = (id) => fileOf.get(id);
// Absolute URL of a study's module file, for the off-thread StudyHost worker to dynamic-import (it registers
// the study in the worker realm, then runs its calc). Stable (no cache-bust) so the worker imports it once.
/** @param {string} id @returns {string | null} */
export const studyUrlFor = (id) => { const f = fileOf.get(id); return f ? new URL('/packages/studies/' + f + '/' + f + '.js', import.meta.url).href : null; };
/** @param {string} file @returns {string | null} */
export const studyIdForFile = (file) => { for (const [id, f] of fileOf) if (f === file) return id; return null; };
/** @param {string} id */
export const isUserStudy = (id) => fileOf.has(id);
export const listUserStudyIds = () => [...fileOf.entries()].map(([id, file]) => ({ id, file }));

/** @param {string} folder   package folder id (e.g. "bollinger") */
async function importFile(folder) {
  // capture exactly the ids this module registers — works whether they're new or
  // overwrite an existing study (an edit re-uses the same id).
  /** @type {string[]} */
  const ids = [];
  setRegisterHook((/** @type {string} */ id) => ids.push(id));
  try { await import('/packages/studies/' + folder + '/' + folder + '.js?t=' + Date.now()); }   // cache-bust so edits reload
  finally { setRegisterHook(null); }
  ids.forEach((id) => fileOf.set(id, folder));
  // Name/description come ONLY from the package's meta.json -- never the code. No meta -> blank.
  let meta = null;
  try { const r = await fetch('/packages/studies/' + folder + '/meta.json', { cache: 'no-store' }); if (r.ok) meta = await r.json(); } catch (_) {}
  for (const id of ids) { const st = getStudy(id); if (st) { st.name = (meta && meta.name) || ''; st.description = (meta && meta.description) || ''; } }
}

export async function loadUserStudies() {
  /** @type {{ id: string }[]} */
  let studies = [];
  try { studies = (await fetch('/api/user-studies').then((r) => r.json())).studies || []; } catch (_) {}
  for (const s of studies) {
    try { await importFile(s.id); }
    catch (e) { log('Indicator "' + s.id + '" failed to load: ' + (/** @type {any} */ (e).message || e), true); }
  }
}

// re-import after a save (registerStudy overwrites the same id)
/** @param {string} name */
export async function reloadUserFile(name) {
  [...fileOf.entries()].forEach(([id, f]) => { if (f === name) fileOf.delete(id); });
  await importFile(name);
  bus.emit('studies:reloaded');   // re-link live instances so edits apply on-chart
}

// The assistant (in the addon-host) wrote a study file; reload it here in the UI window so it applies on the
// charts without a manual refresh. Cross-window, so it reaches every open UI window.
try {
  const rc = new BroadcastChannel(IPC.ASSISTANT_RELOAD);
  rc.onmessage = (e) => { const m = /** @type {any} */ (e.data); if (m && m.file) reloadUserFile(m.file).catch((/** @type {any} */ err) => log('Assistant study load failed: ' + ((err && err.message) || err), true)); };
} catch (_) {}
