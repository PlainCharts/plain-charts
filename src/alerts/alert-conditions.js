// @ts-check
// Pure alert CONDITION compilation -- no DOM, no engine. Turns the create-alert dialog's UI selections
// (localized object labels + English operators) into the host-friendly form the evaluation loop (eval.js)
// reads: stable terms of { op, level }. i18n and display strings stay in the UI -- the host never parses a
// label. The level is SNAPSHOTTED from the anchored LEVEL-category drawing (one constant price) and
// re-snapshotted on drag by alert-drawing-sync; the segments/region/series categories land next, each
// compiling to a per-bar extent instead of one number. Kept DOM-free (a leaf) so it's testable in
// isolation, mirroring eval.js's pure-core philosophy.
import { t } from '../i18n/i18n.js'; // 'Value' label lookup (a pure string map, no DOM)

const OP_MAP = {
  Crossing: 'cross',
  'Crossing Up': 'cross-up',
  'Crossing Down': 'cross-down',
  'Greater Than': 'gt',
  'Less Than': 'lt',
};
const OP_FLIP = { 'cross-up': 'cross-down', 'cross-down': 'cross-up', gt: 'lt', lt: 'gt' };

/** the ALERTABLE plots of a study's plot meta: legend:false entries are decoration (RSI's 70/30 guides),
 * never alert targets. One filter, shared by the dialog context and the study sync.
 * @param {any[]} metaPlots @returns {{ key:string, name:string }[]} */
export const alertablePlots = (metaPlots) =>
  (metaPlots || [])
    .filter((/** @type {any} */ p) => p && p.legend !== false)
    .map((/** @type {any} */ p) => ({ key: p.key, name: p.name || p.key }));

/** a study's DECLARED alert conditions (its `alertConditions` contract field), well-formed entries only.
 * One normalizer, shared by the dialog context and the study sync.
 * @param {any} list @returns {{ key:string, name:string }[]} */
export const declaredConditions = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((/** @type {any} */ c) => c && c.key && c.name)
    .map((/** @type {any} */ c) => ({ key: String(c.key), name: String(c.name) }));

/** a SERIES extent from a seriesByLabel entry + the row's chosen plot (or the study's first). Refuses a
 * study the headless runner cannot compute (`headless:false`: inline-only, intrabar, viewport-reactive) --
 * the ONE gate both term families (price-vs-study and study-vs-Value) pass through, so the dialog warns
 * instead of minting a dead alert.
 * @param {{ studyId:string, studyUrl:(string|null), params:any, plots:{key:string,name:string}[], headless?:boolean, uid?:(string|null) }} s
 * @param {string|null|undefined} rowPlot
 * @returns {{ kind:'series', studyId:string, studyUrl:string, params:any, plot:string }|null} */
function seriesExtentOf(s, rowPlot) {
  if (!s || !s.studyUrl || s.headless === false) return null;
  const plots = s.plots || [];
  const plot = rowPlot && plots.some((p) => p.key === rowPlot) ? rowPlot : plots.length ? plots[0].key : null;
  if (!plot) return null;
  /** @type {any} */
  const ext = { kind: 'series', studyId: s.studyId, studyUrl: s.studyUrl, params: s.params, plot };
  if (s.uid) ext.studyUid = s.uid; // instance binding: the live-follow sync re-snapshots by this
  return ext;
}

/** an EVENT extent -- the compute snapshot for a STUDY-DECLARED condition (the study's alertConditions
 * key, e.g. FVG's 'bull'). Same headless gate as seriesExtentOf; no plot -- the host resolves it against
 * the output's `events` channel.
 * @param {{ studyId:string, studyUrl:(string|null), params:any, headless?:boolean, uid?:(string|null) }|null|undefined} s
 * @param {string|null|undefined} key
 * @returns {{ kind:'series', studyId:string, studyUrl:string, params:any, event:string }|null} */
function eventExtentOf(s, key) {
  if (!s || !s.studyUrl || s.headless === false || !key) return null;
  /** @type {any} */
  const ext = { kind: 'series', studyId: s.studyId, studyUrl: s.studyUrl, params: s.params, event: String(key) };
  if (s.uid) ext.studyUid = s.uid;
  return ext;
}
// Relative (symbol-self) operators: close moved X% over N bars. No Price/Value/level -- percent + lookback.
// Moving Up/Down = absolute price move over N bars (the base); Moving Up/Down % = the same as a percent (derived).
const MOVE_MAP = {
  'Moving Up': 'move-up',
  'Moving Down': 'move-down',
  'Moving Up %': 'move-up-pct',
  'Moving Down %': 'move-down-pct',
};
// The Moving family as the dialog's operator labels -- ONE list (the MOVE_MAP keys), shared by the
// operator dropdown (dialog-controls) and the semantics predicates below.
export const MOVE_OPS = Object.keys(MOVE_MAP);
/** is this operator one of the relative (symbol-self) Moving family? @param {string} op @returns {boolean} */
export const isMoveOp = (op) => MOVE_OPS.indexOf(op) >= 0;
/** Watchlist scope is only meaningful when EVERY condition row is symbol-relative (the Moving family) --
 * an absolute level/Value doesn't generalize across a list. @param {any} ui @returns {boolean} */
export const isRelativeConds = (ui) =>
  !!(ui && ui.conditions && ui.conditions.length && ui.conditions.every((/** @type {any} */ r) => isMoveOp(r.op)));
/** A timeframe only matters for the Moving family (price over time) -- pure price-level conditions
 * (Crossing / Greater / Less) don't use one. @param {any} ui @returns {boolean} */
export const condsUseTf = (ui) =>
  !!(ui && ui.conditions && ui.conditions.some((/** @type {any} */ r) => isMoveOp(r.op)));
// The LEVEL extent category: tools whose data-space extent is ONE constant price, anchored at points[0]
// (the first of the four categories -- level / segments / region / series). The one membership list, shared
// by the compiler here (anchorLevel) and the drag-sync (alert-drawing-sync re-snapshots on commit).
export const LEVEL_TOOLS = ['hline', 'hray'];
/** snapshot the anchored drawing's fixed price level, if it is a LEVEL-category tool. @param {any} d @returns {number|null} */
export function anchorLevel(d) {
  if (!d || !Array.isArray(d.points) || !d.points.length) return null;
  if (LEVEL_TOOLS.indexOf(d.tool) >= 0) {
    const p = d.points[0];
    return p && Number.isFinite(Number(p.price)) ? Number(p.price) : null;
  }
  return null; // segments/region tools -> per-bar extents (anchorExtent)
}

// The SEGMENTS extent category: tools whose data-space extent is a drawn polyline -- the whole trend-line
// family (extend is per-drawing style: trendline none / ray right / extendedline both, reconfigurable),
// the level ray (a finite 2-point line), and the multi-point path. The eval resolves the polyline's price
// value(s) at each bar on the alert-interval bar grid (eval.js segLevelsAt).
export const SEGMENT_TOOLS = ['trendline', 'ray', 'extendedline', 'levelray', 'path'];
// The REGION extent category: tools whose data-space extent is a time x price ZONE spanned by two corner
// anchors (eval.js regionFires: touch / enter-from-below / enter-from-above / beyond, only inside its span).
export const REGION_TOOLS = ['rect'];
// The TIME category: tools that are a pure time marker -- "Create alert on" routes to the TIME-alert engine
// (a one-shot schedule at the line's instant), not a price condition. No extent, no bar feed.
export const TIME_TOOLS = ['vline'];
/** snapshot the anchored drawing's extent, if it is a SEGMENTS- or REGION-category tool.
 * @param {any} d @returns {{ kind:'segments'|'region', points:{time:number,price:number}[], extend?:string }|null} */
export function anchorExtent(d) {
  const kind =
    d && SEGMENT_TOOLS.indexOf(d.tool) >= 0 ? 'segments' : d && REGION_TOOLS.indexOf(d.tool) >= 0 ? 'region' : null;
  if (!kind || !Array.isArray(d.points) || d.points.length < 2) return null;
  const points = d.points
    .map((/** @type {any} */ p) => p && { time: Number(p.time), price: Number(p.price) })
    .filter((/** @type {any} */ p) => p && Number.isFinite(p.time) && Number.isFinite(p.price));
  if (points.length < 2) return null;
  if (kind === 'region') return { kind, points };
  return { kind, points, extend: (d.style && d.style.extend) || 'none' };
}
/**
 * @param {{ match: string, conditions: { left:string, op:string, right:string, value?:(number|null), percent?:(number|null), amount?:(number|null), lookback?:(number|null), plot?:(string|null), event?:(string|null) }[] }} ui
 * @param {string} priceLabel  the localized "Price" label the dropdowns stored
 * @param {string} objectLabel the anchored drawing's label
 * @param {number|null} level  the drawing's snapshotted price level (LEVEL category), null otherwise
 * @param {{ kind:'segments'|'region', points:{time:number,price:number}[], extend?:string }|null} [extent]  the drawing's extent snapshot (SEGMENTS/REGION category), null otherwise
 * @param {Record<string, { studyId:string, studyUrl:(string|null), params:any, plots:{key:string,name:string}[], overlay:boolean, headless?:boolean, uid?:(string|null) }>|null} [seriesByLabel]
 *   attached studies by their dropdown label (the SERIES category). The row's chosen plot (or the only one)
 *   snapshots into a series extent. Sub-pane (non-overlay) studies stay unsupported here until
 *   study-vs-Value lands -- price never reaches a different scale.
 * @returns {{ match: 'all'|'any', terms: { op: string, level?: number, extent?: any, percent?: number, amount?: number, lookback?: number }[] }}
 */
export function compileConditions(ui, priceLabel, objectLabel, level, extent, seriesByLabel) {
  const rows = (ui && ui.conditions) || [];
  const valueLabel = t('Value');
  const match = /any/i.test((ui && ui.match) || 'all') ? 'any' : 'all';
  const terms = rows.map((r) => {
    // A STUDY-DECLARED condition (row.event = the declared key; row.op carries its display name for the
    // sentence, never parsed). Subject-only -- no second object, no value; the study is always r.left.
    if (/** @type {any} */ (r).event) {
      const s = seriesByLabel ? seriesByLabel[r.left] : null;
      const ext = eventExtentOf(s, /** @type {any} */ (r).event);
      return ext ? { op: 'event', extent: ext } : { op: 'unsupported' };
    }
    // Moving is self-referential -- no Price/Value sides. A bar count (of the alert's interval) plus a magnitude:
    // a percent for the "%" ops, an absolute price amount for the base Moving Up/Down.
    const moveOp = /** @type {any} */ (MOVE_MAP[/** @type {keyof typeof MOVE_MAP} */ (r.op)]);
    if (moveOp) {
      const lookback = Math.trunc(Number(/** @type {any} */ (r).lookback));
      if (!(lookback > 0)) return { op: 'unsupported' };
      if (moveOp === 'move-up-pct' || moveOp === 'move-down-pct') {
        const percent = Number(/** @type {any} */ (r).percent);
        if (!Number.isFinite(percent) || percent <= 0) return { op: 'unsupported' };
        return { op: moveOp, percent, lookback };
      }
      const amount = Number(/** @type {any} */ (r).amount);
      if (!Number.isFinite(amount) || amount <= 0) return { op: 'unsupported' };
      return { op: moveOp, amount, lookback };
    }
    const leftPrice = r.left === priceLabel;
    const rightPrice = r.right === priceLabel;
    if (leftPrice && rightPrice) return { op: 'unsupported' }; // Price vs Price is nothing
    if (!leftPrice && !rightPrice) {
      // STUDY vs VALUE: the study's OWN value against a literal (RSI Crossing Up 35). Overlay or sub-pane,
      // the comparison lives on the study's scale, never price's. The subject is the STUDY side; a row
      // written "Value op Study" inverts the op so the term always reads study-op-level.
      const sLeft = seriesByLabel && r.right === valueLabel ? seriesByLabel[r.left] : null;
      const sRight = seriesByLabel && r.left === valueLabel ? seriesByLabel[r.right] : null;
      const s = sLeft || sRight;
      if (!s) return { op: 'unsupported' }; // both Value, study vs study, unknown labels: nothing to compile
      const lvl = r.value != null && Number.isFinite(Number(r.value)) ? Number(r.value) : null;
      const ext = seriesExtentOf(s, r.plot);
      if (lvl == null || !ext) return { op: 'unsupported' };
      let op = /** @type {any} */ (OP_MAP[/** @type {keyof typeof OP_MAP} */ (r.op)]) || 'unsupported';
      if (sRight && OP_FLIP[/** @type {keyof typeof OP_FLIP} */ (op)])
        op = OP_FLIP[/** @type {keyof typeof OP_FLIP} */ (op)];
      return op === 'unsupported' ? { op } : { op, extent: ext, level: lvl };
    }
    const objSide = leftPrice ? r.right : r.left;
    // the object side resolves to the typed "Value", the anchored LEVEL drawing's price, the anchored
    // SEGMENTS/REGION drawing's extent, or an attached study's plot (SERIES) -- nothing resolvable = unsupported.
    let lvl = null;
    /** @type {any} */
    let ext = null;
    if (objSide === valueLabel) {
      lvl = r.value != null && Number.isFinite(Number(r.value)) ? Number(r.value) : null;
    } else if (objSide === objectLabel) {
      lvl = level;
      if (lvl == null) ext = extent;
    } else if (seriesByLabel && seriesByLabel[objSide]) {
      const s = seriesByLabel[objSide];
      // price vs a study only makes sense on the SAME scale: overlay studies. A sub-pane study (RSI, CVD)
      // compares against a Value -- the study-vs-Value family above.
      if (s.overlay) ext = seriesExtentOf(s, r.plot);
    }
    if (lvl == null && !ext) return { op: 'unsupported' }; // non-reducible object / empty value -> can't fire (yet)
    let op = /** @type {any} */ (OP_MAP[/** @type {keyof typeof OP_MAP} */ (r.op)]) || 'unsupported';
    if (!leftPrice && OP_FLIP[/** @type {keyof typeof OP_FLIP} */ (op)])
      op = OP_FLIP[/** @type {keyof typeof OP_FLIP} */ (op)]; // Price on the right -> invert sense
    if (op === 'unsupported') return { op };
    return lvl != null ? { op, level: lvl } : { op, extent: ext };
  });
  return { match, terms };
}
