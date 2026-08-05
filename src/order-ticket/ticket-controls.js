// @ts-check
// Shared FORM CONTROLS for the order ticket -- the small widget builders reused across the entry tabs and the Modify
// editors: the label:input number row (mktRow) and the Qt-type (quantity-type) selector. Kept here as a leaf so
// ticket-entry and ticket-modify share ONE implementation without importing each other (no cycle). The only
// state it touches is the shared qtType.
import { state, restingBracketCap } from './ticket-state.js';
import { restingBracketAllowed } from './order-intent.js'; // the ONE rule for "may a resting order carry a bracket"
import { t } from '../i18n/i18n.js'; // vocabulary lookup -- the order ticket is the execution layer; every word here is overridable

/** @param {string} label @param {number} value @param {{ step?: number|string, min?: number }} [o] @returns {{ row: HTMLElement, input: HTMLInputElement }} */
export function mktRow(label, value, o = {}) {
  const row = document.createElement('div');
  row.className = 'ot-mod-row';
  const lbl = document.createElement('label');
  lbl.className = 'ot-mod-label';
  lbl.textContent = t(label);
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'ot-mod-price';
  input.style.flex = '0 0 120px'; // fixed width == the col2 boxes (Qt type / Stake / Exp), so every entry-tab input is one width
  input.step = String(o.step != null ? o.step : 'any');
  input.min = String(o.min != null ? o.min : 0);
  input.value = String(value);
  row.append(lbl, input);
  return { row, input };
}

// Qt type (quantity type): how the Volume field is READ -- Units (contracts) | Stake ($ risk).
// Sits in col1 as the TOP row ABOVE Volume on every entry tab (Market/Limit/Stop, not Modify), so the choice reads
// first and carries across tabs; Stake shares its row (col2). Label uses the col1 width (47.3px) so the select's left
// edge lines up with the Volume box below it. Sets state.qtType; onChange fires after (reveal/hide Stake + re-preview).
/** @param {() => void} [onChange] @returns {HTMLElement} */
export function buildQtTypeRow(onChange) {
  const row = document.createElement('div');
  row.className = 'ot-mod-row';
  const lbl = document.createElement('label');
  lbl.className = 'ot-mod-label';
  lbl.textContent = t('Qt type:');
  const sel = document.createElement('select');
  sel.className = 'ot-input';
  sel.style.flex = '0 0 120px'; // == Exp/Symbol box width
  /** @type {[string,string][]} */ ([
    ['units', 'Units'],
    ['stake', 'Stake'],
  ]).forEach(([v, l]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t(l);
    sel.appendChild(o);
  });
  sel.value = state.qtType;
  sel.onchange = () => {
    state.qtType = sel.value;
    if (onChange) onChange();
  };
  row.append(lbl, sel);
  return row;
}

// SL/TP on a resting order is enabled per the broker's PROTOCOL, not the account type alone: an order-level bracket
// (CQG) works on netting; a position-level one (MT5) needs hedging; others have none (see restingBracketAllowed).
// Rather than HIDE the column when unavailable (which left the grid looking different per account and hard to reason
// about), always SHOW it and GRAY IT OUT (disabled + dimmed) when it doesn't apply, so the grid is complete and
// legible on every account/broker. Re-applied when the Account dropdown changes.
export const syncLsSltp = () => {
  if (!state.lsSltpRows) return;
  const sa = state.selectedAccount;
  const on = !!sa && restingBracketAllowed(restingBracketCap(sa.broker), sa.hedging);
  const dim = on ? '' : '0.45';
  state.lsSltpRows.sl.style.display = '';
  state.lsSltpRows.sl.style.opacity = dim;
  state.lsSltpRows.tp.style.display = '';
  state.lsSltpRows.tp.style.opacity = dim;
  if (state.lsSltpRows.slDist) state.lsSltpRows.slDist.style.opacity = dim; // the Dist boxes ride with their SL/TP levels
  if (state.lsSltpRows.tpDist) state.lsSltpRows.tpDist.style.opacity = dim;
  if (state.lsInputs) {
    if (state.lsInputs.sl) state.lsInputs.sl.disabled = !on;
    if (state.lsInputs.tp) state.lsInputs.tp.disabled = !on;
    if (state.lsInputs.slDist) state.lsInputs.slDist.disabled = !on;
    if (state.lsInputs.tpDist) state.lsInputs.tpDist.disabled = !on;
  }
};

// SEED-FROM-REFERENCE spinner: the field starts at 0; the FIRST spinner tick doesn't count 0 -> one step, it
// seeds from a REFERENCE price (the live market on Market, the order Price on Limit/Stop) and counts from THERE (up-roll
// = ref + step, down-roll = ref - step). Detected as "was 0, moved exactly one step" so TYPING a real level is untouched;
// a value left negative clamps to 0 (= no level). getRef/getDec are read LIVE on each input so a moving reference (a
// quote tick) is honoured. One impl for all three seed fields (Market, Limit/Stop, order-Modify) so they never drift.
/** @param {HTMLInputElement} input @param {{ getRef: () => number, getDec: () => number, set: (v: number) => void }} o */
export function seedSpinner(input, o) {
  let prev = Number(input.value) || 0;
  input.oninput = () => {
    const step = Number(input.step) || 0;
    let v = Number(input.value) || 0;
    const ref = Number(o.getRef()) || 0;
    if (prev === 0 && v !== 0 && step > 0 && Math.abs(Math.abs(v) - step) < step / 2 && ref > 0) {
      v = Number((v > 0 ? ref + step : ref - step).toFixed(o.getDec()));
      input.value = String(v);
    }
    if (v < 0) {
      v = 0;
      input.value = '0';
    }
    o.set(v);
    prev = v;
  };
}
