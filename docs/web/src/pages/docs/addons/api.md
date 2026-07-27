---
layout: ../../../layouts/DocsLayout.astro
title: The addon API
---

# The addon API

Every member the app calls, and every call you make back.

An addon is a CommonJS module. It exports a few well-known members. The app calls whichever it finds.

```js
module.exports = {
  name: 'My Addon',
  inputs: [ /* setup schema -> ctx.config / api.config */ ],
  popup: false,          // true = open as a dropdown instead of a docked panel

  ui(root, api) { /* interactive UI, in a chart window */ },
  start(ctx)   { /* background/automation, in the Node host */ },
  stop()       { /* clean up timers, sockets, subscriptions */ },
};
```

Provide at least one thing to run: a `ui`, a `start`, or an `inputs` schema. Nothing else is required.

<hr>

## `ui(root, api)`

Runs in a chart window when the user opens the addon from its rail icon or hotkey. `root` is your blank canvas.

| member | what it is |
|---|---|
| `api.id`, `api.name` | the addon's id and display name |
| `api.config` | resolved settings (inputs' defaults, overridden by saved `config.json`) |
| `api.data` | the broker API — see [The data API](#the-data-api) |
| `api.chart` | read and draw on the active chart — see [The chart API](#the-chart-api) |
| `api.onRaw(fn)` | subscribe to the raw broker feed: `fn(broker, channel, msg)`; returns an unsubscribe |
| `api.log(...args)` | log to the browser console, tagged with the addon id |
| `api.save(cfg)` | persist `cfg` to `config.json` and reload it |
| `api.close()` | close the addon's panel |
| `api.onClose(fn)` | register teardown for when the panel closes |

Chart lines and `api.chart` event subscriptions are torn down for you. Your own quote and trade subscriptions and timers are not.

> Release your subscriptions and timers in an `onClose` handler.

<hr>

## The chart API

`api.chart` resolves against the current active pane, live — so the addon follows whichever chart the user views. Re-target with `onActiveChange` / `onSymbolChange`.

**Read**

| call | returns |
|---|---|
| `symbol()` | active symbol, or null |
| `timeframe()` | active timeframe id |
| `decimals()` | price decimals for the active pane |
| `visibleRange()` | `{ from, to }` in epoch seconds, or null |
| `priceAt(y)` / `timeAt(x)` | value under a pixel coordinate |
| `panes()` | every open chart in this window: `[{ symbol, timeframe }]` |

**Events** (each torn down on close)

| call | fires with |
|---|---|
| `onCrosshair(cb)` | `{ time, price }` as the cursor moves |
| `onClick(cb)` | `{ time, price, x, y }` |
| `onRangeChange(cb)` | the new `visibleRange()` |
| `onActiveChange(cb)` | `{ symbol, timeframe }` when the active pane changes |
| `onSymbolChange(cb)` | the new symbol when it changes |

**Draw**

```js
const line = api.chart.priceLine({
  price: 4520.25,
  color: '#2962ff',
  lineWidth: 2,
  title: 'entry',
  draggable: true,
  onDrag:   (px) => { /* live, every move */ },
  onCommit: (px) => { /* on release */ },
});
line.update({ price: 4519 });   // move it / restyle it
line.setVisible(false);         // hide without removing (also un-grabbable)
line.remove();                  // remove it
```

`api.chart.clear()` removes every line the addon made. `api.chart.snapshot()` composites every pane — candles, axes, and your drawings — into one `HTMLCanvasElement` of exactly what's painted.

<hr>

## The data API

`api.data` (and `ctx.data` in the background) is the broker layer over the shared connection. `for(brokerId)` selects a broker. The rest hang off that handle.

```js
const b = api.data.for('cqg');
b.resolveSymbol('EP', (inst) => {
  b.subscribeQuotes(inst.id, (q) => { /* { bid, ask, last, bidSize, askSize, ... } */ });
  b.subscribeDepth(inst.id, (dom) => { /* { bids:[{price,qty}], asks:[...] } */ });
});
```

| group | calls |
|---|---|
| symbols | `resolveSymbol(sym, cb)`, `searchSymbols(q, cb)` |
| market data | `subscribeQuotes` / `unsubscribeQuotes`, `subscribeBars` / `getBars`, `subscribeDepth` / `unsubscribeDepth` |
| trading (reads) | `getAccount(cb)`, `getPositions(cb)`, `getOrders(cb)`, `subscribeTrade(cb)` |
| trading (acts) | `placeOrder(order, cb)`, `modifyOrder(mod, cb)`, `cancelOrder(id, cb)`, `closePosition(sym, cb)` |
| status | `isConnected(brokerId)` |

`placeOrder` takes `{ symbol, side, qty, type, price, tif }`. `type` is `market` / `limit` / `stop`; `tif` is `day` / `gtc` / `gtd` / `ioc` / `fok` where the broker supports it. The callback reports order id and status.

<hr>

## `start(ctx)` and `stop()`

`start(ctx)` runs once in the headless Node host when the addon is enabled. `stop()` runs on disable or reload — clean up there.

| `ctx` member | what it is |
|---|---|
| `ctx.id`, `ctx.name` | the addon's id and name |
| `ctx.dir` | the addon's own folder — write files here |
| `ctx.config` | resolved settings (same rules as `api.config`) |
| `ctx.data` | the broker API (identical surface to `api.data`) |
| `ctx.log(...args)` | append to the addon's log, shown in the manager |

This context has full Node — `require('fs')`, `require('net')`, `require('http')`, `require('child_process')`, anything. It has no chart.

```js
start(ctx) {
  const fs = require('fs'), path = require('path');
  const b = ctx.data.for(ctx.config.broker);
  b.resolveSymbol(ctx.config.symbol, (inst) => {
    b.subscribeQuotes(inst.id, (q) =>
      fs.appendFileSync(path.join(ctx.dir, 'ticks.csv'), `${Date.now()},${q.last}\n`));
  });
}
```

<hr>

## The setup schema — `inputs`

`inputs` declares the addon's settings. Values land in `ctx.config` / `api.config`, defaults first, overridden by saved `config.json`.

```js
inputs: [
  { key: 'broker', label: 'Broker', type: 'text',   default: 'cqg' },
  { key: 'symbol', label: 'Symbol', type: 'text',   default: 'EP' },
  { key: 'qty',    label: 'Qty',    type: 'number', default: 1 },
  { key: 'live',   label: 'Live',   type: 'bool',   default: false },
  { key: 'color',  label: 'Color',  type: 'color',  default: '#2962ff' },
  { key: 'mode',   label: 'Mode',   type: 'select', default: 'a',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
]
```

Types: `text`, `number`, `bool`, `color`, `select` (with `options`). An addon with `inputs` but no `ui` gets an auto-rendered settings form, with a Save button that calls `api.save`.

<hr>

## `popup: true`

The UI opens as a docked slide-out panel beside the charts. Set `popup: true` and it opens instead as a small dropdown anchored to the rail icon — closed on an outside click — for quick, one-shot actions.
