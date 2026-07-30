// @ts-check
// Order-ticket shared state -- the single store for the dialog's cross-module UI state:
// the selected account, the symbol, the loaded position/order context, the active tab,
// every form value and the live input refs the plan-sync mirrors write into. Every
// ticket-* module reads/writes THIS instance; nothing keeps a shadow copy. The render
// slot is the dependency-inversion point: window.js registers its render at boot;
// plan-sync re-renders through the slot without importing the shell.

/** @typedef {{ broker: string, accountId: any, hedging: boolean }} SelectedAccount */

export const state = {
  // Account dropdown state (populated once accounts load; repopulated on connect/disconnect)
  /** @type {SelectedAccount|null} */ selectedAccount: null,
  /** @type {HTMLSelectElement|null} */ accountSelEl: null,
  lastAcctKeys: '',
  // Symbol state, shared across tabs (it's one order dialog). The user either TYPES a symbol, PICKS one
  // from the watchlists (dropdown), or -- for Modify -- inherits the double-clicked position's symbol.
  // symbolBroker records which broker a picked/inherited symbol belongs to (symbols are protocol-scoped);
  // cleared when the user types.
  symbolValue: '',
  symbolBroker: '',
  // the active tab and the loaded position/order context ({tab, position|order|symbol} from main)
  active: 'market',
  /** @type {any} */ context: null,
  // Post-placement "placed" state (entry tabs only): after a SUCCESSFUL Buy/Sell the form grays out and the Buy/Sell
  // row becomes a single New Order button. placedMsg is the ack shown above it. Cleared by New Order (re-arm) or a
  // fresh open -- never by a rejection (a failed order keeps the form live to retry).
  placed: false,
  placedMsg: '',
  // the top mini-table of the loaded position OR order, kept live by the platform-store subscriptions
  /** @type {HTMLElement|null} */ posTableEl: null,
  /** @type {(() => void)|null} */ repaintTable: null, // repaint fn; set by the build fn in use
  /** @type {(() => void)|null} */ syncModify: null, // Modify-editor live-sync: re-read the loaded order/position from the book into the fields (set by the modify build fn; window.js calls it on any book change, skipping a field the user is editing)
  // Quantity-type: how the Volume field is READ -- 'units' (contracts) | 'stake' ($ risk) | later 'mm' (engine). The
  // dropdown lives in the Volume row, so it shows on every entry tab and the choice carries across Market/Limit/Stop.
  qtType: 'units',
  // Market tab ORDER FORM values. SL/TP are ABSOLUTE prices; step/decimals come from the instrument.
  mktVol: 1, // volume / qty (shared with the Limit/Stop tabs)
  mktSl: 0, // stop-loss price (0 = none)
  mktTp: 0, // take-profit price (0 = none)
  mktStake: 0, // $ risk amount when Qt type = Stake (drives position sizing; wired later)
  /** @type {any} */ mktInst: null, // resolved instrument (tickSize/priceDecimals) for the current symbol
  mktInstKey: '', // broker|symbol the resolved inst belongs to
  /** @type {{ vol: HTMLInputElement, sl: HTMLInputElement, tp: HTMLInputElement }|null} */ mktInputs: null,
  // Live quote for the current symbol -- feeds the Stake live-preview (the Volume box shows the sized contracts as you
  // type). Filled by a quote subscription (subscribeMktQuotes); recalcStake re-runs the sizing preview on every tick.
  mktBid: 0,
  mktAsk: 0,
  /** @type {{ brokerId: string, id: any, cb: (q:any)=>void }|null} */ qSub: null, // active quote subscription (for cleanup)
  qSubKey: '', // broker|symbol the quote sub belongs to
  /** @type {(() => void)|null} */ recalcStake: null, // the active entry form's Stake-preview recompute (set per build; quote ticks call it)
  /** @type {(() => void)|null} */ recomputeDist: null, // the active entry form's Stop/Target Dist recompute (set per build; quote ticks + a Price edit call it)
  /** @type {(() => void)|null} */ syncSideGate: null, // the active entry form's Buy/Sell gate: a stop/target below/above entry implies long/short -> disable the contradicting button (set per Actions build)
  /** @type {(() => void)|null} */ refreshQuote: null, // the active entry tab's live bid/ask readout refresh (set per Actions build; quote ticks call it)
  /** @type {((side: 'buy'|'sell') => void)|null} */ fire: null, // the active entry tab's Buy/Sell handler; a bare "buy"/"sell" DSL trigger (quick-button) invokes it, same as clicking the button (set per Actions build)
  // Limit / Stop tab state (the resting order): Price + time-in-force + the HEDGING-only SL/TP column
  lsPrice: 0, // the resting limit/stop price
  lsTif: 'gtc', // time-in-force: gtc | day | gtd
  lsGtdDate: '', // GTD expiry DATE (yyyy-mm-dd); good-thru = UTC midnight of it
  lsSl: 0, // hedging: SL attached to the pending order (0 = none)
  lsTp: 0, // hedging: TP attached to the pending order (0 = none)
  /** @type {{ vol?: HTMLInputElement, price: HTMLInputElement, sl?: HTMLInputElement, tp?: HTMLInputElement, slDist?: HTMLInputElement, tpDist?: HTMLInputElement }|null} */ lsInputs:
    null,
  /** @type {{ sl: HTMLElement, tp: HTMLElement, slDist?: HTMLElement, tpDist?: HTMLElement }|null} */ lsSltpRows: null, // the SL/TP grid column rows (+ their Dist rows) -- dimmed/disabled on netting accounts
  // Project checkbox ref (plan-sync reflects the plan store into it)
  /** @type {HTMLInputElement|null} */ projectCb: null,
  // the universal VISIBILITY / HIDE ON ENTRY frame's re-sync (set ONCE by buildVisibilityFrame; render() calls it on a
  // tab / symbol switch to re-target the toggles to the current ctx). NOT reset by renderBody -- the frame is persistent.
  /** @type {(() => void)|null} */ syncVis: null,
  // ask the OS window to match its height to the current content (set once by window.js). render() and the
  // quick-button repaint call it so adding/removing buttons GROWS/shrinks the window instead of squishing the body.
  /** @type {(() => void)|null} */ fitHeight: null,
};

// the execution context supplied at click/send time. Broker/account come from the Account dropdown
// (falling back to the loaded position / picked symbol); hedging drives account-type-sensitive execution.
export const getCtx = () => ({
  broker:
    (state.selectedAccount && state.selectedAccount.broker) ||
    (state.context && state.context.broker) ||
    state.symbolBroker ||
    '',
  accountId: state.selectedAccount && state.selectedAccount.accountId,
  hedging: state.selectedAccount ? state.selectedAccount.hedging : undefined,
  symbol: state.symbolValue,
  ticket: state.context && state.context.ticket,
});

// render-dispatch indirection: window.js owns the render; plan-sync calls the slot
let renderer = () => {};
/** @param {() => void} fn */
export const setRenderer = (fn) => {
  renderer = fn;
};
export const render = () => renderer();
