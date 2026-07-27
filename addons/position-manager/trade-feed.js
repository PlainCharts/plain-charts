// @ts-check
// order-ticket TRADE FEED -- the EVENT bridge from the broker's execution stream to the addon bus. PURE events, NO
// stores: the addon reads position/order STATE from the platform book (api.trade.book -- the app's single source,
// synced to this window), so keeping a private posMap/workMap here was a shadow copy and is gone. Downstream
// reactions (bracket teardown, the phase buttons, arming the exits on a fill) live in index.js/auto.js and react to:
//   emit('position', pos)   a position update for some symbol (pos.qty === 0 means flat)
//   emit('order', order)    an order update for the active symbol
//   emit('fill', fill)      an execution
//   emit('reseed')          the feed re-wired (connect / symbol switch) -> caller should resync its UI

/** @typedef {ReturnType<import('./kernel.js').createKernel>} Kernel */

/** @param {Kernel} ot */
export function createTradeFeed(ot) {
  const { ad, cfg, emit } = ot;
  /** @type {any} */ let tApi = null;
  /** @type {((e: any) => void)|null} */ let tCb = null;

  const wire = () => {
    if (tApi && tCb) { try { tApi.unsubscribeTrade(tCb); } catch (_) {} }
    tApi = ad(); tCb = null;
    if (!tApi || !tApi.subscribeTrade) { emit('reseed'); return; }
    tCb = (/** @type {any} */ e) => {
      if (e.kind === 'position') emit('position', e.position);
      else if (e.kind === 'order') { if (e.order.symbol === cfg.symbol) emit('order', e.order); }
      else if (e.kind === 'fill') emit('fill', e.fill);
    };
    tApi.subscribeTrade(tCb);
    emit('reseed');   // fresh context (the book is already current -- the app seeds it) -> resync buttons/UI
  };

  const teardown = () => { if (tApi && tCb) { try { tApi.unsubscribeTrade(tCb); } catch (_) {} } };

  return { wire, teardown };
}
