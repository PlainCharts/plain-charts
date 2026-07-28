// @ts-check
// PositionView -- the BASIC on-chart representation of ONE (broker, symbol). A vline (the "string") carrying dots.
// It has TWO clearly separated responsibilities, drawn together and NEVER replacing each other:
//   LIVE      the real book -- blue entry, yellow/green hedging SL/TP, one dot per working order. Always shown.
//   PLANNING  the pre-trade layer -- gray projection entry + a red/green stop/target ladder. Shown while planning.
// The set() below draws each compartment via its own drawLive()/drawPlan(); the two sections in this file mirror that
// split so the intent is legible -- it is not a random string with scattered beads.
//
// DECLARATIVE and DISPLAY-ONLY: you hand it state and it reflects it; it never sends an order and owns no control.
// Every surface (order dialog, addon, on-chart controls, assistant) draws the same thing by handing it state, so there
// is ONE representation on the chart. Interaction (drag/click -> orders) is a separate layer built ON TOP of this.
import { createThread } from '../../../src/chart/thread.js';
import { registerPrimitive } from '../../../src/chart/order-view/primitive-registry.js';
import { primitiveConfig } from '../../../src/chart/order-primitives-config.js';
import { colorSwatch } from '../../../src/ui/colorpicker.js';
import { t } from '../../../src/i18n/i18n.js';   // vocabulary lookup -- every dot label is an overridable word

// canonical dot colours (semantic order roles, not theme chrome -- one source of truth instead of scattered hexes).
// LIVE (book) stop is yellow; the PLAN (pre-trade bracket) stop is red -- so a plan reads differently from a live order.
export const DOT = { projection: '#7e8a97', entry: '#2962ff', stop: '#f5c518', target: '#26a69a', planStop: '#ef5350' };

/**
 * A working order leg: id = the resting order id; type/side/price/qty read from the book.
 * @typedef {{ id: any, type: string, side: string, price: number, qty: number }} OrderLeg
 */
/**
 * The declarative state of one (broker, symbol)'s on-chart representation. Any field left null/undefined hides that dot.
 * Split by the two compartments:
 *   LIVE (from the book, always): entry + hedge SL/TP + orders[] (a dot per real working order).
 *   PLANNING (pre-trade, only while Project is on): projection + planLevels (stop/target ladder).
 * @typedef {{ stop?: number|null, target?: number|null }} PlanLevel  one rung of the plan ladder (a stop and/or a target)
 * @typedef {Object} PositionViewState
 * @property {number} [time]         vline anchor (epoch seconds)
 * @property {number|null} [entry]   blue dot price (the position's average entry)   -- LIVE
 * @property {string} [side]         'long' | 'short' (label only)                    -- LIVE
 * @property {number} [qty]          position qty (label only)                        -- LIVE
 * @property {number|null} [hedgeStop]     yellow dot -- HEDGING position SL (a position attribute, no order id)   -- LIVE
 * @property {number|null} [hedgeStopQty]
 * @property {number|null} [hedgeTarget]   green dot -- HEDGING position TP (a position attribute, no order id)    -- LIVE
 * @property {number|null} [hedgeTargetQty]
 * @property {OrderLeg[]} [orders]   working orders -- ONE dot per resting order, coloured by type                 -- LIVE
 * @property {number|null} [projection]  gray PLAN entry dot (shown only while FLAT)                               -- PLANNING
 * @property {PlanLevel[]} [planLevels]  red-stop / green-target PLAN ladder (draggable, not orders).              -- PLANNING
 *                                       ONE rung draws unnumbered (the classic single bracket); 2+ rungs get a level
 *                                       NUMBER inside each dot + "Stop N"/"Target N" on the price scale.
 * @property {boolean} [planArmed]  the plan went LIVE (planning -> live mode): draw the projection + ladder in the LIVE
 *                                  colours (blue entry, yellow stop) instead of the plan colours (gray entry, red stop).
 */

/**
 * @param {any} pane   a kapelka pane (the chart this position is drawn on)
 * @param {{ time?: number, onEntry?: (at: any) => void, onProjection?: (at: any) => void, onProjectionMove?: (price: number) => void, onPlanStop?: (i: number, price: number) => void, onPlanTarget?: (i: number, price: number) => void, onHedgeStop?: (price: number) => void, onHedgeTarget?: (price: number) => void, onOrderCommit?: (id: any, price: number) => void, onOrderClick?: (id: any) => void, onAnchor?: (time: number, commit: boolean) => void }} [opts]
 *   Optional INTERACTION handlers -- the DISPLAY stays a pure mirror; a handler makes that dot a TRIGGER. LIVE: drag an
 *   ORDER dot -> onOrderCommit(orderId, newPrice); click it -> onOrderClick(orderId). Drag a HEDGE SL/TP dot ->
 *   onHedgeStop/onHedgeTarget (position modify, no order id). Click the entry -> onEntry. PLANNING: drag a plan ladder
 *   dot -> onPlanStop(levelIndex, price)/onPlanTarget(levelIndex, price); click/drag the gray projection ->
 *   onProjection / onProjectionMove. No order logic here.
 * @returns {{ set: (s?: PositionViewState) => void, setTime: (t: number) => void, remove: () => void } | null}
 */
export function createPositionView(pane, opts = {}) {
  // dot colours: the canonical DOT defaults under the user's overrides (this primitive's config namespace,
  // settings > Trading > Primitives). Read at CREATE; a config change rebuilds the view (order-overlay).
  const C = { ...DOT, ...(primitiveConfig('string-beads').colors || {}) };
  // the string + the FIXED dots, built ONCE (hidden) then shown/repriced per state. Grouped by compartment. The
  // dynamic dots (order legs / plan rungs, count varies) are reconciled in set() via addBead/removeBead.
  const thread = createThread(pane, {
    time: opts.time,
    onMove: (tm) => { try { opts.onAnchor && opts.onAnchor(Number(tm), false); } catch (_) {} },        // dragging the string through time (live)
    onMoveCommit: (tm) => { try { opts.onAnchor && opts.onAnchor(Number(tm), true); } catch (_) {} },   // released -> persist the new anchor
    style: { color: 'rgba(150,160,170,0.35)', width: 1 },
    beads: [
      // PLANNING -- the gray projection entry (draggable: pick the pending entry level). DROP semantics: the level
      // registers on release only (no onDrag) -- the bead follows the pointer on its own, and a mid-drag pass over
      // the market price must never move a live trigger. Same feel as the broker-order dots.
      { id: 'proj', price: 0, color: C.projection, tag: t('Market'), visible: false, onClick: opts.onProjection, onCommit: opts.onProjectionMove },
      // LIVE -- the position entry + the hedging SL/TP (position attributes, no order id)
      { id: 'entry', price: 0, color: C.entry, tag: t('Entry'), visible: false, onClick: opts.onEntry },
      { id: 'hedgeStop', price: 0, color: C.stop, tag: t('Stop'), visible: false, onClick: opts.onEntry, onCommit: opts.onHedgeStop },
      { id: 'hedgeTarget', price: 0, color: C.target, tag: t('Target'), visible: false, onClick: opts.onEntry, onCommit: opts.onHedgeTarget },
      // (PLAN ladder stop/target rungs are DYNAMIC -> reconciled in drawPlan like order legs)
    ],
  });
  if (!thread) return null;

  /** show + reprice a fixed dot when its price is present, else hide it (shared by both compartments) @param {string} id @param {number|null|undefined} price @param {string} [tag] */
  const setDot = (id, price, tag) => {
    const on = price != null && !Number.isNaN(Number(price));
    if (on) thread.update(id, { price: Number(price), tag });
    thread.update(id, { visible: on });
  };

  // ============================================================================================
  // LIVE compartment -- the real book: position entry, hedging SL/TP, and a bead per working order.
  // Always drawn; the plan never hides it.
  // ============================================================================================
  // DYNAMIC order legs: one bead PER working order, keyed ord:<orderId>, coloured by type (stop = yellow, limit =
  // green, else the entry blue). These are REAL orders and always shown.
  /** @type {Set<string>} */
  const liveOrders = new Set();
  /** @param {OrderLeg[]} orders */
  const reconcileOrders = (orders) => {
    const want = new Set();
    for (const o of orders) {
      const beadId = 'ord:' + o.id;
      want.add(beadId);
      const color = o.type === 'stop' ? C.stop : o.type === 'limit' ? C.target : C.entry;
      const kind = o.type === 'stop' ? t('Stop') : o.type === 'limit' ? t('Limit') : (o.side === 'buy' ? t('Buy') : t('Sell'));
      const tag = kind + (o.qty != null ? ' ' + o.qty : '');
      if (thread.hasBead(beadId)) { thread.update(beadId, { price: o.price, color, tag, visible: true }); }
      else {
        const id = o.id;   // capture for the handlers
        thread.addBead({ id: beadId, price: o.price, color, tag, onCommit: (px) => opts.onOrderCommit && opts.onOrderCommit(id, px), onClick: () => opts.onOrderClick && opts.onOrderClick(id) });
        liveOrders.add(beadId);
      }
    }
    for (const beadId of [...liveOrders]) { if (!want.has(beadId)) { thread.removeBead(beadId); liveOrders.delete(beadId); } }
  };
  /** draw the LIVE compartment from the book state @param {PositionViewState} s */
  const drawLive = (s) => {
    const label = t('Entry') + (s.side ? ' ' + t(s.side) : '') + (s.qty != null ? ' ' + s.qty : '');
    setDot('entry', s.entry, label);
    setDot('hedgeStop', s.hedgeStop, t('Stop') + (s.hedgeStopQty != null ? ' ' + s.hedgeStopQty : ''));
    setDot('hedgeTarget', s.hedgeTarget, t('Target') + (s.hedgeTargetQty != null ? ' ' + s.hedgeTargetQty : ''));
    reconcileOrders(s.orders || []);   // one bead per working order (all of them)
  };

  // ============================================================================================
  // PLANNING compartment -- the pre-trade projection + the stop/target ladder. The gray entry shows only while flat;
  // ARMED restyles the whole thing to the LIVE colours (blue entry, yellow stop) as it goes live.
  // ============================================================================================
  // DYNAMIC plan ladder: one red stop + one green target bead PER level, keyed plan:<kind>:<i>. A SINGLE level draws
  // unnumbered (the classic bracket); 2+ levels get a number INSIDE each dot ('1','2',...) and a "Stop N"/"Target N"
  // price-scale tag. The in-bead label can't be patched after creation, so a COUNT change purges and re-adds.
  /** @type {Set<string>} */
  const livePlan = new Set();
  let planCount = 0;
  /** @param {PlanLevel[]} levels @param {boolean} [armed]  live -> yellow stop instead of the red plan stop */
  const reconcilePlanLevels = (levels, armed) => {
    if (levels.length !== planCount) { for (const id of [...livePlan]) thread.removeBead(id); livePlan.clear(); planCount = levels.length; }
    const multi = levels.length > 1;
    const stopColor = armed ? C.stop : C.planStop;   // armed (live) stops read yellow like a real stop; a plan stop is red
    const want = new Set();
    levels.forEach((lv, i) => {
      const num = multi ? String(i + 1) : '';
      /** @param {'stop'|'target'} kind @param {number|null|undefined} price @param {string} color @param {(i: number, px: number) => void} [on] */
      const rung = (kind, price, color, on) => {
        if (price == null || Number.isNaN(Number(price))) return;
        const id = 'plan:' + kind + ':' + i; want.add(id);
        const tag = (kind === 'stop' ? t('Stop') : t('Target')) + (multi ? ' ' + (i + 1) : '');
        if (thread.hasBead(id)) { thread.update(id, { price: Number(price), tag, color, visible: true }); }   // color too: an arm/disarm restyles the same bead
        // DROP semantics (no onDrag): the level registers on release only. The bead tracks the pointer itself and the
        // thread ignores external repricing mid-drag, so an ARMED rung never fires from a pass-over while dragging.
        else { thread.addBead({ id, price: Number(price), color, tag, label: num, onCommit: (px) => on && on(i, px) }); livePlan.add(id); }
      };
      rung('stop', lv.stop, stopColor, opts.onPlanStop);
      rung('target', lv.target, C.target, opts.onPlanTarget);
    });
    for (const id of [...livePlan]) { if (!want.has(id)) { thread.removeBead(id); livePlan.delete(id); } }
  };
  /** draw the PLANNING compartment (gray/armed projection + the plan ladder) @param {PositionViewState} s */
  const drawPlan = (s) => {
    setDot('proj', s.entry == null ? s.projection : null, s.planArmed ? t('Entry') : t('Market'));   // gray entry only while flat
    thread.update('proj', { color: s.planArmed ? C.entry : C.projection });
    reconcilePlanLevels(s.planLevels || [], !!s.planArmed);   // 0..N stop/target rungs (numbered when >1); armed -> yellow stops
  };

  /** @param {PositionViewState} [s] */
  const set = (s = {}) => {
    if (s.time != null) thread.setTime(s.time);
    drawLive(s);   // LIVE compartment
    drawPlan(s);   // PLANNING compartment
  };

  return { set, setTime: (tm) => thread.setTime(tm), remove: () => thread.remove() };
}

// this primitive's OWN settings (Settings > Trading > Primitives): the dot colours, defaults = DOT. Mutates
// cfg.colors and save()s; live views rebuild on the change (order-overlay re-creates with the new colours).
/** @param {HTMLElement} host @param {any} cfg @param {() => void} save */
function renderSettings(host, cfg, save) {
  const colors = cfg.colors || (cfg.colors = {});
  /** @type {[keyof typeof DOT, string][]} */
  const rows = [['projection', 'Projection'], ['entry', 'Entry'], ['stop', 'Stop'], ['target', 'Target'], ['planStop', 'Plan stop']];
  rows.forEach(([key, label]) => {
    const r = document.createElement('div'); r.className = 'sd-row';
    const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(label);
    r.append(l, colorSwatch(colors[key] || DOT[key], (/** @type {string} */ v) => { colors[key] = v; save(); }));
    host.appendChild(r);
  });
}

// PRIMITIVE #1 -- the string-and-beads registers itself as an order primitive (primitive-contract.js). It is
// the DEFAULT: always available (imported by the overlay), so the chart never lacks an order renderer.
registerPrimitive({ id: 'string-beads', capabilities: { anchor: true, plan: true }, create: createPositionView, renderSettings });
