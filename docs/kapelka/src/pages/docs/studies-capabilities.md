---
layout: ../../layouts/DocsLayout.astro
title: Special capabilities
---

# Special capabilities

## Cross-pane shapes

A study in its own sub-pane can still draw on the price pane. Set `overlay: true` on an individual shape and it renders on the main price pane instead of the study's pane — so a sub-pane oscillator can paint, say, exhaustion boxes on the candles:

```js
shapes: [
  { overlay: true, type: 'box', from, to, top, bottom, color },  // drawn on the candles
]
```

The study stays a sub-pane oscillator; only the flagged shapes ride the price pane.

## Viewport studies

Set `viewport: true` and the study recomputes over the *visible* window on pan/zoom. Read `ctx.visibleRange` (`{ from, to }` in seconds) and compute against just what's on screen — a volume profile of the visible range, a surface that re-derives as you scroll. Wire it by pushing the window on each change:

```js
chart.timeAxis().onTimeWindow(() => host.setVisibleRange(chart.timeAxis().timeWindow()));
```

Only `viewport` studies recompute on `setVisibleRange`; everything else is skipped, so panning stays cheap.

## Intrabar sub-bars

A study needing finer resolution than the chart bars sets `intrabar: true` (or `lowerTimeframe: '1m'`) and reads the sub-bars from `ctx`. You supply them through the host's `intrabar` callback; the host fetches, caches, and buckets them under each chart bar:

```js
const host = new StudyHost(chart, {
  getBars: () => bars,
  intrabar: (tf, fromMs, toMs) => fetchSubBars(tf, fromMs, toMs),  // → [{ time, open, high, low, close, volume }]
});
```

In `calc`: `ctx.intrabar[i]` is the array of sub-bars under `bars[i]`, `ctx.lowerTimeframe` is the resolved timeframe id, and `ctx.intrabarLoading` flags a fetch in flight. A [`step`](/docs/studies-step) study reads the same buckets from `shared.sub[i]`. This is how Volume Delta and CVD get their buy/sell split.

## Off the render thread

A [`step`](/docs/studies-step) study can run in a background worker. Pass `worker: true` and a `studyUrl(id)` resolver to `StudyHost`, and each study's `step` runs off the render thread against bars the worker holds resident — one upload, then a single candle per tick, not a fresh copy per study.

```js
const host = new StudyHost(chart, {
  getBars: () => bars,
  worker: true,
  studyUrl: (id) => `/studies/${id}.js`,   // where the worker imports each study from
});
```

On a live tick the worker advances only the forming bar from its checkpoint and returns one point, which the host feeds by time; geometry (`calc`) studies recompute in full. It is opt-in — without `worker`, studies run inline on the main thread.
