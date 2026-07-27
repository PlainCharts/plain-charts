---
layout: ../../layouts/DocsLayout.astro
title: Running studies
---

# Running studies — StudyHost

A study describes; `StudyHost` runs it. You give the host access to the bars and the chart, feed it data, and add studies by `id`:

```js
import { StudyHost } from '../studies/index.js';
import '../studies/modules/index.js';   // registers the gallery (rsi, volume_profile, …)

const host = new StudyHost(chart, {
  getBars: () => bars,                      // required — the current bar array
  mainSeries: () => candles,               // the price series (for overlay shapes/fills); null if chart-less
  barTimes: () => bars.map((b) => b.time), // defaults to getBars().map(b => b.time)
});

host.setData(bars);        // set/replace the bars and recompute every study
host.add('rsi', { length: 14 });   // add a registered study by id, with param overrides
```

Constructor opts (all optional except `getBars`):

- `getBars()` — the current bars (**required**).
- `mainSeries()` — the price pane's series, so `overlay` shapes and fills can anchor to it (`null` for a chart-less board).
- `barTimes()` — bar times for time→x mapping (defaults from `getBars`).
- `priceDecimals` — surfaced to `calc` as `ctx.decimals`.
- `intrabar(tf, fromMs, toMs)` — a sub-bar provider for intrabar studies (see [Special capabilities](/docs/studies-capabilities)).
- others: `isHidden()`, `persist(list)`, `resolveLowerTf(study)`, `candleStyle()`.

Managing the set: `add(id, params, opts)`, `remove(i)`, `clearAll()`, `list()`, `count()`, `studyAt(i)`, `setParam(i, key, value)`, `setStyle(i, key, patch)`. Persistence: `serialize()` / `applyTemplate(list)`. (Full list in [API reference → Studies](/docs/api/studies).)

Subscribe to lifecycle events:

```js
host.on('added',    (a) => { /* a study was added */ });
host.on('computed', (a) => { /* its calc finished — legends can refresh */ });
host.on('removed',  (a) => { /* it was removed */ });
host.on('error',    (a, msg) => { /* its calc threw */ });
```
