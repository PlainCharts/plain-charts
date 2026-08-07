// @ts-check
// Order-ticket window SHELL (runs in the standalone order-ticket.html window). The 4-tab
// frame -- Market / Limit / Stop / Modify -- with the custom title bar, tab switching, the
// per-tab body composition and the open/refocus plumbing from main. This window is a PROXY
// (desktop preload present), so orders are driven via the data-host broker.
//
// The dialog is split by responsibility: shared state + getCtx in ticket-state.js; the
// top widgets (mini table, Account dropdown, Symbol combobox) in ticket-top.js; the entry
// forms in ticket-entry.js; the Modify editors in ticket-modify.js; the plan-store mirror
// (Project/Bracket) in ticket-plan-sync.js; the quick-action button bar in buttons.js.
import { platform } from '../../data_engine/index.js';
import '../perf/sampler.js'; // publish this window's live perf sample (Performance Monitor addon reads it)
import { loadSettings } from '../settings/settings.js';
import { loadThemes } from '../settings/theme.js';
import { loadAccounts } from '../connect/accounts.js';
import { buildButtonBar } from './buttons.js';
import { buildVisibilityFrame } from './visibility-frame.js'; // universal VISIBILITY / HIDE ON ENTRY frame (all tabs, like the button bar)
import { setProjecting, setLevels } from '../chart/order-view/plan-store.js'; // open = begin planning; a tab switch arms/re-types the projection (Modify disarms it)
import { state, getCtx, setRenderer } from './ticket-state.js';
import {
  populateAccounts,
  refreshAccounts,
  buildAccountSymbolRow,
  buildPositionTable,
  buildOrderTable,
} from './ticket-top.js';
import { buildMarketForm, buildMarketActions, buildLimitStopForm, buildLimitStopActions } from './ticket-entry.js';
import { buildModifyEditor, buildOrderModifyEditor } from './ticket-modify.js';
import { syncTab } from './ticket-plan-sync.js';
import { t, loadVocab } from '../i18n/i18n.js'; // this standalone window has its OWN module state -> must load the active vocab pack itself

// Skin this window with the user's LIVE chosen theme (settings/themes), exactly like every other window:
// loadThemes() writes the selected palette as CSS variables on documentElement AND subscribes to the cross-window
// theme bus, so changing the theme anywhere re-skins this dialog too. The :root block in the HTML is only the
// pre-load bootstrap (same defaults index.html uses) until this resolves -- never a hardcoded palette.
// load prefs, theme, the active vocabulary pack, and accounts; then re-render so the first synchronous paint
// (line-142 render()) is repainted with the resolved vocab (t() falls back to English until loadVocab settles).
(async () => {
  try {
    await loadSettings();
    await loadThemes();
    await loadVocab();
    await loadAccounts();
    if (state.accountSelEl) populateAccounts(state.accountSelEl);
    render();
  } catch (_) {}
})();

/** @type {[string, string][]} */
const TABS = [
  ['market', 'Market'],
  ['limit', 'Limit'],
  ['stop', 'Stop'],
  ['modify', 'Modify'],
];

const PIN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M8 3h8l-1 5 2 3H7l2-3-1-5z"/></svg>';

const root = /** @type {HTMLElement} */ (document.getElementById('order-root'));

// Closing the dialog ENDS the planning session -- the primitive disappears with the window, because in planning the
// dialog and the primitive are one. If an order was already placed the projection is gone (enterPlaced cleared it),
// so this is a no-op then; the real order, being book-driven, stays.
function endPlanning() {
  const c = getCtx();
  if (c.symbol) setProjecting(c.broker, c.symbol, false);
}

// Custom frameless title bar mirroring the main app: draggable bar + always-on-top pin, minimize, maximize, close.
function buildTitleBar() {
  const d = /** @type {any} */ (window).desktop;
  const bar = document.createElement('div');
  bar.className = 'ot-titlebar';
  const title = document.createElement('div');
  title.className = 'ot-title';
  title.textContent = t('Order');
  const spacer = document.createElement('div');
  spacer.className = 'ot-spacer';
  const ctrls = document.createElement('div');
  ctrls.className = 'ot-ctrls';
  /** @param {string} cls @param {string} glyph @param {string} tip @param {(this: HTMLButtonElement) => void} fn */
  const mk = (cls, glyph, tip, fn) => {
    const b = document.createElement('button');
    b.className = 'ot-btn ' + cls;
    if (glyph) b.textContent = glyph;
    b.title = tip;
    b.onclick = /** @type {any} */ (fn);
    return b;
  };
  if (d) {
    spacer.ondblclick = () => d.winMaximizeToggle && d.winMaximizeToggle();
    if (d.winAlwaysOnTopToggle) {
      const pinned = d.winIsAlwaysOnTop ? !!d.winIsAlwaysOnTop() : false;
      const pin = mk('ot-pin', '', pinned ? t('Unpin (always on top)') : t('Always on top'), function () {
        const on = d.winAlwaysOnTopToggle();
        this.classList.toggle('on', on);
        this.title = on ? t('Unpin (always on top)') : t('Always on top');
      });
      pin.innerHTML = PIN_SVG;
      pin.classList.toggle('on', pinned);
      ctrls.appendChild(pin);
    }
    ctrls.appendChild(mk('ot-min', '–', t('Minimize'), () => d.winMinimize && d.winMinimize()));
    ctrls.appendChild(mk('ot-max', '□', t('Maximize'), () => d.winMaximizeToggle && d.winMaximizeToggle()));
    ctrls.appendChild(
      mk('ot-close', '✕', t('Close'), () => {
        endPlanning(); // close = end planning: drop the projection before the window goes
        if (d.winClose) d.winClose();
      }),
    );
  }
  bar.append(title, spacer, ctrls);
  return bar;
}

const tabsEl = document.createElement('div');
tabsEl.className = 'ot-tabs';
const bodyEl = document.createElement('div');
bodyEl.className = 'ot-body';
root.append(buildTitleBar(), tabsEl, bodyEl);

function renderBody() {
  bodyEl.innerHTML = '';
  state.posTableEl = null;
  state.repaintTable = null; // dropped from the DOM; the build fn re-sets them when a position/order is shown
  state.mktInputs = null;
  state.lsInputs = null;
  state.lsSltpRows = null;
  state.recalcStake = null;
  state.recomputeDist = null;
  state.syncSideGate = null;
  state.refreshQuote = null;
  state.fire = null;
  state.syncModify = null; // market-form + limit/stop-form inputs (Stake-preview + Dist + Buy/Sell-gate + quote-readout + trigger + Modify-sync hooks) are rebuilt below per tab
  // the loaded position OR order as a headerless mini table, ABOVE the symbol -- always shown when one is loaded,
  // so the user sees what they're controlling on every tab
  if (state.context && state.context.kind === 'order') bodyEl.appendChild(buildOrderTable(state.context));
  else if (state.context && state.context.ticket != null) bodyEl.appendChild(buildPositionTable(state.context));
  // Account + Symbol -- shown on every tab (this is an order dialog)
  bodyEl.appendChild(buildAccountSymbolRow());
  // Entry tabs (Market / Limit / Stop): the per-tab FIELDS + one SHARED bottom block. Every entry tab returns just its
  // fields; the bottom is always a .ot-mkt-actions wrap holding [status][Buy/Sell] (margin-top:auto, bottom-pinned).
  if (state.active === 'market' || state.active === 'limit' || state.active === 'stop') {
    const isMkt = state.active === 'market';
    const lsType = /** @type {'limit'|'stop'} */ (state.active);
    const form = isMkt ? buildMarketForm() : buildLimitStopForm(lsType);
    const actions = isMkt ? buildMarketActions() : buildLimitStopActions(lsType);
    bodyEl.append(form, actions);
  }
  // Modify tab -- per context: a resting ORDER (netting stop/limit) gets the Volume+Price editor; a POSITION gets the
  // SL/TP editor. (Hedging position modify unchanged.)
  if (state.active === 'modify' && state.context) {
    if (state.context.kind === 'order') bodyEl.appendChild(buildOrderModifyEditor(state.context));
    else if (state.context.ticket != null) bodyEl.appendChild(buildModifyEditor(state.context));
  }
  // PLACED state (entry tabs): gray the form (all but the .ot-mkt-actions bottom block, which holds New Order). The
  // actions block already rendered its placed variant (New Order in place of Buy/Sell).
  bodyEl.classList.toggle(
    'ot-placed',
    !!state.placed && (state.active === 'market' || state.active === 'limit' || state.active === 'stop'),
  );
}

function render() {
  tabsEl.innerHTML = '';
  for (const [id, label] of TABS) {
    const tab = document.createElement('div');
    tab.className = 'ot-tab' + (id === state.active ? ' active' : '');
    tab.textContent = t(label);
    // a tab click while projecting also writes plan.orderType -- the tabs and the pill's type cell are two
    // views of the planned entry's type (modify is a different context and stays out of it)
    tab.onclick = () => {
      if (state.active !== id) {
        state.active = id;
        render();
        const c = getCtx();
        if (id === 'market' || id === 'limit' || id === 'stop') {
          // an entry tab IS planning: keep the projection armed and typed to this tab (the pill's type cell mirrors it)
          if (c.symbol) {
            setProjecting(c.broker, c.symbol, true);
            setLevels(c.broker, c.symbol, { orderType: id });
          }
        } else if (c.symbol) {
          // Modify (or any non-entry tab) is not a planning context -> drop the projection
          setProjecting(c.broker, c.symbol, false);
        }
      }
    };
    tabsEl.appendChild(tab);
  }
  renderBody();
  if (state.syncVis) state.syncVis(); // re-target the universal visibility frame to the current tab's ctx (symbol/broker)
  fitHeight(); // grow/shrink the OS window to the new content so a taller tab/footer never squishes the body
}
setRenderer(render); // plan-sync's tab mirror re-renders through the state slot

// Match the OS window height to the natural content (title + tabs + body + footer). The body is momentarily
// sized to its content -- its flex:1 stretch + inner scroll would otherwise hide the true height -- so the sum of
// the shell's rows is the height the window should be. Growing the window is what stops added quick-button rows
// from squishing the body. Coalesced in a rAF; main clamps to the screen and only the excess scrolls.
function fitHeight() {
  const d = /** @type {any} */ (window).desktop;
  if (!d || !d.orderTicketHeight) return;
  requestAnimationFrame(() => {
    const prev = bodyEl.style.flex;
    bodyEl.style.flex = '0 0 auto';
    let needed = 0;
    for (const k of root.children) {
      const el = /** @type {HTMLElement} */ (k);
      const pos = getComputedStyle(el).position;
      if (pos === 'absolute' || pos === 'fixed') continue; // skip out-of-flow overlays (editor/script modals)
      needed += el.offsetHeight;
    }
    bodyEl.style.flex = prev;
    if (needed > 0) d.orderTicketHeight(needed);
  });
}
state.fitHeight = fitHeight; // the quick-button bar (buttons.js) refits after it repaints

// Open/refocus payload from main: {tab, position}. Double-clicking a position row asks for the Modify tab.
// Fired on first load and on every re-open.
const desk = /** @type {any} */ (window).desktop;
if (desk && desk.onOrderTicketOpen) {
  desk.onOrderTicketOpen(
    /** @param {any} opts */ (opts) => {
      if (!opts) return;
      state.placed = false;
      state.placedMsg = ''; // a fresh open/re-focus starts armed, never in a stale placed state
      if (opts.position) {
        state.context = opts.position;
        if (state.context.symbol) {
          state.symbolValue = state.context.symbol;
          state.symbolBroker = state.context.broker || '';
        } // inherit the position's symbol
      } else if (opts.order) {
        state.context = { ...opts.order, kind: 'order' }; // a clicked resting stop/limit order -> Modify edits its Volume + Price
        if (state.context.symbol) {
          state.symbolValue = state.context.symbol;
          state.symbolBroker = state.context.broker || '';
        }
      } else if (opts.symbol || opts.broker) {
        state.context = null; // no loaded position -- e.g. opened from the chart toolbar with just broker + symbol
        if (opts.symbol) state.symbolValue = opts.symbol;
        state.symbolBroker = opts.broker || ''; // preselects the matching account (populateAccounts)
      }
      if (opts.tab && TABS.some(([id]) => id === opts.tab)) {
        state.active = opts.tab;
      }
      render();
      // OPEN = begin planning: opening (or re-opening) on an entry tab arms a fresh projection typed to that tab, so
      // the planning primitive appears with no toggle. Modify arms nothing. getCtx after render() so the account the
      // form resolved is in scope; the pill sits at the live price and the levels seed as the user drags / types.
      const oc = getCtx();
      if (oc.symbol && (state.active === 'market' || state.active === 'limit' || state.active === 'stop')) {
        setProjecting(oc.broker, oc.symbol, true);
        // A drawing-tool HANDOFF ("Create limit order" on a Position box): the payload carries the tool's
        // order reading and THIS window seeds its own planning cycle from it -- entry as plan.ref, the
        // bracket as rung 0, side/dir from the stop's placement, the tool's quantity when it could size.
        // ONE patch, WITH the type: the type and the ref must land together, or the chart overlay's
        // seedTypeRef sees a ref-less limit plan mid-flight and pins the live price over the tool's entry
        // (the cross-window race that left the pill on the box and the dialog's Price at the market).
        // The fields and the on-chart pill both mirror the plan (syncFields), so everything shows at once.
        const pf = opts.prefill;
        if (pf) {
          const qty = Number(pf.qty) > 0 ? Number(pf.qty) : null;
          if (qty) state.mktVol = qty;
          const stop = Number(pf.stopLoss),
            target = Number(pf.takeProfit);
          setLevels(oc.broker, oc.symbol, {
            orderType: state.active,
            qty: qty || state.mktVol,
            ref: Number(pf.price) > 0 ? Number(pf.price) : null,
            side: pf.side === 'sell' ? 'sell' : 'buy',
            dir: pf.side === 'sell' ? 'short' : 'long',
            levels: [
              {
                ...(Number.isFinite(stop) && stop > 0 ? { stop } : {}),
                ...(Number.isFinite(target) && target > 0 ? { target } : {}),
              },
            ],
          });
        } else {
          setLevels(oc.broker, oc.symbol, { orderType: state.active, qty: state.mktVol });
        }
      }
      syncTab(); // opened/refocused onto a live projection -> reflect its planned type as the active tab
    },
  );
  // Now that the listener is attached, PULL the open intent from main -- don't rely on main pushing at
  // did-finish-load (that races: on a fresh window the push can land before this listener exists, and is lost).
  if (desk.orderTicketReady) desk.orderTicketReady();
}
// safety net: if the window is destroyed (app quit / programmatic close) instead of via the ✕, still end planning
window.addEventListener('pagehide', endPlanning);

// Universal controls (on EVERY tab, rendered ONCE like the button bar -- not per-tab). The visibility frame edits the
// shared on-chart dot visibility + the global hide-on-entry policy; the button bar holds the quick-action buttons. Both
// read the live context (broker/symbol/ticket) at call time so they work for whatever the dialog currently shows.
// The frame lives INSIDE the footer (above the quick buttons) so the footer's top edge stays at the Buy/Sell boundary --
// that keeps the configure gear (absolute, bottom:100% of the footer) floating up to the Buy/Sell row, not the frame.
const footerBar = buildButtonBar(getCtx);
footerBar.insertBefore(buildVisibilityFrame(getCtx), footerBar.firstChild);
root.appendChild(footerBar);
platform.accounts.subscribe(refreshAccounts); // keep the Account dropdown in sync with connect/disconnect

// keep the mini table LIVE: repaint the loaded position OR order whenever the book changes (a partial close changes
// qty, a resting order fills/cancels, etc.). Only touches the read-only table -- never the inputs the user is editing.
// keep the mini table AND the Modify-tab editor fields live: the loaded order/position drives both, so a chart drag
// (or any book change) that moves its price/SL/TP flows straight into the dialog (syncModify skips a field being edited).
const refreshTable = () => {
  if (state.posTableEl && state.repaintTable) state.repaintTable();
  if (state.syncModify) state.syncModify();
};
platform.positionLots.subscribe(refreshTable);
platform.positions.subscribe(refreshTable);
platform.orders.subscribe(refreshTable);

render();
