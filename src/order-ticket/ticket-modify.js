// @ts-check
// Order-ticket MODIFY editors -- the Modify tab bodies for the two contexts: a loaded
// POSITION (SL/TP editor with linked price/distance boxes + Partial/Close) and a resting
// ORDER (Volume + Price editor, with pending-order SL/TP on hedging accounts). All
// actions route through the ORDER WORKER commands (the single owner of execution) -- the
// UI never calls the broker directly; the dialog only mirrors the ack in its status line.
import { broker, command, platform } from '../../data_engine/index.js';
import { mktRow, seedSpinner } from './ticket-controls.js';
import { state } from './ticket-state.js';
import { unitInfo, round1 } from './ticket-levels.js';   // shared pip/point unit + rounding (one impl across the ticket)
import { t } from '../i18n/i18n.js';   // vocabulary lookup -- execution-layer words are overridable

// A protective level sits below entry for a long's stop / a short's target (else above). Distance is measured
// from the ENTRY price and is a positive magnitude for a normal protective placement.
/** @param {string} kind @param {string} side @returns {boolean} */
const sitsBelow = (kind, side) => (kind === 'sl' && side !== 'short') || (kind === 'tp' && side === 'short');

// Reflect an order-WORKER command ack ({ ok, error }) in a Modify-tab status line. The worker owns execution + journals
// the action and the broker's reply; the dialog only mirrors success/failure here.
/** @param {HTMLElement} el @param {any} r @param {string} okText */
function cmdStatus(el, r, okText) {
  const ok = !!(r && r.ok);
  el.textContent = ok ? okText : ((r && r.error) || t('failed'));
  el.className = 'ot-mod-status ' + (ok ? 'ok' : 'err');
}

// The Modify tab's SL/TP editor: each level has a PRICE box and a linked DISTANCE box (points/pips from entry),
// prefilled from the position's current SL/TP. The Modify button pushes the new prices to the broker.
/** @param {any} ctx */
export function buildModifyEditor(ctx) {
  const wrap = document.createElement('div'); wrap.className = 'ot-modify';
  const dec = ctx.priceDecimals != null ? Number(ctx.priceDecimals) : 2;
  const unit = unitInfo(dec);
  const entry = Number(ctx.avgPrice);
  const side = String(ctx.side || 'long');
  const priceStep = ctx.tickSize ? Number(ctx.tickSize) : Math.pow(10, -dec);
  const fmtP = (/** @type {any} */ v) => (v == null || Number.isNaN(Number(v))) ? '' : Number(v).toFixed(dec);
  let guard = false;
  /** @type {{ kind: string, apply: (v: any) => void }[]} */
  const syncers = [];   // per-level live-sync hooks (populated by levelRow), driven by state.syncModify below
  /** @type {{ kind: string, xBtn: HTMLButtonElement, setZero: () => void }[]} */
  const levelCtl = [];  // per-level X (remove) controls, wired below once both levels + the status line exist

  /** @param {string} kind @param {string} label @param {any} initPrice @returns {HTMLInputElement} */
  function levelRow(kind, label, initPrice) {
    const r = document.createElement('div'); r.className = 'ot-mod-row'; r.style.gap = '6px';   // match the account/symbol row gap so the column edges line up
    const lbl = document.createElement('label'); lbl.className = 'ot-mod-label'; lbl.style.flex = '0 0 47.3px'; lbl.textContent = t(label);   // == "Account:" width -> the Stop/Target box left edge lands on the account box's
    const price = document.createElement('input'); price.type = 'number'; price.className = 'ot-mod-price'; price.step = String(priceStep); price.min = '0';
    price.style.flex = '0 0 120px';   // == account box width -> the Stop/Target box's LEFT and RIGHT edges both land on the account box's (a spacer below absorbs the slack so the Dist column stays pinned right)
    const dist = document.createElement('input'); dist.type = 'number'; dist.className = 'ot-mod-dist'; dist.step = '1'; dist.min = '0'; dist.style.flex = '1 1 auto';
    const unitLbl = document.createElement('span'); unitLbl.className = 'ot-mod-unit'; unitLbl.textContent = unit.label;
    // Align to the account/symbol row above: a placeholder reserves the "Symbol:" label's width so the PRICE box's right
    // edge lands on the Account box's right edge; the distance+unit ride in a 120px group (== the Symbol combo width) so
    // the DISTANCE box's LEFT edge lands on the combo's left edge. The placeholder shows a visible "Dist:" label that rides
    // on top of an invisible "Symbol:" SIZER (grid overlay) -- so it keeps the exact reservation width at any font/locale.
    const ph = document.createElement('span'); ph.style.cssText = 'display:inline-grid;justify-items:end;align-items:center;flex:0 0 auto;font-size:12px;color:var(--tx-dim);';
    const phSizer = document.createElement('span'); phSizer.className = 'ot-label'; phSizer.textContent = t('Symbol:'); phSizer.style.cssText = 'grid-area:1/1;visibility:hidden;';
    const phLabel = document.createElement('span'); phLabel.textContent = t('Dist:'); phLabel.style.cssText = 'grid-area:1/1;';
    ph.append(phSizer, phLabel);
    const distGroup = document.createElement('div'); distGroup.style.cssText = 'flex:0 0 120px;display:flex;align-items:center;gap:6px;min-width:0;';
    distGroup.append(dist, unitLbl);
    const below = sitsBelow(kind, side);
    const toDist = (/** @type {number} */ p) => round1((below ? (entry - p) : (p - entry)) / unit.size);
    const toPrice = (/** @type {number} */ dv) => (below ? (entry - dv * unit.size) : (entry + dv * unit.size));
    if (initPrice != null && Number(initPrice) > 0 && Number.isFinite(entry)) { price.value = fmtP(initPrice); dist.value = String(toDist(Number(initPrice))); }
    else { price.value = fmtP(0); dist.value = '0'; }
    // X (remove) box right after the price -- clears this protective level on the LIVE position. Shown only when the
    // level is currently set (a price > 0); hidden when there's nothing to remove.
    const xBtn = /** @type {HTMLButtonElement} */ (document.createElement('button')); xBtn.type = 'button'; xBtn.className = 'ot-lvl-x'; xBtn.textContent = '✕'; xBtn.title = t('Remove this level');
    const updateX = () => { xBtn.style.display = (Number(price.value) > 0) ? '' : 'none'; };
    price.oninput = () => { if (!guard && Number.isFinite(entry)) { guard = true; dist.value = String(toDist(Number(price.value))); guard = false; } updateX(); };
    dist.oninput = () => { if (guard || !Number.isFinite(entry)) return; guard = true; price.value = fmtP(toPrice(Number(dist.value))); guard = false; updateX(); };
    // live-sync this level from the book: set BOTH the price and its linked distance, unless the user is editing either box
    syncers.push({ kind, apply: (/** @type {any} */ v) => {
      if (document.activeElement === price || document.activeElement === dist) return;
      const val = Number(v) > 0 ? Number(v) : 0;
      price.value = fmtP(val); dist.value = (val > 0 && Number.isFinite(entry)) ? String(toDist(val)) : '0'; updateX();
    } });
    levelCtl.push({ kind, xBtn, setZero: () => { guard = true; price.value = fmtP(0); dist.value = '0'; guard = false; updateX(); } });
    updateX();
    const spacer = document.createElement('span'); spacer.style.flex = '1 1 auto';   // absorbs the gap between the fixed price box and the right-pinned Dist column
    r.append(lbl, price, xBtn, spacer, ph, distGroup); wrap.appendChild(r);
    return price;
  }
  const slPrice = levelRow('sl', 'Stop Loss:', ctx.stopLoss);
  const tpPrice = levelRow('tp', 'Take Profit:', ctx.takeProfit);
  // LIVE SYNC: reflect the position's current SL/TP into the fields on any book change (e.g. dragging the on-chart hedge
  // pills), skipping a box the user is editing. Reads the loaded lot (hedging) or net position (netting) by ticket/symbol.
  state.syncModify = () => {
    const live = /** @type {any} */ (platform.positionLots.all().find((l) => String(l.ticket) === String(ctx.ticket) && (!ctx.broker || l.broker === ctx.broker))
      || platform.positions.all().find((p) => p.symbol === ctx.symbol && (!ctx.broker || p.broker === ctx.broker) && Number(p.qty) > 0));
    if (!live) return;   // position closed -- leave the fields; the mini table shows the new state
    for (const s of syncers) s.apply(s.kind === 'sl' ? live.stopLoss : live.takeProfit);
  };

  const status = document.createElement('span'); status.className = 'ot-mod-status';
  // wire each level's X: remove that protective leg on the LIVE position -- modifyPosition with the leg zeroed and the
  // other leg kept at its current price (the "send both legs, 0 = remove" contract the Modify button + chart pill use).
  for (const lc of levelCtl) {
    lc.xBtn.onclick = () => {
      const sl = lc.kind === 'sl' ? 0 : (Number(slPrice.value) || 0);
      const tp = lc.kind === 'tp' ? 0 : (Number(tpPrice.value) || 0);
      status.textContent = t('Removing…'); status.className = 'ot-mod-status';
      command({ type: 'modifyPosition', broker: ctx.broker, ticket: ctx.ticket, stopLoss: sl, takeProfit: tp }).then((/** @type {any} */ r) => cmdStatus(status, r, t('Removed'))).catch((/** @type {any} */ e) => cmdStatus(status, { error: (e && e.message) || String(e) }, ''));
      lc.setZero();
    };
  }
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ot-btn-primary'; btn.textContent = t('Modify');
  btn.onclick = () => {
    const sl = Number(slPrice.value) || 0, tp = Number(tpPrice.value) || 0;   // 0 = no bracket on that side
    // Route through the ORDER WORKER (the single owner of execution) -- the UI never calls the broker directly. The
    // worker journals the action + the broker's reply; the dialog only reflects the ack in its status line.
    status.textContent = t('Sending...'); status.className = 'ot-mod-status';
    command({ type: 'modifyPosition', broker: ctx.broker, ticket: ctx.ticket, stopLoss: sl, takeProfit: tp }).then((/** @type {any} */ r) => cmdStatus(status, r, t('Modified'))).catch((/** @type {any} */ e) => cmdStatus(status, { error: (e && e.message) || String(e) }, ''));
  };
  // [Close] sits next to Modify -- it closes ONLY THIS position (by ticket, via closeLot). Never closePosition
  // (that's close-all-for-symbol). Lives here in the Modify editor, so it only exists when a real position is loaded.
  const closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'ot-btn-close'; closeBtn.textContent = t('Close'); closeBtn.title = t('Close this position');
  closeBtn.onclick = () => {
    if (ctx.ticket == null) { status.textContent = t('no position'); status.className = 'ot-mod-status err'; return; }
    status.textContent = t('Closing…'); status.className = 'ot-mod-status';
    command({ type: 'closeLot', broker: ctx.broker, ticket: ctx.ticket }).then((/** @type {any} */ r) => cmdStatus(status, r, t('Closed'))).catch((/** @type {any} */ e) => cmdStatus(status, { error: (e && e.message) || String(e) }, ''));
  };
  // [Partial] closes X qty of THIS position (closeLotPartial). Qty entered in the adjacent input.
  const qtyIn = document.createElement('input'); qtyIn.type = 'number'; qtyIn.className = 'ot-mod-dist ot-mod-qty'; qtyIn.min = '0'; qtyIn.step = 'any'; qtyIn.placeholder = t('Qty'); qtyIn.title = t('Quantity to close');
  const partialBtn = document.createElement('button'); partialBtn.type = 'button'; partialBtn.className = 'ot-btn-close'; partialBtn.textContent = t('Partial'); partialBtn.title = t('Close part of this position');
  partialBtn.onclick = () => {
    const q = Number(qtyIn.value);
    if (ctx.ticket == null) { status.textContent = t('no position'); status.className = 'ot-mod-status err'; return; }
    if (!(q > 0)) { status.textContent = t('enter qty'); status.className = 'ot-mod-status err'; return; }
    status.textContent = t('Closing') + ' ' + q + '…'; status.className = 'ot-mod-status';
    command({ type: 'closeLot', broker: ctx.broker, ticket: ctx.ticket, qty: q }).then((/** @type {any} */ r) => cmdStatus(status, r, t('Closed') + ' ' + q)).catch((/** @type {any} */ e) => cmdStatus(status, { error: (e && e.message) || String(e) }, ''));
  };
  // Bottom actions as a right-aligned 2x2 grid: [Close][Modify] over [Qty][Partial]. Fixed-width columns make each
  // column's two controls share their left+right edges -- Close aligns over the Qty INPUT, Modify over Partial. The
  // transient status line rides to the left of the grid (fills the empty space, adds no height).
  const grid = document.createElement('div'); grid.className = 'ot-mod-grid';
  grid.append(closeBtn, btn, qtyIn, partialBtn);   // row 1: Close, Modify ; row 2: Qty, Partial
  const bottom = document.createElement('div'); bottom.className = 'ot-mod-bottom';
  bottom.append(status, grid);
  wrap.append(bottom);
  return wrap;
}

// The Modify tab for a resting ORDER (a clicked stop/limit dot). Volume + Price for every account; on a HEDGING account a
// limit/stop order also gets Stop Loss + Take Profit (pending-order exits). [Modify] pushes them via the adapter's
// modifyOrder (price/qty[/SL/TP] of a working order); [Cancel] pulls it.
/** @param {any} o the order context { broker, symbol, id, type, side, qty, price, stopLoss?, takeProfit?, hedging? } @returns {HTMLElement} */
export function buildOrderModifyEditor(o) {
  const wrap = document.createElement('div'); wrap.className = 'ot-market ot-modify ot-ls-grid';
  // Same 180px col1 as the Limit/Stop entry tabs -- Volume / Price / Stop / Target all stack in ONE column (identical
  // layout), so the boxes' left edge lands on the account box above (the shared 47.3px label guide).
  wrap.style.gridTemplateColumns = '180px minmax(0, 1fr)';
  let dec = o.priceDecimals != null ? Number(o.priceDecimals) : 2;
  let step = o.tickSize ? Number(o.tickSize) : Math.pow(10, -dec);
  let vol = Number(o.qty) > 0 ? Number(o.qty) : 1;
  let price = Number(o.price) > 0 ? Number(o.price) : 0;
  // col1: Volume + Price (every account type)
  const volRow = mktRow('Volume:', vol, { step: 1, min: 1 });
  volRow.row.style.gridColumn = '1 / 2'; volRow.row.style.gridRow = '1';
  const priceRow = mktRow('Price:', price, { step });
  priceRow.row.style.gridColumn = '1 / 2'; priceRow.row.style.gridRow = '2';
  // Volume/Price are 120px, matching every other input (Qt type / Stake / Stop / Target / Account / Symbol).
  volRow.input.style.flex = '0 0 120px'; priceRow.input.style.flex = '0 0 120px';
  volRow.input.oninput = () => { vol = Math.max(1, Math.round(Number(volRow.input.value) || 1)); };
  priceRow.input.oninput = () => { price = Number(priceRow.input.value) || 0; };
  // col2: HEDGING-only SL/TP on the pending order (broker-native), prefilled from the order's current exits. The whole
  // column hides on netting/market context and, because the grid tracks are fixed, nothing reflows -- EXACTLY the Limit/Stop tabs.
  const showSltp = !!o.hedging && (o.type === 'limit' || o.type === 'stop');
  let sl = Number(o.stopLoss) > 0 ? Number(o.stopLoss) : 0;
  let tp = Number(o.takeProfit) > 0 ? Number(o.takeProfit) : 0;
  // Stop / Target stack UNDER Price in col1 (rows 3-4) -- left-aligned, 47.3px label + 120px box, exactly like the
  // Limit/Stop entry tabs. mktRow already gives the 120px box, so no per-row override is needed.
  const slRow = mktRow('Stop Loss:', sl, { step, min: -1 }); slRow.row.style.gridColumn = '1 / 2'; slRow.row.style.gridRow = '3';
  const tpRow = mktRow('Take Profit:', tp, { step, min: -1 }); tpRow.row.style.gridColumn = '1 / 2'; tpRow.row.style.gridRow = '4';
  // SEED-FROM-PRICE (same as the Limit/Stop tabs): a 0 field seeds its first spinner tick from the Price field
  // (up = price + step, down = price - step); a typed/prefilled level is left as-is; a value left negative clamps to 0.
  // getRef/getDec read the live `price`/`dec` locals (resolveSymbol updates dec/step below). See seedSpinner (ticket-controls).
  seedSpinner(slRow.input, { getRef: () => price, getDec: () => dec, set: (v) => { sl = v; } });
  seedSpinner(tpRow.input, { getRef: () => price, getDec: () => dec, set: (v) => { tp = v; } });
  // LIVE SYNC: re-read this order from the book and reflect its price/SL/TP/qty into the fields on any book change (e.g.
  // dragging the on-chart pills, or the leg's X). Skips a field the user is actively editing so we never fight their input.
  const fmtP = (/** @type {number} */ v) => (v == null || Number.isNaN(Number(v))) ? '' : Number(v).toFixed(dec);
  state.syncModify = () => {
    const live = /** @type {any} */ (platform.orders.all().find((x) => String(x.id) === String(o.id) && (!o.broker || x.broker === o.broker)));
    if (!live) return;   // order filled/cancelled -- leave the fields as they are; the mini table shows the new state
    if (document.activeElement !== priceRow.input) { const v = Number(live.price) > 0 ? Number(live.price) : 0; priceRow.input.value = fmtP(v); price = v; }
    if (document.activeElement !== slRow.input) { const v = Number(live.stopLoss) > 0 ? Number(live.stopLoss) : 0; slRow.input.value = v > 0 ? fmtP(v) : '0'; sl = v; }
    if (document.activeElement !== tpRow.input) { const v = Number(live.takeProfit) > 0 ? Number(live.takeProfit) : 0; tpRow.input.value = v > 0 ? fmtP(v) : '0'; tp = v; }
    if (document.activeElement !== volRow.input) { const v = Number(live.qty) > 0 ? Number(live.qty) : vol; volRow.input.value = String(v); vol = v; }
  };
  // Always SHOW the SL/TP column (complete, consistent grid on every account type); GRAY IT OUT (disabled + dimmed)
  // when it doesn't apply -- netting, or a market-context order -- instead of hiding it.
  const syncSltp = () => { const dim = showSltp ? '' : '0.45'; slRow.row.style.display = ''; slRow.row.style.opacity = dim; slRow.input.disabled = !showSltp; tpRow.row.style.display = ''; tpRow.row.style.opacity = dim; tpRow.input.disabled = !showSltp; };
  syncSltp();
  wrap.append(volRow.row, slRow.row, priceRow.row, tpRow.row);
  // resolve the instrument so the price spinner steps by the tick (async; the field is usable meanwhile)
  const ra = /** @type {any} */ (broker.for(o.broker));
  if (ra && ra.resolveSymbol) ra.resolveSymbol(o.symbol, /** @param {any} inst */ (inst) => { if (inst) { dec = inst.priceDecimals != null ? Number(inst.priceDecimals) : dec; step = inst.tickSize ? Number(inst.tickSize) : step; priceRow.input.step = String(step); slRow.input.step = String(step); tpRow.input.step = String(step); } });

  const actions = document.createElement('div'); actions.className = 'ot-mod-actions';
  actions.style.gridColumn = '1 / 3'; actions.style.gridRow = '5';   // span the content columns, below the Target row
  const status = document.createElement('span'); status.className = 'ot-mod-status';
  const cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'ot-btn-close'; cancelBtn.textContent = t('Cancel'); cancelBtn.title = t('Cancel this order');
  const modBtn = document.createElement('button'); modBtn.type = 'button'; modBtn.className = 'ot-btn-primary'; modBtn.textContent = t('Modify');
  modBtn.onclick = () => {
    if (!(price > 0)) { status.textContent = t('enter a price'); status.className = 'ot-mod-status err'; return; }
    if (!(vol > 0)) { status.textContent = t('enter volume'); status.className = 'ot-mod-status err'; return; }
    status.textContent = t('Sending…'); status.className = 'ot-mod-status';
    /** @type {any} */ const cmd = { type: 'modifyOrder', broker: o.broker, id: o.id, price, qty: vol };
    if (showSltp) { cmd.stopLoss = sl; cmd.takeProfit = tp; }   // hedging pending order: carry the SL/TP prices
    command(cmd).then((/** @type {any} */ r) => cmdStatus(status, r, t('Modified'))).catch((/** @type {any} */ e) => cmdStatus(status, { error: (e && e.message) || String(e) }, ''));
  };
  cancelBtn.onclick = () => {
    status.textContent = t('Canceling…'); status.className = 'ot-mod-status';
    command({ type: 'cancel', broker: o.broker, id: o.id }).then((/** @type {any} */ r) => cmdStatus(status, r, t('Canceled'))).catch((/** @type {any} */ e) => cmdStatus(status, { error: (e && e.message) || String(e) }, ''));
  };
  actions.append(status, cancelBtn, modBtn);
  wrap.append(actions);
  return wrap;
}
