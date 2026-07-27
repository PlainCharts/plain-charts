// @ts-check
// The canonical per-chart snapshot: EVERY setting in the CHART settings group -- Instrument (candles),
// Canvas, Scales, Status, Trading, and Time (display offset + time-axis format) -- captured from or
// applied to one pane as a single object. This is the ONE definition of "the whole chart setup".
//
// It exists so nothing drifts. A snapshot is the union of the pane's nested appearance objects
// (getAppearance: candles, canvas, statusLine, indicators, trades, tzOffsetMin) and the flat "Scales
// and lines" keys (getLineSettings, the LINE_KEYS set) -- together those cover every control the CHART
// settings group can edit. Every consumer -- Save as, Apply, Import, Apply-to-all, and (later) the
// personal-template and sharable-theme branches -- routes through here, so no field is dropped or
// duplicated the way the hand-rolled field lists were.

/**
 * A complete (or partial) snapshot of one pane's CHART-group settings.
 * @typedef {Object} ChartSnapshot
 * @property {any}    [candles]     Instrument -> candle body / border / wick
 * @property {any}    [canvas]      Canvas -> background / grid / crosshair / scale text / margins / zoom
 * @property {any}    [statusLine]  Status -> title / OHLC values / market dot
 * @property {any}    [indicators]  indicator-legend display options
 * @property {any}    [trades]      Trading -> fills, order projection, on-chart order display
 * @property {number} [tzOffsetMin] Time -> per-pane display offset (minutes east of UTC)
 * @property {Object.<string, any>} [lines]  flat Scales & lines keys (the LINE_KEYS set)
 */

// The appearance sections a snapshot carries as nested objects (mirrors getAppearance's own keys).
const SECTIONS = ['candles', 'canvas', 'statusLine', 'indicators', 'trades', 'tzOffsetMin'];

/**
 * Capture the COMPLETE CHART-group settings of a pane into one plain, serializable object.
 * @param {any} pane
 * @returns {ChartSnapshot}
 */
export function captureChartSettings(pane) {
  return { ...pane.getAppearance(), lines: pane.getLineSettings() };
}

/**
 * Apply a (possibly partial) snapshot to a pane -- committed and live. Each section is cloned, so one
 * snapshot can be applied to many panes without them sharing (and later mutating) the same object. A
 * section absent from the snapshot keeps the pane's CURRENT value, so an old or partial file still
 * applies cleanly.
 * @param {any} pane
 * @param {ChartSnapshot} snap
 */
export function applyChartSettings(pane, snap) {
  if (!pane || !snap) return;
  const cur = pane.getAppearance();
  /** @type {any} */
  const next = {};
  const s = /** @type {any} */ (snap);
  SECTIONS.forEach((k) => { next[k] = structuredClone(s[k] != null ? s[k] : cur[k]); });
  pane.commitAppearance(next);
  if (snap.lines) pane.applyLineSettings(structuredClone(snap.lines));
}

// ---- settings-dialog helpers: the dialog edits an uncommitted `draft` (the nested appearance sections)
// while the flat "Scales and lines" keys are applied LIVE to the pane. These bridge a snapshot to that
// split so Save-as / Apply / Apply-to-all route through the same SECTIONS list, never a hand-rolled one.

/**
 * Build a snapshot from the dialog's in-progress DRAFT plus the pane's live line settings -- exactly
 * what the user currently sees. Use for Save as and Apply-to-all.
 * @param {any} draft @param {any} pane @returns {ChartSnapshot}
 */
export function snapshotFromDraft(draft, pane) {
  /** @type {any} */
  const o = {};
  SECTIONS.forEach((k) => { o[k] = structuredClone(draft[k]); });
  o.lines = pane.getLineSettings();
  return o;
}

/**
 * Load a snapshot INTO the dialog's draft (appearance sections, mutated in place) and apply its line
 * settings live, so the dialog previews it and the user can still Cancel. Sections absent from the
 * snapshot are left untouched.
 * @param {any} draft @param {any} pane @param {ChartSnapshot} snap
 */
export function applySnapshotToDraft(draft, pane, snap) {
  if (!snap) return;
  const s = /** @type {any} */ (snap);
  SECTIONS.forEach((k) => { if (s[k] != null) draft[k] = structuredClone(s[k]); });
  if (snap.lines && pane) pane.applyLineSettings(structuredClone(snap.lines));
}

/**
 * A file is a chart snapshot if it carries at least one CHART-group section (or the flat line keys).
 * @param {any} obj @returns {boolean}
 */
export function isChartSnapshot(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const s = /** @type {any} */ (obj);
  return SECTIONS.some((k) => s[k] != null) || (!!s.lines && typeof s.lines === 'object');
}
