// @ts-check
// Pure alert CONDITION compilation -- no DOM, no engine. Turns the create-alert dialog's UI selections
// (localized object labels + English operators) into the host-friendly form the evaluation loop (eval.js)
// reads: stable terms of { op, level }. i18n and display strings stay in the UI -- the host never parses a
// label. The level is SNAPSHOTTED from the anchored drawing now (P3: horizontal line = one price); live
// drag-follow arrives with the synced drawing store (P5). Kept DOM-free (a leaf) so it's testable in
// isolation, mirroring eval.js's pure-core philosophy.
import { t } from '../i18n/i18n.js';   // 'Value' label lookup (a pure string map, no DOM)

const OP_MAP = { 'Crossing': 'cross', 'Crossing Up': 'cross-up', 'Crossing Down': 'cross-down', 'Greater Than': 'gt', 'Less Than': 'lt' };
const OP_FLIP = { 'cross-up': 'cross-down', 'cross-down': 'cross-up', 'gt': 'lt', 'lt': 'gt' };
// Relative (symbol-self) operators: close moved X% over N bars. No Price/Value/level -- percent + lookback.
// Moving Up/Down = absolute price move over N bars (the base); Moving Up/Down % = the same as a percent (derived).
const MOVE_MAP = { 'Moving Up': 'move-up', 'Moving Down': 'move-down', 'Moving Up %': 'move-up-pct', 'Moving Down %': 'move-down-pct' };
// The Moving family as the dialog's operator labels -- ONE list (the MOVE_MAP keys), shared by the
// operator dropdown (dialog-controls) and the semantics predicates below.
export const MOVE_OPS = Object.keys(MOVE_MAP);
/** is this operator one of the relative (symbol-self) Moving family? @param {string} op @returns {boolean} */
export const isMoveOp = (op) => MOVE_OPS.indexOf(op) >= 0;
/** Watchlist scope is only meaningful when EVERY condition row is symbol-relative (the Moving family) --
 * an absolute level/Value doesn't generalize across a list. @param {any} ui @returns {boolean} */
export const isRelativeConds = (ui) => !!(ui && ui.conditions && ui.conditions.length && ui.conditions.every((/** @type {any} */ r) => isMoveOp(r.op)));
/** A timeframe only matters for the Moving family (price over time) -- pure price-level conditions
 * (Crossing / Greater / Less) don't use one. @param {any} ui @returns {boolean} */
export const condsUseTf = (ui) => !!(ui && ui.conditions && ui.conditions.some((/** @type {any} */ r) => isMoveOp(r.op)));
/** snapshot the anchored drawing's fixed price level, if it has one (hline). @param {any} d @returns {number|null} */
export function anchorLevel(d) {
  if (!d || !Array.isArray(d.points) || !d.points.length) return null;
  if (d.tool === 'hline') { const p = d.points[0]; return (p && Number.isFinite(Number(p.price))) ? Number(p.price) : null; }
  return null;   // trendline/rect/etc. -> a moving level; deferred to P5
}
/**
 * @param {{ match: string, conditions: { left:string, op:string, right:string, value?:(number|null), percent?:(number|null), amount?:(number|null), lookback?:(number|null) }[] }} ui
 * @param {string} priceLabel  the localized "Price" label the dropdowns stored
 * @param {string} objectLabel the anchored drawing's label
 * @param {number|null} level  the drawing's snapshotted price level (hline)
 * @returns {{ match: 'all'|'any', terms: { op: string, level?: number, percent?: number, amount?: number, lookback?: number }[] }}
 */
export function compileConditions(ui, priceLabel, objectLabel, level) {
  const rows = (ui && ui.conditions) || [];
  const valueLabel = t('Value');
  const match = /any/i.test((ui && ui.match) || 'all') ? 'any' : 'all';
  const terms = rows.map((r) => {
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
    if (leftPrice === rightPrice) return { op: 'unsupported' };            // both or neither Price
    const objSide = leftPrice ? r.right : r.left;
    // the level is either the typed "Value", or the anchored drawing's (hline) price
    let lvl = null;
    if (objSide === valueLabel) lvl = (r.value != null && Number.isFinite(Number(r.value))) ? Number(r.value) : null;
    else if (objSide === objectLabel) lvl = level;
    if (lvl == null) return { op: 'unsupported' };   // non-hline drawing / empty value -> can't fire (yet)
    let op = /** @type {any} */ (OP_MAP[/** @type {keyof typeof OP_MAP} */ (r.op)]) || 'unsupported';
    if (!leftPrice && OP_FLIP[/** @type {keyof typeof OP_FLIP} */ (op)]) op = OP_FLIP[/** @type {keyof typeof OP_FLIP} */ (op)];   // Price on the right -> invert sense
    return op === 'unsupported' ? { op } : { op, level: lvl };
  });
  return { match, terms };
}
