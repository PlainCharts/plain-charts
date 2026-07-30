// @ts-check
// Addons = first-class platform tools. Each enabled addon gets an ICON on the right rail
// (just above the camera/settings buttons); clicking it opens the addon's own UI — a floating,
// draggable, NON-modal window so you keep working the chart while it's open. The "Addons"
// dialog is now a Customize-toolbar-style manager: enable/disable, set an icon, set a hotkey,
// reorder, edit/reload/delete, write/import. The unrestricted runtime lives in the Node host;
// this is the control + presentation surface.
import { $ } from '../dom.js';
import { bus } from '../bus.js';
import { themeIcon } from '../ui/icon.js';
import { t, localizeDom, registerVocab, setAddonWords, getActiveLocale } from '../i18n/i18n.js'; // addons key their UI through api.t / api.localizeDom; each addon ships its OWN locales/ folder
import { openCodeEditor } from '../studies/editor.js';
import { broker, onRaw, platform, platformApiFor } from '../../data_engine/index.js'; // facade + raw tap + the platform services
import * as rp from './rightpanel.js';
import { makeChartApi } from '../addons/chart-api.js';
import { makeTradeApi } from '../addons/trade-api.js'; // trade-control surface: book read + plan state (+ worker command)
import { createWatcher } from '../addons/watcher.js'; // automated price-condition executor (rules engine)
import {
  loadAddonBar,
  iconFor,
  setIcon,
  hotkeyFor,
  setHotkey,
  orderedIds,
  placeAddon,
  fileToIcon,
} from '../addons/toolbar-store.js';
import { getSetting, setSetting } from '../settings/settings.js'; // persist which addon panels are docked (restore on restart)
import { makeDraggable } from '../ui/draggable.js';

// An addon record as the host reports it (/api/addons). Fields beyond these are addon-defined,
// so the shape stays loose at this boundary.
/**
 * @typedef {Object} Addon
 * @property {string} id
 * @property {string} name
 * @property {boolean=} enabled
 * @property {boolean=} running
 * @property {string=} error
 * @property {boolean=} hasIcon
 * @property {any=} config
 * @property {any[]=} inputs
 * @property {Record<string, Record<string, string>>=} locales   the addon's own per-language words (code -> { key: word })
 */
// An evaluated addon module (its CommonJS exports), read purely to drive its ui()/popup.
/** @typedef {any} AddonModule */

// The addon-specific half of the DI object (everything built here); the platform services
// (console/orders/fills/positions/accounts) are spread in from platformApiFor(), so the full
// injected shape is this intersected with that return type — see AddonApi below.
/**
 * @typedef {Object} AddonApiOwn
 * @property {string} id
 * @property {string} name
 * @property {any} config                                    the addon's saved config (a working copy)
 * @property {typeof broker} data                            the live broker feed
 * @property {ReturnType<typeof makeChartApi>} chart         read + draw on the active chart
 * @property {ReturnType<typeof makeTradeApi>} trade         order book read + plan state (+ worker command)
 * @property {(opts: any) => ReturnType<typeof createWatcher>} watcher   price-condition executor factory
 * @property {typeof onRaw} onRaw                            raw broker-feed tap
 * @property {(...m: any[]) => void} log                     console + platform-console logger
 * @property {(cfg: any) => Promise<void>} save             persist the addon's config server-side
 * @property {() => void} close                             close the addon's panel/popup
 * @property {(fn: () => void) => void} onClose             register a teardown callback
 * @property {(s: string) => string} t                      vocabulary lookup — the active pack (user + addon words), English fallback
 * @property {(root?: HTMLElement|Document) => void} localizeDom   localize a subtree tagged with data-i18n / -title / -ph
 * @property {(pack: Record<string, string>) => void} registerVocab   register this addon's own default words (base layer)
 */
// The whole DI object injected into every addon's ui(root, api) / popup — the addon's reach into
// the app. Exported so the addon files can annotate their `api` param with this instead of `any`
// (tracked debt: the 5 bundled addons currently type `api` as any).
/** @typedef {AddonApiOwn & ReturnType<typeof platformApiFor>} AddonApi */

/** @param {string} u @returns {Promise<any>} */
const getJSON = (u) =>
  fetch(u)
    .then((r) => r.json())
    .catch(() => ({}));
/** @param {string} u @param {any} b @returns {Promise<any>} */
const postJSON = (u, b) =>
  fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then((r) => r.json())
    .catch(() => ({}));
/**
 * @param {string} tag
 * @param {(string|null)=} cls
 * @param {(string|null)=} txt
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};
/** @param {string=} n */
const badgeText = (n) => ((n || '?').trim().charAt(0) || '?').toUpperCase();

const ADDON_TEMPLATE = `// Addon — FULL access, no sandbox: ctx.data (live broker feed: resolveSymbol /
// subscribeQuotes / subscribeBars / orders) PLUS require('fs'|'net'|'child_process'|
// 'https'…) for anything external (files, sockets, processes, bridges).
module.exports = {
  name: 'My Addon',

  // setup form (fallback) — types: text | number | bool | color | select(options).
  // Values arrive in ctx.config (defaults below, overridden by the saved settings).
  inputs: [
    { key: 'broker', label: 'Broker', type: 'text', default: '' },
    { key: 'symbol', label: 'Symbol', type: 'text', default: '' },
  ],

  // Your OWN UI — opened from the addon's rail icon. You get a BLANK root and a small api:
  //   api = { config, data (broker), chart, save(cfg), close(), log, onClose(fn) }
  //   chart: symbol()/timeframe()/visibleRange(), onCrosshair/onClick/onSymbolChange/
  //          onRangeChange/onActiveChange, priceLine(opts) -> { update, remove }
  ui(root, api) {
    const cfg = { ...api.config };
    const i = document.createElement('input'); i.value = cfg.symbol || '';
    i.onchange = () => { cfg.symbol = i.value; };
    const save = document.createElement('button'); save.textContent = 'Save';
    save.onclick = () => { api.save(cfg); };
    root.append('Symbol: ', i, ' ', save);
  },

  // ctx: { id, name, dir, config, log, data }
  start(ctx) {
    ctx.log('started', ctx.config);
    // const api = ctx.data.for(ctx.config.broker);
    // api.resolveSymbol(ctx.config.symbol, (inst) => api.subscribeQuotes(inst.id, (q) => ctx.log(q)));
  },

  stop() {
    // clean up timers / sockets / processes / subscriptions here
  },
};
`;

/** @type {HTMLElement|null} */
let panel = null; // the manager dialog (floating, non-modal)
/** @type {ReturnType<typeof setInterval>|null} */
let pollTimer = null;
/** @type {HTMLElement|null} */
let listEl = null;
/** @type {Addon[]} */
let cache = []; // last addon list from the host
/** @type {HTMLElement|null} */
let railWrap = null; // the #addon-rail container inside #rightrail
let mgrOpen = false;
/** @type {Map<string, { closeCbs: Array<() => void> }>} */
const panels = new Map(); // addon id -> { closeCbs } for its DOCKED slide-out panel
/** @type {{ id: string, menu: HTMLElement, closeCbs: Array<() => void>, away: (e: PointerEvent) => void }|null} */
let popupOpen = null; // { id, menu, closeCbs, away } for the one open POPUP addon, if any
let restoring = false; // true while re-docking persisted panels at startup (suppresses re-persist churn)

// Remember which addon panels are docked and whether each is shown, so a restart brings them back -- an addon's
// chart layer (e.g. the Order Ticket's position string) is created by its ui() and only exists once docked.
function persistDocked() {
  if (restoring) return;
  /** @type {Record<string, boolean>} */
  const state = {};
  for (const id of panels.keys()) state[id] = rp.isShown('addon:' + id);
  setSetting('dockedAddons', state);
}

export async function initAddons() {
  const btn = $('btnAddons');
  if (btn) btn.onclick = () => openAddons();
  await loadAddonBar();
  await refreshCache();
  renderAddonRail();
  window.addEventListener('keydown', onHotkey, true);
  bus.on('rightpanel:shown', renderAddonRail); // another view took the slot -> refresh our icons' active state
  // live vocabulary switch: re-pick each addon's active-language words, then refresh the app-owned addon
  // chrome (rail + open manager). A docked addon's own ui() body re-translates on its next open --
  // re-running it mid-session would tear its chart layer.
  bus.on('vocab:changed', () => {
    applyAddonLocale();
    renderAddonRail();
    if (mgrOpen && listEl) renderManager();
  });
  await restoreDocked(); // bring back the addon panels (and their chart layers) that were docked before the restart
}

// re-dock the panels that were open last session, restoring each one's shown/hidden state. A hidden restore
// still runs the addon's ui() -> its chart layer (position string) appears without the panel taking space.
async function restoreDocked() {
  const state = getSetting('dockedAddons');
  if (!state || typeof state !== 'object') return;
  restoring = true;
  try {
    for (const [id, shown] of Object.entries(state)) {
      const a = cache.find((x) => x.id === id && x.enabled);
      if (a && !panels.has(id)) {
        try {
          await openAddonUI(a, null, shown !== false);
        } catch (_) {}
      }
    }
  } finally {
    restoring = false;
    renderAddonRail();
  }
}

async function refreshCache() {
  const d = await getJSON('/api/addons');
  cache = d.addons || [];
  applyAddonLocale();
}

// Rebuild the addon-words layer for the ACTIVE language from each enabled addon's OWN locales/ folder.
// English (or a language an addon doesn't translate) -> the addon has no override, so api.t falls back
// to its English source literal. Called on load and on every language switch, so a pack change re-picks
// each addon's matching file live. An uninstalled addon isn't in `cache`, so its words simply vanish.
function applyAddonLocale() {
  const code = getActiveLocale();
  /** @type {Record<string, string>} */
  const merged = {};
  if (code)
    for (const a of cache) {
      const w = a.enabled && a.locales && a.locales[code];
      if (w) Object.assign(merged, w);
    }
  setAddonWords(merged);
}

// ---------------------------------------------------------------- right-rail icons
function ensureAddonRail() {
  const rail = $('rightrail');
  if (!rail) return null;
  let sp = rail.querySelector('.rail-spacer');
  if (!sp) {
    sp = el('div', 'rail-spacer');
    rail.appendChild(sp);
  } // pin our icons to the bottom cluster
  if (!railWrap || !rail.contains(railWrap)) {
    railWrap = el('div', 'addon-rail');
    railWrap.style.display = 'contents'; // its buttons participate directly in the rail's flex
    rail.insertBefore(railWrap, sp.nextSibling); // directly below the spacer => above camera/gear
  }
  return railWrap;
}
function renderAddonRail() {
  const wrap = ensureAddonRail();
  if (!wrap) return;
  wrap.innerHTML = '';
  const enabled = cache.filter((a) => a.enabled);
  orderedIds(enabled.map((a) => a.id)).forEach((id) => {
    const a = enabled.find((x) => x.id === id);
    if (!a) return;
    const active = rp.isShown('addon:' + id) || (popupOpen && popupOpen.id === id);
    const btn = el('button', 'rail-btn addon-rail-btn' + (active ? ' active' : ''));
    const hk = hotkeyFor(id);
    btn.title = a.name + (hk ? '  (' + hk + ')' : '') + (a.error ? '  — error' : '');
    paintIcon(btn, a);
    btn.onclick = (e) => {
      e.stopPropagation();
      openAddonUI(a, btn);
    };
    wrap.appendChild(btn);
  });
}
// an addon's icon: user override -> the icon shipped in its package (addons/<id>/icon.png) -> badge
/** @param {Addon} a */
const addonPkgIcon = (a) => (a && a.hasIcon ? '/addons/' + a.id + '/icon.png' : null);
/** @param {HTMLElement} node @param {Addon} a */
function paintIcon(node, a) {
  node.innerHTML = '';
  const ic = iconFor(a.id) || addonPkgIcon(a);
  if (ic) node.appendChild(themeIcon(ic, 20));
  else {
    const s = el('span', 'glyph-ico', badgeText(a.name));
    s.style.cssText = 'font-weight:600;font-size:15px;';
    node.appendChild(s);
  }
}

// ---------------------------------------------------------------- hotkeys
/** @param {KeyboardEvent} e */
function comboOf(e) {
  /** @type {string[]} */
  const p = [];
  if (e.ctrlKey) p.push('Ctrl');
  if (e.metaKey) p.push('Meta');
  if (e.altKey) p.push('Alt');
  if (e.shiftKey) p.push('Shift');
  p.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return p.join('+');
}
/** @param {KeyboardEvent} e */
function onHotkey(e) {
  if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
  const t = /** @type {HTMLElement} */ (e.target);
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const combo = comboOf(e);
  const a = cache.find((x) => x.enabled && hotkeyFor(x.id) === combo);
  if (a) {
    e.preventDefault();
    e.stopPropagation();
    openAddonUI(a);
  }
}

// ---------------------------------------------------------------- manager dialog
function openAddons() {
  closeAddons();
  // Floating (non-modal) panel so the chart stays interactive while it's open — no click-away close.
  const dlg = el('div', 'dialog addons-mgr');
  panel = dlg;
  dlg.style.zIndex = '60';
  dlg.style.width = '600px';
  dlg.style.maxWidth = '94vw';
  const head = el('div', 'lib-head');
  const x = el('span', 'lib-x', '✕');
  x.onclick = closeAddons;
  head.append(Object.assign(document.createElement('h3'), { textContent: t('Addons') }), x);
  const list = el('div', 'tool-mgr-list addon-mgr-list');
  listEl = list;
  dlg.append(head, list);
  document.body.appendChild(dlg);
  // center on open (fixed), then drag by the header
  dlg.style.position = 'fixed';
  dlg.style.margin = '0';
  dlg.style.left = Math.max(8, (window.innerWidth - dlg.offsetWidth) / 2) + 'px';
  dlg.style.top = Math.max(8, (window.innerHeight - dlg.offsetHeight) / 2) + 'px';
  makeDraggable(dlg, head);
  mgrOpen = true;
  refresh();
  pollTimer = setInterval(refresh, 1500);
}
function closeAddons() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (panel) {
    panel.remove();
    panel = null;
  }
  mgrOpen = false;
  listEl = null;
}
async function refresh() {
  await refreshCache();
  for (const aid of [...panels.keys()]) {
    const a = cache.find((x) => x.id === aid);
    if (!a || !a.enabled) destroyPanel(aid);
  } // disabled/removed -> drop its docked panel
  if (mgrOpen && listEl && !hkRecording) renderManager(); // don't clobber an in-progress hotkey recording
  renderAddonRail();
}

// ---- drag-to-reorder (same idiom as the toolbar-manager): whole row draggable, an insertion line
// on the hovered row shows where it lands (top half -> above, bottom half -> below).
/** @type {string | null} */
let dragAddon = null;
function clearAddonDropMarks() {
  if (listEl)
    listEl
      .querySelectorAll('.tool-mgr-drop-above, .tool-mgr-drop-below')
      .forEach((e) => e.classList.remove('tool-mgr-drop-above', 'tool-mgr-drop-below'));
}
/** @param {HTMLElement} row @param {string} id @param {string[]} allIds */
function wireAddonRowDrag(row, id, allIds) {
  row.draggable = true;
  row.ondragstart = (e) => {
    dragAddon = id;
    row.classList.add('tool-mgr-dragging');
    try {
      const dt = /** @type {DataTransfer} */ (e.dataTransfer);
      dt.effectAllowed = 'move';
      dt.setData('text/plain', id);
    } catch (_) {}
  };
  row.ondragend = () => {
    dragAddon = null;
    row.classList.remove('tool-mgr-dragging');
    clearAddonDropMarks();
  };
  row.ondragover = (e) => {
    if (!dragAddon || dragAddon === id) return;
    e.preventDefault();
    const r = row.getBoundingClientRect();
    const below = e.clientY > r.top + r.height / 2;
    row.classList.toggle('tool-mgr-drop-below', below);
    row.classList.toggle('tool-mgr-drop-above', !below);
  };
  row.ondragleave = () => row.classList.remove('tool-mgr-drop-above', 'tool-mgr-drop-below');
  row.ondrop = (e) => {
    e.preventDefault();
    const after = row.classList.contains('tool-mgr-drop-below');
    clearAddonDropMarks();
    if (!dragAddon || dragAddon === id) return;
    placeAddon(dragAddon, id, after, allIds);
    dragAddon = null;
    renderManager();
    renderAddonRail();
  };
}

function renderManager() {
  if (!listEl) return;
  listEl.innerHTML = '';
  const acts = el('div', 'tool-mgr-actions');
  const write = el('span', 'tool-mgr-action', '✎ ' + t('Write new addon'));
  write.onclick = writeNewAddon;
  const fld = el('span', 'tool-mgr-action', '⊞ ' + t('Open folder'));
  fld.title = t('Open the addons folder — drop an addon package (folder) in, then reload');
  fld.onclick = () => fetch('/api/addons/open', { method: 'POST' }).catch(() => {});
  acts.append(write, fld);
  listEl.appendChild(acts);
  listEl.appendChild(el('div', 'tool-mgr-sep'));

  if (!cache.length) {
    listEl.appendChild(el('div', 'addon-empty', t('No addons yet — write one or import a .js file.')));
    return;
  }

  const allIds = cache.map((a) => a.id);
  orderedIds(allIds).forEach((id) => {
    const a = cache.find((x) => x.id === id);
    if (!a) return;
    const row = el('div', 'tool-mgr-row');
    wireAddonRowDrag(row, a.id, allIds);

    const grip = el('span', 'tool-mgr-grip', '⠿');
    grip.title = t('Drag to reorder');

    const chk = el('span', 'tool-chk' + (a.enabled ? ' on' : ''), a.enabled ? '☑' : '☐');
    chk.title = a.enabled ? t('Disable') : t('Enable');
    chk.onclick = async () => {
      await postJSON('/api/addons/toggle', { id: a.id, enabled: !a.enabled });
      await refresh();
    };

    const dot = el('span', 'addon-dot' + (a.running ? ' on' : a.error ? ' err' : ''));
    dot.title = a.running ? t('running') : a.error ? t('error') : t('stopped');

    const iconCell = el('div', 'tool-icon-cell');
    const prev = el('span', 'tool-icon-prev');
    const ic = iconFor(a.id) || addonPkgIcon(a);
    if (ic) prev.appendChild(themeIcon(ic, 20));
    else prev.textContent = badgeText(a.name);
    const setIco = el('span', 'tool-ico', '🖼');
    setIco.title = t('Set PNG icon');
    setIco.onclick = () => pickIcon(a.id);
    iconCell.append(prev, setIco);
    // clear BOTH sources: the toolbar override AND the package's folder icon.png, so it truly reverts to the
    // badge and a fresh upload can take (otherwise the folder icon.png re-shows and the button looks dead).
    if (ic) {
      const clr = el('span', 'tool-ico', '✕');
      clr.title = t('Remove icon');
      clr.onclick = async () => {
        setIcon(a.id, '');
        await fetch('/api/addon-icon?id=' + encodeURIComponent(a.id), { method: 'DELETE' }).catch(() => {});
        await refresh();
      };
      iconCell.append(clr);
    }

    const name = el('span', 'tool-mgr-name', a.name);
    const hk = hotkeyCell(a.id);

    const open = el('span', 'tool-ico', '⧉');
    open.title = t('Open UI');
    open.onclick = () => openAddonUI(a);
    const edit = el('span', 'tool-ico', '✎');
    edit.title = t('Edit code');
    edit.onclick = () => editAddon(a.id);
    const reload = el('span', 'tool-ico', '⟳');
    reload.title = t('Reload');
    reload.onclick = async () => {
      await postJSON('/api/addons/reload', { id: a.id });
      await refresh();
    };
    const del = el('span', 'tool-ico', '🗑');
    del.title = t('Delete');
    del.onclick = async () => {
      if (confirm(t('Delete addon "{n}"? This removes its folder.').replace('{n}', a.name))) {
        await postJSON('/api/addons/delete', { id: a.id });
        await refresh();
      }
    };

    row.append(grip, chk, dot, iconCell, name, hk, open, edit, reload, del);
    /** @type {HTMLElement} */ (listEl).appendChild(row);
    if (a.error) /** @type {HTMLElement} */ (listEl).appendChild(el('div', 'addon-error', a.error));
  });
}

/** @param {string} id */
function pickIcon(id) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  // Normalize to a 64x64 PNG, then write it as the addon package's icon.png (addons/<id>/icon.png) — the same
  // convention as tools. It travels with the folder and the package manager sees it; not a data URL in a blob.
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    fileToIcon(f, async (/** @type {string|null} */ url) => {
      if (!url) return;
      const r = await postJSON('/api/addon-icon', { id, dataUrl: url });
      if (r && r.error) {
        alert(t('Icon upload failed:') + ' ' + r.error);
        return;
      }
      setIcon(id, r.path + '?v=' + Date.now()); // cache-bust so a re-upload shows immediately
      await refresh();
    });
  };
  inp.click();
}

/** @type {(() => void)|null} */
let hkRecording = null;
/** @param {string} id */
function hotkeyCell(id) {
  const cur = hotkeyFor(id);
  const cell = el('span', 'tool-hk' + (cur ? '' : ' empty'), cur || t('Set hotkey'));
  cell.title = t('Click then press Ctrl/Alt + key. Backspace clears, Esc cancels.');
  cell.onclick = (e) => {
    e.stopPropagation();
    if (hkRecording) hkRecording();
    cell.classList.remove('empty');
    cell.classList.add('rec');
    cell.textContent = t('Press keys…');
    /** @param {KeyboardEvent} ev */
    const onKey = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        done(false);
        return;
      }
      if (ev.key === 'Backspace' || ev.key === 'Delete') {
        setHotkey(id, '');
        done(true);
        return;
      }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(ev.key)) return;
      if (!(ev.ctrlKey || ev.metaKey || ev.altKey)) {
        cell.textContent = t('Use Ctrl/Alt + key');
        return;
      }
      setHotkey(id, comboOf(ev));
      done(true);
    };
    /** @param {boolean} changed */
    const done = (changed) => {
      document.removeEventListener('keydown', onKey, true);
      hkRecording = null;
      if (changed) {
        renderManager();
        renderAddonRail();
        return;
      }
      cell.classList.remove('rec');
      cell.classList.toggle('empty', !cur);
      cell.textContent = cur || t('Set hotkey');
    };
    hkRecording = () => done(false);
    document.addEventListener('keydown', onKey, true);
  };
  return cell;
}

// ---------------------------------------------------------------- the addon's own UI panel
// DOCKED slide-out (the same right-panel the watchlist uses) — it sits BESIDE the charts, never
// over them, and being in the chart window means api.chart still works. Built once per addon, then
// the rail icon just toggles it. Reads exports.ui(root, api); falls back to exports.settings().
/** @param {Addon} a @param {HTMLElement|null=} btn @param {boolean=} show */
async function openAddonUI(a, btn, show = true) {
  const id = 'addon:' + a.id;
  if (popupOpen && popupOpen.id === a.id) {
    closePopup();
    renderAddonRail();
    return;
  } // popup open -> toggle off
  if (panels.has(a.id)) {
    rp.toggle(id);
    persistDocked();
    renderAddonRail();
    return;
  } // docked -> show/hide

  const r = await getJSON('/api/addons/file?id=' + encodeURIComponent(a.id));
  /** @type {any} */
  const mod = evalAddon(r.code || '');
  if (mod && mod.popup) {
    openAddonPopup(a, mod, btn);
    renderAddonRail();
    return;
  } // dropdown mode

  /** @type {Array<() => void>} */
  const closeCbs = [];
  const content = el('div', 'addon-panel');
  const head = el('div', 'addon-panel-head');
  const x = el('span', 'lib-x', '✕');
  x.onclick = () => {
    rp.toggle(id, false);
    persistDocked();
    renderAddonRail();
  };
  head.append(el('span', 'addon-panel-title', a.name), x);
  const root = el('div', 'addon-set-root addon-panel-body');
  content.append(head, root);

  /** @type {AddonApi} */
  const api = {
    id: a.id,
    name: a.name,
    config: { ...(a.config || {}) },
    data: broker,
    chart: makeChartApi((fn) => closeCbs.push(fn)), // works: the docked panel lives in the chart window
    trade: makeTradeApi((fn) => closeCbs.push(fn)), // order book read + plan state (execution via api.trade.command)
    watcher: (opts) => createWatcher(opts), // automated price-condition executor (fires market orders)
    onRaw, // raw broker-feed tap: onRaw(fn) -> fn(broker, channel, msg); returns an unsubscribe
    ...platformApiFor(a.id), // console / orders / positions / accounts — app-wide services (read + write, cross-window)
    log: (...m) => {
      console.log('[addon:' + a.id + ']', ...m);
      platform.console.post({
        cat: 'addon',
        src: a.id,
        msg: m.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '),
      });
    },
    save: async (cfg) => {
      await postJSON('/api/addons/config', { id: a.id, config: cfg });
      await refresh();
    },
    close: () => {
      rp.toggle(id, false);
      persistDocked();
      renderAddonRail();
    },
    onClose: (fn) => closeCbs.push(fn),
    t,
    localizeDom,
    registerVocab, // translation capability: look up words, localize a subtree, ship own defaults
  };

  const uiFn = mod && (mod.ui || mod.settings);
  if (typeof uiFn === 'function') {
    try {
      uiFn(root, api);
    } catch (e) {
      root.textContent = 'ui() error: ' + ((e && /** @type {any} */ (e).message) || e);
    }
  } else if (a.inputs && a.inputs.length) {
    root.appendChild(buildForm(a, api));
  } else {
    root.className += ' addon-set-empty';
    root.textContent = t('This addon has no UI. Define exports.ui(root, api) to build your own.');
  }

  rp.dockView({ id, content, width: 380 });
  panels.set(a.id, { closeCbs });
  rp.toggle(id, show);
  persistDocked();
  renderAddonRail();
}

// tear a docked panel down (addon disabled/removed): run its cleanup, drop the view.
/** @param {string} addonId */
function destroyPanel(addonId) {
  const p = panels.get(addonId);
  if (!p) return;
  p.closeCbs.forEach((f) => {
    try {
      f();
    } catch (_) {}
  });
  rp.removeView('addon:' + addonId);
  panels.delete(addonId);
  persistDocked();
}

// POPUP mode (exports.popup === true): a small dropdown anchored to the addon's rail icon, like a
// menu — opened fresh each time, closed on an outside click. For quick-action addons (screenshot).
/** @param {Addon} a @param {any} mod @param {HTMLElement|null=} btn */
function openAddonPopup(a, mod, btn) {
  closePopup();
  /** @type {Array<() => void>} */
  const closeCbs = [];
  const menu = el('div', 'addon-popup');
  menu.style.cssText =
    'position:fixed;z-index:6000;background:var(--panel);color:var(--tx);border:1px solid var(--bd);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.45);min-width:180px;max-width:320px;padding:8px;';
  const head = el('div', null, a.name);
  head.style.cssText = 'font-size:11px;color:var(--tx-dim);letter-spacing:.04em;margin:0 2px 7px;';
  const root = el('div');
  root.style.cssText = 'display:block;';
  menu.append(head, root);
  document.body.appendChild(menu);

  /** @type {AddonApi} */
  const api = {
    id: a.id,
    name: a.name,
    config: { ...(a.config || {}) },
    data: broker,
    chart: makeChartApi((fn) => closeCbs.push(fn)),
    trade: makeTradeApi((fn) => closeCbs.push(fn)), // order book read + plan state (execution via api.trade.command)
    watcher: (opts) => createWatcher(opts), // automated price-condition executor (fires market orders)
    onRaw,
    ...platformApiFor(a.id), // console / orders / positions / accounts — app-wide services (read + write, cross-window)
    log: (...m) => {
      console.log('[addon:' + a.id + ']', ...m);
      platform.console.post({
        cat: 'addon',
        src: a.id,
        msg: m.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '),
      });
    },
    save: async (cfg) => {
      await postJSON('/api/addons/config', { id: a.id, config: cfg });
      await refresh();
    },
    close: () => {
      closePopup();
      renderAddonRail();
    },
    onClose: (fn) => closeCbs.push(fn),
    t,
    localizeDom,
    registerVocab, // translation capability: look up words, localize a subtree, ship own defaults
  };
  const uiFn = mod && (mod.ui || mod.settings);
  if (typeof uiFn === 'function') {
    try {
      uiFn(root, api);
    } catch (e) {
      root.textContent = 'ui() error: ' + ((e && /** @type {any} */ (e).message) || e);
    }
  } else if (a.inputs && a.inputs.length) root.appendChild(buildForm(a, api));
  else root.textContent = t('This addon has no UI.');

  // anchor to the rail icon, opening to its LEFT (the rail is on the right edge)
  const rb = btn
    ? btn.getBoundingClientRect()
    : { left: window.innerWidth - 54, right: window.innerWidth - 16, top: 80 };
  let left = rb.left - menu.offsetWidth - 8;
  if (left < 8) left = rb.right + 8;
  menu.style.left = left + 'px';
  menu.style.top = Math.min(rb.top, window.innerHeight - menu.offsetHeight - 8) + 'px';

  const away = (/** @type {PointerEvent} */ e) => {
    const tgt = /** @type {Node} */ (e.target);
    if (menu && !menu.contains(tgt) && (!btn || (tgt !== btn && !btn.contains(tgt)))) {
      closePopup();
      renderAddonRail();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  popupOpen = { id: a.id, menu, closeCbs, away };
}
function closePopup() {
  if (!popupOpen) return;
  popupOpen.closeCbs.forEach((f) => {
    try {
      f();
    } catch (_) {}
  });
  if (popupOpen.away) document.removeEventListener('pointerdown', popupOpen.away, true);
  try {
    popupOpen.menu.remove();
  } catch (_) {}
  popupOpen = null;
}

// eval an addon's CommonJS source in the browser to read its exports. Node built-ins are
// shimmed to a harmless proxy so a top-level require('fs') doesn't throw — ui() is pure UI.
/** @param {string} code @returns {any} */
function evalAddon(code) {
  /** @type {{ exports: any }} */
  const m = { exports: {} };
  const noop = function () {};
  const stub = new Proxy(noop, { get: () => stub, apply: () => undefined });
  const shim = () => stub;
  try {
    new Function('module', 'exports', 'require', code)(m, m.exports, shim);
  } catch (e) {
    return { __error: String((e && /** @type {any} */ (e).message) || e) };
  }
  return m.exports;
}

// fallback: a simple form from the inputs schema (only used when an addon defines no ui())
/** @param {Addon} a @param {AddonApi} api */
function buildForm(a, api) {
  const sec = el('div', 'addon-settings');
  /** @type {Record<string, any>} */
  const cfg = { ...(a.config || {}) };
  /** @type {any[]} */ (a.inputs).forEach((inp) => {
    const row = el('div', 'addon-set-row');
    const lbl = el('span', 'addon-set-label', t(inp.label || inp.key));
    const ty = inp.type || 'text';
    /** @type {any} */
    let ctl;
    if (ty === 'bool') {
      ctl = document.createElement('input');
      ctl.type = 'checkbox';
      ctl.checked = !!cfg[inp.key];
      ctl.onchange = () => {
        cfg[inp.key] = ctl.checked;
      };
    } else if (ty === 'number') {
      ctl = document.createElement('input');
      ctl.type = 'number';
      ctl.value = cfg[inp.key] != null ? cfg[inp.key] : '';
      ctl.onchange = () => {
        cfg[inp.key] = ctl.value === '' ? null : parseFloat(ctl.value);
      };
    } else if (ty === 'color') {
      ctl = document.createElement('input');
      ctl.type = 'color';
      ctl.value = cfg[inp.key] || '#888888';
      ctl.onchange = () => {
        cfg[inp.key] = ctl.value;
      };
    } else if (ty === 'select') {
      ctl = document.createElement('select');
      (inp.options || []).forEach((/** @type {any} */ o) => {
        const v = o && o.value != null ? o.value : o;
        const op = document.createElement('option');
        op.value = v;
        op.textContent = t((o && o.label) || v);
        ctl.appendChild(op);
      });
      ctl.value = cfg[inp.key];
      ctl.onchange = () => {
        cfg[inp.key] = ctl.value;
      };
    } else {
      ctl = document.createElement('input');
      ctl.type = 'text';
      ctl.value = cfg[inp.key] != null ? cfg[inp.key] : '';
      ctl.onchange = () => {
        cfg[inp.key] = ctl.value;
      };
    }
    ctl.className = 'addon-set-ctl';
    row.append(lbl, ctl);
    sec.appendChild(row);
  });
  const save = el('button', 'addon-reload addon-set-save', t('Save settings'));
  save.onclick = async () => {
    save.textContent = t('Saving…');
    await api.save(cfg);
    save.textContent = t('Saved');
  };
  sec.appendChild(save);
  return sec;
}

// addon save handler shared by write/edit/import — saves server-side, reports
// syntax/start errors in the editor console, refreshes the list + rail.
/** @param {string} fn @param {string} code @param {any} eapi */
const addonOnSave = async (fn, code, eapi) => {
  eapi.setCon('Saving…');
  const r = await postJSON('/api/addons/save', { name: fn, code });
  if (!r.ok) {
    eapi.setCon('✗ ' + (r.error || 'save failed'), 'err');
    return;
  }
  eapi.lockName();
  if (r.error) eapi.setCon('⚠ Saved, but failed to start:\n' + r.error, 'err');
  else eapi.setCon(r.running ? '✓ Saved & reloaded — running.' : '✓ Saved. Enable it in the list to run it.', 'ok');
  refresh();
};

function writeNewAddon() {
  openCodeEditor({ title: 'New addon', name: '', code: ADDON_TEMPLATE, saveLabel: 'Save addon', onSave: addonOnSave });
}
/** @param {string} id */
async function editAddon(id) {
  const r = await getJSON('/api/addons/file?id=' + encodeURIComponent(id));
  openCodeEditor({
    title: 'Edit addon',
    name: id,
    code: r.code || ADDON_TEMPLATE,
    saveLabel: 'Save addon',
    onSave: addonOnSave,
  });
}
