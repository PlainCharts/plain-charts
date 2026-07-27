# User broker adapters

Drop a broker adapter here and the app loads it at startup — no code changes anywhere else. Each adapter is
a folder with an `index.js`:

```
data_engine/adapters/
  my-broker/
    index.js        ← required; registers the adapter
    server.js       ← optional; adapter-owned server hook (CORS/auth proxy etc.)
    (any other files it needs)
```

An adapter is a **translator**: it speaks your broker's protocol on one side and the app's fixed contract on
the other. It imports one stable module — the SDK — and calls `registerBroker(...)`. See the full explanation
in the docs (Data ▸ Broker adapters). The adapters we ship (`cqg`, `schwab`, `oanda`) live right here too —
they are just examples, not a built-in tier — so `cqg/` is the reference implementation to copy.

## Minimal skeleton

```js
import { registerBroker, event } from '/data_engine/data/adapter-sdk.js';

let connected = false;
const listeners = new Set();

registerBroker({
  id: 'my-broker',
  label: 'My Broker',
  capabilities: { marketData: true, trading: true, depth: false },

  connect(account, ctx) { /* open your session; */ connected = true; },
  disconnect() { connected = false; },
  isConnected() { return connected; },

  // --- market data ---
  resolveSymbol(sym, cb) { cb({ id: sym, tickSize: 0.25, priceDecimals: 2 }); },
  subscribeQuotes(id, cb) { /* on each tick: */ cb({ bid, ask, last }); },
  unsubscribeQuotes(id, cb) {},
  getBars(req, cb) { cb({ bars: [/* { time, open, high, low, close, volume } */] }); },

  // --- execution (only if capabilities.trading) ---
  subscribeTrade(cb) {
    listeners.add(cb);
    // translate YOUR broker's events into the contract shapes with event.*:
    // cb(event.order({ id, symbol, side:'buy'|'sell', type, qty, price, tif, status }));
    // cb(event.fill({ id, symbol, side, qty, price, time }));
    // cb(event.position({ symbol, qty, side:'long'|'short', avgPrice }));
    // cb(event.account({ accountId, balance, equity, ... }));
    // cb(event.reject({ code, text }));
  },
  unsubscribeTrade(cb) { listeners.delete(cb); },
  placeOrder(order, cb) { /* translate order -> your broker; */ cb({ id: '...' }); },
  cancelOrder(id, cb) {},
  modifyOrder(mod, cb) {},
  closePosition(symbol, cb) {},
});
```

The data-host **validates** every event you emit against the contract and drops malformed ones with a warning
in the Console — so if a shape is wrong, you find out immediately instead of losing data silently.

## Optional server hook (`server.js`)

Some broker APIs cannot be reached from a page at all: plain REST endpoints without CORS headers, or OAuth
flows whose client secret must never live in a renderer. For those, an adapter may ship a `server.js` — a
CommonJS module that runs in the app's **local server** process and owns a URL prefix. The app mounts every
`data_engine/adapters/<id>/server.js` it finds at startup (a restart picks up a new one — same rule as `index.js`):

```js
// data_engine/adapters/my-broker/server.js  (CommonJS — runs in the local server, full Node access)
module.exports = (api) => {
  // api = { sendJson, readBody, readSettingsFile, writeSettingsFile, httpsRequest }
  async function handle(req, res) {
    // everything under the prefix is yours: proxy requests, hold tokens, refresh OAuth...
    api.sendJson(res, 200, { ok: true });
  }
  return { prefix: '/api/my-broker/', handle };
};
```

Your `index.js` then simply fetches `/api/my-broker/...` like any other endpoint. The `schwab` (OAuth +
market-data proxy) and `oanda` (CORS proxy) adapters ship hooks like this. Adapters that speak WebSocket
(`cqg`) or raw sockets (`mt5`) need no hook — the folder stays the single portable unit either way.
