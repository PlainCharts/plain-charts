// @ts-check
// Order-ticket ENTRY FORMS -- the Market tab grid (Volume / SL / TP + Project/Bracket +
// Buy/Sell) and the Limit/Stop tab grid (Volume / Price / Expiration + the HEDGING-only
// SL/TP column) with their Buy/Sell actions. Buy/Sell SEND a `place` command to the order
// worker (the execution layer); no order logic here. Shared form state lives in ticket-state.js.
import { command } from '../../data_engine/index.js';
import { setProjecting, setLevels } from '../chart/order-view/plan-store.js'; // enterPlaced ends planning; newOrder re-begins it (arms a fresh projection); other level writes go through planControl
import { state, getCtx, render } from './ticket-state.js';
import { attachDist } from './ticket-levels.js';
import { mktRow, buildQtTypeRow, syncLsSltp, seedSpinner } from './ticket-controls.js'; // shared form-control builders (leaf; also used by ticket-modify + ticket-top)
import { resolveMktInst, applyMktInst, wireStakePreview } from './ticket-quotes.js'; // the ticket's market-data feed: instrument resolve + quote sub + stake preview
import { syncFields } from './ticket-plan-sync.js';
import { sideForSetup, buildPlaceIntent } from './order-intent.js'; // pure domain rules (direction gate + place-intent) -- no DOM/store
import { planControl } from './plan-control.js'; // the ONE seam for field -> plan-store writes (owns the flip/snap/pivot + isProjecting guard)
import { t } from '../i18n/i18n.js'; // vocabulary lookup -- the order ticket is the execution layer; every word here is overridable

// --- post-placement "placed" state: after a successful order, gray the form and swap Buy/Sell for one New Order button,
// so the user re-arms in place instead of closing + reopening to clear stale values (a confirm-then-reset flow) ---
/** enter the placed state after a successful order: show the ack, gray the form (renderBody adds .ot-placed). A
 *  successful placement ENDS the planning session, so drop the projection here -- the same exit the pill's V (place)
 *  and X (cancel) already use. Without this the planning primitive lingered on top of the just-placed order. @param {string} msg */
function enterPlaced(msg) {
  state.placed = true;
  state.placedMsg = msg;
  const c = getCtx();
  if (c.symbol) setProjecting(c.broker, c.symbol, false);
  render();
}
/** New Order: re-arm the dialog IN PLACE -- reset the form to fresh defaults, un-gray, and RE-BEGIN planning with a
 *  fresh projection. This is the entrance side of the cycle (place/cancel -> terminal -> New order -> plan again),
 *  mirroring a dialog open. No close. */
function newOrder() {
  state.placed = false;
  state.placedMsg = '';
  state.mktVol = 1;
  state.mktSl = 0;
  state.mktTp = 0;
  state.mktStake = 0;
  state.lsPrice = 0;
  state.lsSl = 0;
  state.lsTp = 0;
  state.lsTif = 'gtc';
  state.lsGtdDate = '';
  const c = getCtx();
  // New order only shows on entry tabs, so re-arm a fresh projection typed to the current tab -> a new planning
  // primitive appears at the live price (same seed as opening the dialog).
  if (c.symbol && (state.active === 'market' || state.active === 'limit' || state.active === 'stop')) {
    setProjecting(c.broker, c.symbol, true);
    setLevels(c.broker, c.symbol, { orderType: state.active, qty: state.mktVol });
  }
  render();
}
/** the placed-state bottom block: the ack + a single New Order button in the Buy/Sell row's place. @returns {HTMLElement} */
function buildPlacedActions() {
  const wrap = document.createElement('div');
  wrap.className = 'ot-mkt-actions';
  const status = document.createElement('div');
  status.className = 'ot-foot-status';
  status.textContent = state.placedMsg || t('order sent');
  const row = document.createElement('div');
  row.className = 'ot-bar-row';
  const nu = document.createElement('button');
  nu.type = 'button';
  nu.className = 'ot-btn-primary ot-btn-new';
  nu.textContent = t('New order');
  nu.onclick = newOrder;
  row.append(nu);
  wrap.append(status, row);
  return wrap;
}

// Buy/Sell GATE: a bracket implies a DIRECTION -- Stop BELOW the entry (Target above) is a LONG; Stop ABOVE is a SHORT.
// So the button that contradicts the setup is disabled: long -> Sell off, short -> Buy off. Entry = the live market
// (Market tab) or the order Price (Limit/Stop). No levels, or no entry reference yet -> both buttons work.
// sideForSetup (the direction rule) lives in order-intent.js; this is just the DOM gate that acts on its verdict.
/** @param {HTMLButtonElement} buyBtn @param {HTMLButtonElement} sellBtn @param {'long'|'short'|null} side */
function applySideGate(buyBtn, sellBtn, side) {
  buyBtn.disabled = side === 'short';
  sellBtn.disabled = side === 'long';
}

// The Market tab is ONE fixed grid (columns x rows). Every control is placed in a cell by grid-row/grid-column, so
// hiding any cell / row / column leaves the rest exactly in place. Layout (see .ot-mkt-grid in the CSS):
//   col1 (label:input) | col2 (checkbox) | 40px gear gutter
//   row1 Volume | row2 Stop Loss + [x] Project | row3 Take Profit + [x] Bracket | row4 1fr spacer |
//   row5 status(span) | row6 Buy/Sell(span, two equal buttons)   (Project first; Bracket is its extension)
export function buildMarketForm() {
  const grid = document.createElement('div');
  grid.className = 'ot-mkt-grid';
  // Volume / Stop Loss / Take Profit -- identical label:input rows (mktRow) stacked in col 1, so their colons and inputs
  // line up in one column. col 1 is fixed-width, so all three inputs align exactly (see .ot-mkt-grid grid-template-columns).
  const vol = mktRow('Volume:', state.mktVol, { step: 1, min: 1 });
  vol.row.style.gridColumn = '1 / 2';
  vol.row.style.gridRow = '2';
  // Volume edits sync to plan.qty while projecting -- the on-chart pill's qty cell shows/edits the SAME value
  vol.input.oninput = () => {
    state.mktVol = Math.max(1, Math.round(Number(vol.input.value) || 1));
    planControl.setQty(state.mktVol);
  };
  // Stop / Target reference = the LIVE market (bid/ask mid); precision from the instrument. Shared by the seed-from-market
  // rollers and the Dist boxes below.
  const getDec = () => (state.mktInst && state.mktInst.priceDecimals != null ? Number(state.mktInst.priceDecimals) : 5);
  const mktRef = () =>
    state.mktAsk > 0 && state.mktBid > 0 ? (state.mktAsk + state.mktBid) / 2 : state.mktAsk || state.mktBid || 0;
  const sl = mktRow('Stop Loss:', state.mktSl, { min: -1 });
  sl.row.style.gridColumn = '1 / 2';
  sl.row.style.gridRow = '3';
  const tp = mktRow('Take Profit:', state.mktTp, { min: -1 });
  tp.row.style.gridColumn = '1 / 2';
  tp.row.style.gridRow = '4';
  // SEED-FROM-MARKET: the Stop/Target fields seed their first spinner tick from the LIVE market mid (mktRef) -- see
  // seedSpinner (ticket-controls). min is -1 so a down-roll from 0 fires an event; anything left negative clamps to 0.
  // Each edit also moves the plan dot (fields -> chart) when bracket/projecting; the stop edit re-runs the Stake preview.
  seedSpinner(sl.input, {
    getRef: mktRef,
    getDec,
    set: (v) => {
      state.mktSl = v;
      planControl.setStop(v, mktRef());
      if (state.recalcStake) state.recalcStake();
      if (state.syncSideGate) state.syncSideGate();
    },
  });
  seedSpinner(tp.input, {
    getRef: mktRef,
    getDec,
    set: (v) => {
      state.mktTp = v;
      planControl.setTarget(v);
      if (state.syncSideGate) state.syncSideGate();
    },
  });
  state.mktInputs = { vol: vol.input, sl: sl.input, tp: tp.input };
  // Market entry estimate = the live ASK (fall back to BID) -- the side isn't chosen until Buy/Sell, and the spread is
  // immaterial to a stop DISTANCE. The stop basis is the Stop field. recalcStake writes the sized qty into the Volume box.
  state.recalcStake = wireStakePreview(
    vol.input,
    () => state.mktAsk || state.mktBid,
    () => state.mktSl,
  );
  // Stop / Target DISTANCE boxes (col2, beside each level) -- pips/points from the live market (bid/ask mid). Two-way
  // linked: typing a distance sets the level off the market; editing the level, or a quote tick, refreshes the distance.
  const slDist = attachDist(sl.input, {
    kind: 'sl',
    getRef: mktRef,
    getDec,
    onPriceSet: (p) => {
      state.mktSl = p || 0;
      planControl.setStop(state.mktSl, mktRef());
    },
  });
  slDist.row.style.gridColumn = '2 / 4';
  slDist.row.style.gridRow = '3';
  const tpDist = attachDist(tp.input, {
    kind: 'tp',
    getRef: mktRef,
    getDec,
    onPriceSet: (p) => {
      state.mktTp = p || 0;
      planControl.setTarget(state.mktTp);
    },
  });
  tpDist.row.style.gridColumn = '2 / 4';
  tpDist.row.style.gridRow = '4';
  // Market: the Dist boxes are REFERENCE-ONLY (read-only, grayed). A market order sets a FIXED price level, but a distance
  // is measured off the MOVING market, so you can't ENTER one -- it would drift. They still DISPLAY the live distance.
  for (const d of [slDist.dist, tpDist.dist]) {
    d.disabled = true;
    d.classList.add('ot-dist-ref');
    d.title = t('reference only -- a market order uses a fixed price, not a moving distance');
  }
  state.recomputeDist = () => {
    slDist.recompute();
    tpDist.recompute();
  };
  // No Project toggle: the planning projection is bound to the dialog now -- an open entry tab IS a planning session
  // (window.js arms on open, ends on close/place/cancel). A set Stop/Target IS the bracket and rides with the order.
  // Buy/Sell + the order-ack status live in the SHARED bottom block (buildMarketActions), assembled by renderBody the
  // SAME way as the Limit/Stop actions -- so the bottom bar sits in one identical place on every entry tab.
  // Qt type in the Volume row, col 2 -> gutter so its box reaches the content edge (same right edge as the Limit/Stop
  // Exp box, since the Market grid has a 40px gear gutter col 3 that the Limit/Stop grid does not).
  // Stake input -- the $ risk amount, UNDER Qt type (col2 row2), a 120px box right-pinned so it aligns under the Qt-type
  // box. Shown ONLY when Qt type = Stake (syncStake, driven by the Qt-type onChange). Feeds position sizing (wired later).
  const stakeRow = document.createElement('div');
  stakeRow.className = 'ot-mod-row';
  stakeRow.style.justifyContent = 'flex-end';
  stakeRow.style.gridColumn = '2 / 4';
  stakeRow.style.gridRow = '1'; // Stake shares the Qt-type row (top), right-pinned -- unchanged size/side
  const stakeLbl = document.createElement('label');
  stakeLbl.className = 'ot-mod-label';
  stakeLbl.style.flex = '0 0 auto';
  stakeLbl.textContent = t('Stake:');
  const stakeIn = document.createElement('input');
  stakeIn.type = 'number';
  stakeIn.className = 'ot-input';
  stakeIn.style.flex = '0 0 120px';
  stakeIn.style.textAlign = 'right';
  stakeIn.min = '0';
  stakeIn.step = 'any';
  stakeIn.value = state.mktStake ? String(state.mktStake) : '';
  stakeIn.oninput = () => {
    state.mktStake = Number(stakeIn.value) || 0;
    if (state.recalcStake) state.recalcStake();
    if (state.syncSideGate) state.syncSideGate();
  };
  stakeRow.append(stakeLbl, stakeIn);
  // Qt-type change: show the Stake input (stake), and flip the Volume box between editable (Units) and
  // grayed live-preview (stake).
  const syncStake = () => {
    stakeRow.style.display = state.qtType === 'stake' ? '' : 'none';
    if (state.recalcStake) state.recalcStake();
    if (state.syncSideGate) state.syncSideGate();
  };
  const qt = buildQtTypeRow(syncStake);
  qt.style.gridColumn = '1 / 2';
  qt.style.gridRow = '1'; // Qt type in col1, ABOVE Volume
  syncStake();
  grid.append(vol.row, sl.row, tp.row, qt, stakeRow, slDist.row, tpDist.row);
  // SL/TP are the BRACKET on every account type -- always active (the broker places a server-side OCO from them, hedging
  // attaches them to the position). The red/green chart beads mirror these fields via the plan store (syncFields).
  applyMktInst();
  syncFields();
  resolveMktInst();
  state.recalcStake();
  state.recomputeDist(); // reflect plan levels + paint the Stake preview + Dist
  return grid;
}

// Buy / Sell for the Market tab -- SEND a `place` MARKET command to the worker (execution; no order logic here). Same
// .ot-mkt-actions wrap as buildLimitStopActions, so renderBody can build ONE shared bottom block ([status][Buy/Sell])
// that is identical on every entry tab. @returns {HTMLElement}
// Live bid/ask readout for the traded symbol -- centered, just above Buy/Sell on every entry tab. The quote is
// already subscribed (ticket-quotes.js -> state.mktBid/mktAsk); this only DISPLAYS it, refreshed on each tick via
// state.refreshQuote (set here, called by the quote cb). Decimals from the resolved instrument.
/** @returns {HTMLElement} */
function buildQuoteReadout() {
  const el = document.createElement('div');
  el.className = 'ot-quote';
  const bidEl = document.createElement('span');
  bidEl.className = 'ot-quote-bid';
  const sep = document.createElement('span');
  sep.className = 'ot-quote-sep';
  sep.textContent = '/';
  const askEl = document.createElement('span');
  askEl.className = 'ot-quote-ask';
  el.append(bidEl, sep, askEl);
  const update = () => {
    const dec = state.mktInst && state.mktInst.priceDecimals != null ? Number(state.mktInst.priceDecimals) : 5;
    const has = state.mktBid > 0 || state.mktAsk > 0;
    el.classList.toggle('empty', !has);
    bidEl.textContent = state.mktBid > 0 ? state.mktBid.toFixed(dec) : '—';
    askEl.textContent = state.mktAsk > 0 ? state.mktAsk.toFixed(dec) : '—';
  };
  state.refreshQuote = update;
  update();
  return el;
}

export function buildMarketActions() {
  if (state.placed) return buildPlacedActions(); // post-placement: the ack + one New Order button in place of Buy/Sell
  const wrap = document.createElement('div');
  wrap.className = 'ot-mkt-actions';
  const status = document.createElement('div');
  status.className = 'ot-foot-status';
  const btns = document.createElement('div');
  btns.className = 'ot-bar-row';
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'ot-btn-buy';
  buy.textContent = t('Buy');
  const sell = document.createElement('button');
  sell.type = 'button';
  sell.className = 'ot-btn-sell';
  sell.textContent = t('Sell');
  btns.append(buy, sell);
  /** @param {'buy'|'sell'} side */
  const fire = (side) => {
    const c = getCtx();
    // all the order-shaping rules live in buildPlaceIntent (order-intent.js); the view gathers state, then dispatches.
    const res = buildPlaceIntent({
      orderType: 'market',
      ctx: c,
      side,
      qty: state.mktVol,
      qtType: state.qtType,
      stake: state.mktStake,
      sl: state.mktSl,
      tp: state.mktTp,
    });
    if (!res.ok) {
      status.textContent = t(res.error);
      status.className = 'ot-foot-status err';
      return;
    }
    const sized = state.qtType === 'stake';
    status.textContent = t(side.toUpperCase()) + ' ' + (sized ? t('sizing') : state.mktVol) + '…';
    status.className = 'ot-foot-status';
    command(res.intent)
      .then((/** @type {any} */ r) => {
        if (r && r.ok) {
          enterPlaced(
            t(side.toUpperCase()) + ' ' + (r.qty != null ? r.qty : state.mktVol) + ' ' + c.symbol + ' ' + t('sent'),
          );
        } else {
          status.textContent = (r && r.error) || t('rejected');
          status.className = 'ot-foot-status err';
        }
      })
      .catch((/** @type {any} */ e) => {
        status.textContent = (e && e.message) || t('error');
        status.className = 'ot-foot-status err';
      });
  };
  buy.onclick = () => fire('buy');
  sell.onclick = () => fire('sell');
  state.fire = fire; // a bare "buy"/"sell" DSL trigger (quick-button) fires THIS tab's setup, same as clicking the button
  // gate Buy/Sell from the bracket direction (entry = the live market mid); re-run on level/quote changes.
  state.syncSideGate = () => {
    const entry =
      state.mktAsk > 0 && state.mktBid > 0 ? (state.mktAsk + state.mktBid) / 2 : state.mktAsk || state.mktBid || 0;
    applySideGate(buy, sell, sideForSetup(entry, state.mktSl, state.mktTp));
  };
  state.syncSideGate();
  wrap.append(status, buildQuoteReadout(), btns);
  return wrap;
}

// Limit / Stop tab ORDER FORM, a fixed grid (.ot-ls-grid): col1 = Volume + Price + Expiration (every account type);
// col2 = the HEDGING-only SL/TP attached to the pending order (broker-native) -- the whole column hides on netting, and
// because the tracks are fixed nothing reflows. type = 'limit'|'stop'. The Buy/Sell (buildLimitStopActions) place it
// via the worker `place` command (orderType/price/tif/goodThru + bracket when hedging set SL/TP).
/** @param {'limit'|'stop'} _type @returns {HTMLElement} */
export function buildLimitStopForm(_type) {
  const wrap = document.createElement('div');
  wrap.className = 'ot-market ot-modify ot-ls-grid';
  const vol = mktRow('Volume:', state.mktVol, { step: 1, min: 1 });
  vol.row.style.gridColumn = '1 / 2';
  vol.row.style.gridRow = '2';
  // same shared volume as the Market tab -- keep plan.qty (the pill's qty cell) in step while projecting
  vol.input.oninput = () => {
    state.mktVol = Math.max(1, Math.round(Number(vol.input.value) || 1));
    planControl.setQty(state.mktVol);
  };
  const price = mktRow('Price:', state.lsPrice);
  price.row.style.gridColumn = '1 / 2';
  price.row.style.gridRow = '3';
  // While PROJECTING, the Price field and the on-chart projection level (plan.ref) are two views of ONE price:
  // typing here moves the pill/dot; dragging it fills this field (syncFields). The hedging SL/TP still ride ON
  // the pending order itself (they activate with the fill) and never touch the plan store.
  price.input.oninput = () => {
    state.lsPrice = Number(price.input.value) || 0;
    planControl.setRef(state.lsPrice);
    if (state.recalcStake) state.recalcStake();
    if (state.syncSideGate) state.syncSideGate();
    if (state.recomputeDist) state.recomputeDist();
  }; // Price is the Dist reference here -> refresh the SL/TP distances when it moves
  // SL/TP stack UNDER Volume/Price in col 1 (one column reads Volume -> Price -> Stop Loss -> Take Profit); Expiration
  // moves to col 2 beside them (below). On netting they gray out (syncLsSltp) but stay in place.
  const sl = mktRow('Stop Loss:', state.lsSl, { min: -1 });
  sl.row.style.gridColumn = '1 / 2';
  sl.row.style.gridRow = '4';
  const tp = mktRow('Take Profit:', state.lsTp, { min: -1 });
  tp.row.style.gridColumn = '1 / 2';
  tp.row.style.gridRow = '5';
  // SEED-FROM-PRICE: the Stop/Target fields seed their first spinner tick from the order PRICE field (seedSpinner in
  // ticket-controls). min is -1 (not 0) so a down-roll from 0 produces an event; anything left negative clamps to 0.
  // editing SL/TP also moves the on-chart bracket pill (fields -> chart) while bracket OR a plain projection is on --
  // EXACTLY like the Market tab. 0 clears the rung. (The SL is also the Stake sizing basis here -> re-run the preview.)
  const lsSeedDec = () =>
    state.mktInst && state.mktInst.priceDecimals != null ? Number(state.mktInst.priceDecimals) : 5;
  seedSpinner(sl.input, {
    getRef: () => Number(state.lsPrice) || 0,
    getDec: lsSeedDec,
    set: (v) => {
      state.lsSl = v;
      planControl.setStop(v, Number(state.lsPrice) || 0);
      if (state.recalcStake) state.recalcStake();
      if (state.syncSideGate) state.syncSideGate();
    },
  });
  seedSpinner(tp.input, {
    getRef: () => Number(state.lsPrice) || 0,
    getDec: lsSeedDec,
    set: (v) => {
      state.lsTp = v;
      planControl.setTarget(v);
      if (state.syncSideGate) state.syncSideGate();
    },
  });
  state.lsInputs = { vol: vol.input, price: price.input, sl: sl.input, tp: tp.input };
  // Resting-order Stake preview: entry = the order's OWN price, stop = the (hedging) SL. Volume box goes grayed/read-only
  // in Stake mode and shows the sized qty. On netting the SL is disabled -> preview stays blank until a stop exists.
  state.recalcStake = wireStakePreview(
    vol.input,
    () => state.lsPrice,
    () => state.lsSl,
  );
  // Stop/Target DISTANCE boxes (col2, beside each level) -- pips/points from the order PRICE (the reference). Two-way
  // linked: typing a distance sets the level off the Price; editing the Price (above) or the level refreshes the distance.
  const lsDec = () => (state.mktInst && state.mktInst.priceDecimals != null ? Number(state.mktInst.priceDecimals) : 5);
  const lsRef = () => Number(state.lsPrice) || 0;
  const slDist = attachDist(sl.input, {
    kind: 'sl',
    getRef: lsRef,
    getDec: lsDec,
    onPriceSet: (p) => {
      state.lsSl = p || 0;
      planControl.setStop(state.lsSl, lsRef());
      if (state.recalcStake) state.recalcStake();
      if (state.syncSideGate) state.syncSideGate();
    },
  });
  slDist.row.style.gridColumn = '2 / 3';
  slDist.row.style.gridRow = '4';
  const tpDist = attachDist(tp.input, {
    kind: 'tp',
    getRef: lsRef,
    getDec: lsDec,
    onPriceSet: (p) => {
      state.lsTp = p || 0;
      planControl.setTarget(p);
      if (state.syncSideGate) state.syncSideGate();
    },
  });
  tpDist.row.style.gridColumn = '2 / 3';
  tpDist.row.style.gridRow = '5';
  state.recomputeDist = () => {
    slDist.recompute();
    tpDist.recompute();
  };
  if (state.lsInputs) {
    state.lsInputs.slDist = slDist.dist;
    state.lsInputs.tpDist = tpDist.dist;
  }
  if (state.lsSltpRows) {
    state.lsSltpRows.slDist = slDist.row;
    state.lsSltpRows.tpDist = tpDist.row;
  }
  state.lsSltpRows = { sl: sl.row, tp: tp.row };
  // Expiration (time-in-force): GTC / DAY / GTD -- sits in col 2 beside the Stop Loss row. GTD reveals a DATE picker
  // on the row below (col 2, beside Take Profit): it's Good-Till-DATE, not a time; the order lives through that trade
  // date (good-thru = UTC midnight of the date, so it's unambiguous, no timezone guessing).
  // col 2, right-aligned so the Expiration box's right edge lands on the content edge -- the SAME edge as the Symbol
  // combo above it. The box is 120px, matching the Symbol combo width, so the two input boxes line up exactly.
  const expRow = document.createElement('div');
  expRow.className = 'ot-mod-row';
  expRow.style.gridColumn = '2 / 3';
  expRow.style.gridRow = '2';
  expRow.style.justifyContent = 'flex-end'; // beside Volume
  const expLbl = document.createElement('label');
  expLbl.className = 'ot-mod-label';
  expLbl.style.flex = '0 0 auto';
  expLbl.textContent = t('Exp:');
  const tif = document.createElement('select');
  tif.className = 'ot-input';
  tif.style.flex = '0 0 120px'; // == Symbol combo width, so the boxes align
  /** @type {[string,string][]} */ ([
    ['gtc', 'GTC'],
    ['day', 'DAY'],
    ['gtd', 'GTD'],
  ]).forEach(([v, l]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t(l);
    tif.appendChild(o);
  });
  tif.value = state.lsTif;
  expRow.append(expLbl, tif);
  // GTD date on its own row (col 2, below Expiration, beside Take Profit); SAME 120px box, right-pinned, so its left
  // AND right edges line up exactly with the Expiration box above it. Shown only on GTD, as before.
  const gDateRow = document.createElement('div');
  gDateRow.className = 'ot-mod-row';
  gDateRow.style.gridColumn = '2 / 3';
  gDateRow.style.gridRow = '3';
  gDateRow.style.justifyContent = 'flex-end'; // beside Price
  const gDate = /** @type {HTMLInputElement} */ (document.createElement('input'));
  gDate.type = 'date';
  gDate.className = 'ot-input';
  gDate.style.cssText = 'flex:0 0 120px;min-width:0;';
  gDate.value = state.lsGtdDate;
  gDateRow.append(gDate);
  const applyTif = () => {
    gDateRow.style.display = tif.value === 'gtd' ? '' : 'none';
  };
  tif.onchange = () => {
    state.lsTif = tif.value;
    applyTif();
  };
  gDate.onchange = () => {
    state.lsGtdDate = gDate.value;
  };
  applyTif();
  // Stake input under Qt type (col2 row2), shown only when Qt type = Stake -- same shared risk value as the Market tab.
  const stakeRow = document.createElement('div');
  stakeRow.className = 'ot-mod-row';
  stakeRow.style.justifyContent = 'flex-end';
  stakeRow.style.gridColumn = '2 / 3';
  stakeRow.style.gridRow = '1'; // Stake shares the Qt-type row (top), right-pinned -- unchanged size/side
  const stakeLbl = document.createElement('label');
  stakeLbl.className = 'ot-mod-label';
  stakeLbl.style.flex = '0 0 auto';
  stakeLbl.textContent = t('Stake:');
  const stakeIn = document.createElement('input');
  stakeIn.type = 'number';
  stakeIn.className = 'ot-input';
  stakeIn.style.flex = '0 0 120px';
  stakeIn.style.textAlign = 'right';
  stakeIn.min = '0';
  stakeIn.step = 'any';
  stakeIn.value = state.mktStake ? String(state.mktStake) : '';
  stakeIn.oninput = () => {
    state.mktStake = Number(stakeIn.value) || 0;
    if (state.recalcStake) state.recalcStake();
    if (state.syncSideGate) state.syncSideGate();
  };
  stakeRow.append(stakeLbl, stakeIn);
  const syncStake = () => {
    stakeRow.style.display = state.qtType === 'stake' ? '' : 'none';
    if (state.recalcStake) state.recalcStake();
    if (state.syncSideGate) state.syncSideGate();
  };
  const qt = buildQtTypeRow(syncStake);
  qt.style.gridColumn = '1 / 2';
  qt.style.gridRow = '1'; // Qt type in col1, ABOVE Volume
  syncStake();
  wrap.append(vol.row, price.row, sl.row, tp.row, expRow, gDateRow, qt, stakeRow, slDist.row, tpDist.row);
  syncLsSltp(); // hedging -> SL/TP column + Dist show; netting -> dimmed/disabled
  applyMktInst();
  syncFields();
  resolveMktInst();
  state.recalcStake();
  state.recomputeDist(); // steps from the tick; reflect the plan; paint the Stake preview + Dist
  return wrap;
}
// Buy / Sell for the Limit/Stop tab -- SENDS a `place` command with orderType/price/tif/goodThru to the worker (no order
// logic here). GTD resolves the good-thru epoch from the date+time inputs.
/** @param {'limit'|'stop'} type @returns {HTMLElement} */
export function buildLimitStopActions(type) {
  if (state.placed) return buildPlacedActions(); // post-placement: the ack + one New Order button in place of Buy/Sell
  const wrap = document.createElement('div');
  wrap.className = 'ot-mkt-actions';
  const row = document.createElement('div');
  row.className = 'ot-bar-row';
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'ot-btn-buy';
  buy.textContent = t('Buy');
  const sell = document.createElement('button');
  sell.type = 'button';
  sell.className = 'ot-btn-sell';
  sell.textContent = t('Sell');
  const status = document.createElement('div');
  status.className = 'ot-foot-status';
  /** @param {'buy'|'sell'} side */
  const fire = (side) => {
    const c = getCtx();
    // all the order-shaping rules (price/GTD/stake/hedging-bracket) live in buildPlaceIntent; the view dispatches only.
    const res = buildPlaceIntent({
      orderType: type,
      ctx: c,
      side,
      qty: state.mktVol,
      qtType: state.qtType,
      stake: state.mktStake,
      sl: state.lsSl,
      tp: state.lsTp,
      price: state.lsPrice,
      tif: state.lsTif,
      gtdDate: state.lsGtdDate,
    });
    if (!res.ok) {
      status.textContent = t(res.error);
      status.className = 'ot-foot-status err';
      return;
    }
    const sized = state.qtType === 'stake';
    status.textContent = t(side.toUpperCase()) + ' ' + t(type) + ' ' + (sized ? t('sizing') : state.mktVol) + '…';
    status.className = 'ot-foot-status';
    command(res.intent)
      .then((/** @type {any} */ r) => {
        if (r && r.ok) {
          enterPlaced(
            t(side.toUpperCase()) +
              ' ' +
              t(type) +
              ' ' +
              (r.qty != null ? r.qty : state.mktVol) +
              ' ' +
              c.symbol +
              ' ' +
              t('sent'),
          );
        } else {
          status.textContent = (r && r.error) || t('rejected');
          status.className = 'ot-foot-status err';
        }
      })
      .catch((/** @type {any} */ e) => {
        status.textContent = (e && e.message) || t('error');
        status.className = 'ot-foot-status err';
      });
  };
  buy.onclick = () => fire('buy');
  sell.onclick = () => fire('sell');
  state.fire = fire; // a bare "buy"/"sell" DSL trigger (quick-button) fires THIS tab's setup, same as clicking the button
  // gate Buy/Sell from the bracket direction (entry = the order Price); re-run on level/price changes.
  state.syncSideGate = () => {
    applySideGate(buy, sell, sideForSetup(Number(state.lsPrice) || 0, state.lsSl, state.lsTp));
  };
  state.syncSideGate();
  row.append(buy, sell);
  wrap.append(status, buildQuoteReadout(), row);
  return wrap;
}
