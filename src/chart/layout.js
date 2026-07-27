// @ts-check
// Pane grid manager: builds N panes for the chosen layout, tracks the active
// pane, drives it from the toolbar (symbol + timeframe), syncs across panes when
// enabled, and persists. Adding a new split = one more entry in LAYOUTS.
import { Pane } from './pane.js';
import { broker } from '../../data_engine/index.js';
import { bus } from '../bus.js';
import { bus as engineBus } from '../../data_engine/index.js';   // engine events (logon / connections:changed)
import { byId, firstTf } from '../workspace/timeframes.js';
import { $ } from '../dom.js';
import * as syncStore from '../tools/engine/sync-store.js';
import { getSetting } from '../settings/settings.js';
import { listTemplates } from '../settings/templates.js';
import { mountSurface } from '../surface/index.js';
import { createGutters } from './layout-gutters.js';
import { initLayoutMenu, applyGrid, addRecentLayout } from './layout-menu.js';

// The vendored kapelka chart engine has no TS types here, so a live pane and its engine handles
// (`p.chart`, `p.series`, timeAxis, level handles, plus study-board fields like `p.board`/`p.boardMode`)
// are treated as `any` at this boundary (mirrors the `@typedef {any} Pane` in src/addons/chart-api.js).
// Named PaneRef here to avoid shadowing the imported Pane class used for construction.
/** @typedef {any} PaneRef */

// A layout descriptor: a CSS-grid spec (columns/rows/template-areas) + the area letter each
// pane occupies. Presets live in LAYOUTS; a user-built ("custom") layout carries the same shape
// plus its split proportions (colFr/rowFr).
/**
 * @typedef {Object} LayoutDef
 * @property {string} type
 * @property {number} count
 * @property {string} cols
 * @property {string} rows
 * @property {string} areas
 * @property {string[]} cells
 * @property {number[]=} colFr
 * @property {number[]=} rowFr
 */

// Per-tab sync preferences (which properties propagate from the active pane to the others).
/**
 * @typedef {Object} SyncPrefs
 * @property {boolean} syncSymbol
 * @property {boolean} syncInterval
 * @property {boolean} syncCrosshair
 * @property {boolean} syncRange
 */

// A serialized workspace (tab content). Chart tabs carry a layout + panes; a surface tab carries
// only its own kind + state. Most fields are optional because a workspace can come from a preset,
// a saved file, a study board, or a surface — the reader null-guards each.
/**
 * @typedef {Object} Workspace
 * @property {string=} type                 'surface' | 'studyboard' | undefined (a plain chart)
 * @property {string=} layout               preset type string, or 'custom'
 * @property {LayoutDef=} grid              the user-built grid spec (when layout === 'custom')
 * @property {any[]=} panes                 per-pane saved config (symbol/tfId/range/settings/broker)
 * @property {number|null=} maximizedPane   index of the expanded pane (null/absent = grid)
 * @property {{ cols?: number[], rows?: number[] }=} sizes   resizable track fractions
 * @property {Partial<SyncPrefs>=} sync
 * @property {Object=} synced               layout-scoped synced drawings
 * @property {Object=} layers               shared-per-symbol drawing layers
 * @property {string=} linkedTo             study board: linked main-chart workspace
 * @property {number=} linkedPane           study board: anchor pane index in that workspace
 * @property {Object=} link                 study board: { range, crosshair } link prefs
 * @property {boolean=} sharedTimeAxis      study board: show only the bottom time scale
 */

// The mounted surface handle (a surface tab serializes its own kind + state; no panes).
/**
 * @typedef {Object} SurfaceHandle
 * @property {() => void} destroy
 * @property {() => Workspace} ws
 */

// fresh workspace for a NEW tab/window. Honors the user's defaults (Settings > Layout):
// a chosen built layout for the arrangement, and a chart template for each pane's look.
/** @returns {Workspace} */
export function defaultWorkspace() {
  const sync = { syncSymbol: true, syncInterval: false, syncCrosshair: false };
  const tset = defaultPaneSettings();
  const mkPane = () => ({ symbol: 'EP', settings: tset ? structuredClone(tset) : {} });
  const dl = getSetting('defaultLayout');
  if (dl && dl.areas && dl.count) return { layout: 'custom', grid: dl, panes: Array.from({ length: dl.count }, mkPane), sync };
  return { layout: '1', panes: [mkPane()], sync };
}
// the chosen default chart template flattened into pane.settings shape (or null)
function defaultPaneSettings() {
  const name = getSetting('defaultTemplate');
  if (!name) return null;
  const t = (listTemplates() || []).find((/** @type {any} */ x) => x.name === name);
  if (!t) return null;
  return { ...(t.lines || {}), candles: t.candles, canvas: t.canvas, statusLine: t.statusLine, indicators: t.indicators };
}

// Each layout = CSS grid columns/rows + template-areas; `cells[i]` is the area
// pane i occupies. Asymmetric splits (big + stacked) fall out naturally.
// Grouped by `count` in the picker.
/** @type {LayoutDef[]} */
const LAYOUTS = [
  { type: '1',   count: 1, cols: '1fr',         rows: '1fr',         areas: '"a"',         cells: ['a'] },
  // 2
  { type: '2v',  count: 2, cols: '1fr 1fr',     rows: '1fr',         areas: '"a b"',       cells: ['a', 'b'] },
  { type: '2h',  count: 2, cols: '1fr',         rows: '1fr 1fr',     areas: '"a" "b"',     cells: ['a', 'b'] },
  // 3
  { type: '3v',  count: 3, cols: '1fr 1fr 1fr', rows: '1fr',         areas: '"a b c"',     cells: ['a', 'b', 'c'] },
  { type: '3h',  count: 3, cols: '1fr',         rows: '1fr 1fr 1fr', areas: '"a" "b" "c"', cells: ['a', 'b', 'c'] },
  { type: '3lr', count: 3, cols: '1fr 1fr',     rows: '1fr 1fr',     areas: '"a b" "a c"', cells: ['a', 'b', 'c'] }, // left big
  { type: '3tb', count: 3, cols: '1fr 1fr',     rows: '1fr 1fr',     areas: '"a a" "b c"', cells: ['a', 'b', 'c'] }, // top big
  { type: '3rl', count: 3, cols: '1fr 1fr',     rows: '1fr 1fr',     areas: '"b a" "c a"', cells: ['a', 'b', 'c'] }, // right big
  { type: '3bt', count: 3, cols: '1fr 1fr',     rows: '1fr 1fr',     areas: '"b c" "a a"', cells: ['a', 'b', 'c'] }, // bottom big
];
/** @param {string} t */
const byType = (t) => LAYOUTS.find((l) => l.type === t);
// The current layout def. Presets come from LAYOUTS; a user-built ("custom") layout supplies
// its own {type:'custom', count, cols, rows, areas, cells, colFr, rowFr} via the layout builder.
// Everything downstream (grid, gutters, panes, icon) is agnostic to which it is.
/** @type {LayoutDef|null} */
let customDef = null;
/** @returns {LayoutDef} */
const curDef = () => (layoutType === 'custom' && customDef) ? customDef : /** @type {LayoutDef} */ (byType(layoutType));

// resolve layoutType + customDef from a workspace (a built layout stores ws.layout==='custom'
// plus ws.grid; presets just store the type string)
/** @param {Workspace} ws */
function setLayoutFromWs(ws) {
  if (ws && ws.layout === 'custom' && ws.grid) { layoutType = 'custom'; customDef = ws.grid; }
  else { layoutType = (ws && byType(/** @type {string} */ (ws.layout))) ? /** @type {string} */ (ws.layout) : '1'; customDef = null; }
  wsLinkedTo = (ws && ws.linkedTo) || null;   // preserve the board's chart link across save/load
  wsLinkedPane = (ws && ws.linkedPane != null) ? ws.linkedPane : null;   // which chart (pane index) in that workspace
  wsLink = (ws && ws.link) || null;
  wsSharedTimeAxis = !(ws && ws.sharedTimeAxis === false);   // default on unless explicitly saved false
}
/** @param {string} s */
const trackCount = (s) => s.trim().split(/\s+/).length;

// Set once in initLayout() from $('panes') and non-null thereafter (the app's chart-area host),
// so it is typed non-null; the null initializer is cast to satisfy the invariant.
/** @type {HTMLElement} */
let panesEl = /** @type {HTMLElement} */ (/** @type {unknown} */ (null));
/** @type {PaneRef[]} */
let panes = [];
/** @type {SurfaceHandle|null} */
let surface = null;   // when the active tab is a SURFACE (non-chart) workspace, its mounted handle (else null)

// tear down whatever the chart area currently holds (panes and/or a surface); leaves it empty + chart-styled
function teardownContent() {
  panes.forEach((p) => p.destroy());
  panes = [];
  activePane = null;   // no live chart while a surface is up; getActivePane() consumers all null-guard
  if (surface) { try { surface.destroy(); } catch (_) {} surface = null; }
  document.body.classList.remove('surface-active');
  if (panesEl) panesEl.classList.remove('surface-host');
}
// mount a surface workspace into the (cleared) chart area; hides chart chrome via body.surface-active
/** @param {Workspace} ws */
function mountSurfaceWs(ws) {
  panesEl.innerHTML = '';
  panesEl.removeAttribute('style');   // drop the grid template left by a chart layout
  panesEl.classList.add('surface-host');
  document.body.classList.add('surface-active');
  surface = /** @type {SurfaceHandle} */ (mountSurface(panesEl, /** @type {{ surface?: { kind?: string } }} */ (ws)));
}
/** @type {PaneRef|null} */
let activePane = null;
let layoutType = '1';
/** @type {string|null} */
let wsLinkedTo = null;   // study board: the main-chart workspace this board is time-linked to (persisted)
/** @type {number|null} */
let wsLinkedPane = null; // study board: which chart (pane index) inside that workspace's layout is the anchor
/** @type {Object|null} */
let wsLink = null;       // study board: { range, crosshair } -- which links are on (persisted; set in the board dialog)
let wsSharedTimeAxis = true;   // study board: "show only the bottom time scale & labels" (persisted; set in the board dialog)
/** @type {PaneRef|null} */
let maximized = null;
// user-resizable track fractions for the current layout (draggable gutters)
/** @type {number[]} */
let colSizes = [1];
/** @type {number[]} */
let rowSizes = [1];
/** @type {ResizeObserver|null} */
let gutterRO = null;
/** @type {SyncPrefs} */
const sync = { syncSymbol: true, syncInterval: false, syncCrosshair: false, syncRange: false };

// draggable gutters between panes (layout-gutters.js) -- reads the live layout via accessors,
// so track-array reassignments (restoreSizes / applyCustomLayout) are always picked up
const gut = createGutters({
  host: () => panesEl,
  def: () => curDef(),
  cols: () => colSizes,
  rows: () => rowSizes,
  isMaximized: () => !!maximized,
  applyGrid: () => applyPanesGrid(),
  persist: () => persist(),
});

/** @param {Workspace} [ws] */
export function initLayout(ws) {
  panesEl = /** @type {HTMLElement} */ ($('panes'));
  ws = ws || defaultWorkspace();
  // build the tab's CONTENT — a surface (Console, …) or the chart pane grid. Everything below (menu,
  // gutter observer, and the one-time bus wiring) runs REGARDLESS of type, so switching to a chart tab
  // later still works when the app opened on a surface tab.
  if (ws.type === 'surface') {
    mountSurfaceWs(ws);
  } else {
    setLayoutFromWs(ws);
    sync.syncSymbol = ws.sync ? ws.sync.syncSymbol !== false : true;
    sync.syncInterval = ws.sync ? ws.sync.syncInterval === true : false;
    sync.syncCrosshair = ws.sync ? ws.sync.syncCrosshair === true : false;
    sync.syncRange = ws.sync ? ws.sync.syncRange === true : false;

    syncStore.loadLayout(ws.synced || {});   // active tab's layout-synced drawings
    syncStore.loadLayers(ws.layers || {});   // shared-per-symbol drawing layers + folder organization (else they vanish on reload)
    restoreSizes(ws);
    buildPanes(ws.panes, ws.maximizedPane);
  }
  initLayoutMenu({
    sync,
    persist,
    applySync,
    clearCrosshairs: () => panes.forEach((p) => p.clearCrosshair()),
    applyCustomLayout,
    currentCustomDef: () => (layoutType === 'custom' && customDef) ? customDef : null,
  });
  if (!gutterRO && window.ResizeObserver) { gutterRO = new ResizeObserver(() => gut.position()); gutterRO.observe(panesEl); }

  engineBus.on('logon', () => panes.forEach((p) => { if (broker.isConnected(p.broker)) p.resolve(); }));
  // When a broker drops, clear its panes' subscription handle so the idempotent resolve() (which
  // skips reloading while a live subscription exists) will re-request on reconnect.
  engineBus.on('connections:changed', () => panes.forEach((p) => { if (p.reqId && !broker.isConnected(p.broker)) p.reqId = 0; }));
  // Study board hard off-switch: the anchored chart's liveness (from study-board-sync). Alive -> the
  // board panes run; closed -> they blank (a board only exists to study its anchored chart).
  bus.on('board:anchor', (alive) => panes.forEach((p) => { if (p.board) { if (alive) p.unblank(); else p.blank(); } }));
  // Study board pane controls (from the study legend, routed by StudyHost): reorder / collapse / max,
  // mirroring the main chart's sub-pane study controls.
  bus.on('board:move', ({ pane, dir }) => moveBoardPane(pane, dir));
  bus.on('board:mode', ({ pane, mode }) => setBoardPaneMode(pane, mode));

  // persist pan/zoom and per-pane setting changes automatically. When Range sync is on, push the
  // source pane's visible TIME window onto the others (each maps that span to its own bars).
  // setTimeWindow is silent (it does not re-emit pane:range), so there is no feedback loop.
  bus.on('pane:range', (source) => {
    if (sync.syncRange && source && source.range) {
      panes.forEach((p) => { if (p !== source) { try { p.chart.timeAxis().setTimeWindow(source.range); } catch (_) {} } });
    }
    persist();
  });
  bus.on('pane:changed', () => persist());

  // maximize / restore a single pane
  bus.on('pane:maximize', (p) => toggleMax(p));

  // hide/show all drawings or indicators (the eye toggle) across every pane
  bus.on('view:visibility', () => panes.forEach((p) => { if (p.drawings) p.drawings.requestUpdate(); if (p.studies) p.studies.applyVisibility(); }));

  // a user indicator was edited/reloaded — apply the new code to live instances
  bus.on('studies:reloaded', () => panes.forEach((p) => p.studies.relink()));

  // mirror the hovered pane's crosshair onto the others (by time)
  bus.on('crosshair', ({ source, time, price }) => {
    if (!sync.syncCrosshair) return;
    panes.forEach((p) => { if (p !== source) p.setCrosshair(time, price); });
  });

  bus.on('tf:selected', (id) => {
    if (!activePane) return;
    activePane.setTimeframe(id);
    if (sync.syncInterval) others().forEach((p) => p.setTimeframe(id));
    bus.emit('tf:active', id);
    persist();
  });

  bus.on('tf:deleted', (id) => {
    panes.forEach((p) => { if (p.tfId === id) { p.tfId = firstTf(); if (p.contractId) p.requestBars(); } });
    if (activePane) bus.emit('tf:active', activePane.tfId);
    persist();
  });

  // clicking a watchlist row loads that (broker, symbol) on the active pane
  bus.on('watchlist:pick', ({ broker: brokerId, symbol }) => applySymbol(brokerId, symbol));

  // the symbol box is now a launcher for the broker-first Symbol Search
  const sb = /** @type {HTMLInputElement} */ ($('sym'));
  sb.readOnly = true;
  sb.style.cursor = 'pointer';
  // symbol-search is a dialog layout OPENS on demand; lazy-import it so layout doesn't statically depend on it (it
  // depends on layout for applySymbol/getActivePane) -- keeps the module DAG acyclic. Mirrors the layout-builder open.
  sb.onmousedown = async (e) => { e.preventDefault(); try { const m = await import('../market/symbol-search.js'); m.openSymbolSearch(); } catch (_) {} };
}

const others = () => panes.filter((p) => p !== activePane);
export const getAllPanes = () => panes;
export const getActivePane = () => activePane;
// study board: the main-chart workspace this layout is time-linked to (null for a regular chart)
export const getLinkedTo = () => wsLinkedTo;
// study board: which chart (pane index) inside the linked workspace is the anchor (null if none)
export const getLinkedPane = () => wsLinkedPane;
// study board link prefs { range, crosshair } (null for a regular chart)
export const getLink = () => wsLink;
// study board: switch EVERY pane to a timeframe (the anchored chart's) -- studies have no own tf.
// No-op if the tf is already current on all panes (avoids reload churn from repeated presence beats).
/** @param {string} tfId */
export function setBoardTimeframe(tfId) {
  if (!tfId) return;
  panes.forEach((p) => { if (p.board && p.tfId !== tfId) p.setTimeframe(tfId); });
}

// apply a (broker, symbol) chosen in the symbol search to the active pane
// (and synced panes if symbol-sync is on). Called by symbol-search.js.
/** @param {string} brokerId @param {string} symbol */
export function applySymbol(brokerId, symbol) {
  if (!activePane) return;
  activePane.setSource(brokerId, symbol);
  if (sync.syncSymbol) others().forEach((p) => p.setSource(brokerId, symbol));
  /** @type {HTMLInputElement} */ ($('sym')).value = symbol;
  persist();
}

// apply a maximized pane (or null) to the DOM. Shared by the toggle, Tab-cycle, and layout rebuild so
// the maximized state can be restored (it is persisted in the workspace via getWorkspace).
/** @param {PaneRef|null} p */
function setMaximized(p) {
  maximized = p || null;
  panesEl.classList.toggle('has-max', !!maximized);
  panes.forEach((x) => x.el.classList.toggle('maximized', x === maximized));
  // Render gate: when one pane is maximized the others are display:none -- pause their render pipelines
  // so an expanded chart costs one render, not the whole split (see Pane.setRenderActive). No maximize
  // => every pane visible => every pane active.
  panes.forEach((x) => { if (x.setRenderActive) x.setRenderActive(!maximized || x === maximized); });
  gut.position();   // hide gutters while maximized, restore after
  bus.emit('pane:maxchanged', maximized);   // let the bottom-bar button flip maximize<->restore
}
/** @param {PaneRef} p */
function toggleMax(p) {
  setMaximized(maximized === p ? null : p);
  persist();   // remember which pane is maximized in the workspace (survives tab switch + restart)
}

// is a pane currently maximized? (for the bottom-bar button's initial icon)
export const isMaximized = () => !!maximized;

// cycle the active chart (Tab). When one chart is maximized, the maximize follows
// the focus so you flip through full-screen charts one at a time.
export function cyclePane(dir = 1) {
  if (panes.length < 2) return;
  const i = Math.max(0, panes.indexOf(activePane));
  const next = panes[(i + dir + panes.length) % panes.length];
  if (maximized) { setMaximized(next); persist(); }   // the maximize follows the focus; remember it
  setActivePane(next);
}

// ---- resizable grid (draggable gutters adjust the column/row fractions) ----
function ensureSizes() {
  const def = curDef();
  const nc = trackCount(def.cols), nr = trackCount(def.rows);
  if (colSizes.length !== nc) colSizes = Array(nc).fill(1);
  if (rowSizes.length !== nr) rowSizes = Array(nr).fill(1);
}
// Study-board pane modes mirror the main chart's sub-pane study controls: collapse -> a thin bar
// (just the legend), max -> grow and squish the others. 'normal' rows keep their draggable fr.
const BOARD_COLLAPSED_H = 26, BOARD_SQUISH_H = 48, BOARD_TIMEAXIS_H = 22;
const isBoardLayout = () => panes.length > 0 && panes.every((p) => p.board);
// row template for a board: pane[k] sits in grid row k (its gridArea = cells[k]). A collapsed pane is a
// thin bar (legend + controls); if it also carries the time scale (the bottom pane), it gets a little
// extra so the time labels sit BELOW the legend/controls instead of overlapping them.
function boardRowTemplate() {
  const hasMax = panes.some((p) => p.boardMode === 'max');
  return panes.map((p, k) => {
    if (p.boardMode === 'collapsed') return (BOARD_COLLAPSED_H + (p.settings.timeScale !== false ? BOARD_TIMEAXIS_H : 0)) + 'px';
    if (hasMax) return p.boardMode === 'max' ? '1fr' : BOARD_SQUISH_H + 'px';
    return (rowSizes[k] || 1) + 'fr';
  }).join(' ');
}
function applyPanesGrid() {
  const def = curDef();
  panesEl.style.gridTemplateColumns = colSizes.map((f) => f + 'fr').join(' ');
  panesEl.style.gridTemplateRows = isBoardLayout() ? boardRowTemplate() : rowSizes.map((f) => f + 'fr').join(' ');
  panesEl.style.gridTemplateAreas = def.areas;
}
// study board: swap a pane with its neighbour (reorder the stack) -- like moving a study sub-pane
// up/down in the main chart. Reassign every pane's grid cell from its new array position.
/** @param {PaneRef} p @param {number} dir */
function moveBoardPane(p, dir) {
  const i = panes.indexOf(p), j = i + dir;
  if (i < 0 || j < 0 || j >= panes.length) return;
  [panes[i], panes[j]] = [panes[j], panes[i]];
  const def = curDef();
  panes.forEach((pn, k) => { pn.el.style.gridArea = def.cells[k]; });
  applyPanesGrid(); gut.position();
  // the new order persists via getWorkspace() (reads panes[] order) on the next flush (tab switch/close)
}
// study board: collapse (thin bar) / maximize (grow, squish others) / normal. `mode` is the target.
/** @param {PaneRef} p @param {string} mode */
function setBoardPaneMode(p, mode) {
  if (!p) return;
  p.boardMode = (mode === 'max' || mode === 'collapsed') ? mode : 'normal';
  // studies hide their own plot via the library (setPaneMode); a compare/price pane has no study, so
  // the pane hides its candles when collapsed -> a clean strip (status line + controls), not crammed.
  if (p.setBoardCollapsed) p.setBoardCollapsed(p.boardMode === 'collapsed');
  applyPanesGrid(); gut.position();
}
/** @param {Workspace} ws */
function restoreSizes(ws) {
  const def = curDef();
  const okC = ws && ws.sizes && Array.isArray(ws.sizes.cols) && ws.sizes.cols.length === trackCount(def.cols);
  const okR = ws && ws.sizes && Array.isArray(ws.sizes.rows) && ws.sizes.rows.length === trackCount(def.rows);
  colSizes = okC ? /** @type {{ cols: number[], rows: number[] }} */ (ws.sizes).cols.slice() : [];
  rowSizes = okR ? /** @type {{ cols: number[], rows: number[] }} */ (ws.sizes).rows.slice() : [];
}
/** @param {any[]|undefined} saved @param {number|null} [maxIdx] */
function buildPanes(saved, maxIdx) {
  const def = curDef();
  ensureSizes();
  applyPanesGrid();
  panesEl.classList.toggle('multi', def.count > 1);
  maximized = null;
  panesEl.classList.remove('has-max');
  panes = [];
  for (let i = 0; i < def.count; i++) {
    const cfg = (Array.isArray(saved) && saved[i]) || {};
    const p = new Pane({
      symbol: cfg.symbol || 'EP',
      tfId: byId(cfg.tfId) ? (/** @type {import('../workspace/timeframes.js').Interval} */ (byId(cfg.tfId))).id : firstTf(),   // canonicalize (60m -> 1h)
      range: cfg.range || null,
      settings: cfg.settings || {},
      broker: cfg.broker || null,
    });
    p.el.style.gridArea = def.cells[i];
    p.mount(panesEl);
    p.el.addEventListener('mousedown', () => setActivePane(p), true);
    panes.push(p);
  }
  setActivePane(panes[0]);
  gut.build();
  renderLayoutIcon();
  // restore a maximized pane from the workspace (a multi-chart layout reopened with one chart expanded)
  if (maxIdx != null && maxIdx >= 0 && maxIdx < panes.length && def.count > 1) setMaximized(panes[maxIdx]);
}

// draw the toolbar button as a mini-preview of the current layout
function renderLayoutIcon() {
  const btn = $('btnLayout');
  if (!btn) return;
  const def = curDef();
  btn.innerHTML = '';
  const icon = document.createElement('div');
  icon.className = 'layout-btn-icon';
  applyGrid(icon, def);
  def.cells.forEach((area) => { const c = document.createElement('div'); c.style.gridArea = area; icon.appendChild(c); });
  btn.appendChild(icon);
}

/** @param {PaneRef} p */
function setActivePane(p) {
  activePane = p;
  panes.forEach((x) => x.el.classList.toggle('active', x === p));
  /** @type {HTMLInputElement} */ ($('sym')).value = p.symbol;
  bus.emit('tf:active', p.tfId);
  bus.emit('pane:active', p);
}

// the live workspace is owned by tabs.js — signal it to capture + persist
function persist() { bus.emit('workspace:changed'); }

// ---- named workspace snapshots (used by tabs.js / saved-layouts.js) ----
/** @returns {Workspace} */
export function getWorkspace() {
  if (surface) return surface.ws();   // a surface tab serializes its own kind + state (no panes)
  const isBoard = panes.length > 0 && panes.every((p) => p.board);
  const last = panes.length - 1;
  /** @type {Workspace} */
  const ws = {
    layout: layoutType,
    sizes: { cols: colSizes.slice(), rows: rowSizes.slice() },   // resizable pane splits
    // for a study board, DERIVE each pane's time scale from the shared-time-axis flag (single source of
    // truth) so it can't drift out of sync with the checkbox on autosave / reorder -- only the bottom pane
    // (last) shows the time scale when the flag is on. Regular panes keep their own settings verbatim.
    panes: panes.map((p, i) => {
      const settings = isBoard ? { ...p.settings, timeScale: (wsSharedTimeAxis && i !== last) ? false : true } : p.settings;
      return { symbol: p.symbol, tfId: p.tfId, range: p.range, settings, broker: p.broker };
    }),
    sync: { ...sync },
    synced: syncStore.snapshotLayout(),   // layout-scoped synced drawings (keyed by symbol)
    layers: syncStore.snapshotLayers(),   // drawing layers + folder organization, shared per symbol
    maximizedPane: maximized ? panes.indexOf(maximized) : null,   // which chart is expanded (null = grid)
  };
  if (layoutType === 'custom' && customDef) ws.grid = customDef;   // the user-built grid spec
  // study board (every pane is chart-less): tag the type + carry the chart link so it round-trips
  if (isBoard) { ws.type = 'studyboard'; if (wsLinkedTo) ws.linkedTo = wsLinkedTo; if (wsLinkedPane != null) ws.linkedPane = wsLinkedPane; if (wsLink) ws.link = wsLink; ws.sharedTimeAxis = wsSharedTimeAxis; }
  return ws;
}

// Apply a user-built layout from the layout builder. `def` = { count, cols, rows, areas,
// cells, colFr, rowFr } (see treeToGridSpec). Preserves existing panes' symbol/tf/broker by
// index; the builder's split proportions become the initial draggable track sizes.
/** @param {LayoutDef} def */
export function applyCustomLayout(def) {
  if (!def || !def.count) return;
  const prev = panes.map((p) => ({ symbol: p.symbol, tfId: p.tfId, broker: p.broker, settings: p.settings }));
  panes.forEach((p) => p.destroy());
  layoutType = 'custom';
  customDef = def;
  colSizes = (def.colFr || []).slice();
  rowSizes = (def.rowFr || []).slice();
  buildPanes(prev);
  panes.forEach((p) => { if (broker.isConnected(p.broker)) p.resolve(); });
  addRecentLayout(def);   // remember this arrangement in the recent-layouts list
  persist();
}

// fresh single-pane workspace (keeps current sync prefs)
export function newWorkspace() {
  applyWorkspace({ layout: '1', panes: [{ symbol: 'EP', tfId: firstTf() }], sync: { ...sync } });
}

/** @param {Workspace} ws */
export function applyWorkspace(ws) {
  if (!ws) return;
  teardownContent();                                   // drop whatever was mounted (panes or a surface)
  if (ws.type === 'surface') { mountSurfaceWs(ws); persist(); return; }
  if (ws.sync) {
    sync.syncSymbol = !!ws.sync.syncSymbol;
    sync.syncInterval = !!ws.sync.syncInterval;
    sync.syncCrosshair = !!ws.sync.syncCrosshair;
    sync.syncRange = !!ws.sync.syncRange;
  }
  setLayoutFromWs(ws);
  panes.forEach((p) => p.destroy());
  syncStore.loadLayout(ws.synced || {});   // this tab's layout-synced drawings (before panes render)
  syncStore.loadLayers(ws.layers || {});   // shared-per-symbol drawing layers + folder organization
  restoreSizes(ws);
  buildPanes(ws.panes || [], ws.maximizedPane);
  panes.forEach((p) => { if (broker.isConnected(p.broker)) p.resolve(); });
  persist();
}

/** @param {keyof SyncPrefs} key */
function applySync(key) {
  if (!activePane) return;
  // activePane is a module-level `let`, so its non-null narrowing above doesn't carry into the
  // forEach closures below (TS treats it as reassignable); cast to the non-null PaneRef at each use.
  if (key === 'syncSymbol') others().forEach((p) => p.setSource(/** @type {PaneRef} */ (activePane).broker, /** @type {PaneRef} */ (activePane).symbol));
  if (key === 'syncInterval') others().forEach((p) => p.setTimeframe(/** @type {PaneRef} */ (activePane).tfId));
  if (key === 'syncRange' && /** @type {PaneRef} */ (activePane).range) others().forEach((p) => { try { p.chart.timeAxis().setTimeWindow(/** @type {PaneRef} */ (activePane).range); } catch (_) {} });
}
