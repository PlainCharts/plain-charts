// @ts-check
// Workspace tabs. Each tab is a full workspace
// (layout + panes + drawings + studies), identified by a stable id.
//
// Multi-window (Electron): every window is the whole app and shows the tabs the MAIN
// process assigned it — an ordered id list pushed via window.desktop.onTabs. A tab id
// lives in exactly ONE window, never two (no cloning). Dragging a tab and dropping it
// outside the window tears it off into a new window; dropping it on another window docks
// it there — in both cases it MOVES (leaves this window). Persistence is per-tab
// (/api/tabs/upsert|remove) so windows never clobber each other. The browser build has no
// window.desktop, so it's a single window that shows every tab.
import { getJSON, postJSON } from '../api.js';
import { bus } from '../bus.js';
import { broker, bus as engineBus } from '../../data_engine/index.js';   // facade + engine events (logon / connections:changed)
import { getWorkspace, applyWorkspace, defaultWorkspace } from '../chart/layout.js';
import { $ } from '../dom.js';
import { getSetting } from '../settings/settings.js';
import { createWorkspace, saveWorkspace, flushWorkspace, readWorkspace } from './workspace-store.js';
import { surfaceWorkspace, surfaceWsId } from '../surface/index.js';
import { themeIcon } from '../ui/icon.js';

// A tab is a viewport onto a workspace. The workspace FILE (settings/workspaces/<wsId>.json) is the
// source of truth; a tab carries a thin index entry (id/name/wsId) plus a hydrated working copy (ws).
/**
 * @typedef {Object} Tab
 * @property {string} id
 * @property {string=} name
 * @property {string=} wsId                                   the backing workspace file id
 * @property {import('../chart/layout.js').Workspace=} ws     hydrated working copy of that file
 */

/** @type {Tab[]} */
let tabs = [];          // full content set: [{ id, name, ws }] (each window holds all, renders myIds)
/** @type {string[]} */
let myIds = [];         // ordered tab ids THIS window shows (authoritative, from main)
/** @type {string|null} */
let activeId = null;
let isPrimary = true;   // browser build, or the first Electron window
/** @type {HTMLElement|null} */
let barEl = null;
// The tab whose panes are ACTUALLY rendered right now. getWorkspace() reads the live layout, so a
// tab's live state may only be saved back to the tab that owns it -- guards against a cross-window
// tab move writing one tab's panes (e.g. a study board) over another tab's workspace file.
/** @type {string|null} */
let liveTabId = null;
// apply a tab's workspace to the screen, then mark it live (always the active tab at call time).
/** @param {import('../chart/layout.js').Workspace=} ws @returns {void} */
const applyLive = (ws) => { applyWorkspace(/** @type {import('../chart/layout.js').Workspace} */ (ws)); liveTabId = activeId; };

// configurable tab title: parts shown (Ticker / Last price / Price change %), drag-reorderable
// in Settings ▸ Tabs. Last/Change are live — each visible tab tracks its primary symbol's quote.
const DAY = 86400000;
const DAILY = { id: 'D', unit: 'D', n: 1 };
export const TITLE_DEFAULT = [{ key: 'ticker', on: true }, { key: 'last', on: true }, { key: 'change', on: true }];
const titleCfg = () => { const c = getSetting('tabTitle'); return Array.isArray(c) && c.length ? c : TITLE_DEFAULT; };
// per-tab live price tracker state (external broker/quote data — loose shape at this boundary)
/** @typedef {{ symbol: string, brokerId?: string, contractId?: any, decimals?: number, last?: number, prevClose?: number, qcb?: (q: any) => void, started?: boolean }} LiveState */
/** @type {Map<string, LiveState>} */
const tabLive = new Map();   // tabId -> { symbol, brokerId, contractId, decimals, last, prevClose, qcb, started }
/** @type {Map<string, HTMLElement>} */
const nameEls = new Map();   // tabId -> the title <span> (updated live without a full re-render)

// window.desktop is the typed Electron preload bridge (see src/desktop.d.ts). This file drives the
// frameless-window + tab-drag surface defensively (probes method existence, calls inside click
// closures), which fights a precise type -- so the local is widened to `any` at this boundary; the
// ambient DesktopApi still documents the full contract and checks the other consumers.
const desktop = /** @type {any} */ ((typeof window !== 'undefined' && window.desktop && window.desktop.isDesktop) ? window.desktop : null);
const genId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/** @param {string|null} id @returns {Tab|undefined} */
const byId = (id) => tabs.find((t) => t.id === id);
/** @returns {Tab[]} */
const visible = () => /** @type {Tab[]} */ (myIds.map(byId).filter(Boolean));

// The workspace FILE (settings/workspaces/<wsId>.json) is the single source of truth for a tab's
// content; tabs.json is only a thin index of { id, name, wsId }. hydrate() loads a tab's working copy
// (t.ws) from its file, creating a file if the tab has no wsId or the file is gone (e.g. an old inline
// ws carried in tabs.json during the transition, else the default workspace).
/** @param {Tab=} t @returns {Promise<Tab|undefined>} */
async function hydrate(t) {
  if (!t) return t;
  if (t.wsId) {
    const rec = await readWorkspace(t.wsId);
    if (rec && rec.ws) { t.ws = rec.ws; if (rec.name != null) t.name = rec.name; return t; }
  }
  const rec = await createWorkspace(t.name || '', t.ws || defaultWorkspace());
  t.wsId = rec.id; t.ws = rec.ws;
  upsert(t.id);   // persist the tab -> workspace mapping
  return t;
}

/** @param {import('../chart/layout.js').Workspace=} seedWs @returns {Promise<void>} */
export async function loadTabs(seedWs) {
  const d = await getJSON('/api/tabs');
  /** @type {Tab[]} */
  let list = Array.isArray(d.tabs) ? d.tabs.filter(Boolean) : [];
  let migrated = false;
  list.forEach((t) => { if (!t.id) { t.id = genId(); migrated = true; } });   // legacy tabs had no id
  if (!list.length) { list = [{ id: genId(), name: '', ws: seedWs || defaultWorkspace() }]; migrated = true; }
  tabs = list;

  const q = new URLSearchParams(location.search);
  const claimAll = !desktop || q.get('claim') === 'all';
  isPrimary = claimAll || q.get('primary') === '1';
  if (claimAll) myIds = tabs.map((t) => t.id);
  else myIds = (q.get('tabs') || '').split(',').filter(Boolean);

  // main's saved per-window tab list (the `tabs=` param) can outlive a tab's index entry -- e.g. a tab
  // closed in another window/session removed the entry but this window's layout still names its id. Such
  // a phantom renders nowhere (visible() filters it) yet poisons close/activate (myIds[0] resolves to no
  // tab -> defaultWorkspace). Drop phantoms up front and correct main's list so it can't recur.
  const realIds = myIds.filter((id) => tabs.some((t) => t.id === id));
  if (realIds.length !== myIds.length) { myIds = realIds; if (desktop && desktop.claim) desktop.claim(myIds); }

  // a freshly opened (empty) desktop window — from the New window button — starts with one
  // blank tab the user can organize. Use the clean built-in default (NOT seedWs, which carries
  // the legacy last-used multi-pane layout). Persist it and tell main this window owns it.
  if (desktop && !claimAll && !myIds.length) {
    const t = { id: genId(), name: '', ws: defaultWorkspace() };
    tabs.push(t); myIds = [t.id];   // wsId + file created by the hydrate loop below
    if (desktop.addTab) desktop.addTab(t.id);
  }

  let storedActive = null;
  if (typeof d.active === 'string') storedActive = d.active;
  else if (typeof d.active === 'number' && tabs[d.active]) storedActive = tabs[d.active].id;
  const activeParam = q.get('active');   // restored desktop tells the window which tab was active
  activeId = (activeParam && myIds.includes(activeParam)) ? activeParam
    : (storedActive && myIds.includes(storedActive)) ? storedActive : myIds[0];

  // load every visible tab's working copy from its workspace file (creating a file for tabs that
  // predate the wsId, e.g. from the old inline-ws schema). Done before initLayout reads the active ws.
  for (const t of visible()) await hydrate(t);

  if (migrated && isPrimary) postJSON('/api/tabs', { tabs, active: activeId });   // one-time id backfill
  if (desktop) {
    if (claimAll) desktop.claim(myIds);
    desktop.onTabs(onTabs);
    reportActive();
  }
}

const reportActive = () => { if (desktop && desktop.setActive && activeId) desktop.setActive(activeId); };

/** @returns {import('../chart/layout.js').Workspace|undefined} */
export const getActiveWorkspace = () => { const t = byId(activeId); return t ? t.ws : defaultWorkspace(); };

// ---- Workspace Manager entry points (called by workspace-manager.js) ----
// Open an existing workspace (by id) in a NEW tab -- the "+" flow: "+" makes a new tab, and you fill
// it by creating a workspace or opening an existing one. Single-open: if it's already shown in a
// visible tab, just focus that tab instead of a second copy (avoids autosave conflicts).
/** @param {string=} wsId @returns {Promise<void>} */
export async function openWorkspace(wsId) {
  if (!wsId) return;
  const already = visible().find((t) => t.wsId === wsId);
  if (already) { switchTo(already.id); return; }
  const rec = await readWorkspace(wsId); if (!rec) return;
  const cur = byId(activeId); if (cur && cur.id === liveTabId) { cur.ws = getWorkspace(); if (cur.wsId) saveWorkspace(cur.wsId, cur.name, cur.ws); upsert(cur.id); }   // flush current
  const t = { id: genId(), name: rec.name || '', wsId: rec.id, ws: rec.ws || defaultWorkspace() };
  tabs.push(t); myIds.push(t.id);
  activeId = t.id;
  applyLive(t.ws);
  upsert(t.id);
  if (desktop) desktop.addTab(t.id);
  reportActive();
  render();
}

// Open a SURFACE panel (Trade Desk / AI Workspace). A surface is a SINGLETON per kind, not a
// user-curated workspace: it rides the same tab machinery, but its file uses a STABLE per-kind id
// (surfaceWsId) reused on every open. So it never mints a new "0 panes" file per click (the bug that
// piled the picker with junk) -- there is at most one Trade Desk and one AI Workspace file, ever, and
// its state (desk mini-tabs, ai session) persists there across restart. openWorkspace then focuses it
// if already open in this window, else opens the reused file in a new tab.
/** @param {string=} kind @param {string=} label @returns {Promise<void>} */
export async function createSurfaceTab(kind = 'desk', label) {
  const wsId = surfaceWsId(kind);
  const name = label || (kind.charAt(0).toUpperCase() + kind.slice(1));
  if (!(await readWorkspace(wsId))) await createWorkspace(name, surfaceWorkspace(kind), wsId);   // create once, reuse thereafter
  return openWorkspace(wsId);
}

// Create a brand-new named workspace (default layout from settings) and open it in a NEW tab.
/** @param {string=} name @param {import('../chart/layout.js').Workspace=} ws @returns {Promise<void>} */
export async function createWorkspaceTab(name, ws) {
  const cur = byId(activeId); if (cur && cur.id === liveTabId) { cur.ws = getWorkspace(); if (cur.wsId) saveWorkspace(cur.wsId, cur.name, cur.ws); upsert(cur.id); }
  const rec = await createWorkspace(name || '', ws || defaultWorkspace());
  const t = { id: genId(), name: name || '', wsId: rec.id, ws: rec.ws };
  tabs.push(t); myIds.push(t.id);
  activeId = t.id;
  applyLive(t.ws);
  upsert(t.id);
  if (desktop) desktop.addTab(t.id);
  reportActive();
  render();
}

// which workspace id the active tab currently shows (so the manager marks it)
export const getActiveWsId = () => { const t = byId(activeId); return t ? t.wsId : null; };
// the active workspace's display name (for the top-bar workspace button)
export const getActiveWorkspaceName = () => { const t = byId(activeId); return (t && t.name) || 'Untitled'; };
// wsIds open in ANY tab (any window) -- the top-bar dropdown disables these (a workspace may be open
// in only one tab at a time; a second copy would create autosave/sync conflicts).
export const openWsIds = () => tabs.map((t) => t.wsId).filter(Boolean);

// Load an existing workspace into the CURRENT tab (top-bar dropdown). Tabs are viewports, so this
// swaps what this tab shows. HARD STOP if the workspace is already open in another tab.
/** @param {string=} wsId @returns {Promise<void>} */
export async function loadWorkspaceHere(wsId) {
  if (!wsId) return;
  const cur = byId(activeId); if (!cur) return;
  if (cur.wsId === wsId) return;                                        // already showing it
  if (tabs.some((t) => t.wsId === wsId && t.id !== activeId)) return;   // open in another tab -> refuse
  const rec = await readWorkspace(wsId); if (!rec) return;
  if (cur.id === liveTabId) { cur.ws = getWorkspace(); if (cur.wsId) saveWorkspace(cur.wsId, cur.name, cur.ws); }   // flush the old one (only if it's live)
  cur.wsId = rec.id; cur.name = rec.name || ''; cur.ws = rec.ws || defaultWorkspace();
  applyLive(cur.ws);
  upsert(cur.id);
  reportActive();
  render();
}

// Save an edited study board's workspace (from the builder) and re-apply it if it's open in a tab.
/** @param {string=} wsId @param {string=} name @param {import('../chart/layout.js').Workspace=} ws @returns {void} */
export function updateBoard(wsId, name, ws) {
  if (!wsId) return;
  flushWorkspace(wsId, name || '', ws);
  const t = visible().find((x) => x.wsId === wsId);
  if (t) { t.ws = ws; if (name != null) t.name = name; if (t.id === activeId) applyLive(ws); render(); }
}

export function initTabs() {
  barEl = $('tabbar');
  render();
  liveTabId = activeId;   // the initial layout (built by initLayout) belongs to the active tab
  bus.on('workspace:changed', () => { const t = byId(activeId); if (t && t.id === liveTabId) { t.ws = getWorkspace(); if (t.wsId) saveWorkspace(t.wsId, t.name, t.ws); startLive(t); repaint(t.id); } });
  engineBus.on('logon', syncLive);           // start price trackers once a broker connects
  engineBus.on('connections:changed', syncLive);
  bus.on('tabs:title', repaintAll);          // Settings ▸ Tabs changed the title parts
  if (desktop && desktop.onMaxChange) desktop.onMaxChange((/** @type {boolean} */ v) => { isMax = v; updateMaxBtn(); });
}

/** @param {string} id @returns {void} */
function upsert(id) {
  const t = byId(id); if (!t) return;
  postJSON('/api/tabs/upsert', { id: t.id, name: t.name || '', wsId: t.wsId, active: isPrimary ? activeId : undefined });
}
/** @param {string} id */
const removeRemote = (id) => postJSON('/api/tabs/remove', { id });

/** @param {Tab} t @returns {{ symbol: any, brokerId: any }|null} */
const primaryOf = (t) => { const p = t.ws && t.ws.panes && t.ws.panes[0]; return p ? { symbol: p.symbol, brokerId: p.broker } : null; };
/** @param {Tab} t @returns {string} */
const label = (t) => t.name || (primaryOf(t) && (/** @type {{ symbol: any }} */ (primaryOf(t))).symbol) || 'Chart';

// ---- live tab title (Ticker / Last price / Price change %) ----
// The tab title follows the Tab Title settings and is SYMBOL-based (Ticker = the pane's symbol).
// It is NOT the workspace name -- that is shown in the top-bar workspace button (saved-layouts.js).
/** @param {Tab} t @returns {Array<{ text: string, cls?: string }>} */
function titlePieces(t) {
  if (t.ws && t.ws.type === 'surface') return [{ text: t.name || 'Trade Desk' }];   // surface tabs show their name, not a symbol
  const pr = primaryOf(t);
  const sym = (pr && pr.symbol) || 'Chart';
  const s = tabLive.get(t.id);
  /** @type {Array<{ text: string, cls?: string }>} */
  const out = [];
  titleCfg().forEach(({ key, on }) => {
    if (on === false) return;
    if (key === 'ticker') out.push({ text: sym });
    else if (key === 'last') { if (s && s.last != null) out.push({ text: s.last.toFixed(s.decimals != null ? s.decimals : 2) }); }
    else if (key === 'change' && s && s.last != null && s.prevClose) {
      const d = s.last - s.prevClose, p = (d / s.prevClose) * 100;
      out.push({ text: (p >= 0 ? '+' : '') + p.toFixed(2) + '%', cls: d > 0 ? 'up' : d < 0 ? 'down' : '' });
    }
  });
  if (!out.length) out.push({ text: sym });
  return out;
}
/** @param {HTMLElement} nameEl @param {Tab} t @returns {void} */
function fillName(nameEl, t) {
  nameEl.innerHTML = '';
  titlePieces(t).forEach((pc) => {
    const sp = document.createElement('span');
    sp.className = 'tab-part' + (pc.cls ? ' ' + pc.cls : '');
    sp.textContent = pc.text;
    nameEl.appendChild(sp);
  });
}
/** @param {string} id @returns {void} */
function repaint(id) { const el = nameEls.get(id), t = byId(id); if (el && t) fillName(el, t); }
function repaintAll() { nameEls.forEach((el, id) => repaint(id)); }

/** @param {Tab} t @returns {void} */
function startLive(t) {
  const pr = primaryOf(t);
  if (!pr || !pr.symbol) return;
  const s0 = tabLive.get(t.id);
  if (s0 && s0.symbol === pr.symbol && s0.brokerId === pr.brokerId && s0.started) return;   // already tracking
  if (s0) stopLive(t.id);                                  // symbol/broker changed → restart
  if (!broker.isConnected(pr.brokerId)) return;            // wait for its broker
  const api = broker.for(pr.brokerId); if (!api) return;
  /** @type {LiveState} */
  const s = { symbol: pr.symbol, brokerId: pr.brokerId, started: true };
  tabLive.set(t.id, s);
  api.resolveSymbol(pr.symbol, (/** @type {any} */ inst) => {
    if (!inst) { s.started = false; return; }
    s.contractId = inst.id; s.decimals = inst.priceDecimals != null ? inst.priceDecimals : 2;
    api.getBars({ id: inst.id, tf: DAILY, fromMs: Date.now() - 8 * DAY, toMs: Date.now() }, (/** @type {any} */ u) => {
      const bars = (u && u.bars) || [];
      if (bars.length) s.prevClose = (bars.length >= 2 ? bars[bars.length - 2] : bars[bars.length - 1]).close;
      repaint(t.id);
    });
    s.qcb = (q) => { if (q.last != null) s.last = q.last; else if (q.bid != null && q.ask != null) s.last = (q.bid + q.ask) / 2; repaint(t.id); };
    api.subscribeQuotes(inst.id, s.qcb);
  });
}
/** @param {string} id @returns {void} */
function stopLive(id) {
  const s = tabLive.get(id);
  if (s && s.qcb && s.contractId != null) { try { (/** @type {any} */ (broker.for(s.brokerId))).unsubscribeQuotes(s.contractId, s.qcb); } catch (_) {} }
  tabLive.delete(id);
}
// track only the tabs this window currently shows
function syncLive() {
  const vis = new Set(visible().map((t) => t.id));
  [...tabLive.keys()].forEach((id) => { if (!vis.has(id)) stopLive(id); });
  visible().forEach(startLive);
}

function render() {
  if (!barEl) return;
  barEl.innerHTML = '';
  nameEls.clear();
  const list = visible();
  list.forEach((t) => {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeId ? ' active' : '');
    const name = document.createElement('span'); name.className = 'tab-name';
    fillName(name, t); nameEls.set(t.id, name);
    name.ondblclick = (e) => { e.stopPropagation(); startRename(t.id, name); };
    el.appendChild(name);
    if (list.length > 1 || !isPrimary) {
      const x = document.createElement('span'); x.className = 'tab-x'; x.textContent = '✕'; x.title = 'Close';
      x.onclick = (e) => { e.stopPropagation(); closeTab(t.id); };
      el.appendChild(x);
    }
    bindTab(el, t.id);
    (/** @type {HTMLElement} */ (barEl)).appendChild(el);
  });
  const add = document.createElement('button'); add.className = 'tab-add'; add.title = 'Workspaces';
  add.appendChild(themeIcon('/images/plus.png', 20));   // themeable icon in place of the "+" glyph
  add.onclick = () => bus.emit('workspaces:manage');   // opens the Workspace Manager (create / open)
  (/** @type {HTMLElement} */ (barEl)).appendChild(add);
  if (desktop && desktop.winClose) appendWindowControls();   // frameless: tab strip IS the title bar
  syncLive();   // (re)attach price trackers for the visible tabs
  bus.emit('workspace:active');   // keep the top-bar workspace name in sync with the active tab
}

// frameless windows: a draggable spacer (moves the window) + minimize / maximize / close
/** @type {HTMLButtonElement|null} */
let maxBtn = null;
let isMax = false;
function appendWindowControls() {
  const spacer = document.createElement('div'); spacer.className = 'tab-spacer';
  spacer.ondblclick = () => desktop.winMaximizeToggle();   // double-click the title bar
  (/** @type {HTMLElement} */ (barEl)).appendChild(spacer);
  const ctrls = document.createElement('div'); ctrls.className = 'win-ctrls';
  /** @param {string} cls @param {string} glyph @param {string} title @param {(this: HTMLButtonElement, ev: MouseEvent) => any} fn @returns {HTMLButtonElement} */
  const mk = (cls, glyph, title, fn) => { const b = document.createElement('button'); b.className = 'win-btn ' + cls; b.textContent = glyph; b.title = title; b.onclick = /** @type {any} */ (fn); return b; };
  // New empty window to organize, set off on the left with a divider
  if (desktop.newWindow) {
    const winNew = mk('win-new', '', 'New window', () => desktop.newWindow());
    winNew.appendChild(themeIcon('/images/brand-windows.png', 20));
    ctrls.appendChild(winNew);
    const div = document.createElement('span'); div.className = 'win-div'; ctrls.appendChild(div);
  }
  // Always-on-top pin: keeps this window above others. Reflects the live main-process state.
  if (desktop.winAlwaysOnTopToggle) {
    const pinned = desktop.winIsAlwaysOnTop ? !!desktop.winIsAlwaysOnTop() : false;
    // outline pushpin when free, the filled "pinned" glyph when always-on-top -- swap the icon on toggle
    const pinSrc = (/** @type {boolean} */ on) => (on ? '/images/pinned.png' : '/images/pin.png');
    const pin = mk('win-pin', '', pinned ? 'Unpin (always on top)' : 'Always on top', function () {
      const on = desktop.winAlwaysOnTopToggle();
      this.classList.toggle('on', on); this.title = on ? 'Unpin (always on top)' : 'Always on top';
      this.replaceChildren(themeIcon(pinSrc(on), 16));
    });
    pin.appendChild(themeIcon(pinSrc(pinned), 16)); pin.classList.toggle('on', pinned);
    ctrls.appendChild(pin);
  }
  ctrls.appendChild(mk('win-min', '–', 'Minimize', () => desktop.winMinimize()));
  maxBtn = mk('win-max', '', isMax ? 'Restore' : 'Maximize', () => desktop.winMaximizeToggle());
  maxBtn.appendChild(themeIcon('/images/square.png', 14));
  ctrls.appendChild(maxBtn);
  const winClose = mk('win-close', '', 'Close window', () => desktop.winClose());
  winClose.appendChild(themeIcon('/images/x.png', 20));
  ctrls.appendChild(winClose);
  // Exit the whole app (all windows), saving the desktop layout for next launch.
  // Uses the masked exit.png icon (recolored via CSS to match the other controls).
  if (desktop.appQuit) {
    const quit = mk('win-quit', '', 'Exit app (saves layout)', () => desktop.appQuit());
    const ico = document.createElement('span'); ico.className = 'win-quit-ico';
    quit.appendChild(ico);
    ctrls.appendChild(quit);
  }
  (/** @type {HTMLElement} */ (barEl)).appendChild(ctrls);
}
function updateMaxBtn() { if (maxBtn) maxBtn.title = isMax ? 'Restore' : 'Maximize'; }   // icon is static square.png; only the tooltip reflects state

// click = switch; press-and-drag (desktop) = move the tab. The drop point (screen coords)
// is resolved by main: outside any window -> new window; over another window -> dock there.
/** @param {HTMLElement} el @param {string} id @returns {void} */
function bindTab(el, id) {
  if (!desktop) { el.onclick = () => switchTo(id); return; }
  el.onpointerdown = (e) => {
    const et = /** @type {HTMLElement} */ (e.target);
    if (e.button !== 0 || (et.classList && et.classList.contains('tab-x'))) return;
    switchTo(id);                              // activate on grab so the live thumbnail is THIS tab
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    const sx = e.screenX, sy = e.screenY;
    let dragging = false;
    const move = (/** @type {PointerEvent} */ ev) => {
      if (!dragging) {
        if (Math.hypot(ev.screenX - sx, ev.screenY - sy) <= 6) return;
        dragging = true; el.classList.add('tab-dragging');
        const t = byId(id); if (t && t.id === liveTabId) { t.ws = getWorkspace(); if (t.wsId) flushWorkspace(t.wsId, t.name, t.ws); upsert(id); }   // flush the file IMMEDIATELY so the target window reads fresh (only if this tab is live)
        desktop.dragStart(id, { x: ev.screenX, y: ev.screenY });            // main: capture + show preview
      }
      desktop.dragMove({ x: ev.screenX, y: ev.screenY });                   // preview follows the cursor (any monitor)
    };
    const up = (/** @type {PointerEvent} */ ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      el.classList.remove('tab-dragging');
      if (dragging) desktop.dragEnd({ x: ev.screenX, y: ev.screenY });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
}

/** @param {string} id @returns {void} */
function switchTo(id) {
  if (id === activeId) return;
  const cur = byId(activeId); if (cur && cur.id === liveTabId) { cur.ws = getWorkspace(); if (cur.wsId) saveWorkspace(cur.wsId, cur.name, cur.ws); upsert(cur.id); }
  activeId = id;
  applyLive(getActiveWorkspace());
  if (isPrimary) upsert(id);
  reportActive();
  render();
}

/** @param {string} id @returns {Promise<void>} */
async function closeTab(id) {
  tabs = tabs.filter((t) => t.id !== id);
  myIds = myIds.filter((t) => t !== id);
  removeRemote(id);   // removes the tab index entry ONLY -- the workspace FILE persists (no data loss)
  if (desktop) desktop.removeTab(id);
  if (id === activeId) {
    const vis = visible();   // real tabs only -- myIds can carry a stale id whose tab-index entry is gone
    if (vis.length) { activeId = vis[0].id; applyLive(getActiveWorkspace()); }
    else if (isPrimary) { const t = { id: genId(), name: '', ws: defaultWorkspace() }; tabs.push(t); myIds.push(t.id); activeId = t.id; applyLive(t.ws); await hydrate(t); if (desktop) desktop.addTab(t.id); upsert(t.id); }
    reportActive();
  }
  render();
}

// main pushed this window a new tab-id list (after a move/detach/dock/redock)
/** @param {string[]} ids @returns {Promise<void>} */
async function onTabs(ids) {
  if (!Array.isArray(ids)) return;
  const added = ids.filter((id) => !myIds.includes(id));
  myIds = ids;
  if (added.length) await reloadContent();   // adopted tab-index entries (id/name/wsId) from other windows
  for (const t of visible()) if (!t.ws) await hydrate(t);   // load workspace files for newly-adopted tabs
  if (added.length) activeId = added[added.length - 1];        // focus the docked tab
  else if (!myIds.includes(/** @type {string} */ (activeId))) activeId = myIds[0];     // active moved away
  if (myIds.length) applyLive(getActiveWorkspace());
  reportActive();
  render();
}

/** @returns {Promise<void>} */
async function reloadContent() {
  const d = await getJSON('/api/tabs');
  /** @type {Tab[]} */
  const fresh = Array.isArray(d.tabs) ? d.tabs.filter((/** @type {any} */ t) => t && t.id) : [];
  /** @type {Map<string, Tab>} */
  const map = new Map(fresh.map((t) => [t.id, t]));
  // refresh the thin index (id/name/wsId) but KEEP any working copy we already hydrated; brand-new
  // tabs arrive without ws and get hydrated from their file by the caller (onTabs).
  tabs.forEach((t, i) => { if (map.has(t.id)) { tabs[i] = /** @type {Tab} */ ({ ...map.get(t.id), ws: t.ws }); map.delete(t.id); } });
  map.forEach((t) => tabs.push(t));
}

/** @param {string} id @param {HTMLElement} nameEl @returns {void} */
function startRename(id, nameEl) {
  const t = byId(id); if (!t) return;
  const inp = document.createElement('input'); inp.className = 'tab-rename';
  inp.value = t.name || label(t);
  nameEl.replaceWith(inp); inp.focus(); inp.select();
  const done = () => { t.name = inp.value.trim(); if (t.wsId) saveWorkspace(t.wsId, t.name, t.ws); upsert(id); render(); };
  inp.onblur = done;
  inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); else if (e.key === 'Escape') render(); };
}
