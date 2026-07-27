---
layout: ../../../layouts/DocsLayout.astro
title: Worked examples
---

# Worked examples

Five shipped addons, each a recipe for one corner of the system.

Together they prove the whole reach. Read them as recipes.

<hr>

## Data Interceptor — the raw feed

A pure `ui()` diagnostic. It subscribes to `api.onRaw` — every raw broker message, before the app strips it to neutral shapes — and walks each into field paths, learning the broker's schema from the live stream. It lists every path with its latest value and a count, and downloads the schema as JSON.

**Shows:** `api.onRaw`, and that an addon can discover a protocol rather than hard-code it. Use it to audit what a broker actually sends versus what the app captures.

<hr>

## Screenshot — reading the chart

A tiny `popup: true` addon with zero capture logic. It calls `api.chart.snapshot()` — the app composites every pane's canvases (candles, axes, drawings) into one — then copies it to the clipboard or saves it.

**Shows:** `api.chart.snapshot()` and popup mode. A built-in feature rebuilt as an addon, on the same first-class reach the app's own UI has.

<hr>

## Price Watch — Node meets the data stream

Both contexts. Its `ui()` configures a symbol; its `start(ctx)` subscribes to that symbol's quotes through `ctx.data` and appends each bid/ask/last to a file with `require('fs')`.

```js
start(ctx) {
  const fs = require('fs'), path = require('path');
  const b = ctx.data.for('cqg');
  b.resolveSymbol(ctx.config.symbol, (inst) => {
    b.subscribeQuotes(inst.id, (q) =>
      fs.appendFileSync(path.join(ctx.dir, 'watch.log'), `${q.bid},${q.ask},${q.last}\n`));
  });
}
```

**Shows:** the background context — `ctx.data` plus the Node filesystem, running with no panel open.

<hr>

## TV Bridge — an addon as a server

A `start(ctx)` addon that does `require('http')`, opens `http.createServer(...).listen(port)`, and streams the broker feed from `ctx.data` out over HTTP + SSE to an external program.

```js
start(ctx) {
  const http = require('http');
  const b = ctx.data.for(ctx.config.broker);
  const server = http.createServer((req, res) => { /* serve the feed */ });
  server.listen(ctx.config.port, () => ctx.log('tv-bridge listening on ' + ctx.config.port));
  this._server = server;
}
stop() { if (this._server) this._server.close(); }
```

**Shows:** full OS reach — an addon opening a network port and acting as a server. Files, sockets, servers, and child processes are all this same `require` away.

<hr>

## Order Ticket — the full showcase

A `ui()` trading dashboard that uses nearly everything at once:

- **live data** — `subscribeQuotes`, `subscribeDepth`, `subscribeTrade`, `getAccount` / `getPositions`
- **chart drawing** — draggable stop, target, and entry lines via `api.chart.priceLine({ draggable, onDrag, onCommit })`; dragging a line modifies the live order at its new price
- **order routing** — `placeOrder` (market entry, then stop + limit legs), `modifyOrder`, `cancelOrder`, `closePosition`, with a time-in-force selector for the working legs
- **all three together** — an armed pending line: draws a draggable trigger, watches the price stream, fires a market entry the moment price touches it, then registers the stop and target at their line prices

**Shows:** the union — reading the chart, streaming data, and routing orders, coordinated in one addon.

<hr>

## Reading them

The addons live in `addons/<id>/index.js`. Open any from the Addons manager's *Edit* to read the full source — the canonical, runnable reference for [The addon API](/docs/addons/api).
