// @ts-check
// Money-management engine -- the surface for the MM sizing method. Pure logic: no broker, no store, no DOM.
//
// It sizes an order the same category of way `stake` does, but computes the risk amount itself instead of
// taking it from the user: replay the account's closed-trade history against the starting balance to get the
// current zone + ladder state, and `mmState().risk` is the dollar risk that then feeds sizeFromStake.
export { CascadeMM } from './cascade.js';
export { ZoneManager } from './zones.js';
export { setCeiling, applyCeiling, applyTrade } from './combined.js';
export { replay, mmState, replayTrace } from './replay.js';
