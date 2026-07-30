// @ts-check
// order-ticket PLAN BRIDGE -- turns the app's shared PROJECTION on/off for the addon's pending setup (api.trade.plan),
// so the APP OVERLAY draws the on-chart planning dots (entry + stop/target). The addon draws nothing itself.
//
// GEOMETRY IS THE APP'S JOB: the overlay places the string `Bars away` (Settings > Trading) into the empty space and
// seeds the bracket a screen-relative `Offset (% height)` from the entry -- both need the pane's pixel scale, which the
// addon (running in the addon-host) cannot measure. So the bridge only flips Project + Bracket ON and lets the app seed
// the ref/anchor/levels from those global settings; it never imposes its own prices (doing so is exactly what made the
// dots ignore Bars away / Offset). The watcher derives its rules from the store (auto.js applyRules) on every change.
//
// An `owns` guard makes clear() a no-op unless THIS addon set the plan, so it never wipes a projection the user set
// from the Order dialog.

/** @typedef {ReturnType<import('./kernel.js').createKernel>} Kernel */

/** @param {Kernel} ot */
export function createPlanBridge(ot) {
  const { cfg, api } = ot;
  const plan = api.trade.plan;
  const ctx = () => ({ broker: cfg.broker || '', symbol: cfg.symbol });
  let owns = false; // did WE set the plan? -> only then may clear() wipe it

  // PUSH: flip Project + Bracket on and STAMP OWNERSHIP -- the plan is addon-controlled now, so the app's pill
  // controller switches to owner semantics (its V arms us via the shared armed flag instead of placing an order
  // itself). The overlay seeds the entry/stop/target + the bars-away anchor from the app's global projection
  // settings -- we deliberately set NO ref/levels so those settings are honoured.
  const push = () => {
    const { broker, symbol } = ctx();
    if (!symbol) return;
    plan.setProjecting(broker, symbol, true);
    plan.setBracket(broker, symbol, true);
    plan.setLevels(broker, symbol, { owner: 'position-manager' });
    owns = true;
  };

  // ARM / DISARM: flip the projected bracket LIVE (planning -> live mode) without touching the levels. The overlay
  // redraws it in the live colours; disarm returns it to a plan.
  const arm = () => {
    const { broker, symbol } = ctx();
    if (!symbol) return;
    plan.setArmed(broker, symbol, true);
  };
  const disarm = () => {
    const { broker, symbol } = ctx();
    if (!symbol) return;
    plan.setArmed(broker, symbol, false);
  };

  // CLEAR the plan (setup torn down / entry filled) -- only if we own it. setBracket(false) also clears armed.
  const clear = () => {
    if (!owns) return;
    const { broker, symbol } = ctx();
    if (!symbol) return;
    plan.setBracket(broker, symbol, false);
    plan.setProjecting(broker, symbol, false);
    owns = false;
  };

  // RESET: fresh slate on (re)start. A prior session's projection lingers in the store / on disk while a fresh addon has
  // no setup -- so the chart shows stale beads under an idle "Show pending". Assert empty unconditionally (not owns-gated).
  const reset = () => {
    const { broker, symbol } = ctx();
    if (!symbol) return;
    plan.setProjecting(broker, symbol, false);
    owns = false;
  };

  return { push, arm, disarm, clear, reset };
}
