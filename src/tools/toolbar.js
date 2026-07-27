// @ts-check
// Left toolbar UI: the bar shows the user's chosen tools (icon buttons, active
// highlight) plus the pinned platform-feature buttons (lock / trash / eye / magnet /
// sync) with their dropdown menus. The "build your own toolbar" manager lives in
// toolbar-manager.js and is passed the bar's renderer + the feature descriptors.
import { getTool } from './registry.js';
import { toolbarTools, iconFor, newDrawingSync, setNewDrawingSync, magnetMode, setMagnetMode, drawingsHidden, indicatorsHidden, setHideDrawings, setHideIndicators, drawingsLocked, setLockDrawings, featureOrder } from './toolbar-store.js';
import { getActiveTool, setActiveTool } from './controller.js';
import { toolIconUrl } from './user-loader.js';
import { openManager } from './toolbar-manager.js';
import { bus } from '../bus.js';
import { $ } from './../dom.js';
import { getAllPanes } from '../chart/layout.js';
import { themeIcon } from '../ui/icon.js';
import * as syncStore from './engine/sync-store.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup for tool tooltips + feature menus

/** @type {HTMLElement | null} */
let barEl = null;

/** @param {any} s @returns {boolean} */
const isImg = (s) => typeof s === 'string' && (s.startsWith('/') || s.startsWith('data:') || s.startsWith('http'));

/** @param {string} tag @param {string} [cls] @param {string} [txt] @returns {HTMLElement} */
const el2 = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

export function initToolbar() {
  barEl = $('toolbar');
  if (!barEl) return;
  bus.on('tool:active', renderBar);
  bus.on('icons:mask', renderBar);   // Settings > App > Theme toggled icon masking
  renderBar();
}

function renderBar() {
  if (!barEl) return;
  const bar = barEl;   // local alias so TS keeps the non-null narrowing inside callbacks below
  bar.innerHTML = '';
  toolbarTools().forEach((id) => {
    const tool = getTool(id);
    if (!tool) return;
    const b = document.createElement('button');
    b.className = 'tool-btn' + (getActiveTool() === id ? ' active' : '');
    b.title = t(tool.name);
    const ic = iconFor(id) || toolIconUrl(id);   // user override -> package icon -> glyph
    if (isImg(ic)) b.appendChild(themeIcon(ic, 22));
    else b.textContent = ic || tool.glyph || '•';
    b.onclick = () => setActiveTool(id);
    bar.appendChild(b);
  });
  const mgr = document.createElement('button');
  mgr.className = 'tool-btn tool-mgr'; mgr.title = t('Customize toolbar');
  { const g = document.createElement('span'); g.className = 'glyph-ico'; g.textContent = '⋯'; mgr.appendChild(g); }
  mgr.onclick = () => openManager(renderBar, FEATURES);
  bar.appendChild(mgr);

  // ---- Features (platform actions, not drawing tools) — pinned to the bottom,
  // rendered in the user's chosen order ----
  bar.appendChild((() => { const s = document.createElement('div'); s.className = 'tool-spacer'; return s; })());
  bar.appendChild((() => { const s = document.createElement('div'); s.className = 'tool-sep'; return s; })());
  featureOrder().forEach((id) => { const f = FEATURES[id]; if (f) bar.appendChild(f.build()); });
}

// a feature button (image icon) with a state class + click handler
/** @param {string} cls @param {string} src @param {string} title @param {boolean} active @param {(b: HTMLButtonElement) => void} onclick */
function featureBtn(cls, src, title, active, onclick) {
  const b = document.createElement('button');
  b.className = 'tool-btn ' + cls + (active ? ' active' : '');
  b.appendChild(themeIcon(src, 22)); b.title = t(title); b.onclick = () => onclick(b);
  return b;
}

// platform features (id -> { label/icon for the customize dialog, build() for the bar })
/** @typedef {import('./toolbar-manager.js').Feature} Feature */
/** @type {Record<string, Feature>} */
const FEATURES = {
  lock: {
    label: 'Lock drawings', icon: '/images/lock.png',
    build: () => featureBtn('tool-lock', '/images/lock.png', drawingsLocked() ? 'Unlock all drawings' : 'Lock all drawings', drawingsLocked(), () => {
      setLockDrawings(!drawingsLocked());
      if (drawingsLocked()) getAllPanes().forEach((p) => p.drawings && p.drawings.select(null));
      renderBar();
    }),
  },
  trash: {
    label: 'Remove', icon: '/images/trash.png',
    build: () => featureBtn('tool-trash', '/images/trash.png', 'Remove drawings / indicators', false, (b) => openTrashMenu(b)),
  },
  eye: {
    label: 'Hide', icon: '/images/visible.png',
    build: () => { const h = drawingsHidden() || indicatorsHidden(); return featureBtn('tool-eye', h ? '/images/invisible.png' : '/images/visible.png', 'Hide drawings / indicators', h, (b) => openEyeMenu(b)); },
  },
  magnet: {
    label: 'Magnet', icon: '/images/magnet.png',
    build: () => featureBtn('tool-magnet', '/images/magnet.png', t('Magnet') + ': ' + t(MAGNET_LABEL[magnetMode()]), magnetMode() !== 'off', (b) => openMagnetMenu(b)),
  },
  sync: {
    label: 'Sync new drawings', icon: '/images/link.png',
    build: () => featureBtn('tool-sync', '/images/link.png', t('New drawings') + ': ' + t(SYNC_LABEL[newDrawingSync()]), newDrawingSync() !== 'none', (b) => openSyncMenu(b)),
  },
};

// ---- shared feature-dropdown infrastructure: ONE open menu at a time, anchored to the
// right of its toolbar button, dismissed by a pointerdown outside (the four menus below
// were four hand-rolled copies of this open/close/away pattern) ----
/** @type {HTMLElement | null} */
let dropMenuEl = null;
/** @type {((e: PointerEvent) => void) | null} */
let dropAway = null;
function closeDropMenu() {
  if (dropAway) { document.removeEventListener('pointerdown', dropAway, true); dropAway = null; }
  if (dropMenuEl) { dropMenuEl.remove(); dropMenuEl = null; }
}
/** @param {HTMLElement} anchor @param {(m: HTMLElement) => void} build */
function dropMenu(anchor, build) {
  closeDropMenu();
  const m = el2('div', 'dwg-menu'); dropMenuEl = m;
  build(m);
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = (r.right + 6) + 'px';
  m.style.top = Math.min(r.top, window.innerHeight - m.offsetHeight - 6) + 'px';
  dropAway = (e) => { const tgt = /** @type {Node} */ (e.target); if (dropMenuEl && !dropMenuEl.contains(tgt) && tgt !== anchor) closeDropMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (dropAway), true), 0);
}
// a checked/plain clickable menu row shared by the menus below
/** @param {string} label @param {boolean} checked @param {() => void} fn */
function dropItem(label, checked, fn) {
  const row = el2('div', 'dwg-item');
  row.append(el2('span', 'dwg-check', checked ? '✓' : ''), el2('span', 'dwg-label', t(label)));
  row.onclick = () => { closeDropMenu(); fn(); renderBar(); };
  return row;
}

let trashGlobal = false;   // include globally-synced drawings in the removal?
/** @param {HTMLElement} anchor */
function openTrashMenu(anchor) {
  const panes = getAllPanes();
  const symbols = [...new Set(panes.map((p) => p.symbol))];
  // layout = local drawings on every pane + layout-synced drawings for shown symbols.
  // global = globally-synced drawings for shown symbols (only removed when opted in).
  const localCount = panes.reduce((s, p) => s + (p.drawings ? p.drawings.localCount() : 0), 0);
  const layoutSynced = symbols.flatMap((sym) => syncStore.forSymbolScope(sym, 'layout'));
  const globalSynced = symbols.flatMap((sym) => syncStore.forSymbolScope(sym, 'global'));
  const nD = localCount + layoutSynced.length + (trashGlobal ? globalSynced.length : 0);
  const nI = panes.reduce((s, p) => s + (p.studies ? p.studies.count() : 0), 0);
  const removeDrawings = () => {
    panes.forEach((p) => p.drawings && p.drawings.clearLocal());
    layoutSynced.forEach((d) => syncStore.remove(d.id));
    if (trashGlobal) globalSynced.forEach((d) => syncStore.remove(d.id));
  };
  const removeIndicators = () => panes.forEach((p) => p.studies && p.studies.clearAll());

  /** @param {number} n @param {string} w */
  const plur = (n, w) => `${n} ${t(w)}${n === 1 ? '' : 's'}`;
  dropMenu(anchor, (m) => {
    if (nD) m.appendChild(dropItem(t('Remove') + ' ' + plur(nD, 'drawing'), false, removeDrawings));
    if (nI) m.appendChild(dropItem(t('Remove') + ' ' + plur(nI, 'indicator'), false, removeIndicators));
    if (nD && nI) m.appendChild(dropItem(`${t('Remove')} ${plur(nD, 'drawing')} & ${plur(nI, 'indicator')}`, false, () => { removeDrawings(); removeIndicators(); }));
    if (!nD && !nI) m.appendChild(el2('div', 'dwg-head', t('Nothing to remove')));

    // scope toggle: layout-only (default) vs also include global drawings
    m.appendChild(el2('div', 'dwg-div'));
    const tog = document.createElement('div'); tog.className = 'dwg-item';
    const sw = document.createElement('span'); sw.className = 'dwg-switch' + (trashGlobal ? ' on' : '');
    tog.append(el2('span', 'dwg-label', t('Include global drawings') + (globalSynced.length ? ` (${globalSynced.length})` : '')), sw);
    tog.onclick = (e) => { e.stopPropagation(); trashGlobal = !trashGlobal; openTrashMenu(anchor); };   // re-render with new counts
    m.appendChild(tog);
  });
}

/** @param {HTMLElement} anchor */
function openEyeMenu(anchor) {
  /** @param {string} label @param {boolean} checked @param {() => void} onToggle */
  const item = (label, checked, onToggle) => dropItem(label, checked, () => { onToggle(); bus.emit('view:visibility'); });
  dropMenu(anchor, (m) => {
    m.appendChild(item('Hide drawings', drawingsHidden(), () => setHideDrawings(!drawingsHidden())));
    m.appendChild(item('Hide indicators', indicatorsHidden(), () => setHideIndicators(!indicatorsHidden())));
    const allOn = drawingsHidden() && indicatorsHidden();
    m.appendChild(item('Hide all', allOn, () => { const v = !allOn; setHideDrawings(v); setHideIndicators(v); }));
  });
}

/** @type {Record<string, string>} */
const MAGNET_LABEL = { off: 'Off', weak: 'Weak magnet', strong: 'Strong magnet' };
/** @param {HTMLElement} anchor */
function openMagnetMenu(anchor) {
  const cur = magnetMode();
  dropMenu(anchor, (m) => {
    m.appendChild(el2('div', 'dwg-head', t('Magnet')));
    Object.keys(MAGNET_LABEL).forEach((key) => m.appendChild(dropItem(MAGNET_LABEL[key], cur === key, () => setMagnetMode(key))));
  });
}

/** @type {Record<string, string>} */
const SYNC_LABEL = { none: 'No sync', layout: 'Sync in layout', global: 'Sync globally' };
/** @param {HTMLElement} anchor */
function openSyncMenu(anchor) {
  const cur = newDrawingSync();
  dropMenu(anchor, (m) => {
    m.appendChild(el2('div', 'dwg-head', t('New drawings')));
    Object.keys(SYNC_LABEL).forEach((key) => m.appendChild(dropItem(SYNC_LABEL[key], cur === key, () => setNewDrawingSync(key))));
  });
}
