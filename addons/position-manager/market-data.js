// @ts-check
// order-ticket MARKET DATA -- resolves the active symbol and subscribes to QUOTES for it, exactly like the
// watchlist: subscribe ONCE and wait (no re-subscribe watchdog -- that thrashes the shared per-contract subscription
// and blanks bid/ask). It owns the instrument/quote state on ot.state (lastPx, domTick, domDecimals) and paints the
// one-line quote. (Market DEPTH / the DOM ladder was removed.) Everything else reacts through events:
//   emit('instrument', inst)  -- tick size / decimals now known
//   emit('quote', lastPx)     -- a new reference price

/** @typedef {ReturnType<import('./kernel.js').createKernel>} Kernel */
/** @typedef {{ api: any, id: string|number, cb: (u: any) => void }} Sub */

/**
 * @param {Kernel} ot
 * @param {{ quoteLine: HTMLElement }} deps
 */
export function createMarketData(ot, { quoteLine }) {
  const { ad, cfg, api, state, emit, t } = ot;
  /** @param {...any} a */
  const dbg = (...a) => console.log('[OT]', ...a);
  /** @type {Sub|null} */ let qSub = null;
  let wireGen = 0; // generation token: only the LATEST wireQuote may subscribe
  /** @type {any} */ let resolveWd = null; // watchdog timer -> re-issue resolveSymbol if the relay is dropped

  const wireQuote = () => {
    const gen = ++wireGen;
    if (resolveWd) {
      clearTimeout(resolveWd);
      resolveWd = null;
    }
    const a = /** @type {import('/data_engine/index.js').BrokerAdapter|null} */ (ad());
    if (!a) {
      quoteLine.textContent = t('broker not connected');
      return;
    } // the broker facade returns a proxy|core union; it IS a conforming adapter
    // The post-resolve work (swap subscriptions, wire the quote + DOM). Runs for the WINNING resolve only; a
    // superseded one is dropped by the gen check so it can never leave us with no live sub.
    const onResolved = (/** @type {import('/data_engine/index.js').Instrument|null} */ inst) => {
      if (gen !== wireGen) {
        dbg('DROP stale resolve for', cfg.symbol, 'contract', inst && inst.id);
        return;
      } // superseded -> leave the current sub alone
      if (!inst) {
        quoteLine.textContent = t('symbol not found:') + ' ' + cfg.symbol;
        return;
      }
      if (qSub) {
        try {
          qSub.api.unsubscribeQuotes(qSub.id, qSub.cb);
        } catch (_) {}
        qSub = null;
      } // swap: drop the old sub now a replacement is ready
      if (inst.tickSize) state.domTick = inst.tickSize;
      if (inst.priceDecimals != null) state.domDecimals = inst.priceDecimals;
      emit('instrument', inst); // tick size known -> the watcher vicinity recomputes (index.js listens)
      dbg('SUBSCRIBE quotes for', cfg.symbol, 'contract', inst.id, 'gen', gen);
      /** @type {{ bid: number|null, ask: number|null, last: number|null }} */
      const q = { bid: null, ask: null, last: null };
      const cb = (/** @type {any} */ u) => {
        if (u.bid != null) q.bid = u.bid;
        if (u.ask != null) q.ask = u.ask;
        if (u.last != null) q.last = u.last;
        const sp = q.bid != null && q.ask != null ? q.ask - q.bid : null;
        const dc = state.domDecimals != null ? state.domDecimals : 2,
          pxf = (/** @type {number|null} */ v) => (v == null ? '–' : Number(v).toFixed(dc));
        quoteLine.textContent = 'B: ' + pxf(q.bid) + ' | ' + pxf(sp) + ' | A: ' + pxf(q.ask); // one-line quote under Buy/Sell
        const mid = q.bid != null && q.ask != null ? (q.bid + q.ask) / 2 : null;
        // Reference price = the MID (bid/ask are live). The last TRADE can be a stale phantom on thin / far-dated
        // contracts and was tripping the watcher; only fall back to it when there is no book.
        if (mid != null && q.last != null && Math.abs(q.last - mid) > 5)
          dbg('STALE last', q.last, 'vs mid', mid, '-> using mid');
        state.lastPx = mid != null ? mid : q.last != null ? q.last : state.lastPx;
        emit('quote', state.lastPx); // the watcher + the market-projection ride react (index.js listens)
      };
      // subscribe ONCE and wait -- exactly like the watchlist, which uses this same channel and works.
      a.subscribeQuotes(inst.id, cb);
      qSub = { api: a, id: inst.id, cb };
    };
    // resolveSymbol is a PROXY relay to the data-host; if it lands before the adapter is ready the host drops it with
    // NO reply, so the callback never fires and the panel hangs on "resolving…" (the bug the watchlist dodged by
    // gating on isConnected + re-running on logon -- neither of which an addon module can hear). Two guards mirror
    // that: (1) don't issue until the broker reports connected -- poll; (2) re-issue if no reply lands in 2s.
    const issueResolve = () => {
      if (gen !== wireGen) return;
      if (api.data && api.data.isConnected && !api.data.isConnected(cfg.broker)) {
        quoteLine.textContent = t('waiting for') + ' ' + String(cfg.broker || 'broker').toUpperCase() + '…';
        resolveWd = setTimeout(issueResolve, 1000); // recheck until the broker is up
        return;
      }
      quoteLine.textContent = t('resolving') + ' ' + cfg.symbol + '…';
      let answered = false;
      a.resolveSymbol(cfg.symbol, (/** @type {any} */ inst) => {
        if (gen !== wireGen) return;
        answered = true;
        if (resolveWd) {
          clearTimeout(resolveWd);
          resolveWd = null;
        }
        onResolved(inst);
      });
      resolveWd = setTimeout(() => {
        resolveWd = null;
        if (gen !== wireGen || answered) return;
        dbg('resolve watchdog re-resolve', cfg.symbol);
        issueResolve();
      }, 2000);
    };
    issueResolve();
  };

  // drop the subscriptions + timer (called on panel close)
  const teardown = () => {
    if (resolveWd) {
      clearTimeout(resolveWd);
      resolveWd = null;
    }
    if (qSub) {
      try {
        qSub.api.unsubscribeQuotes(qSub.id, qSub.cb);
      } catch (_) {}
      qSub = null;
    }
  };

  return { wireQuote, teardown };
}
