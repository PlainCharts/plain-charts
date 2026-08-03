// @ts-check
// Per-pane ORDER overlay. Draws THIS pane's (broker, symbol) on-chart order picture through the shared PositionView
// primitive, from TWO independent inputs:
//   LIVE  -- the platform BOOK (positions / orders / positionLots). A pure projection of the book: an order from ANY
//            source shows up (our dialog, the assistant, or an order placed on the broker's own platform via the trade
//            stream). Blue entry + yellow stop + green target; dragging a dot sends a COMMAND to the order worker.
//   PLAN  -- a transient, per-pane PROJECTION requested by a surface (the Order window's "Project order" toggle) over
//            the ORDER_PLAN channel, keyed by broker+symbol. Pure UI: the gray dot at the live price while FLAT, so the
//            user can plan before anything exists in the book. Never touches the book; the book always wins over a plan.
// Display + gesture only; the order LOGIC lives in the worker.
import { platform } from '../../../data_engine/index.js';
import { barMs } from '../../workspace/timeframes.js';
import './pill-view.js'; // self-registers the shipped default 'pill' primitive (always present)
import { loadPrimitiveModules } from './primitive-modules.js'; // discovers + loads any LOADABLE primitives (string-beads, ...)
import { getPrimitive } from './primitive-registry.js';
import { activePrimitiveId, loadOrderPrimitives, subscribePrimitives } from '../order-primitives-config.js';
import { command, readActive } from '../../../data_engine/index.js'; // command -> order worker; readActive -> the book's ACTIVE picture
import {
  isProjecting,
  isBracket,
  isArmed,
  getPlan,
  setLevels,
  setLevel,
  setProjecting,
  setArmed,
  commitStop,
  subscribe as subscribePlan,
} from './plan-store.js'; // shared PLAN state (gray projection + bracket ladder), keyed by broker+symbol
import { applyEntryVisibility, resetEntryVisibility } from './order-visibility.js'; // fill-driven HIDE-ON-ENTRY: apply the global policy the moment a position opens; reset when flat
import { mmPlanQty } from './plan-sizing.js'; // money-management pill qty, derived IN this window (no dialog needed)

/** @param {any} pane @returns {{ setEnabled: (on: boolean) => void, refresh: () => void, destroy: () => void }} */
export function createOrderOverlay(pane) {
  /** @type {import('./primitive-contract.js').OrderViewInstance | null} */
  let view = null;
  let raf = 0;

  // projection config lives in the pane's trades settings (Settings > Trading), read live each render.
  const tradeCfg = () => (pane.settings && pane.settings.trades) || {};
  const projBars = () => {
    const n = Number(tradeCfg().projBars);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 5;
  };
  const projFrac = () => {
    const p = Number(tradeCfg().projHeightPct);
    return Number.isFinite(p) && p > 0 ? p / 100 : 0.2;
  };
  let enabled = tradeCfg().showOrders !== false; // PER-CHART display gate (Settings > Trading > "Positions and orders")

  // where the string hangs in TIME: `Bars away` bars past the last bar, so it sits in the empty space by the latest price
  const anchorTime = () => {
    const pl = getPlan(pane.broker, pane.symbol);
    if (pl && pl.anchor != null && Number.isFinite(Number(pl.anchor))) return Number(pl.anchor); // user dragged the string -> honour where they put it
    const bars = pane.bars || [];
    const last = bars.length ? Number(bars[bars.length - 1].time) : Math.floor(Date.now() / 1000);
    let barSec = 60;
    try {
      const tf = pane.tf && pane.tf();
      if (tf) barSec = barMs(tf) / 1000;
    } catch (_) {}
    return last + projBars() * barSec;
  };

  // the VISIBLE price range (the "screen height" in price terms) via the pane's y-scale: price at the top pixel minus
  // price at the bottom of the plot (pane height less the time axis). Placing the bracket seed a SCREEN-relative
  // fraction of THIS makes one percent value sane on any instrument. null when the scale isn't ready yet.
  const visibleRange = () => {
    try {
      const s = pane.series;
      if (!s || !s.yToPrice || !pane.el) return null;
      const h = pane.el.getBoundingClientRect().height;
      let th = 0;
      try {
        th = pane.chart.timeAxis().height() || 0;
      } catch (_) {}
      const plot = h - th;
      if (!(plot > 0)) return null;
      const top = Number(s.yToPrice(0)),
        bot = Number(s.yToPrice(plot));
      const r = Math.abs(top - bot);
      return Number.isFinite(r) && r > 0 ? r : null;
    } catch (_) {
      return null;
    }
  };

  // read the BOOK for this pane's broker+symbol -> the ACTIVE picture (position + hedge SL/TP + ALL working orders). The
  // interpretation (netting/hedging aggregation, order collection) lives in book-read; this overlay only DISPLAYS it.
  const derive = () => readActive(pane.broker, pane.symbol);

  // INTERACTION -> COMMAND. Dragging a dot is NOT a move; it REQUESTS an absolute price. The worker applies it; the book
  // confirms; the mirror re-settles (schedule() after the ack, so a rejected/queued modify snaps the dot back).
  // Every command chain ends in jerr -- a rejection lands in the Console journal, NEVER as an unhandled rejection
  // (a bare .finally re-propagates and crashed the window with the red overlay).
  /** @param {any} e */
  const jerr = (e) =>
    platform.console.post({
      level: 'error',
      cat: 'journal',
      src: pane.broker || 'app',
      msg: 'order command failed: ' + ((e && e.message) || e),
    });
  // the live resting order by id -> read its current legs so every modify carries the FULL SL/TP state (the contract's
  // SL/TP convention, exactly like the position path: send both legs, 0 = remove that leg -- never a 0=keep guess).
  /** @param {any} id @returns {{ stopLoss: number, takeProfit: number }} */
  const legsOf = (id) => {
    const o = /** @type {any} */ (derive().orders.find((x) => x.id === id)) || {};
    return { stopLoss: Number(o.stopLoss) || 0, takeProfit: Number(o.takeProfit) || 0 };
  };
  // An ORDER dot is a real resting order -> MODIFY its price by id (preserves the server-side OCO).
  // Carry the current SL/TP so repricing the entry never drops the attached bracket.
  /** @param {any} id @param {number} price */
  const onOrderCommit = (id, price) => {
    if (!pane.broker || !pane.symbol) return;
    const l = legsOf(id);
    command({
      type: 'modifyOrder',
      broker: pane.broker,
      id,
      price: snap(price),
      stopLoss: l.stopLoss,
      takeProfit: l.takeProfit,
    })
      .catch(jerr)
      .finally(() => schedule());
  };
  // the SL/TP ATTACHED to a resting order (a pending-order bracket): drag = reprice THAT leg; the X removes it. Both
  // send the full leg state (changed leg + the other leg's current value), so the adapter sets exactly that -- same as the
  // position's hedge SL/TP. 0 = remove (the adapter reads a 0 leg as remove, matching the position modify).
  /** @param {any} id @param {number} price */
  const onOrderStopCommit = (id, price) => {
    if (pane.broker)
      command({
        type: 'modifyOrder',
        broker: pane.broker,
        id,
        stopLoss: snap(price),
        takeProfit: legsOf(id).takeProfit,
      })
        .catch(jerr)
        .finally(() => schedule());
  };
  /** @param {any} id @param {number} price */
  const onOrderTargetCommit = (id, price) => {
    if (pane.broker)
      command({ type: 'modifyOrder', broker: pane.broker, id, stopLoss: legsOf(id).stopLoss, takeProfit: snap(price) })
        .catch(jerr)
        .finally(() => schedule());
  };
  /** @param {any} id */
  const onOrderStopClear = (id) => {
    if (pane.broker)
      command({ type: 'modifyOrder', broker: pane.broker, id, stopLoss: 0, takeProfit: legsOf(id).takeProfit })
        .catch(jerr)
        .finally(() => schedule());
  };
  /** @param {any} id */
  const onOrderTargetClear = (id) => {
    if (pane.broker)
      command({ type: 'modifyOrder', broker: pane.broker, id, stopLoss: legsOf(id).stopLoss, takeProfit: 0 })
        .catch(jerr)
        .finally(() => schedule());
  };
  // a HEDGING SL/TP dot has no order id -> move the POSITION's SL/TP (setStop/setTarget). Prices snap to the tick grid.
  /** @param {number} price */
  const onHedgeStop = (price) => {
    if (pane.broker && pane.symbol)
      command({ type: 'setStop', ctx: { broker: pane.broker, symbol: pane.symbol }, price: snap(price) })
        .catch(jerr)
        .finally(() => schedule());
  };
  /** @param {number} price */
  const onHedgeTarget = (price) => {
    if (pane.broker && pane.symbol)
      command({ type: 'setTarget', ctx: { broker: pane.broker, symbol: pane.symbol }, price: snap(price) })
        .catch(jerr)
        .finally(() => schedule());
  };
  // REMOVE a hedging SL/TP from the position (the hedge pill's X): price 0 is the contract's "no level" -- the
  // worker's setStop/setTarget route it as a position modify that keeps the other leg.
  const onHedgeStopClear = () => {
    if (pane.broker && pane.symbol)
      command({ type: 'setStop', ctx: { broker: pane.broker, symbol: pane.symbol }, price: 0 })
        .catch(jerr)
        .finally(() => schedule());
  };
  const onHedgeTargetClear = () => {
    if (pane.broker && pane.symbol)
      command({ type: 'setTarget', ctx: { broker: pane.broker, symbol: pane.symbol }, price: 0 })
        .catch(jerr)
        .finally(() => schedule());
  };
  // click the entry dot -> open the order-ticket dialog on this position (Modify tab). HEDGING: the dot aggregates
  // lots but the Modify tab edits ONE lot (by TICKET) -- without it the tab opens empty. Mirror the Positions tab's
  // payload from the live lot (same fields, same source): exactly one lot -> that lot; several -> the aggregate
  // without a ticket (one dot cannot say which lot the user means -- the Positions tab lists them per row).
  const onEntry = () => {
    const d = /** @type {any} */ (window).desktop;
    if (!d || !d.openOrderTicket) return;
    const a = derive();
    if (a.entry == null) return;
    const lots = /** @type {any[]} */ (platform.positionLots.all()).filter(
      (l) => l.symbol === pane.symbol && (!pane.broker || l.broker === pane.broker) && Number(l.qty) > 0,
    );
    if (lots.length === 1) {
      const l = lots[0];
      d.openOrderTicket({
        tab: 'modify',
        position: {
          broker: l.broker,
          accountId: l.accountId,
          symbol: l.symbol,
          ticket: l.ticket,
          side: l.side,
          qty: l.qty,
          avgPrice: l.avgPrice,
          stopLoss: l.stopLoss,
          takeProfit: l.takeProfit,
          priceDecimals: l.priceDecimals,
          tickSize: l.tickSize,
        },
      });
      return;
    }
    d.openOrderTicket({
      tab: 'modify',
      position: {
        broker: pane.broker,
        symbol: pane.symbol,
        side: a.side,
        qty: a.qty,
        avgPrice: a.entry,
        stopLoss: a.hedgeStop,
        takeProfit: a.hedgeTarget,
      },
    });
  };
  // click the gray PROJECTION dot -> open the ORDER DIALOG (Market) for this instrument. ONE control UI: the dialog
  // holds the order entry; the chart dots are its display + draggable inputs (no separate on-chart popup).
  const onProjection = () => {
    const d = /** @type {any} */ (window).desktop;
    if (!d || !d.openOrderTicket || !pane.symbol) return;
    d.openOrderTicket({ tab: 'market', broker: pane.broker, symbol: pane.symbol });
  };
  // an order element's CANCEL affordance (the pill's X) -> cancel THAT resting order by id (the worker's command;
  // a compound sibling is the server's business -- same path as the Orders tab cancel).
  /** @param {any} id */
  const onOrderCancel = (id) => {
    if (pane.broker)
      command({ type: 'cancel', broker: pane.broker, id })
        .catch(jerr)
        .finally(() => schedule());
  };
  // the qty cell on a working-order pill -> RESIZE that resting order by id (price and any server-side OCO
  // bond untouched -- the worker's modifyOrder; the book confirms the new size and the pill re-labels from it).
  // Fires once: the pill opens the picker in CONFIRM mode, so this is the confirmed value, not per-click noise.
  /** @param {any} id @param {number} qty */
  const onOrderQty = (id, qty) => {
    if (pane.broker && Number(qty) > 0)
      command({ type: 'modifyOrder', broker: pane.broker, id, qty: Number(qty) })
        .catch(jerr)
        .finally(() => schedule());
  };
  // the position element's CLOSE affordance (the entry pill's X) -> flatten the symbol at market (the worker's
  // closePosition: hedging closes all lots, netting sends the offsetting order -- same as the Modify tab's Close).
  const onPositionClose = () => {
    if (pane.broker && pane.symbol)
      command({ type: 'closePosition', broker: pane.broker, symbol: pane.symbol })
        .catch(jerr)
        .finally(() => schedule());
  };
  // click any ORDER dot -> open THAT specific order in the Modify tab (by id). Every working order is editable here.
  /** @param {any} id */
  const onOrderClick = (id) => {
    const d = /** @type {any} */ (window).desktop;
    if (!d || !d.openOrderTicket || !pane.symbol) return;
    const o = /** @type {any} */ (derive().orders.find((x) => x.id === id));
    if (!o) return;
    // hedging (from the order's account) unlocks the SL/TP editor for a resting limit/stop (pending-order exits)
    const acct = /** @type {any[]} */ (platform.accounts.all()).find(
      (a) => a.broker === pane.broker && String(a.accountId) === String(o.accountId),
    );
    d.openOrderTicket({
      tab: 'modify',
      order: {
        broker: pane.broker,
        symbol: pane.symbol,
        id,
        type: o.type,
        side: o.side,
        qty: o.qty,
        price: o.price,
        stopLoss: o.stopLoss,
        takeProfit: o.takeProfit,
        hedging: !!(acct && acct.hedging),
      },
    });
  };
  // drag a plan STOP dot -> commitStop, THE shared stop writer (chart drag + levels table go through the same rule):
  // PRE-FILL rung 0, the stop's side vs the entry pivot sets the direction -- crossing it flips long<->short and
  // mirrors the target (the reference addon's reflectDir). With a position open, on rungs 1+, or while the plan
  // is ARMED, a plain reprice: flipping is a PLANNING gesture -- retargeting an armed entry trigger that sits at
  // the market fires it INSTANTLY on the flipped side (a live accidental entry), so an armed stop only moves.
  /** @param {number} i @param {number} price */
  const onPlanStop = (i, price) => {
    commitStop(pane.broker, pane.symbol, i, snap(price), {
      flip: derive().entry == null && !isArmed(pane.broker, pane.symbol),
      snap,
      pivot: livePrice(),
    });
  };
  /** @param {number} i @param {number} price */
  const onPlanTarget = (i, price) => {
    setLevel(pane.broker, pane.symbol, i, { target: snap(price) });
  };
  // CLEAR a rung's leg (the rung pill's X): the level drops off the chart and the kebab piece returns to the
  // stick. Plan state only -- nothing is sent anywhere.
  /** @param {number} i */
  const onPlanStopClear = (i) => {
    setLevel(pane.broker, pane.symbol, i, { stop: null });
  };
  /** @param {number} i */
  const onPlanTargetClear = (i) => {
    setLevel(pane.broker, pane.symbol, i, { target: null });
  };
  // drag the gray PROJECTION dot -> pick the pending ENTRY level (plan ref). Persisted in the store, so the dot stays
  // where the user put it and stops riding the live price (the market projection rides only until it is pinned).
  /** @param {number} price */
  const onProjectionMove = (price) => {
    if (pane.symbol) setLevels(pane.broker, pane.symbol, { ref: snap(price) });
  };
  // edit the planned ENTRY volume (the pill's qty cell) -> plan.qty, the ONE shared value the dialog's Volume
  // field also edits/mirrors. Pure plan state; nothing is sent anywhere.
  /** @param {number} q */
  const onProjectionQty = (q) => {
    const n = Number(q);
    if (pane.symbol && n > 0) setLevels(pane.broker, pane.symbol, { qty: n });
  };
  // switch the planned entry's TYPE (the pill's type cell) -> plan.orderType; the dialog mirrors it as its
  // active Market/Limit/Stop tab (and a tab click writes it back). Pure plan state.
  /** @param {string} t */
  const onProjectionType = (t) => {
    if (pane.symbol && (t === 'market' || t === 'limit' || t === 'stop'))
      setLevels(pane.broker, pane.symbol, { orderType: t });
  };
  // switch the planned entry's SIDE (the pill's B/S cell) -> plan.side; the confirm (V) places with it
  /** @param {string} sd */
  const onProjectionSide = (sd) => {
    if (pane.symbol && (sd === 'buy' || sd === 'sell')) setLevels(pane.broker, pane.symbol, { side: sd });
  };
  // dismiss the projection (the pill's X) -> Project OFF, exactly the dialog's checkbox unticked: clears the
  // plan (ref/levels/qty/type/side) everywhere; the dialog's checkbox mirrors it off.
  const onProjectionCancel = () => {
    if (pane.symbol) setProjecting(pane.broker, pane.symbol, false);
  };
  // CONFIRM (the pill's V) -> PLACE the planned order through the worker, the same `place` command the dialog's
  // Buy/Sell buttons send: side/qty/type from the plan, the ref as the resting price, the projected bracket's
  // rung 0 as the native SL/TP. Placed OK -> the projection is CONSUMED (Project off; the real order takes over
  // on the chart from the book). Rejected/failed -> the projection stays so the user can adjust and retry (the
  // worker logs the error to the Console).
  const onProjectionConfirm = () => {
    if (!pane.broker || !pane.symbol) return;
    const p = getPlan(pane.broker, pane.symbol);
    // ADDON MODE: the plan has an OWNER (an addon pushed it) -> V means "go live" in the OWNER's semantics:
    // flip the shared armed flag and let the owner arm its automation (watcher entry + ladder exits). Placing
    // directly here would run the app's order path on top of the addon's -- two heads on one plan.
    if (p.owner) {
      setArmed(pane.broker, pane.symbol, true);
      return;
    }
    const qty = Number(p.qty) > 0 ? Number(p.qty) : 1;
    const side = p.side === 'sell' ? 'sell' : 'buy';
    const t = p.orderType === 'limit' || p.orderType === 'stop' ? p.orderType : 'market';
    const l0 = (Array.isArray(p.levels) && p.levels[0]) || {};
    // whatever exit legs are planned ride the order natively -- from the full projected bracket OR individual
    // kebab pieces dragged off the pill (a lone stop / lone target is a valid bracket to the adapters)
    const bracket =
      l0.stop != null || l0.target != null
        ? { stopLoss: l0.stop != null ? Number(l0.stop) : 0, takeProfit: l0.target != null ? Number(l0.target) : 0 }
        : null;
    /** @type {any} */
    const cmd = { type: 'place', ctx: { broker: pane.broker, symbol: pane.symbol }, side, qty, bracket };
    // STAKE mode: the plan carries the sizing intent -> place via it, EXACTLY the dialog's Buy/Sell path (the worker
    // sizes against the live entry). qty above is only the pill's displayed reflection; the worker overrides it.
    if (p.sizing && Number(p.sizing.risk) > 0)
      cmd.sizing = { risk: Number(p.sizing.risk), stop: Number(p.sizing.stop) };
    if (t !== 'market') {
      const px = p.ref != null ? Number(p.ref) : NaN;
      if (!(px > 0)) return; // a resting order needs its price (seedTypeRef pins one as soon as the type is set)
      cmd.orderType = t;
      cmd.price = snap(px);
    }
    command(cmd)
      .then((/** @type {any} */ r) => {
        if (r && r.ok) setProjecting(pane.broker, pane.symbol, false);
      })
      .catch(jerr)
      .finally(() => schedule());
  };

  // drag the STRING horizontally through time -> remember where the user put it (per broker+symbol, synced in memory,
  // NOT persisted). anchorTime() then honours it over the bars-away default; toggling the projection off clears it.
  /** @param {number} t @param {boolean} commit */
  const onAnchor = (t, commit) => {
    if (commit && pane.symbol) {
      setLevels(pane.broker, pane.symbol, { anchor: Number(t) });
      schedule();
    }
  };
  // resolve the ACTIVE primitive from the registry (the GLOBAL choice in order-primitives-config; falls back to
  // string-beads) and build ONE instance of it. The overlay stays primitive-blind: it derives state and sends
  // commands; the primitive draws. Any primitives-config change (active id, a primitive's settings) tears the
  // view down; the next render rebuilds it with the current primitive + config -- never two at once.
  const ensureView = () => {
    if (!view) {
      const prim = getPrimitive(activePrimitiveId());
      view = prim
        ? prim.create(pane, {
            onEntry,
            onProjection,
            onProjectionMove,
            onProjectionQty,
            onProjectionType,
            onProjectionSide,
            onProjectionCancel,
            onProjectionConfirm,
            onPlanStop,
            onPlanTarget,
            onPlanStopClear,
            onPlanTargetClear,
            onHedgeStop,
            onHedgeTarget,
            onHedgeStopClear,
            onHedgeTargetClear,
            onOrderCommit,
            onOrderStopCommit,
            onOrderTargetCommit,
            onOrderStopClear,
            onOrderTargetClear,
            onOrderQty,
            onOrderClick,
            onOrderCancel,
            onPositionClose,
            onAnchor,
          })
        : null;
    }
    return view;
  };
  const offPrim = subscribePrimitives(() => {
    if (view) {
      view.remove();
      view = null;
    }
    schedule();
  });
  loadOrderPrimitives().catch(() => {}); // one GET per window; emits when loaded so early views rebuild with user config
  // one GET per window to load any LOADABLE primitives; when they finish registering, drop the fallback view so the
  // next render rebuilds with the now-available active primitive (e.g. string-beads once installed).
  loadPrimitiveModules()
    .then(() => {
      if (view) {
        view.remove();
        view = null;
      }
      schedule();
    })
    .catch(() => {});
  // last traded price for THIS pane -- pane.lastClose is the newest bar's close, refreshed on every redraw (each live
  // bar). (pane.bars is a Map, not an array, so it can't be indexed; lastClose is the maintained live figure.)
  const livePrice = () => {
    const c = Number(pane.lastClose);
    return Number.isFinite(c) ? c : null;
  };
  // snap a price to the instrument's TICK grid (indices trade in e.g. 0.25 -> no off-tick plan prices). pane.tickSize is
  // set on symbol resolve; 0/absent -> pass through. toPrecision(12) clears the multiply's IEEE754 noise (7630.7500001).
  /** @param {number} v */
  const snap = (v) => {
    const t = Number(pane.tickSize) || 0;
    const x = t > 0 ? Math.round(Number(v) / t) * t : Number(v);
    return Number.isFinite(x) ? Number(x.toPrecision(12)) : Number(v);
  };

  const render = () => {
    raf = 0;
    if (pane.destroyed) return;
    if (!enabled) {
      if (view) {
        view.remove();
        view = null;
      }
      return;
    } // PER-CHART toggle off -> draw nothing on this chart
    // LAYER 1 -- ACTIVE, always from the book: position entry + hedge SL/TP + EVERY working order. Never suppressed.
    const a = derive();
    const hasActive = a.entry != null || a.orders.length > 0 || a.hedgeStop != null || a.hedgeTarget != null;
    // LAYER 2 -- PLAN. TWO cases, split by whether a position exists:
    //   PRE-TRADE (FLAT): the planning projection + bracket seed.
    //   POSITION OPEN: ONLY an ARMED ladder draws (live automation exits: watcher rules, NOT broker orders, so Layer 1
    //     never draws them -- they must persist through the fill). An UNARMED plan is suppressed over a position: its
    //     entry became either real broker orders (the dialog's bracket -- Layer 1 already draws those; drawing the plan
    //     too doubled every level) or nothing to act on. The addon arms its bracket at the fill (watcher or manual), so
    //     its exits always draw. The plan resumes when flat.
    const armed = planActive && isArmed(pane.broker, pane.symbol);
    const planOwner = planActive ? getPlan(pane.broker, pane.symbol).owner || null : null; // addon mode: who owns the plan
    const planPre = a.entry == null && planActive && isProjecting(pane.broker, pane.symbol); // pre-trade projection + seed
    const planLive = a.entry != null && armed && isBracket(pane.broker, pane.symbol); // live automation exits over the position
    const planOn = planPre || planLive;
    if (!hasActive && !planOn) {
      if (view) {
        view.remove();
        view = null;
      }
      return;
    } // nothing real and no plan -> clear
    let projection = null;
    /** @type {number|null} */
    let projectionQty = null;
    /** @type {string|undefined} */
    let projectionType;
    /** @type {string|undefined} */
    let projectionSide;
    /** @type {Array<{stop?: number|null, target?: number|null, qty?: number|null}>} */
    let planLevels = [];
    if (planPre) {
      const px = livePrice();
      const p = getPlan(pane.broker, pane.symbol);
      // On a money-management account the pill DERIVES its qty here, in this window (engine risk + live price
      // + the plan's stop) -- the store carries intent, never a derived number, so the pill is correct with no
      // dialog open. Manual account (null) -> the shared plan qty, as before.
      const l0 = Array.isArray(p.levels) && p.levels[0] ? p.levels[0] : null;
      const mm = mmPlanQty({
        broker: pane.broker,
        entry: px,
        stop: l0 && l0.stop != null ? Number(l0.stop) : 0,
        tickSize: pane.tickSize,
        tickValue: pane.tickValue,
      });
      projectionQty = mm ? mm.qty : Number(p.qty) > 0 ? Number(p.qty) : 1; // the planned entry volume (shared with the dialog's Volume; 1 until set)
      projectionType = p.orderType === 'limit' || p.orderType === 'stop' ? p.orderType : 'market'; // the planned type (shared with the dialog's tabs)
      projectionSide = p.side === 'sell' ? 'sell' : 'buy'; // the planned side (the pill's B/S cell; default buy)
      // a PINNED entry level (plan ref, e.g. set by the automation's pending setup or dragged here) anchors the dot and
      // stops it riding; an unpinned market projection rides the live price. Either can be null -> no dot.
      const projPx = p.ref != null && Number.isFinite(Number(p.ref)) ? Number(p.ref) : px;
      if (projPx != null) {
        projection = snap(projPx); // gray entry projection (planPre already guarantees we are flat)
        // render EVERY rung (level 0 = app bracket, 1+ = extra ladder from a multi-level caller), snapped to the
        // grid. Rungs draw when the BRACKET is projected *or* when individual legs exist without it (a kebab
        // piece dragged off the pill sets just its own leg). PURE READ: the rung-0 seeding is an ACTION
        // (seedBracket below), never done while rendering.
        const levels = Array.isArray(p.levels) ? p.levels : [];
        const hasLegs = levels.some((lv) => lv && (lv.stop != null || lv.target != null));
        if (isBracket(pane.broker, pane.symbol) || hasLegs) {
          planLevels = levels.map((lv) => ({
            stop: lv && lv.stop != null ? snap(Number(lv.stop)) : null,
            target: lv && lv.target != null ? snap(Number(lv.target)) : null,
            qty: lv && lv.qty != null ? Number(lv.qty) : null,
          }));
        }
      }
    } else if (planLive) {
      // LIVE exits: render the ladder that is already set (no projection, no seed -- the automation owns the prices).
      // COMPLETED rungs (below the automation's activeIdx) are done -- blank them so their dots drop off the chart;
      // keeping them as empty slots preserves the remaining rungs' numbering (beads are keyed/labelled by index).
      const p = getPlan(pane.broker, pane.symbol);
      const levels = Array.isArray(p.levels) ? p.levels : [];
      const ai = Number(p.activeIdx);
      const doneBelow = Number.isFinite(ai) && ai > 0 ? ai : 0;
      planLevels = levels.map((lv, i) =>
        i < doneBelow
          ? { stop: null, target: null, qty: null }
          : {
              stop: lv && lv.stop != null ? snap(Number(lv.stop)) : null,
              target: lv && lv.target != null ? snap(Number(lv.target)) : null,
              qty: lv && lv.qty != null ? Number(lv.qty) : null,
            },
      );
    }
    const v = ensureView();
    if (!v) return;
    // per-category VISIBILITY (plan.vis, session-only): pure show/hide set by the automation's toggles / hide-on-entry.
    // Filters the DISPLAY only -- the book, the plan data and the watcher rules underneath are untouched.
    const vis = getPlan(pane.broker, pane.symbol).vis || {};
    const show = (/** @type {'entry'|'stop'|'target'} */ k) => vis[k] !== false;
    v.set({
      time: anchorTime(),
      entry: show('entry') ? a.entry : null,
      side: a.side || undefined,
      qty: a.qty,
      hedgeStop: show('stop') ? a.hedgeStop : null,
      hedgeStopQty: a.hedgeStopQty,
      hedgeTarget: show('target') ? a.hedgeTarget : null,
      hedgeTargetQty: a.hedgeTargetQty,
      orders: a.orders,
      projection: show('entry') ? projection : null,
      projectionQty,
      projectionType,
      projectionSide,
      planLevels: planLevels.map((lv) => ({
        stop: show('stop') ? lv.stop : null,
        target: show('target') ? lv.target : null,
        qty: lv.qty,
      })),
      planArmed: armed,
      planOwner,
    });
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(render);
  };

  // SEED the bracket -- an ACTION (event -> action -> mutate -> render), never run inside render(). When a bracket is
  // projected pre-trade and rung 0 / the entry pivot are still unset, freeze the pivot at the projection and place
  // rung 0 a SCREEN-relative distance from it: projHeightPct of the visible chart height, frozen to a price so it does
  // not ride the screen after. Falls back to a small price-% until the y-scale is measurable -- instrument-agnostic,
  // no ticks/points to mis-scale on crypto/fx. Runs on every plan change + each ride tick (retries until a price
  // exists); a no-op once seeded.
  const seedBracket = () => {
    if (!enabled || pane.destroyed || !pane.symbol) return;
    if (!isProjecting(pane.broker, pane.symbol) || !isBracket(pane.broker, pane.symbol)) return;
    if (derive().entry != null) return; // pre-trade only -- with a position open the automation owns the levels
    const p = getPlan(pane.broker, pane.symbol);
    const l0 = (Array.isArray(p.levels) && p.levels[0]) || {};
    if (p.ref != null && l0.stop != null && l0.target != null) return; // already seeded
    const projPx = p.ref != null && Number.isFinite(Number(p.ref)) ? Number(p.ref) : livePrice();
    if (projPx == null) return; // no price yet -- the ride tick retries
    const ref = snap(projPx); // freeze the entry pivot at the projection on first show (on the tick grid)
    const range = visibleRange();
    const off = range ? projFrac() * range : Math.max(ref * 0.0015, 0);
    const s = snap(l0.stop != null ? Number(l0.stop) : ref - off);
    const t = snap(l0.target != null ? Number(l0.target) : ref + off);
    setLevel(pane.broker, pane.symbol, 0, { stop: s, target: t });
    if (p.ref == null) setLevels(pane.broker, pane.symbol, { ref, dir: s < ref ? 'long' : 'short' });
  };

  // a LIMIT/STOP projection is a RESTING order plan -- it needs a definite price. If the type arrives while the
  // projection still rides the live price (no ref), PIN the ref at the market: the pill stops riding and the
  // dialog's Price field has a number. One-shot (no-op once ref exists); an ACTION like seedBracket, never in render().
  const seedTypeRef = () => {
    if (!enabled || pane.destroyed || !pane.symbol) return;
    if (!isProjecting(pane.broker, pane.symbol)) return;
    if (derive().entry != null) return;
    const p = getPlan(pane.broker, pane.symbol);
    if ((p.orderType !== 'limit' && p.orderType !== 'stop') || p.ref != null) return;
    const px = livePrice();
    if (px == null) return;
    setLevels(pane.broker, pane.symbol, { ref: snap(px) });
  };

  // PLAN input (pure UI, independent of the book): MIRROR the shared plan store. When THIS pane's (broker, symbol) is
  // being projected, show the gray dot; while projecting, a light rAF loop lets it ride the live price. The book always
  // supersedes it (render() draws the book first and only falls through to the plan when flat). The plan lives in the
  // store, not here, so it survives the control window closing and a new pane picks it up on creation.
  let planActive = false; // projecting and/or bracket -> the ride loop runs + the overlay draws the plan
  let projRaf = 0;
  /** @type {number|null} */
  let lastRidePx = null; // last live price the ride loop rendered at -- render only when it MOVES (plan
  // changes re-render via subscribePlan/schedule; a full re-render per frame burned
  // ~25% CPU re-setting identical state)
  const projTick = () => {
    projRaf = 0;
    if (!planActive || pane.destroyed) return;
    seedBracket();
    seedTypeRef();
    const px = livePrice();
    if (px !== lastRidePx) {
      lastRidePx = px;
      render();
    }
    projRaf = requestAnimationFrame(projTick);
  };
  const startRide = () => {
    if (!projRaf) projRaf = requestAnimationFrame(projTick);
  };
  const stopRide = () => {
    if (projRaf) {
      cancelAnimationFrame(projRaf);
      projRaf = 0;
    }
  };
  // mirror the shared plan store: active when THIS instrument has a projection OR a bracket. Re-render on ANY plan
  // change (a bracket toggle from the dialog, a level drag from another window) so the dots always track it.
  const syncPlan = () => {
    const on = isProjecting(pane.broker, pane.symbol) || isBracket(pane.broker, pane.symbol);
    if (on !== planActive) {
      planActive = on;
      if (on) startRide();
      else stopRide();
    }
    seedBracket();
    seedTypeRef();
    schedule();
  };
  const offPlan = subscribePlan(syncPlan);

  // HIDE-ON-ENTRY trigger: the SINGLE universal site. The overlay already watches the book, so it detects THIS
  // instrument going flat -> open (a position appeared, from ANY source -- the dialog, an addon, or the broker's own
  // platform) and applies the shared hide-on-entry policy; open -> flat resets visibility to all-shown. Seeded from the
  // CURRENT book so an already-open position at load does NOT re-fire (hide-on-entry is an entry MOMENT, not a load).
  let hadPosition = derive().entry != null;
  const onBook = () => {
    const has = derive().entry != null;
    if (has && !hadPosition)
      applyEntryVisibility(pane.broker, pane.symbol); // flat -> open: apply the policy
    else if (!has && hadPosition) resetEntryVisibility(pane.broker, pane.symbol); // open -> flat: show everything again
    hadPosition = has;
    schedule();
  };
  // driven by the BOOK: any change to positions / orders / lots re-projects (and drives the hide-on-entry transition)
  const offs = [
    platform.positions.subscribe(onBook),
    platform.orders.subscribe(schedule),
    platform.positionLots.subscribe(onBook),
  ];
  syncPlan(); // reflect any plan that already exists for this instrument
  render();

  return {
    /** @param {boolean} on PER-CHART "Positions and orders" toggle -- off clears this chart's overlay immediately */
    setEnabled: (on) => {
      const v = on !== false;
      if (v === enabled) return;
      enabled = v;
      if (!enabled && view) {
        view.remove();
        view = null;
      }
      schedule();
    },
    refresh: () => {
      syncPlan();
      schedule();
    }, // pane calls this on a symbol/broker switch (re-evaluate the plan for the new instrument)
    destroy() {
      offs.forEach((f) => {
        try {
          f();
        } catch (_) {}
      });
      offPlan();
      offPrim();
      stopRide();
      if (raf) cancelAnimationFrame(raf);
      if (view) {
        view.remove();
        view = null;
      }
    },
  };
}
