---
layout: ../../layouts/DocsLayout.astro
title: The step function
---

# The step function

A [`step` study](/docs/studies) declares its plots up front and emits one bar at a time. The engine walks a shared read-only window once, calling `step(i, …)` per bar, and assembles the same [render channels](/docs/studies-channels) `calc` returns — so the drawing is identical, only produced incrementally.

```js
Studies.register({
  id: 'sma', name: 'SMA', overlay: true,
  requires: { bars: true },              // the data this study reads
  inputs: [ { key: 'length', name: 'Length', type: 'number', default: 20 } ],
  init(params, ctx, shared) { return { len: params.length, buf: [], sum: 0 }; },     // once: constants + mutable state
  plots(params, ctx, state) { return [{ key: 'ma', name: 'SMA', type: 'line' }]; },   // once: declare plots, no data
  step(i, shared, params, ctx, state) {                                               // per bar: this bar's value
    const c = shared.close[i];
    state.buf.push(c); state.sum += c;
    if (state.buf.length > state.len) state.sum -= state.buf.shift();
    return state.buf.length < state.len ? null : { ma: state.sum / state.len };
  },
});
```

The methods:

- `requires` — `{ bars?, intrabars? }`, the data the study reads (intrabar studies set `intrabars: true`).
- `init(params, ctx, shared)` — optional; runs once and returns the study's `state`. Hold constants (colors, thresholds, helper closures) and the mutable running accumulators here.
- `plots(params, ctx, state)` — returns the plot metas (same fields as the [`plots`](/docs/studies-channels) channel) *without* `data`; `step` fills the data.
- `shapes(params, ctx, state)` / `fills(params, ctx, state)` / `scale(params, ctx, state)` — optional; static shapes (a zero line), line-to-line fills, and a pane range (`{ min, max }`, e.g. an oscillator pinned to 0–100), each computed once.
- `step(i, shared, params, ctx, state)` — the per-bar core. Return a map of plot `key` → this bar's value: a scalar (`{ ma: 42 }`) or a point object (`{ ma: { value, color, segments, wicks, lines } }`), or `null` to emit nothing at bar `i`.

## The shared window

`step` reads a `shared` window — the bars as column arrays, built once and read by every study on the pane:

- `shared.n` — the bar count.
- `shared.time[i]`, `.open[i]`, `.high[i]`, `.low[i]`, `.close[i]`, `.volume[i]`, `.openInterest[i]` — the columns.
- `shared.sub[i]` — for an intrabar study, the sub-bars bucketed under bar `i` (the `step` equivalent of `ctx.intrabar[i]`).

A study only reads the window; it never owns or copies it. For a source price, rebuild a bar for `Studies.priceOf`: `Studies.priceOf({ open: shared.open[i], high: shared.high[i], low: shared.low[i], close: shared.close[i], volume: shared.volume[i] }, params.source)`.

> Keep mutable state in plain fields on `state` — numbers, arrays, plain objects. The engine snapshots it to checkpoint the last closed bar, and a closure hides state it can't copy. Pure helper functions on `state` are fine; they are kept by reference, not cloned.
