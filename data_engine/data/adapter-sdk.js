// @ts-check
// The stable entry point a broker adapter imports — the ONLY thing a user adapter needs to reference. It
// re-exports `registerBroker` (to announce the adapter) and the whole contract (the `event.*` constructors +
// validators + status/side constants). A user adapter imports from '/data_engine/data/adapter-sdk.js' and
// nothing else internal, so its imports never break as the engine moves files around.
//
//   import { registerBroker, event } from '/data_engine/data/adapter-sdk.js';
export { registerBroker } from './registry.js';
export * from './adapter-contract.js';
