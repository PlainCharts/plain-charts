// @ts-check
// The order ticket's PLAN-CONTROL adapter -- the single seam between the form fields and the on-chart PLAN STORE
// (the gray projection dot + bracket pill). Every field->plan write funnels through here, so the form handlers say
// WHAT changed (planControl.setStop(v, pivot)) instead of HOW to mutate the plan (commitStop flip/snap/pivot, the
// isProjecting guard, the level shape). Each method is a no-op unless a projection is active for the CURRENT
// (broker, symbol) -- read live via getCtx, so it always targets whatever the dialog currently shows. The plan lives
// in the store and outlives the dialog; this is a pure control surface (nothing is sent to a broker here).
import { isProjecting, isArmed, setLevel, setLevels, commitStop } from '../chart/order-view/plan-store.js';
import { state, getCtx } from './ticket-state.js';
import { snapToTick } from './order-intent.js';   // shared tick-snap (pure)

// snap a price to the current instrument's tick (used for the mirrored target commitStop can produce on a flip)
const snapStop = (/** @type {number} */ v) => { const inst = state.mktInst; const tick = inst && inst.tickSize ? Number(inst.tickSize) : 0; const dec = inst && inst.priceDecimals != null ? Number(inst.priceDecimals) : 2; return snapToTick(v, tick, dec); };

// Commit a dialog STOP edit (roller/type/Dist) through the SAME position-based writer the chart drag uses (commitStop):
// the stop's side vs the entry PIVOT sets the direction -- below = long, above = short -- so it flips the pill's B/S and
// mirrors the target the instant the stop crosses the pivot, whether it moved by a roller HERE or a drag on the chart.
// v <= 0 clears the rung. (Formerly writeDialogStop in ticket-entry; the one place this rule lives.)
/** @param {{broker:string,symbol:string}} c @param {number} v @param {number} pivot */
function writeStop(c, v, pivot) {
  if (v > 0) commitStop(c.broker, c.symbol, 0, v, { flip: !isArmed(c.broker, c.symbol), snap: snapStop, pivot });
  else setLevel(c.broker, c.symbol, 0, { stop: null });
}

// The control surface the form fields drive. Every method reads the LIVE ctx and no-ops unless a projection is on for
// it, so a handler never has to repeat `const c = getCtx(); if (isProjecting(...)) ...`.
export const planControl = {
  /** the pill's qty cell mirrors the Volume box @param {number} qty */
  setQty(qty) { const c = getCtx(); if (isProjecting(c.broker, c.symbol)) setLevels(c.broker, c.symbol, { qty }); },
  /** the projection level (plan.ref) for a limit/stop entry; only a positive price moves it @param {number} price */
  setRef(price) { const c = getCtx(); if (price > 0 && isProjecting(c.broker, c.symbol)) setLevels(c.broker, c.symbol, { ref: price }); },
  /** the bracket STOP, through the flip/snap/pivot rule; pivot = the entry reference this stop is measured against @param {number} v @param {number} pivot */
  setStop(v, pivot) { const c = getCtx(); if (isProjecting(c.broker, c.symbol)) writeStop(c, v, pivot); },
  /** the bracket TARGET on rung 0; 0/negative clears it @param {number} v */
  setTarget(v) { const c = getCtx(); if (isProjecting(c.broker, c.symbol)) setLevel(c.broker, c.symbol, 0, { target: v > 0 ? v : null }); },
  /** the sizing INTENT the on-chart V places with (null in Units mode) @param {any} sizing */
  setSizing(sizing) { const c = getCtx(); if (isProjecting(c.broker, c.symbol)) setLevels(c.broker, c.symbol, { sizing }); },
  /** qty + sizing together (the Stake preview writes both so the pill reflects the Volume box AND sizes like the dialog) @param {number} qty @param {any} sizing */
  setQtyAndSizing(qty, sizing) { const c = getCtx(); if (isProjecting(c.broker, c.symbol)) setLevels(c.broker, c.symbol, { qty, sizing }); },
};
