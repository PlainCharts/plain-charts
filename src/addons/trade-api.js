// @ts-check
// Trade-control surface for addons (the `api.trade` surface). The order-worker-era counterpart to api.chart: it hands
// an addon the SAME order services the app's own surfaces use, so an addon never re-derives the book or reaches past
// the worker.
//   - book(broker, symbol): the ACTIVE picture from the platform book (net/hedged entry + every working order leg),
//     via the shared readActive selector -- the identical read the chart overlay and the order worker use.
//   - plan: the pre-trade PLAN state (projection + bracket levels), shared and synced across windows via plan-store.
//   - command(cmd): (added P2.3) send a semantic order command to the order worker -- the ONLY execution path.
// Read + plan are pure app services (no broker contact). This runs where the addon's UI lives; the plan-store and the
// book are cross-window synced, so reads here mirror every other window.
import { readActive, command } from '../../data_engine/index.js';
import * as plan from '../chart/order-view/plan-store.js';
import * as vis from '../chart/order-view/order-visibility.js';   // shared VISIBILITY behavior (hide-on-entry policy + apply/reset)

/** @param {((cleanup: () => void) => void)=} registerCleanup */
export function makeTradeApi(registerCleanup) {
  /** @type {Array<() => void>} */
  const subs = [];   // plan-store unsubscribers (auto-dropped on close)

  const api = {
    // ---- read the ACTIVE book for a (broker, symbol) ----
    // Net/hedged entry + side + qty + hedging SL/TP (position attributes) + orders[] (one leg per working order).
    // Empty broker matches any. Pure + synchronous -- safe to call every render. Never null.
    /** @param {string} broker @param {string} symbol */
    book: (broker, symbol) => readActive(broker, symbol),

    // ---- EXECUTE via the order worker -- the ONLY execution path (the worker is the single owner) ----
    // A semantic command { type, ... } routed to the order-host worker, which owns the logic and journals it; the
    // ack resolves { ok, error? } (or the verb's result). Verbs: place / setStop / setTarget / modifyOrder / cancel /
    // modifyPosition / closeLot / closePosition / script. UNGATED: addons are trusted EA-like modules (they already
    // have direct broker reach), so this is their clean funnel INTO the worker instead of touching the broker. The
    // gated actor is the assistant (its own policy + confirm live in the worker).
    /** @param {{ type: string, [k: string]: any }} cmd @returns {Promise<any>} */
    command: (cmd) => command(cmd),

    // ---- pre-trade PLAN state (projection / bracket levels), shared + synced across windows ----
    // DISPLAY/planning only -- it is NOT the order book and never touches a broker. Keyed broker:symbol (empty broker
    // = a broker-agnostic plan matching any pane of the symbol). setProjecting/setBracket persist; setLevels syncs
    // in-memory only. bracket => project is enforced by the store.
    plan: {
      /** the full plan for (broker, symbol). @param {string} broker @param {string} symbol */
      get: (broker, symbol) => plan.getPlan(broker, symbol),
      /** @param {string} broker @param {string} symbol */
      isProjecting: (broker, symbol) => plan.isProjecting(broker, symbol),
      /** @param {string} broker @param {string} symbol */
      isBracket: (broker, symbol) => plan.isBracket(broker, symbol),
      /** @param {string} broker @param {string} symbol */
      isArmed: (broker, symbol) => plan.isArmed(broker, symbol),
      /** @param {string} broker @param {string} symbol @param {boolean} on */
      setProjecting: (broker, symbol, on) => plan.setProjecting(broker, symbol, on),
      /** @param {string} broker @param {string} symbol @param {boolean} on */
      setBracket: (broker, symbol, on) => plan.setBracket(broker, symbol, on),
      /** flip the projected bracket LIVE (session-only) -- planning -> live mode. @param {string} broker @param {string} symbol @param {boolean} on */
      setArmed: (broker, symbol, on) => plan.setArmed(broker, symbol, on),
      /** @param {string} broker @param {string} symbol @param {any} patch ref/dir/anchor (non-rung plan fields) */
      setLevels: (broker, symbol, patch) => plan.setLevels(broker, symbol, patch),
      /** set ONE ladder rung's stop/target/qty by index (rung 0 = the app's bracket). @param {string} broker @param {string} symbol @param {number} i @param {{stop?: number|null, target?: number|null, qty?: number|null}} patch */
      setLevel: (broker, symbol, i, patch) => plan.setLevel(broker, symbol, i, patch),
      /** commit a STOP price through THE shared stop rule (rung-0 direction flip + target mirror when flip is allowed). @param {string} broker @param {string} symbol @param {number} i @param {number} stop @param {{ flip?: boolean, snap?: (v: number) => number, pivot?: number|null }} [opts] */
      commitStop: (broker, symbol, i, stop, opts) => plan.commitStop(broker, symbol, i, stop, opts),
      /** merge per-category dot VISIBILITY (session-only show/hide, never affects orders). @param {string} broker @param {string} symbol @param {{entry?: boolean, stop?: boolean, target?: boolean}} patch */
      setVis: (broker, symbol, patch) => plan.setVis(broker, symbol, patch),
      /** the GLOBAL hide-on-entry policy (which categories hide when a position opens). Shared with the order dialog. @returns {{entry: boolean, stop: boolean, target: boolean}} */
      hideOnEntry: () => vis.hideOnEntry(),
      /** merge a hide-on-entry patch; persists + syncs to every window (dialog + addon share it). @param {{entry?: boolean, stop?: boolean, target?: boolean}} patch */
      setHideOnEntry: (patch) => vis.setHideOnEntry(patch),
      /** subscribe to hide-on-entry policy changes (auto-unsubscribed on close). @param {() => void} fn @returns {() => void} */
      onHideOnEntryChange: (fn) => { const u = vis.onHideOnEntryChange(fn); subs.push(u); return u; },
      /** apply the hide-on-entry policy now (hide checked categories). @param {string} broker @param {string} symbol */
      applyEntryVisibility: (broker, symbol) => vis.applyEntryVisibility(broker, symbol),
      /** reset visibility to all-shown. @param {string} broker @param {string} symbol */
      resetEntryVisibility: (broker, symbol) => vis.resetEntryVisibility(broker, symbol),
      /** REPLACE the whole ladder (push N rungs at once) -- the automation's multi-level SL/TP. @param {string} broker @param {string} symbol @param {Array<{stop?: number|null, target?: number|null}>} levels */
      setLadder: (broker, symbol, levels) => plan.setLadder(broker, symbol, levels),
      /** subscribe to any plan change; auto-unsubscribed on close. @param {() => void} fn @returns {() => void} */
      subscribe: (fn) => { const u = plan.subscribe(fn); subs.push(u); return u; },
    },
  };

  if (typeof registerCleanup === 'function') registerCleanup(() => { subs.forEach((u) => { try { u(); } catch (_) {} }); subs.length = 0; });
  return api;
}
