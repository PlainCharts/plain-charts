// @ts-check
// Pacman — package manager, as an ADDON (experiment / walking skeleton). Clicking the rail icon opens an
// in-app dialog that fetches a curated repo's `index.json` catalog over raw.githubusercontent.com, lists
// packages by class in a Cinnamon-style row list, and installs / removes them.
//
// v0: browse + install + remove for STUDIES, reusing the app's existing /api/user-studies endpoints (install
// writes packages/studies/<id>/<id>.js, the app picks it up). It shows two sources merged: the remote catalog
// (installable) and what's actually installed on THIS system (via the class's local discovery endpoint), so a
// locally-authored study with no catalog entry still lists, marked installed. Config = repo URL only (each
// package's location in the repo is a known, carried in the catalog's `path`). Enough to FEEL the flow.
'use strict';

const DEFAULT_REPO = 'https://raw.githubusercontent.com/PlainCharts/plain-charts/main';

// The addon is eval'd with require() shimmed, so siblings load via dynamic import — kicked off at load,
// awaited in openModal. lang.js = language identity for vocab packs (Weblate DB + flag mapping);
// classes.js = the per-class capability tables (CATEGORIES, LOCAL discovery, install/uninstall endpoints);
// ui.js = the presentation layer (el, header drag, the injected stylesheet); actions.js = the install /
// uninstall actions (everything that writes to the library) + ghUrl.
// Relative specifiers so these resolve against THIS module in both contexts: the browser (served over
// http, absolute '/addons/...' happens to work) AND the Node addon-host (where a leading '/' is the
// filesystem root, not the app root -- absolute paths throw ERR_MODULE_NOT_FOUND there).
const langP = import('./lang.js');
const classesP = import('./classes.js');
const uiP = import('./ui.js');
const actionsP = import('./actions.js');

const cfg = {
  get repo() { return (localStorage.getItem('pacman.repo') || DEFAULT_REPO).replace(/\/+$/, ''); },
  set repo(v) { localStorage.setItem('pacman.repo', String(v || '').trim()); },
};

/** @type {HTMLElement|null} */
let overlay = null;
function closeModal() { if (overlay) { overlay.remove(); overlay = null; } }

/** @param {import('../../src/panels/addons.js').AddonApi} api */
async function openModal(api) {
  const t = api && api.t ? api.t : (/** @type {string} */ s) => s;
  const [{ loadLangs, langLabel }, { CATEGORIES, LOCAL }, { el, makeDraggable, injectCss }, { ghUrl, createActions }] = await Promise.all([langP, classesP, uiP, actionsP]);
  injectCss();
  closeModal();
  overlay = el('div', 'modal open'); overlay.style.zIndex = '90';
  const dlg = el('div', 'dialog pac-dialog');

  const head = el('div', 'pac-head');
  const search = /** @type {HTMLInputElement} */ (el('input', 'pac-search')); search.type = 'text'; search.placeholder = t('Search');
  const x = el('span', 'lib-x', '✕'); x.style.cursor = 'pointer';
  head.append(el('span', 'pac-title', 'Pacman'), search, x);

  // Local ⇄ Remote switcher under Search. Local = what's on this system; Remote = the repo catalog.
  const modebar = el('div', 'pac-modebar');
  const countLbl = el('span', 'pac-count', '');
  const sw = el('div', 'pac-switch');
  const swLocal = el('span'); swLocal.append(el('span', 'pac-ico pac-ico-desktop'), document.createTextNode(t('Local')));
  const swRemote = el('span'); swRemote.append(el('span', 'pac-ico pac-ico-github'), document.createTextNode(t('Remote')));
  sw.append(swLocal, swRemote); modebar.append(countLbl, sw);

  const status = el('div', 'pac-status', '');
  const list = el('div', 'pac-list');
  const cfgPane = el('div', 'pac-cfg');
  const cats = el('div', 'pac-cats');

  // Controls swap by mode. Local: Settings · Install · Uninstall · Refresh. Remote: Github · Settings
  // (no uninstall — Remote never deletes; no refresh — the catalog is fetched fresh every time Pacman opens).
  const ctrl = el('div', 'pac-ctrl');
  const githubBtn = el('button', 'pac-btn'); githubBtn.title = t('Open repo folder on GitHub'); githubBtn.appendChild(el('span', 'pac-ico pac-ico-ext'));
  const installBtn = el('button', 'pac-btn', '⤓'); installBtn.title = t('Install from disk'); installBtn.style.fontSize = '17px';
  const rmBtn = el('button', 'pac-btn'); rmBtn.title = t('Uninstall'); rmBtn.appendChild(el('span', 'pac-ico pac-ico-min'));
  const cfgBtn = el('button', 'pac-btn'); cfgBtn.title = t('Settings'); cfgBtn.appendChild(el('span', 'pac-ico pac-ico-set'));
  const refBtn = el('button', 'pac-btn'); refBtn.title = t('Refresh'); refBtn.appendChild(el('span', 'pac-ico pac-ico-ref'));
  function renderCtrl() {
    ctrl.innerHTML = '';
    if (state.mode === 'local') ctrl.append(installBtn, rmBtn, cfgBtn, refBtn);
    else ctrl.append(githubBtn, cfgBtn);
  }

  dlg.append(head, modebar, status, list, cfgPane, cats, ctrl);
  overlay.appendChild(dlg); document.body.appendChild(overlay);
  makeDraggable(dlg, head);   // drag the dialog by its header

  const state = { mode: /** @type {'local'|'remote'} */ ('remote'), catalog: /** @type {any[]} */ ([]), installed: new Set(), installedMeta: /** @type {Map<string,any>} */ (new Map()), localCounts: /** @type {Record<string,number>} */ ({}), category: 'studies', sel: /** @type {any} */ (null), q: '' };
  const setStatus = (/** @type {string} */ m) => { status.textContent = m || ''; };

  // Installed count per class, for the Local-mode category badges. Only classes with a local source report.
  async function loadLocalCounts() {
    const counts = /** @type {Record<string,number>} */ ({});
    for (const key of Object.keys(LOCAL)) {
      try { counts[key] = (await /** @type {any} */ (LOCAL)[key]()).length; } catch (_) { counts[key] = 0; }
    }
    state.localCounts = counts;
  }
  // What's installed on this system for the current class (empty for classes without a local endpoint yet).
  async function loadInstalled() {
    state.installed = new Set(); state.installedMeta = new Map();
    const src = /** @type {any} */ (LOCAL)[state.category];
    if (!src) return;
    try {
      for (const row of await src()) { state.installed.add(row.id); state.installedMeta.set(row.id, row); }
    } catch (_) {}
  }
  // THE reload-and-rerender chain: pull the local truth again, then repaint badges + list. Every mutation
  // (install / uninstall / category switch / refresh) funnels through here.
  async function refresh() { await loadInstalled(); await loadLocalCounts(); renderCats(); renderList(); }
  const { install, uninstall, installFromDisk } = createActions({ t, cfg, state, setStatus, refresh });

  // Rows for the active mode. Remote = the repo catalog for this class. Local = what's installed on this
  // system for this class (from its discovery endpoint). The two are never mixed.
  function itemsFor() {
    if (state.mode === 'remote') {
      const rows = state.catalog.filter((p) => p.class === state.category);
      // vocab is code-named with no indexed metadata; Pacman names it from the bundled language DB.
      return state.category === 'vocab' ? rows.map((p) => ({ ...p, ...langLabel(p.id) })) : rows;
    }
    return [...state.installedMeta.values()]
      .map((m) => ({ class: state.category, id: m.id, name: m.name || m.id, description: m.description || '', icon: m.icon || '', _local: true }));
  }
  const selectedPkg = () => itemsFor().find((p) => p.id === state.sel) || null;
  function renderSwitch() {
    swLocal.classList.toggle('on', state.mode === 'local');
    swRemote.classList.toggle('on', state.mode === 'remote');
  }
  async function setMode(/** @type {'local'|'remote'} */ m) {
    if (state.mode === m) return;
    state.mode = m; state.sel = null;
    if (m === 'local') await loadLocalCounts();
    renderSwitch(); renderCtrl(); renderCats(); renderList();
  }
  swLocal.onclick = () => setMode('local');
  swRemote.onclick = () => setMode('remote');
  async function loadCatalog() {
    setStatus(t('Loading catalog') + '…');
    try {
      const r = await fetch(cfg.repo + '/index.json', { cache: 'no-store' }).then((x) => x.json());
      state.catalog = Array.isArray(r.packages) ? r.packages : [];
      setStatus('');   // the per-view count lives in the modebar; the status line is for messages only
    } catch (_) { state.catalog = []; setStatus(t('Could not load') + ' ' + cfg.repo + '/index.json'); }
  }
  function renderCats() {
    cats.innerHTML = '';
    for (const c of CATEGORIES) {
      const count = state.mode === 'remote' ? state.catalog.filter((p) => p.class === c.key).length : (state.localCounts[c.key] || 0);
      const b = el('div', 'pac-cat' + (state.category === c.key ? ' sel' : ''), t(c.name) + (count ? ' (' + count + ')' : ''));
      b.onclick = async () => { state.category = c.key; state.sel = null; await refresh(); };
      cats.appendChild(b);
    }
  }
  // Is this id available in the remote catalog for the active class? A local package that also lives in the
  // repo is marked "From repo" so its origin is legible (vs. one authored or dropped in by hand).
  function inCatalog(/** @type {string} */ id) { return state.catalog.some((c) => c.class === state.category && c.id === id); }
  function renderCount(/** @type {number} */ n) {
    countLbl.textContent = state.mode === 'local' ? n + ' ' + t('installed') : n + ' ' + t('available');
  }
  function renderList() {
    list.innerHTML = '';
    const q = state.q.toLowerCase();
    const items = itemsFor()
      .filter((p) => !q || (p.name + ' ' + p.id + ' ' + (p.description || '')).toLowerCase().includes(q));
    renderCount(items.length);
    if (!items.length) {
      const msg = q ? t('No matches') : (state.mode === 'local' ? t('Nothing installed yet') : t('The catalog is empty'));
      list.appendChild(el('div', 'pac-status', msg)); return;
    }
    for (const p of items) {
      const installed = state.installed.has(p.id);
      const row = el('div', 'pac-row' + (state.sel === p.id ? ' sel' : ''));
      // A thumbnail only when the package carries an image (tools/addons ship one; studies etc. don't).
      // Local rows already hold a full icon URL; remote rows carry a bare filename in `icon` + the package's
      // `path`, so build repo/path/icon. No image -> no placeholder graphic.
      const img = p._local ? (p.icon || '')
        : (p.icon ? (p.icon.startsWith('/') ? p.icon : `${cfg.repo}/${p.path}/${p.icon}`) : '');
      const body = el('div', 'pac-body');
      const name = el('div', 'pac-name'); name.append(document.createTextNode(p.name || p.id));
      if (p.author) name.appendChild(el('span', 'pac-by', ' ' + t('by') + ' ' + p.author));
      body.append(name, el('div', 'pac-id', p.id), el('div', 'pac-desc', p.description || ''));
      if (img) {
        // Flags stay colourful; package line-icons are masked to the theme's --icon colour so they adapt
        // to light/dark instead of rendering as a dark PNG that vanishes on a dark theme.
        const isFlag = p.class === 'vocab';
        const thumb = el('div', 'pac-thumb' + (isFlag ? ' pac-flag' : ' pac-mask'));
        if (isFlag) thumb.style.backgroundImage = `url(${img})`;
        else thumb.style.webkitMaskImage = thumb.style.maskImage = `url(${img})`;
        row.append(thumb);
      }
      row.append(body);
      if (state.mode === 'local' && inCatalog(p.id)) row.append(el('span', 'pac-badge', t('From repo')));
      // The per-row action button belongs to Remote only: ⤓ downloads into the library, ✓ marks an item
      // already installed. In Local every row is installed by definition, so no button — select + Uninstall.
      if (state.mode === 'remote') {
        const act = el('div', 'pac-act');
        // A package that ships an info.md gets a link to its rendered GitHub page, next to the install action.
        if (p.info && p.path) {
          const info = el('button', 'pac-btn'); info.title = t('Read more on GitHub');
          info.appendChild(el('span', 'pac-ico pac-ico-info'));
          info.onclick = (e) => { e.stopPropagation(); window.open(ghUrl(cfg.repo, 'blob', p.path + '/' + p.info), '_blank'); };
          act.appendChild(info);
        }
        const btn = el('button', 'pac-btn' + (installed ? ' on' : ''), installed ? '✓' : '⤓');
        btn.title = installed ? t('In your library — remove it from Local') : t('Download and install');
        btn.onclick = (e) => { e.stopPropagation(); if (installed) setStatus(t('Already installed — switch to Local to remove it')); else install(p); };
        act.appendChild(btn);
        row.append(act);
      }
      row.onclick = () => { state.sel = p.id; renderList(); };
      list.appendChild(row);
    }
  }
  function renderConfig() {
    cfgPane.innerHTML = '';
    const repoL = el('label'); repoL.append(el('span', null, t('Repository (raw base URL)')));
    const repoI = /** @type {HTMLInputElement} */ (el('input')); repoI.value = cfg.repo; repoL.appendChild(repoI);
    const save = el('button', 'primary', t('Save'));
    save.onclick = async () => { cfg.repo = repoI.value; cfgPane.classList.remove('show'); await loadCatalog(); renderCats(); renderList(); };
    cfgPane.append(repoL, save);
  }

  // Open the selected package's folder on GitHub, derived from the repo URL + the package's path.
  githubBtn.onclick = () => {
    const p = selectedPkg();
    if (!p || !p.path) { setStatus(t('Select a package first')); return; }
    window.open(ghUrl(cfg.repo, 'tree', p.path), '_blank');
  };
  installBtn.onclick = () => installFromDisk();
  rmBtn.onclick = async () => {
    const p = selectedPkg();
    if (!p || !state.installed.has(p.id)) { setStatus(t('Select an installed package')); return; }
    const msg = t('Remove') + ' "' + (p.name || p.id) + '" ' + t('from your library? This removes it permanently.');
    let ok;
    try { const m = await import('/src/ui/confirm.js'); ok = await m.confirmDialog({ title: t('Uninstall'), message: msg, yes: t('Uninstall'), no: t('Cancel') }); }
    catch (_) { ok = window.confirm(msg); }
    if (ok) uninstall(p);
  };
  cfgBtn.onclick = () => { renderConfig(); cfgPane.classList.toggle('show'); };
  refBtn.onclick = async () => { await loadCatalog(); await refresh(); };
  search.oninput = () => { state.q = search.value; renderList(); };
  x.onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  await loadLangs();   // language DB for vocab naming (local + remote), before any discovery runs
  await loadCatalog();
  await loadInstalled();
  await loadLocalCounts();
  renderSwitch();
  renderCtrl();
  renderCats();
  renderList();
}

module.exports = {
  popup: true,   // rail icon -> we immediately open the full dialog and dismiss the popup

  /** @param {HTMLElement} root @param {import('../../src/panels/addons.js').AddonApi} api */
  ui(root, api) {
    openModal(api);
    // The browse experience is the modal, not the framework's little popup shell. Hide the shell instantly
    // (no flash), then dismiss it only AFTER the host finishes wiring its outside-click handler — which it
    // does on a 0ms timer after ui() returns. Closing sooner leaves that handler orphaned, and it then eats
    // the next rail-icon click (so Pacman won't reopen). Two nested timers run us after that setup completes.
    const shell = /** @type {HTMLElement|null} */ (root && root.closest ? root.closest('.addon-popup') : null);
    if (shell) shell.style.display = 'none';
    if (api && api.close) setTimeout(() => setTimeout(() => api.close(), 0), 0);
  },

  /** @param {any} ctx */
  start(ctx) { try { ctx.log('pacman addon ready'); } catch (_) {} },
  stop() { closeModal(); },
};
