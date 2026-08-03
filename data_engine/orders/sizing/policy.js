// @ts-check
// Injectable per-account sizing policy. The app installs a resolver; the order worker asks it, at order
// time, for the risk amount the order's ACCOUNT dictates (money management). No policy installed -> null ->
// the order's own sizing (a hand-set qty, or a stake) stands unchanged. Mirrors setExecGate in ../../policy.js.
//
// The key is the order's ctx { broker, accountId }: identity is the ACCOUNT, not the broker -- the same
// ctx every `place` command already carries. This keeps the engine generic: it exposes the seam; the app
// plugs in the MM computation and registers it via setSizingPolicy.

/** @typedef {{ broker?: string, accountId?: string|number|null }} SizingCtx */

/** @type {((ctx: SizingCtx) => (number | null)) | null} */
let policy = null;

/** Install the per-account sizing resolver (the app's MM policy). @param {(ctx: SizingCtx) => (number | null)} fn */
export function setSizingPolicy(fn) {
  policy = fn;
}

/** The account-dictated risk$ for an order, or null to leave the order's own sizing. @param {SizingCtx} ctx */
export function accountRisk(ctx) {
  if (!policy || !ctx || !ctx.broker) return null;
  try {
    const r = policy(ctx);
    return r != null && r > 0 ? r : null;
  } catch {
    return null;
  }
}
