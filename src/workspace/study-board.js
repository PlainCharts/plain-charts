// @ts-check
// Study board = a chart-less workspace: N vertically-stacked panes, each holding ONE study (an
// oscillator) with no candles. Each pane is a full chart instance (its own symbol / timeframe /
// x-axis); Range + Crosshair sync keep them time-aligned. Board-ness lives entirely in each pane's
// settings (board:true + studies:[one study]) -- buildPanes needs no special case.
import { applyWorkspace, getActivePane } from '../chart/layout.js';

/** @typedef {import('../chart/layout.js').Workspace} Workspace */
/** @typedef {import('../chart/layout.js').LayoutDef} LayoutDef */

// A single board row descriptor. A row is EITHER a study (studyId + params) or a COMPARE price pane
// (compare:true + chartType). `_settings`/`_range` carry the pane's full saved state through an edit
// (extracted by boardRowsFromWs, consumed by mergeStudyBoard) so editing never wipes drawings/appearance.
/**
 * @typedef {Object} BoardRow
 * @property {string} symbol
 * @property {string|null=} broker
 * @property {string|null=} studyId       oscillator study id (null on a compare row)
 * @property {Object=} params             study params
 * @property {boolean=} compare           true => a price (compare) pane instead of a study
 * @property {string=} chartType          compare pane chart type (default 'candles')
 * @property {string|null=} tfId          per-row timeframe fallback (legacy; board tf normally shared)
 * @property {Object=} _settings          preserved full pane settings (state-preserving edit)
 * @property {Object|null=} _range        preserved pane visible range
 */

// Options shared by studyBoardWorkspace / mergeStudyBoard.
/**
 * @typedef {Object} BoardOpts
 * @property {string|null=} linkedTo      main workspace id this board is anchored to
 * @property {number|null=} linkedPane    anchor chart (pane) index within that workspace's layout
 * @property {string|null=} tf            board timeframe (the anchored chart's), shared by all studies
 * @property {{ range?: boolean, crosshair?: boolean }|null=} link   cross-window sync toggles
 * @property {boolean=} sharedTimeAxis    only the bottom pane shows the time scale (default true)
 */

// an N-row single-column custom grid (same spec shape the layout builder produces)
/**
 * @param {number} n
 * @returns {LayoutDef}
 */
export function studyBoardGrid(n) {
  const cells = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));   // a, b, c, ...
  return {
    type: 'custom', count: n,
    cols: '1fr',
    rows: Array(n).fill('1fr').join(' '),
    areas: cells.map((c) => `"${c}"`).join(' '),
    cells,
    colFr: [1],
    rowFr: Array(n).fill(1),
  };
}

// build a study-board workspace from row specs [{ symbol, broker?, studyId, params? }].
// opts:
//   linkedTo   = the MAIN WORKSPACE id this board is anchored to (required for a live board)
//   linkedPane = index of the anchored CHART (pane) within that workspace's layout
//   tf         = the board timeframe -- taken from the anchored chart; ALL study panes share it
//                (studies have no independent timeframe; they follow the anchored chart)
//   link       = { range, crosshair } cross-window sync toggles (default both on)
/**
 * @param {BoardRow[]} rows
 * @param {BoardOpts} [opts]
 * @returns {Workspace}
 */
export function studyBoardWorkspace(rows, opts = {}) {
  const { linkedTo = null, linkedPane = null, tf = null, link = null, sharedTimeAxis = true } = opts;
  const last = rows.length - 1;
  // board-specific fields (boardTf, nullable linkedTo/linkedPane) extend the shared Workspace shape;
  // cast at this boundary since the layout.js typedef is owned elsewhere.
  return /** @type {Workspace} */ ({
    type: 'studyboard',
    linkedTo: linkedTo || null,
    linkedPane: linkedPane == null ? null : linkedPane,   // which chart in the anchored workspace's layout
    boardTf: tf || null,                                  // the anchored chart's timeframe, shared by all studies
    // board<->chart LINK sync (cross-window), set in the board dialog -- SEPARATE from the layout's
    // SYNC IN LAYOUT toggles (those only align panes within one layout). Default: both on.
    link: { range: !(link && link.range === false), crosshair: !(link && link.crosshair === false) },
    sharedTimeAxis: sharedTimeAxis !== false,   // only the BOTTOM pane shows the time scale + labels
    layout: 'custom',
    grid: studyBoardGrid(rows.length),
    sizes: { cols: [1], rows: rows.map(() => 1) },
    panes: rows.map((r, i) => ({
      symbol: r.symbol, tfId: tf || r.tfId || null, broker: r.broker || null,
      settings: paneSettings(r, sharedTimeAxis !== false && i !== last),
    })),
    // time-linked by default; symbols stay independent per row (timeframe is shared = the anchor's)
    sync: { syncSymbol: false, syncInterval: false, syncCrosshair: true, syncRange: true },
  });
}

// a board row is EITHER a study (oscillator) or a COMPARE pane (a price chart of its symbol, like the
// "+ compare" feature -- board:true so it still follows the anchor's tf/window and blanks with it).
// The pane status line (symbol · tf · OHLC) is meaningful for a COMPARE pane (a real price chart) but
// shows "O NaN H NaN L NaN C NaN" on an oscillator pane (no candles) -- so it is OFF for oscillators,
// ON for compare panes. hideTimeAxis hides the redundant time scale on every pane but the bottom one.
/**
 * @param {BoardRow} r
 * @param {boolean} hideTimeAxis
 * @returns {Object}
 */
function paneSettings(r, hideTimeAxis) {
  const ta = hideTimeAxis ? { timeScale: false } : {};
  if (r.compare) return { board: true, pricePane: true, chartType: r.chartType || 'candles', statusLine: { title: true, chartValues: true }, ...ta };
  return { board: true, studies: [{ id: r.studyId, params: r.params || {} }], statusLine: { title: false, chartValues: false }, ...ta };
}

// extract row specs from a saved board workspace (reverse of studyBoardWorkspace) -- for editing.
// _settings/_range carry the pane's FULL state (drawings, appearance, pan/zoom) so an edit preserves it.
// Rows no longer carry a timeframe (the board follows the anchored chart's tf).
/**
 * @param {Workspace|null|undefined} ws
 * @returns {BoardRow[]}
 */
export function boardRowsFromWs(ws) {
  return (((ws && ws.panes) || [])).map((p) => {
    const s = p.settings || {};
    if (s.pricePane) return { symbol: p.symbol, broker: p.broker || null, compare: true, chartType: s.chartType || 'candles',
                              _settings: s, _range: p.range || null };
    const st = (s.studies && s.studies[0]) || {};
    return { symbol: p.symbol, broker: p.broker || null, studyId: st.id, params: st.params || {},
             _settings: s, _range: p.range || null };
  });
}
// the board's timeframe (shared by all studies) -- the anchored chart's tf; falls back to a pane's tfId
// for boards saved before boardTf existed.
/**
 * @param {Workspace|null|undefined} ws
 * @returns {string|null}
 */
export function boardTfOf(ws) {
  return (ws && /** @type {any} */ (ws).boardTf) || (ws && ws.panes && ws.panes[0] && ws.panes[0].tfId) || null;
}

// Rebuild a board workspace from edited rows while PRESERVING each row's existing pane state
// (drawings, appearance, pan/zoom) via row._settings/_range -- so editing rows or the link never wipes
// what you set up. Rows carry their state through reorder; a NEW row (no _settings) starts fresh; a
// REMOVED row simply drops out. Only the study spec + symbol/tf/link change.
/**
 * @param {Workspace|null|undefined} orig
 * @param {BoardRow[]} rows
 * @param {BoardOpts} [opts]
 * @returns {Workspace}
 */
export function mergeStudyBoard(orig, rows, opts = {}) {
  const { linkedTo = null, linkedPane = null, tf = null, link = null, sharedTimeAxis = true } = opts;
  const sameCount = orig && Array.isArray(orig.panes) && orig.panes.length === rows.length;
  const last = rows.length - 1;
  // board-specific fields extend the shared Workspace shape; cast at this boundary (typedef owned elsewhere).
  return /** @type {Workspace} */ ({
    type: 'studyboard',
    linkedTo: linkedTo || null,
    linkedPane: linkedPane == null ? null : linkedPane,
    boardTf: tf || null,
    link: { range: !(link && link.range === false), crosshair: !(link && link.crosshair === false) },
    sharedTimeAxis: sharedTimeAxis !== false,
    layout: 'custom',
    grid: studyBoardGrid(rows.length),
    sizes: (sameCount && orig.sizes) ? orig.sizes : { cols: [1], rows: rows.map(() => 1) },
    panes: rows.map((r, i) => {
      const settings = /** @type {any} */ (r._settings ? { ...r._settings } : {});   // keep drawings / appearance / per-pane state
      settings.board = true;
      if (r.compare) { settings.pricePane = true; delete settings.studies; if (!settings.chartType) settings.chartType = r.chartType || 'candles'; if (!settings.statusLine) settings.statusLine = { title: true, chartValues: true }; }
      // oscillator pane: no candles -> the OHLC status line reads NaN, so force it off (keep any font/colour prefs)
      else { delete settings.pricePane; settings.studies = [{ id: r.studyId, params: r.params || {} }]; settings.statusLine = { ...(settings.statusLine || {}), title: false, chartValues: false }; }
      settings.timeScale = (sharedTimeAxis !== false && i !== last) ? false : true;   // shared time axis: only the bottom pane shows it
      return { symbol: r.symbol, tfId: tf || r.tfId || null, broker: r.broker || null, range: r._range || null, settings };
    }),
    synced: (orig && orig.synced) || {},   // shared-per-symbol drawings
    layers: (orig && orig.layers) || {},    // drawing layers + folder organization
    sync: (orig && orig.sync) || { syncSymbol: false, syncInterval: false, syncCrosshair: true, syncRange: true },
  });
}

// TEST-ONLY (temporary; replaced by the Study Board Manager). Build a 3-RSI board on the active pane's
// symbol/broker and apply it to the current tab. Run window.testStudyBoard() from the console.
/** @returns {void} */
export function testStudyBoard() {
  const p = getActivePane();
  const base = p ? { symbol: p.symbol, broker: p.broker } : { symbol: 'EP', broker: null };
  applyWorkspace(studyBoardWorkspace([
    { ...base, studyId: 'rsi', params: { length: 14 } },
    { ...base, studyId: 'rsi', params: { length: 7 } },
    { ...base, studyId: 'rsi', params: { length: 28 } },
  ], { tf: (p && p.tfId) || '5m' }));
}

if (typeof window !== 'undefined') /** @type {any} */ (window).testStudyBoard = testStudyBoard;
