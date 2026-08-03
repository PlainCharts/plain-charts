// @ts-check
// The order ticket's live MARKET-DATA FEED: instrument resolution (tick/decimals for the price steppers), the live
// bid/ask quote subscription, and the position-sizing STAKE PREVIEW that feed drives. Kept apart from the entry-form
// builders (ticket-entry.js) so the forms are pure view and the data plumbing stands on its own. All of it reads/writes
// the shared ticket state; the quote tick re-runs whatever hooks the active form registered (recalcStake / syncSideGate
// / recomputeDist).
import { broker, sizeFromStake } from '../../data_engine/index.js';
import { state, getCtx } from './ticket-state.js';
import { syncFields } from './ticket-plan-sync.js'; // an instrument resolve mirrors plan levels back into the fields
import { planControl } from './plan-control.js'; // the Stake preview writes the sizing intent to the plan through the one seam
import { mmSnapshot } from '../money-management/resolver.js'; // the ONE shared MM gather (also feeds the order worker)

// push the resolved instrument's tick/decimals onto the price inputs (step for the spinners): Market SL/TP + Limit/Stop price
export function applyMktInst() {
  const dec = state.mktInst && state.mktInst.priceDecimals != null ? Number(state.mktInst.priceDecimals) : 5;
  const step = state.mktInst && state.mktInst.tickSize ? Number(state.mktInst.tickSize) : Math.pow(10, -dec);
  /** @type {HTMLInputElement[]} */
  const ins = [];
  if (state.mktInputs) ins.push(state.mktInputs.sl, state.mktInputs.tp);
  if (state.lsInputs) {
    ins.push(state.lsInputs.price);
    if (state.lsInputs.sl) ins.push(state.lsInputs.sl);
    if (state.lsInputs.tp) ins.push(state.lsInputs.tp);
  }
  ins.forEach((i) => {
    if (i) i.step = String(step);
  });
}
// resolve the current symbol's instrument (async) so the SL/TP steppers match its tick
export function resolveMktInst() {
  const c = getCtx();
  if (!c.broker || !c.symbol) {
    state.mktInst = null;
    unsubscribeMktQuotes();
    return;
  }
  const key = c.broker + '|' + c.symbol;
  if (key === state.mktInstKey && state.mktInst) {
    applyMktInst();
    subscribeMktQuotes(c.broker, state.mktInst);
    if (state.recalcStake) state.recalcStake();
    if (state.syncSideGate) state.syncSideGate();
    return;
  }
  const a = /** @type {any} */ (broker.for(c.broker));
  if (!a || !a.resolveSymbol) return;
  a.resolveSymbol(
    c.symbol,
    /** @param {any} inst */ (inst) => {
      if (inst && getCtx().symbol === c.symbol) {
        state.mktInst = inst;
        state.mktInstKey = key;
        applyMktInst();
        syncFields();
        subscribeMktQuotes(c.broker, inst);
        if (state.recalcStake) state.recalcStake();
        if (state.syncSideGate) state.syncSideGate();
      }
    },
  );
}

// LIVE QUOTE subscription for the Stake preview -- the ticket needs a fill-price estimate to size a market order (the
// reference app tracks bid/ask the same way and recomputes units on every tick). Subscribe once per broker|symbol; a
// tick stores the latest bid/ask and re-runs the active form's Stake preview. Cleaned up when the symbol changes.
/** @param {string} brokerId @param {any} inst */
export function subscribeMktQuotes(brokerId, inst) {
  if (!inst || !inst.id) return;
  const key = brokerId + '|' + inst.id;
  if (key === state.qSubKey && state.qSub) return; // already streaming this symbol
  unsubscribeMktQuotes();
  const a = /** @type {any} */ (broker.for(brokerId));
  if (!a || !a.subscribeQuotes) return;
  const cb = (/** @type {any} */ q) => {
    const bid = Number(q.bid),
      ask = Number(q.ask);
    if (isFinite(bid) && bid > 0) state.mktBid = bid;
    if (isFinite(ask) && ask > 0) state.mktAsk = ask;
    if (state.refreshQuote) state.refreshQuote();
    if (state.recalcStake) state.recalcStake();
    if (state.syncSideGate) state.syncSideGate();
    if (state.recomputeDist) state.recomputeDist();
  };
  a.subscribeQuotes(inst.id, cb);
  state.qSub = { brokerId, id: inst.id, cb };
  state.qSubKey = key;
}
export function unsubscribeMktQuotes() {
  if (!state.qSub) return;
  const a = /** @type {any} */ (broker.for(state.qSub.brokerId));
  try {
    if (a && a.unsubscribeQuotes) a.unsubscribeQuotes(state.qSub.id, state.qSub.cb);
  } catch (_) {}
  state.qSub = null;
  state.qSubKey = '';
  state.mktBid = 0;
  state.mktAsk = 0;
}

// The risk$ driving the sized preview: the typed stake, or -- on a money-management account -- the engine's
// answer for the selected account (cached snapshot; refreshMM keeps it current). 0 = nothing to size with.
export function previewRisk() {
  if (state.qtType === 'mm') return state.mmSnap && state.mmSnap.risk > 0 ? Number(state.mmSnap.risk) : 0;
  return state.qtType === 'stake' ? Number(state.mktStake) || 0 : 0;
}

// Refresh the cached MM snapshot for the SELECTED account and re-arm the form: qtType locks to 'mm' when the
// account is on money management (restores Units/Stake otherwise), then the preview + side gate re-run.
// Called on account change, a fills change (a closed trade moves the ladder), and an MM config edit --
// never on a quote tick (the per-tick work stays the one cheap sizeFromStake below, same as Stake).
export function refreshMM() {
  const c = getCtx();
  state.mmSnap = c.broker ? mmSnapshot({ broker: c.broker, accountId: c.accountId }) : null;
  if (state.mmSnap) {
    if (state.qtType !== 'mm') {
      state.qtType = 'mm';
      planControl.setSizing(null); // entering MM: clear any stale stake intent -- MM stores nothing in the plan
    }
  } else if (state.qtType === 'mm') state.qtType = 'units';
  if (state.syncQtType) state.syncQtType(); // rebuild the Qt-type select (locked 'mm' vs Units/Stake)
  if (state.recalcStake) state.recalcStake();
  if (state.syncSideGate) state.syncSideGate();
}

// Position-sizing PREVIEW -- the SAME pure rule the order-host runs at fire-time (sizeFromStake), mirrored in the UI so
// the Volume box shows the sized contracts live. entry = the fill estimate: the live quote (market) or the resting
// order's price (limit/stop). Returns the qty, or null when there isn't enough to size yet (no quote / no stop / no
// tick value). The worker re-sizes authoritatively at fire, so this is a display, never the source of truth.
/** @param {number} entry @param {number} stop @returns {number|null} */
export function previewStakeUnits(entry, stop) {
  const inst = state.mktInst;
  const risk = previewRisk();
  if (!inst || !(entry > 0) || !(risk > 0) || !(stop > 0)) return null;
  const r = sizeFromStake({
    risk,
    entryPrice: entry,
    stopPrice: stop,
    tickSize: Number(inst.tickSize),
    tickValue: Number(inst.tickValue),
    volumeStep: inst.volumeStep,
    minVolume: inst.minVolume,
    maxVolume: inst.maxVolume,
  });
  return r.qty; // 0 = valid inputs but too small to size (below min); shown as 0 so the trader sees "risk too tight"
}

// Wire a Volume input as the sized live-preview: in Stake / MM mode it goes READ-ONLY (grayed) and displays the
// computed qty; in Units mode it's the editable volume. entryOf() supplies the fill estimate for the active tab.
// Returns the recompute fn (stored on state so quote ticks and field edits can re-run it).
/** @param {HTMLInputElement} volInput @param {() => number} entryOf @param {() => number} stopOf @returns {() => void} */
export function wireStakePreview(volInput, entryOf, stopOf) {
  const recalc = () => {
    if (state.qtType !== 'stake' && state.qtType !== 'mm') {
      volInput.disabled = false;
      volInput.classList.remove('ot-computed');
      volInput.title = '';
      volInput.value = String(state.mktVol);
      planControl.setSizing(null); // Units mode: the plan carries no sizing intent (qty is the Volume oninput's job)
      return;
    }
    volInput.disabled = true;
    volInput.classList.add('ot-computed');
    // STAKE: the plan carries the typed SIZING INTENT (user intent -> stored) so the on-chart pill's V places the
    // SAME way the dialog's Buy/Sell does (worker-sized); plan.qty mirrors the Volume box.
    // MM: the plan gets NO qty/sizing writes -- the number is DERIVED wherever it is shown (the chart overlay
    // derives its own from the same resolver; the worker decides at fire). Storing it would be a shadow copy.
    const mm = state.qtType === 'mm';
    const risk = previewRisk();
    const sizing = !mm && risk > 0 && stopOf() > 0 ? { risk, stop: stopOf() } : null;
    const u = previewStakeUnits(entryOf(), stopOf());
    if (u == null) {
      volInput.value = '';
      volInput.title = mm ? 'set a stop' : 'enter a stake + stop';
      if (!mm) planControl.setSizing(sizing);
      return;
    }
    volInput.value = String(u);
    volInput.title = u > 0 ? '' : 'risk too tight for one unit';
    state.mktVol = u > 0 ? u : state.mktVol; // keep the shared volume in step (status text, intent fallback qty)
    if (!mm) planControl.setQtyAndSizing(state.mktVol, sizing); // pill reflects the Volume box AND carries the sizing so V sizes like the dialog
  };
  return recalc;
}
