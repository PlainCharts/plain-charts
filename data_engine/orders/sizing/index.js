// @ts-check
// Sizing methods -- pure decision rules that answer "how big?" for an order. No broker, no store, no DOM.
//   stake -> sizeFromStake: the caller gives the risk amount, this returns the quantity.
// The order worker (exec.js) gathers the live inputs (instrument, entry quote) and calls these; the rules
// themselves stay pure and testable.
export { sizeFromStake } from './stake.js';
