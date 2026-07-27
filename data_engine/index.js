// @ts-check
// DATA ENGINE -- the public API. The execution engine is one self-contained library: broker adapters,
// the data host, the platform stores and the order worker, with three entry points:
//
//   index.js        THIS FILE -- the CLIENT surface. Everything an app window (or an addon, or an
//                   external terminal) may use: the broker facade, the platform stores, the order
//                   command funnel, the engine event bus, the adapter contract, and the app-installable
//                   seams (status sink, assistant-order gate). App code imports the engine HERE and
//                   never from the engine's internals (enforced by lint).
//   data-host.js    boot entry for the DATA-HOST window (owns broker sockets, runs the adapters).
//   order-worker.js boot entry for the ORDER-WORKER window (owns all order business logic).
//
// Everything else under data_engine/ is internal. Adapters live in data_engine/adapters/ as
// plug-and-play folders and are discovered by the server, never imported by the app.

// the broker facade -- market data + low-level order verbs, role-resolved (solo / host / proxy)
export { broker, listBrokers } from './data/broker.js';

// the platform stores -- cross-window keyed live state (orders / fills / positions / accounts / perf)
// and the console stream; platformApiFor tags an addon's writes
export { platform, platformApiFor } from './platform/index.js';

// the order COMMAND funnel -- every surface drives execution through command(); register() installs
// worker-side handlers (order-worker entry / solo page)
export { command, register, orders } from './orders/index.js';

// book READ business logic -- shared position/exit readers over the platform stores
export { readActive, livePosition, currentPosition, exitSide, freshestExitOrder } from './orders/book-read.js';

// round-trip reconstruction from the fills stream (running average-cost net-0)
export { computePositions } from './data/compute-positions.js';

// the order DSL parser (pure; the executor runs in the worker)
export { parseScript } from './orders/dsl.js';

// position sizing -- pure business rule (units from a risk amount + stop + instrument specs); reused for a live
// preview in the ticket and authoritatively in the order-host
export { sizeFromStake } from './orders/sizing.js';

// the engine event bus -- 'logon', 'connections:changed', 'broker:notice'
export { bus } from './bus.js';

// diagnostic raw broker-feed tap (Data Interceptor-style tooling)
export { onRaw, emitRaw, setRawActivity } from './data/raw-tap.js';

// the adapter CONTRACT -- neutral shapes + helpers (isTerminal, normalizeTradeEvent, event builders);
// also the home of the engine's public typedefs (Order / Position / Fill / Account / Bar / Quote ...)
export * from './data/adapter-contract.js';

// app-installable seams
export { setStatusSink } from './status.js';     // mirror engine log lines onto an app display
export { setExecGate } from './policy.js';       // the assistant-order policy gate (default: deny)

// neutral bar/timeframe math shared with adapters
export { barMs } from './timeframes.js';
export { foldExtras, isExtraKey, EXTRA_AGG } from './bar-fields.js';

// stored-record typedefs (contract shape + the `broker` tag) -- pass-through so app code can
// reference them off the public entry instead of the internals
/**
 * @typedef {import('./platform/index.js').StoredOrder} StoredOrder
 * @typedef {import('./platform/index.js').StoredPosition} StoredPosition
 * @typedef {import('./platform/index.js').StoredPositionLot} StoredPositionLot
 * @typedef {import('./platform/index.js').StoredFill} StoredFill
 * @typedef {import('./platform/index.js').StoredAccount} StoredAccount
 * @typedef {import('./platform/console.js').ConsoleEntry} ConsoleEntry
 * @typedef {import('./data/compute-positions.js').DerivedPosition} DerivedPosition
 * @typedef {import('./data/compute-positions.js').FillLike} FillLike
 */
