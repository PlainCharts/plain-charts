// @ts-check
// THE ORDER-PRIMITIVE CONTRACT -- the single language between the order overlay and any on-chart order
// RENDERER ("primitive"). A primitive is a display vocabulary for one (broker, symbol)'s order picture: the
// string-and-beads is one, the pill is another. Every primitive implements THIS interface; the overlay
// (order-overlay.js) derives the state and owns all order LOGIC/COMMANDS, so a conforming primitive is
// plug-and-play -- same idea as the broker adapters (src/data/adapter-contract.js). This file is the source
// of truth: to write a primitive, read this file.
//
// A primitive is an object registered with the primitive registry (primitive-registry.js):
//   id            unique string ('string-beads', 'pill', 'my-style')
//   label         display name (the settings dropdown)
//   capabilities  { anchor?, plan? } -- what the renderer can draw; the overlay never depends on these to
//                 derive state, they only describe the display (anchor = a time-anchored element the user can
//                 drag through time; plan = the pre-trade projection + stop/target ladder)
//   create(pane, handlers) -> instance | null
//   renderSettings(host, cfg, save)   OPTIONAL -- the primitive's OWN settings UI. The Settings > Trading >
//                 Primitives tab shows a dropdown of registered primitives and calls the selected one's
//                 renderSettings with a host element, its LIVE config namespace (order-primitives-config.js,
//                 settings/trading/order-primitives.json under primitives.<id>), and save() to persist. The
//                 primitive mutates cfg and calls save(); live views rebuild on the change. No hook = the tab
//                 says the primitive has no settings.
//
// The INSTANCE is declarative and DISPLAY-ONLY: the overlay hands it the full OrderViewState and it reflects
// it; it never sends an order and owns no logic. Interaction is inverted: a user gesture on the primitive
// calls back through the HANDLERS (drag a level -> onOrderCommit(id, price); click -> onOrderClick(id); ...)
// and the overlay turns that into a COMMAND to the order worker. A primitive renders what it supports and
// ignores the rest -- but the LIVE book fields (entry, hedge SL/TP, orders[]) are the core vocabulary every
// primitive should draw.
//
// Lifecycle: the overlay creates ONE instance per pane, calls set(state) on every book/plan change, and
// remove() tears it down (the instance must clean up ALL its DOM/engine artifacts -- the caller owns nothing).

/**
 * A working order leg: id = the resting order id; type/side/price/qty read from the book.
 * @typedef {{ id: any, type: string, side: string, price: number, qty: number, stopLoss?: number|null, takeProfit?: number|null }} OrderLeg
 */
/**
 * One rung of the pre-trade plan ladder (a stop and/or a target, plus the rung's exit qty when the caller
 * sizes rungs individually -- absent means the whole planned/position qty).
 * @typedef {{ stop?: number|null, target?: number|null, qty?: number|null }} PlanLevel
 */
/**
 * The declarative state of one (broker, symbol)'s on-chart order picture. Any field left null/undefined hides
 * that element. Two compartments, drawn together and never replacing each other:
 *   LIVE (from the book, always): entry + hedge SL/TP + orders[] (one element per real working order).
 *   PLANNING (pre-trade, only while Project is on): projection + planLevels (stop/target ladder).
 * @typedef {Object} OrderViewState
 * @property {number} [time]         time anchor, epoch seconds (primitives with capabilities.anchor)
 * @property {number|null} [entry]   the position's average entry                                   -- LIVE
 * @property {string} [side]         'long' | 'short' (label only)                                  -- LIVE
 * @property {number} [qty]          position qty (label only)                                      -- LIVE
 * @property {number|null} [hedgeStop]      HEDGING position SL (a position attribute, no order id) -- LIVE
 * @property {number|null} [hedgeStopQty]
 * @property {number|null} [hedgeTarget]    HEDGING position TP (a position attribute, no order id) -- LIVE
 * @property {number|null} [hedgeTargetQty]
 * @property {OrderLeg[]} [orders]   working orders -- ONE element per resting order                -- LIVE
 * @property {number|null} [projection]  PLAN entry level (shown only while FLAT)                   -- PLANNING
 * @property {number|null} [projectionQty]  the planned ENTRY volume (plan.qty -- shared with the dialog's Volume)
 * @property {string} [projectionType]  the planned entry's TYPE, 'market'|'limit'|'stop' (plan.orderType -- shared with the dialog's tabs)
 * @property {string} [projectionSide]  the planned entry's SIDE, 'buy'|'sell' (plan.side; default buy)
 * @property {PlanLevel[]} [planLevels]  stop/target PLAN ladder (draggable, not orders)            -- PLANNING
 * @property {boolean} [planArmed]  the plan went LIVE: draw the projection + ladder in the live colours
 * @property {string|null} [planOwner]  which surface OWNS the plan (an addon id, e.g. 'order-ticket'; null = the
 *                                  app). ADDON MODE: with an owner set, confirm ARMS the owner's automation
 *                                  (the overlay flips the shared armed flag; the owner reacts) instead of
 *                                  placing an order directly -- one controller, the owner's semantics.
 */
/**
 * The interaction callbacks -- the primitive reports GESTURES; the overlay turns them into commands. All
 * optional: without a handler that element is display-only. Drags use DROP semantics where it matters (plan
 * rungs, order levels): the primitive tracks the pointer itself and reports the price on RELEASE (onCommit),
 * so a mid-drag pass over a level never fires anything.
 * @typedef {Object} OrderViewHandlers
 * @property {(at: any) => void} [onEntry]                    click the position entry (open the ticket)
 * @property {(at: any) => void} [onProjection]               click the plan projection (open the ticket)
 * @property {(price: number) => void} [onProjectionMove]     drag the projection -> pick the pending entry level
 * @property {(qty: number) => void} [onProjectionQty]        edit the planned entry volume (the pill's qty cell)
 * @property {(type: string) => void} [onProjectionType]      switch the planned entry's type (the pill's type cell)
 * @property {(side: string) => void} [onProjectionSide]      switch the planned entry's side (the pill's B/S cell)
 * @property {() => void} [onProjectionCancel]                dismiss the projection (the pill's X cell = Project off)
 * @property {() => void} [onProjectionConfirm]               place the planned order (the pill's V cell)
 * @property {(i: number, price: number) => void} [onPlanStop]    drag plan ladder rung i's stop
 * @property {(i: number, price: number) => void} [onPlanTarget]  drag plan ladder rung i's target
 * @property {(i: number) => void} [onPlanStopClear]              clear rung i's stop (the rung pill's X)
 * @property {(i: number) => void} [onPlanTargetClear]            clear rung i's target (the rung pill's X)
 * @property {(price: number) => void} [onHedgeStop]          drag the hedge SL (position modify, no order id)
 * @property {(price: number) => void} [onHedgeTarget]        drag the hedge TP (position modify, no order id)
 * @property {() => void} [onHedgeStopClear]                  remove the hedge SL from the position (the pill's X)
 * @property {() => void} [onHedgeTargetClear]                remove the hedge TP from the position (the pill's X)
 * @property {(id: any, price: number) => void} [onOrderCommit]   drag an order element -> request its new price
 * @property {(id: any, price: number) => void} [onOrderStopCommit]    drag a resting order's attached SL -> modify that leg by id
 * @property {(id: any, price: number) => void} [onOrderTargetCommit]  drag a resting order's attached TP -> modify that leg by id
 * @property {(id: any) => void} [onOrderStopClear]                    remove a resting order's attached SL (the pill's X)
 * @property {(id: any) => void} [onOrderTargetClear]                  remove a resting order's attached TP (the pill's X)
 * @property {(id: any, qty: number) => void} [onOrderQty]    pick a new qty on an order element -> resize the resting order
 * @property {(id: any) => void} [onOrderClick]               click an order element (open it in the ticket)
 * @property {(id: any) => void} [onOrderCancel]              click an order element's cancel affordance (X)
 * @property {() => void} [onPositionClose]                   click the position element's close affordance (X) -- flatten at market
 * @property {(time: number, commit: boolean) => void} [onAnchor]  drag the time anchor (capabilities.anchor)
 */
/**
 * What create() returns: a live view the overlay drives. set() reflects the whole state (idempotent -- the
 * instance reconciles its own elements); remove() tears everything down.
 * @typedef {Object} OrderViewInstance
 * @property {(s?: OrderViewState) => void} set
 * @property {(t: number) => void} [setTime]
 * @property {() => void} remove
 */
/**
 * @typedef {Object} OrderPrimitive
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {{ anchor?: boolean, plan?: boolean }} [capabilities]
 * @property {(pane: any, handlers?: OrderViewHandlers) => OrderViewInstance | null} create
 * @property {(host: HTMLElement, cfg: any, save: () => void) => void} [renderSettings]
 */

export {};
