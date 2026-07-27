// Boots the data engine in-process and returns its public surface (data_engine/index.js).
//
// Importing the engine runs its top-level adapter discovery (broker-core `await loadAdapters()`), so the
// host shims in register.mjs (resolve hook + /api/adapters fetch) MUST already be installed -- i.e. this
// process was started with `node --import ./boot/register.mjs ...`. With no browser globals present the
// engine resolves ROLE 'solo': the broker runs in this process and owns the socket directly, no
// BroadcastChannel, no proxying.

/** @returns {Promise<any>} the engine public API: broker, platform, listBrokers, bus, orders, command, ... */
export async function bootEngine() {
  const engine = await import('../../index.js');
  // Boot the ORDER WORKER in-process. It registers the order command handlers (place/cancel/closePosition/
  // ...). In solo, engine.command() runs them here (no separate order-host process). This is how command()
  // reaches the worker -- the single owner of order business logic (OCO, reconcile, stop auto-size).
  await import('../../orders/host.js');
  return engine;
}
