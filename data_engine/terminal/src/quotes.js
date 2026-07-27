// Live quote subscriptions against the broker facade. Framework-agnostic so it can be unit-tested with a
// mock broker: it calls onUpdate(Map) whenever quote data changes and onLog(line) for messages. The App
// renders the map and the dispatcher calls start/stop. Mirrors the app's resolve -> subscribe sequence
// (data_engine broker: resolveSymbol(sym, cb) then subscribeQuotes(instId, cb), unsubscribe with same cb).

/**
 * @param {any} broker the engine broker facade
 * @param {{ onUpdate: (m: Map<string, any>) => void, onLog: (line: string) => void, now?: () => number }} io
 */
export function createQuotes(broker, io) {
  const now = io.now || (() => Date.now());
  const subs = new Map();   // sym -> { id, cb }  (lifecycle: cb ref needed to unsubscribe)
  const data = new Map();   // sym -> { decimals, bid, ask, last, ticks, lastMs, intervalMs, rttMs }
  const emit = () => io.onUpdate(new Map(data));

  function start(sym) {
    if (subs.has(sym)) { io.onLog('  ' + sym + ' already streaming'); return; }
    const t0 = now();
    broker.resolveSymbol(sym, (inst, err) => {
      if (!inst) { io.onLog('  ' + sym + ' not resolved' + (err && err.status != null ? ' (status ' + err.status + ')' : '')); return; }
      const rttMs = now() - t0;
      const decimals = inst.priceDecimals != null ? inst.priceDecimals : 2;
      data.set(sym, { decimals, ticks: 0, lastMs: 0, intervalMs: 0, rttMs });
      const cb = (q) => {
        const cur = data.get(sym);
        if (!cur) return;   // stopped between tick and delivery
        const t = now();
        cur.intervalMs = cur.lastMs ? t - cur.lastMs : 0;
        cur.lastMs = t;
        cur.ticks += 1;
        if (q.bid != null) cur.bid = q.bid;
        if (q.ask != null) cur.ask = q.ask;
        if (q.last != null) cur.last = q.last;
        emit();
      };
      subs.set(sym, { id: inst.id, cb });
      io.onLog('  ' + sym + ' resolved in ' + rttMs + 'ms; streaming  (quote stop ' + sym + ')');
      emit();
      broker.subscribeQuotes(inst.id, cb);
    });
  }

  function stop(sym) {
    if (sym) {
      const e = subs.get(sym);
      if (!e) { io.onLog('  ' + sym + ' not streaming'); return; }
      try { broker.unsubscribeQuotes(e.id, e.cb); } catch (_) {}
      subs.delete(sym); data.delete(sym); emit();
    } else {
      for (const [, e] of subs) { try { broker.unsubscribeQuotes(e.id, e.cb); } catch (_) {} }
      subs.clear(); data.clear(); emit();
    }
  }

  function list() { return new Map(data); }
  return { start, stop, list };
}
