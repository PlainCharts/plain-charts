// @ts-check
// The install / uninstall actions — everything that WRITES to the library. Remote install (fetch the runtime,
// POST it), uninstall (the class's delete endpoint), and install-from-disk (folder tree or single file).
// The dialog gathers and dispatches; the deciding lives here. Each action ends with ctx.refresh() — the
// dialog's reload-and-rerender chain — then a status line.
import { el } from './ui.js';
import { INSTALL_EP, INSTALL_FILE_EP, UNINSTALL_EP } from './classes.js';

// Turn the raw base (raw.githubusercontent.com/<owner>/<repo>/<branch>) into a browsable github.com URL.
// verb = 'tree' for a folder, 'blob' for a file. Falls back to the raw base when it isn't a github raw URL.
/** @param {string} repo @param {'tree'|'blob'} verb @param {string} sub */
export function ghUrl(repo, verb, sub) {
  const m = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)/.exec(repo);
  const base = m ? `https://github.com/${m[1]}/${m[2]}/${verb}/${m[3]}` : repo;
  return base + '/' + sub;
}

/**
 * The actions bound to one open dialog.
 * @param {{ t: (s:string)=>string, cfg: {repo:string}, state: {category:string, sel:any},
 *   setStatus: (m:string)=>void, refresh: ()=>Promise<void> }} ctx
 */
export function createActions({ t, cfg, state, setStatus, refresh }) {
  const IMG_RE = /\.(png|jpe?g|gif|webp|ico|svg)$/i;
  // Remote install. Folder classes (studies/tools/addons/adapters/primitives): fetch every file in the
  // catalog manifest and POST the tree to the class's /package endpoint (paths prefixed with <id>/, images
  // as base64). File classes (themes/chart-themes/vocab): fetch the single JSON and save it via the
  // folder-library endpoint; vocab is stored as a {name, words} pack.
  async function install(/** @type {any} */ p) {
    const folderEp = INSTALL_EP[p.class];
    const fileEp = INSTALL_FILE_EP[p.class];
    if (!folderEp && !fileEp) { setStatus(t('Install is not available for this class yet')); return; }
    setStatus(t('Installing') + ' ' + p.id + '…');
    try {
      if (folderEp) {
        const rels = (Array.isArray(p.files) && p.files.length) ? p.files : [p.runtime];
        const files = [];
        for (const rel of rels) {
          const url = cfg.repo + '/' + p.path + '/' + rel;
          const dest = p.id + '/' + rel;
          if (IMG_RE.test(rel)) {
            const resp = await fetch(url, { cache: 'no-store' });
            const bytes = new Uint8Array(await resp.arrayBuffer());
            let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            files.push({ path: dest, b64: btoa(bin) });
          } else {
            files.push({ path: dest, text: await fetch(url, { cache: 'no-store' }).then((x) => x.text()) });
          }
        }
        const r = await fetch(folderEp, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, files }) }).then((x) => x.json());
        if (r && r.error) { setStatus(t('Install failed') + ': ' + r.error); return; }
      } else {
        const obj = await fetch(cfg.repo + '/' + p.path + '/' + p.runtime, { cache: 'no-store' }).then((x) => x.json());
        const name = (obj && obj.name) || p.id;
        const data = p.class === 'vocab'
          ? { words: (obj && obj.words && typeof obj.words === 'object') ? obj.words : obj }
          : (() => { const o = Object.assign({}, obj); delete o.name; return o; })();
        const r = await fetch(fileEp.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data }) }).then((x) => x.json());
        if (r && r.error) { setStatus(t('Install failed') + ': ' + r.error); return; }
      }
      await refresh(); setStatus(t('Installed') + ' ' + p.id);
    } catch (e) { setStatus(t('Install failed') + ': ' + ((e && /** @type {any} */ (e).message) || e)); }
  }
  async function uninstall(/** @type {any} */ p) {
    const ep = UNINSTALL_EP[state.category];
    if (!ep) { setStatus(t('Uninstall is not available for this class yet')); return; }
    setStatus(t('Removing') + ' ' + p.id + '…');
    try {
      await fetch(ep.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [ep.field]: p.id }) });
      state.sel = null;
      await refresh(); setStatus(t('Removed') + ' ' + p.id);
    } catch (_) { setStatus(t('Remove failed')); }
  }
  // Local Install: pick a study PACKAGE FOLDER; the node server writes the whole folder into the library,
  // tree intact (each file at its relative path, so nested dirs like locales/ survive). The folder name is
  // the package id; the app picks it up on reload.
  function installFromDisk() {
    const ep = INSTALL_EP[state.category];
    if (ep) return installFolder(ep);
    const fep = INSTALL_FILE_EP[state.category];
    if (fep) return installFile(fep);
    setStatus(t('Install from disk is not available for this class yet'));
  }
  // Single-file classes (themes, …): pick one file, parse it, save via the folder-library endpoint.
  function installFile(/** @type {{url:string,accept:string}} */ fep) {
    const inp = /** @type {HTMLInputElement} */ (el('input')); inp.type = 'file'; inp.accept = fep.accept;
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      setStatus(t('Installing') + ' ' + f.name + '…');
      try {
        const obj = JSON.parse(await f.text());
        const name = obj.name || f.name.replace(/\.[^.]+$/, '');
        const data = state.category === 'vocab'
          ? { words: (obj && obj.words && typeof obj.words === 'object') ? obj.words : obj }
          : (() => { const o = Object.assign({}, obj); delete o.name; return o; })();
        const r = await fetch(fep.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data }) }).then((x) => x.json());
        if (r.error) { setStatus(t('Install failed') + ': ' + r.error); return; }
        await refresh(); setStatus(t('Installed') + ' ' + name);
      } catch (e) { setStatus(t('Install failed') + ': ' + ((e && /** @type {any} */ (e).message) || e)); }
    };
    inp.click();
  }
  // Folder classes: pick a folder, copy the whole tree into the library via its package endpoint.
  function installFolder(/** @type {string} */ ep) {
    const inp = /** @type {HTMLInputElement} */ (el('input')); inp.type = 'file'; inp.multiple = true; inp.setAttribute('webkitdirectory', '');
    inp.onchange = async () => {
      const all = [...(inp.files || [])];
      if (!all.length) return;
      const id = (all[0].webkitRelativePath || all[0].name).split('/')[0];   // the picked folder's name = the id
      setStatus(t('Installing') + ' ' + id + '…');
      try {
        const files = [];
        for (const f of all) {
          const rel = f.webkitRelativePath || f.name;
          if (/\.(png|jpe?g|gif|webp|ico|svg)$/i.test(rel)) {
            const bytes = new Uint8Array(await f.arrayBuffer());
            let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            files.push({ path: rel, b64: btoa(bin) });
          } else {
            files.push({ path: rel, text: await f.text() });
          }
        }
        const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, files }) }).then((x) => x.json());
        if (r.error) { setStatus(t('Install failed') + ': ' + r.error); return; }
        await refresh(); setStatus(t('Installed') + ' ' + id);
      } catch (e) { setStatus(t('Install failed') + ': ' + ((e && /** @type {any} */ (e).message) || e)); }
    };
    inp.click();
  }
  return { install, uninstall, installFromDisk };
}
