// The PLATFORM — app-wide, first-class services that both the app and any addon talk to directly, with data
// flowing in AND out. These are NOT owned by any addon: the broker layer (data-host) feeds orders/positions/
// accounts, addons and the app read/subscribe (and may write), and the surface tabs (Console / Orders /
// Positions / Accounts) are just views. Everything is cross-window (BroadcastChannel) via two primitives:
//   channel() — append streams (console, activity feeds)
//   store()   — keyed live state (orders, positions, accounts)
//
// Import in app code:   import { platform } from './platform/index.js';
// On the addon api:     api.console / api.orders / api.positions / api.accounts
//
// This is the foundation everything else builds on. Add a service = one more line here + (optionally) a view.
// @ts-check
import { store } from './store.js';
import { makeConsole } from './console.js';

/**
 * @typedef {import('../data/adapter-contract.js').Order} Order
 * @typedef {import('../data/adapter-contract.js').Position} Position
 * @typedef {import('../data/adapter-contract.js').Fill} Fill
 * @typedef {import('../data/adapter-contract.js').Account} Account
 */
// Records land in the stores TAGGED with their source broker (trade-feed sets `{ broker, ...record }`), so a
// stored record is the contract shape PLUS `broker`. Consumers read these Stored* supersets.
/**
 * @typedef {Order & { broker: string }} StoredOrder
 * @typedef {Position & { broker: string }} StoredPosition
 * @typedef {import('../data/adapter-contract.js').PositionLot & { broker: string }} StoredPositionLot
 * @typedef {Fill & { broker: string }} StoredFill
 * @typedef {Account & { broker: string }} StoredAccount
 */

// The platform's typed shape: each store is keyed state of ONE stored type, so `platform.orders.all()` is
// StoredOrder[], `platform.positions.get(k)` is StoredPosition|undefined, etc.
/**
 * @type {{
 *   console: ReturnType<typeof makeConsole>,
 *   orders: import('./store.js').Store<StoredOrder>,
 *   fills: import('./store.js').Store<StoredFill>,
 *   positions: import('./store.js').Store<StoredPosition>,
 *   positionLots: import('./store.js').Store<StoredPositionLot>,
 *   accounts: import('./store.js').Store<StoredAccount>,
 *   perf: import('./store.js').Store<any>,
 * }}
 */
export const platform = {
  console: makeConsole(),        // log stream — { post, scoped, subscribe, history, clear }
  orders: store('orders'),       // order book — every order, keyed broker:orderId (working + terminal, retained)
  fills: store('fills'),         // executions — keyed broker:orderId (cumulative fill per order); positions/history derive from this
  positions: store('positions'), // open positions — keyed broker:symbol (the NETTED view: chart dot, order-ticket)
  positionLots: store('positionLots'), // hedging: individual broker positions, keyed broker:ticket (SL/TP/live P&L per lot)
  accounts: store('accounts'),   // trading accounts — keyed broker:accountId
  perf: store('perf'),           // diagnostics — per-window live samples (src/perf/sampler.js) + OS process rows (perf-monitor addon)
};

// Build the addon-facing view of the platform for a given addon id: writers are auto-tagged (Addons +
// the addon id), reads/subscribes are the shared services. Both directions, first-class, from the start.
/** @param {string} addonId */
export function platformApiFor(addonId) {
  const c = platform.console;
  const scoped = c.scoped(addonId, 'addon');
  return {
    console: { ...scoped, post: c.post, subscribe: c.subscribe, history: c.history, clear: c.clear },
    orders: platform.orders,
    fills: platform.fills,
    positions: platform.positions,
    positionLots: platform.positionLots,
    accounts: platform.accounts,
  };
}
