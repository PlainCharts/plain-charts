---
layout: ../../layouts/DocsLayout.astro
title: The calc function
---

# The calc function

`calc` is the whole-array form — a [geometry study](/docs/studies)'s work. It gets every bar and returns the whole drawing:

```js
calc(bars, params, ctx) {
  // ... compute ...
  return { plots: [ /* … */ ] };
}
```

It may be `async`. It receives:

- `bars` — the full bar array, `[{ time, open, high, low, close, volume }, …]` (time in unix **seconds**).
- `params` — the resolved input values, keyed by each input's `key`.
- `ctx` — the context:
  - `decimals` — the chart's price decimal places (for formatting).
  - `candle` — `{ up, down }` of the chart's candle colors (or `null`), for a study that wants to match them.
  - `visibleRange` — `{ from, to }` in seconds, the visible window; `null` until a range is reported. Used by viewport studies.
  - `self` — a persistent scratch object that survives recomputes — hold animation or caching state here.
  - `requestFrames(step)` — drive per-frame tweening of this study's own shapes on the chart's frame clock; `step(tMs)` returns a new shapes array to draw, or `null` to stop.
  - `fetch(url)` — a convenience JSON fetch.
  - `chart` — the chart object itself (an escape hatch; rarely needed).
  - **Intrabar studies also get:** `lowerTimeframe` (the resolved sub-bar timeframe id), `intrabar` (sub-bars bucketed per bar — `intrabar[i]` is the array of sub-bars under `bars[i]`), and `intrabarLoading` (a fetch is in flight). See [Special capabilities](/docs/studies-capabilities).

Return a render-channel object — or nothing, to draw nothing this pass. The channels are on [Render channels](/docs/studies-channels).
