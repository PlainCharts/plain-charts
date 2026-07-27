// @ts-check
// The per-class capability tables — one home for what content classes exist, how each is discovered on THIS
// system, and which endpoints install / uninstall it. A class appears in a table only once the app end
// exists; the rest stay catalog-only / view-only until it does.
import { langLabel } from './lang.js';

export const CATEGORIES = [
  { key: 'studies', name: 'Studies' }, { key: 'addons', name: 'Addons' }, { key: 'tools', name: 'Tools' }, { key: 'adapters', name: 'Adapters' },
  { key: 'themes', name: 'App Themes' }, { key: 'chart-themes', name: 'Chart Themes' }, { key: 'vocab', name: 'Vocabulary' }, { key: 'primitives', name: 'Primitives' },
];

// Local discovery: what's installed on THIS system, per class. Each returns [{id, name}]. Only classes with a
// glob endpoint appear; the rest are catalog-only until an endpoint exists. Studies is the walking skeleton.
export const LOCAL = {
  /** @returns {Promise<{id:string,name:string}[]>} */
  async studies() {
    const r = await fetch('/api/user-studies', { cache: 'no-store' }).then((x) => x.json());
    return (r.studies || []).map((/** @type {any} */ s) => ({ id: s.id, name: s.name || s.id, description: s.description || '', icon: s.icon || '' }));
  },
  /** @returns {Promise<{id:string,name:string}[]>} */
  async themes() {
    const r = await fetch('/api/themes', { cache: 'no-store' }).then((x) => x.json());
    return (r.themes || []).map((/** @type {any} */ th) => ({ id: th.name, name: th.name, description: th.description || '' }));
  },
  /** @returns {Promise<{id:string,name:string}[]>} */
  'chart-themes': async () => {
    const r = await fetch('/api/chart-themes', { cache: 'no-store' }).then((x) => x.json());
    return (r.themes || []).map((/** @type {any} */ th) => ({ id: th.name, name: th.name, description: th.description || '' }));
  },
  /** @returns {Promise<{id:string,name:string}[]>} */
  async tools() {
    const r = await fetch('/api/user-tools', { cache: 'no-store' }).then((x) => x.json());
    return (r.tools || []).map((/** @type {any} */ tl) => ({ id: tl.folder, name: tl.name || tl.folder, description: tl.description || '', icon: tl.icon ? '/packages/tools/' + tl.folder + '/' + tl.icon : '' }));
  },
  /** @returns {Promise<{id:string,name:string}[]>} */
  async addons() {
    const r = await fetch('/api/addons', { cache: 'no-store' }).then((x) => x.json());
    return (r.addons || []).map((/** @type {any} */ a) => ({ id: a.id, name: a.name || a.id, description: a.description || '', icon: a.hasIcon ? '/addons/' + a.id + '/icon.png' : '' }));
  },
  /** @returns {Promise<{id:string,name:string}[]>} */
  async vocab() {
    const r = await fetch('/api/vocab', { cache: 'no-store' }).then((x) => x.json());
    // packs are code-named (v.name = 'es'); Pacman names the language from the bundled DB, same as remote.
    return (r.packs || []).map((/** @type {any} */ v) => ({ id: v.name, ...langLabel(v.name) }));
  },
  /** @returns {Promise<{id:string,name:string}[]>} */
  async adapters() {
    const r = await fetch('/api/adapters', { cache: 'no-store' }).then((x) => x.json());
    return (r.adapters || []).map((/** @type {any} */ a) => ({ id: a.id, name: a.name || a.id, description: a.description || '', icon: a.icon || '' }));
  },
  /** @returns {Promise<{id:string,name:string}[]>} */
  async primitives() {
    const r = await fetch('/api/user-order-primitives', { cache: 'no-store' }).then((x) => x.json());
    return (r.primitives || []).map((/** @type {any} */ p) => ({ id: p.id, name: p.name || p.id, description: p.description || '', icon: p.icon || '' }));
  },
};

// Per-class LOCAL install (folder-package endpoint) and uninstall (delete endpoint + the id field it wants).
// A class appears here only once both ends exist; the rest stay view-only.
// Folder classes: pick a folder, copy the whole tree into the library.
export const INSTALL_EP = /** @type {Record<string,string>} */ ({ studies: '/api/user-studies/package', addons: '/api/addons/package', tools: '/api/user-tools/package', adapters: '/api/adapters/package', primitives: '/api/user-order-primitives/package' });
// Single-file classes: pick one file, save it via the folder-library endpoint ({name, data}).
export const INSTALL_FILE_EP = /** @type {Record<string,{url:string,accept:string}>} */ ({ themes: { url: '/api/themes/save', accept: '.json' }, 'chart-themes': { url: '/api/chart-themes/save', accept: '.json' } });
export const UNINSTALL_EP = /** @type {Record<string,{url:string,field:string}>} */ ({
  studies: { url: '/api/user-studies/delete', field: 'name' },
  addons: { url: '/api/addons/delete', field: 'id' },
  tools: { url: '/api/user-tools/delete', field: 'name' },
  adapters: { url: '/api/adapters/delete', field: 'id' },
  primitives: { url: '/api/user-order-primitives/delete', field: 'id' },
  themes: { url: '/api/themes/delete', field: 'name' },
  'chart-themes': { url: '/api/chart-themes/delete', field: 'name' },
});
