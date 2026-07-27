---
layout: ../../../layouts/DocsLayout.astro
title: Writing an addon
---

# Writing an addon

Build one up from nothing: a panel, then a Node worker, then packaging.

An addon is one CommonJS file.

<hr>

## The smallest addon

```js
module.exports = {
  name: 'Hello',
  ui(root, api) {
    root.textContent = 'Active symbol: ' + (api.chart.symbol() || 'none');
  },
};
```

Save it as `addons/hello/index.js`, enable it in the Addons manager, and its icon appears on the right rail. Click it — a docked panel names the active symbol.

Two ways to create one:

- **From the manager** — *Write new addon* opens the editor with a template; Save writes the folder and enables it.
- **By hand** — make `addons/<id>/index.js` and hit *Reload*, or drop a whole folder in and reload.

<hr>

## Settings

Declare `inputs`. Values arrive in `api.config` / `ctx.config` and persist through `api.save`.

```js
module.exports = {
  name: 'Hello',
  inputs: [
    { key: 'broker', label: 'Broker', type: 'text', default: 'cqg' },
    { key: 'symbol', label: 'Symbol', type: 'text', default: 'EP' },
  ],
  ui(root, api) {
    const cfg = { ...api.config };
    const inp = document.createElement('input'); inp.value = cfg.symbol;
    inp.onchange = () => { cfg.symbol = inp.value; };
    const save = document.createElement('button'); save.textContent = 'Save';
    save.onclick = () => api.save(cfg);
    root.append('Symbol ', inp, ' ', save);
  },
};
```

Give an addon `inputs` but no `ui`, and the app renders those inputs as a settings form for free.

<hr>

## Reading the chart and streaming data

`ui()` gets both `api.chart` and `api.data`. This panel resolves the configured symbol, streams quotes, and draws a draggable line at the last price.

```js
ui(root, api) {
  const cfg = api.config;
  const out = document.createElement('div'); root.append(out);
  const b = api.data.for(cfg.broker);

  b.resolveSymbol(cfg.symbol, (inst) => {
    if (!inst) { out.textContent = 'symbol not found'; return; }
    let line = null;
    const cb = (q) => {
      out.textContent = `bid ${q.bid}  ask ${q.ask}  last ${q.last}`;
      if (q.last == null) return;
      if (!line) line = api.chart.priceLine({ price: q.last, color: '#e0a000', title: 'last', draggable: true });
      else line.update({ price: q.last });
    };
    b.subscribeQuotes(inst.id, cb);
    api.onClose(() => b.unsubscribeQuotes(inst.id, cb));   // your subscriptions are yours to release
  });
}
```

> Chart lines auto-remove on close. The quote subscription does not — release it in `onClose`.

<hr>

## Acting on the chart and the stream together

`ui()` reads the chart, reads the price stream, and routes orders — so it can act on their combination. Draw a level, watch price, place an order when they meet.

```js
ui(root, api) {
  const b = api.data.for(api.config.broker);
  let level = null, armed = false, lastPx = null;

  const arm = () => {
    if (lastPx == null) return;
    level = api.chart.priceLine({ price: lastPx, color: '#26a69a', title: 'buy trigger', draggable: true });
    armed = true;
  };
  root.append(Object.assign(document.createElement('button'),
    { textContent: 'Arm buy at line', onclick: arm }));

  b.resolveSymbol(api.config.symbol, (inst) => {
    const cb = (q) => {
      lastPx = q.last ?? lastPx;
      if (armed && lastPx != null && lastPx <= level.price()) {
        armed = false;
        b.placeOrder({ symbol: api.config.symbol, side: 'buy', qty: 1, type: 'market' }, () => {});
      }
    };
    b.subscribeQuotes(inst.id, cb);
    api.onClose(() => b.unsubscribeQuotes(inst.id, cb));
  });
}
```

<hr>

## A background worker

For work that runs without the panel open — logging, a bridge, a scheduled job — use `start(ctx)` / `stop()`. This context has full Node. Keep handles so `stop()` can clean up.

```js
module.exports = {
  name: 'Tick logger',
  inputs: [{ key: 'symbol', type: 'text', default: 'EP' }],

  start(ctx) {
    const fs = require('fs'), path = require('path');
    const file = path.join(ctx.dir, 'ticks.csv');
    const b = ctx.data.for('cqg');
    this._sub = null;
    b.resolveSymbol(ctx.config.symbol, (inst) => {
      const cb = (q) => { if (q.last != null) fs.appendFileSync(file, `${Date.now()},${q.last}\n`); };
      b.subscribeQuotes(inst.id, cb);
      this._sub = () => b.unsubscribeQuotes(inst.id, cb);
      ctx.log('logging', ctx.config.symbol, 'to', file);
    });
  },

  stop() { if (this._sub) this._sub(); },
};
```

An addon can export both `ui` and `start` — the panel for interaction, the worker for the background. They share the same broker feed and the same folder on disk.

<hr>

## Packaging

- **Icon** — drop `icon.png` in the folder, or set one in the manager. It shows on the rail.
- **Hotkey** — set one in the manager to open the addon with `Ctrl` / `Alt` + a key.
- **Vocabulary** — ship a `vocab.json` (`{ "words": { ... } }`) to merge your terms into the app's wording.
- **Popup vs docked** — `popup: true` opens a small dropdown instead of a docked panel; use it for one-shot actions.

<hr>

## Cleanup checklist

- release every quote, depth, and trade subscription in `api.onClose` (UI) or `stop()` (background)
- clear timers and close sockets, servers, and child processes in `stop()`
- chart lines and `api.chart` event handlers are torn down for you on close
