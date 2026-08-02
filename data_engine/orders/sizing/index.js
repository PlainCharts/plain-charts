// @ts-check
// Sizing methods -- pure decision rules that answer "how big?" for an order. No broker, no store, no DOM.
// Each method sizes a different way:
//   stake -> sizeFromStake: the caller gives the risk amount, this returns the quantity.
//   mm    -> the money-management engine (added next, in ./mm/): computes the risk amount itself from the
//            account balance + zone + ladder, then that risk feeds sizeFromStake for the quantity.
// The order worker (exec.js) gathers the live inputs (instrument, entry quote) and calls these; the rules
// themselves stay pure and testable.
export { sizeFromStake } from './stake.js';
export { setSizingPolicy, accountRisk } from './policy.js';
