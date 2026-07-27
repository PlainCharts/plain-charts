import assert from 'node:assert/strict';
import { createQuotes } from '../src/quotes.js';

// P2c-2: quote controller. Verifies resolve -> subscribe -> tick accumulation -> stop/unsubscribe against a
// MOCK broker (no live feed). Live streaming is verified by running the terminal against a real session.
// Run: npm run test:quotes

// deterministic clock: each now() call advances 5ms
let t = 1000;
const now = () => (t += 5);

const broker = {
  _cb: null, _unId: null, _unCb: null,
  resolveSymbol(sym, cb) { cb({ id: 42, priceDecimals: 2 }); },
  subscribeQuotes(id, cb) { this._subId = id; this._cb = cb; },
  unsubscribeQuotes(id, cb) { this._unId = id; this._unCb = cb; },
};

let last = new Map();
const q = createQuotes(broker, { onUpdate: (m) => { last = m; }, onLog: () => {}, now });

// start -> resolves synchronously (mock) and subscribes
q.start('EURUSD');
assert.ok(q.list().has('EURUSD'), 'symbol not tracked after start');
assert.equal(broker._subId, 42, 'subscribeQuotes got the wrong instrument id');
assert.equal(q.list().get('EURUSD').rttMs, 5, 'resolve round-trip not measured');

// feed ticks through the subscription callback
broker._cb({ bid: 1.10, ask: 1.20 });
broker._cb({ last: 1.15 });
const d = q.list().get('EURUSD');
assert.equal(d.ticks, 2, 'tick count wrong');
assert.equal(d.bid, 1.10, 'bid not captured');
assert.equal(d.ask, 1.20, 'ask not captured');
assert.equal(d.last, 1.15, 'last not captured');
assert.ok(d.intervalMs >= 0, 'inter-tick interval not measured');
assert.equal(last.get('EURUSD').ticks, 2, 'onUpdate did not emit latest state');

// stop -> unsubscribes with the SAME callback reference the adapter needs
q.stop('EURUSD');
assert.ok(!q.list().has('EURUSD'), 'symbol still tracked after stop');
assert.equal(broker._unId, 42, 'unsubscribe used the wrong id');
assert.equal(broker._unCb, broker._cb, 'unsubscribe must pass the same callback reference');

// resolve failure path
const broker2 = { resolveSymbol(sym, cb) { cb(null, { status: 104 }); }, subscribeQuotes() { throw new Error('should not subscribe'); } };
let logged = '';
const q2 = createQuotes(broker2, { onUpdate: () => {}, onLog: (l) => { logged = l; }, now });
q2.start('NOPE');
assert.ok(!q2.list().has('NOPE'), 'unresolved symbol should not be tracked');
assert.match(logged, /not resolved.*104/, 'resolve failure not reported');

console.log('PASS: quote controller (resolve+rtt, subscribe, ticks, stop/unsubscribe, resolve-failure)');
process.exit(0);
