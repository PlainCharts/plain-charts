// @ts-check
// Injectable per-account sizing policy. The app installs a resolver; the order worker asks it, at order time,
// for the risk amount an account's sizing SYSTEM dictates (money management). No policy installed -> null ->
// the order's own sizing (a hand-set qty, or a stake) stands unchanged. Mirrors setExecGate in ../../policy.js.
//
// This keeps the engine generic: it exposes the seam; the app plugs in the MM computation (config + the
// account's closed-trade history -> mmState().risk) and registers it via setSizingPolicy.

/** @type {((brokerId: string) => (number | null)) | null} */
let policy = null;

/** Install the per-account sizing resolver (the app's MM policy). @param {(brokerId: string) => (number | null)} fn */
export function setSizingPolicy(fn) {
  policy = fn;
}

/** The account-dictated risk$ for an order on `brokerId`, or null to leave the order's own sizing. @param {string} brokerId */
export function accountRisk(brokerId) {
  if (!policy || !brokerId) return null;
  try {
    const r = policy(brokerId);
    return r != null && r > 0 ? r : null;
  } catch {
    return null;
  }
}
