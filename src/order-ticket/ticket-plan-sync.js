// @ts-check
// PROJECT ORDER (plan mode) -- the dialog's two-way mirror onto the shared PLAN STORE
// (chart/order-view/plan-store.js). The gray planning dot lives in the store, keyed by
// broker+symbol and synced to every chart; this window is a pure CONTROL: the checkboxes
// REFLECT the plan for the selected instrument and toggling WRITES it. Because the plan
// lives in the store (not this window), it OUTLIVES the dialog -- closing the window
// leaves the dot on the chart; reopening reflects it. Pure UI: nothing is sent to a broker.
// Shared state lives in ticket-state.js.
import { isProjecting, getPlan, subscribe as subscribePlan } from '../chart/order-view/plan-store.js';
import { state, getCtx, render } from './ticket-state.js';
import { snapToTick } from './order-intent.js'; // shared tick-snap (pure) -- keep displayed levels on the instrument grid
import { t } from '../i18n/i18n.js'; // terminal-state status string

// reflect the plan's bracket LEVELS in the Market tab SL/TP fields (a chart bead drag -> the fields), on EVERY account
// type -- the SL/TP fields and the red/green beads are two views of ONE bracket plan. Only while bracket is on; never
// overwrites a field the user is actively editing (activeElement guard). The Stop/Limit tabs are NOT part of the bracket.
export const syncFields = () => {
  const c = getCtx();
  const p = getPlan(c.broker, c.symbol);
  const dec = state.mktInst && state.mktInst.priceDecimals != null ? Number(state.mktInst.priceDecimals) : 2;
  const tick = state.mktInst && state.mktInst.tickSize ? Number(state.mktInst.tickSize) : 0;
  const snapTick = (/** @type {any} */ v) => snapToTick(v, tick, dec); // keep displayed levels on the instrument tick grid (0.25 for indices)
  // while PROJECTING the plan's qty / type / ref mirror into whatever entry form is shown (the pill's cells and
  // drags edited them); never overwrite a field being typed in
  if (isProjecting(c.broker, c.symbol)) {
    const pq = Number(p.qty);
    if (pq > 0) {
      if (state.mktInputs && state.mktInputs.vol !== document.activeElement) {
        state.mktVol = pq;
        state.mktInputs.vol.value = String(pq);
      }
      if (state.lsInputs && state.lsInputs.vol && state.lsInputs.vol !== document.activeElement) {
        state.mktVol = pq;
        state.lsInputs.vol.value = String(pq);
      }
    }
    // Price <- plan.ref (the projection level the pill/dot sits at) on the Limit/Stop form
    if (state.lsInputs && state.lsInputs.price && (p.orderType === 'limit' || p.orderType === 'stop')) {
      const ref = Number(p.ref);
      if (ref > 0 && state.lsInputs.price !== document.activeElement) {
        state.lsPrice = snapTick(ref);
        state.lsInputs.price.value = String(state.lsPrice);
      }
    }
  }
  // SL/TP <- plan rung 0 while a projection is on (a kebab-detached lone leg, a dialog field, or an addon-seeded pair
  // fills its field). Runs for WHICHEVER entry tab is up: the Market tab has mktInputs, the Limit/Stop tab has lsInputs.
  if (!state.mktInputs && !state.lsInputs) return;
  if (!isProjecting(c.broker, c.symbol)) return;
  const l0 = (p.levels && p.levels[0]) || {}; // rung 0 = the stop/target the dialog + on-chart pill share
  if (state.mktInputs && l0.stop != null && state.mktInputs.sl !== document.activeElement) {
    state.mktSl = snapTick(l0.stop);
    state.mktInputs.sl.value = String(state.mktSl);
  }
  if (state.mktInputs && l0.target != null && state.mktInputs.tp !== document.activeElement) {
    state.mktTp = snapTick(l0.target);
    state.mktInputs.tp.value = String(state.mktTp);
  }
  // the Limit/Stop tab's SL/TP are the SAME rung-0 bracket -- reflect the pill's drag into those fields too (chart -> fields)
  if (state.lsInputs && state.lsInputs.sl && l0.stop != null && state.lsInputs.sl !== document.activeElement) {
    state.lsSl = snapTick(l0.stop);
    state.lsInputs.sl.value = String(state.lsSl);
  }
  if (state.lsInputs && state.lsInputs.tp && l0.target != null && state.lsInputs.tp !== document.activeElement) {
    state.lsTp = snapTick(l0.target);
    state.lsInputs.tp.value = String(state.lsTp);
  }
  if (state.recomputeDist) state.recomputeDist(); // the Dist boxes read off these prices -> refresh after a plan-driven update
  if (state.syncSideGate) state.syncSideGate(); // a dragged bracket can flip the implied direction -> re-gate Buy/Sell
};
// mirror plan.orderType -> the active tab (the pill's type cell switched it). Only among the three entry tabs;
// never yanks the user off Modify. A tab CLICK is the only writer, so this mirror cannot loop.
export const syncTab = () => {
  const c = getCtx();
  if (!isProjecting(c.broker, c.symbol)) return;
  const t = getPlan(c.broker, c.symbol).orderType;
  if ((t === 'market' || t === 'limit' || t === 'stop') && t !== state.active && state.active !== 'modify') {
    state.active = t;
    render();
  }
};
// Track the projection ON->OFF edge for THIS dialog's instrument, so a planning session ended from the CHART (the
// pill's V place or X cancel) lands the dialog in its terminal state -- exactly where a dialog Buy/Sell lands. Keyed
// by instrument so switching symbols never counts as an "ended" edge. state.placed guards the dialog's OWN placement
// (enterPlaced set it before clearing the projection). Message is neutral: place vs cancel isn't distinguishable
// across the window boundary, and a placed order already shows on the chart.
let lastKey = '';
let wasProjecting = false;
subscribePlan(() => {
  const c = getCtx();
  const key = (c.broker || '') + ':' + (c.symbol || '');
  const now = !!(c.symbol && isProjecting(c.broker, c.symbol));
  const onEntry = state.active === 'market' || state.active === 'limit' || state.active === 'stop';
  if (key === lastKey && wasProjecting && !now && onEntry && !state.placed) {
    lastKey = key;
    wasProjecting = now;
    state.placed = true;
    state.placedMsg = t('planning ended');
    render();
    return;
  }
  lastKey = key;
  wasProjecting = now;
  syncFields();
  syncTab();
}); // any plan change (drag, another window, snapshot) -> refresh the fields + tab
