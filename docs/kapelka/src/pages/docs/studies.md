---
layout: ../../layouts/DocsLayout.astro
title: Studies
---

# Studies

A study is a pure function of bars. You register it once, and it computes: given the chart's bars, its inputs, and a context, it returns a description of what to draw — lines, bands, shapes, markers. It never touches the canvas. `StudyHost` takes that description and renders it, refits the pane, and reports values under the crosshair, so a study is only the math and the *what*, never the *how*.

These pages are the authoring guide; the flat name listing is in [API reference → Studies](/docs/api/studies).

## Registering a study

A study registers itself once, on import:

```js
import { Studies } from '../studies/index.js';

Studies.register({
  id: 'rsi',                       // unique key
  name: 'RSI',                     // legend / UI label
  overlay: false,                  // own pane (true = draw on the price pane)
  inputs: [ /* … */ ],
  calc(bars, params, ctx) { /* … return render channels … */ },
});
```

The definition object:

- `id` — unique key used to add and look it up.
- `name` — the label shown in the legend and controls.
- `overlay` — `false` gives the study its own pane; `true` draws it on the price pane.
- `viewport` — `true` recomputes the study over the visible window on pan/zoom (see [Special capabilities](/docs/studies-capabilities)).
- `intrabar` / `lowerTimeframe` — opt into lower-timeframe sub-bars (see [Special capabilities](/docs/studies-capabilities)).
- `inputs` — the parameters exposed to the user (below).
- the compute — either [`calc(bars, params, ctx)`](/docs/studies-calc) (whole-array) **or** the [`step`](/docs/studies-step) set (`requires` + `init` / `plots` / `step`). Which one follows from the study's form (below).

### Inputs

Each input is a descriptor; its value arrives in `calc` as `params[key]`:

```js
inputs: [
  { key: 'length', name: 'Length', type: 'number', default: 14, min: 2, max: 200 },
  { key: 'source', name: 'Source', type: 'source', default: 'close' },
  { key: 'color',  name: 'Color',  type: 'color',  default: '#ff8800', legend: false },
]
```

- `type: 'number'` — numeric input; honors `min`, `max`, `step`.
- `type: 'select'` — dropdown from an `options: [{ key, name }]` list.
- `type: 'source'` — price-source dropdown (close, open, high, low, hl2, hlc3, …); read with `Studies.priceOf(bar, params.source)`.
- `type: 'color'` — color picker.
- `type: 'bool'` — checkbox.
- `legend: false` — keep this input out of the legend readout (default shows number inputs).

## Two forms: `calc` and `step`

A study computes in one of two forms. Which one is not a preference — it follows from what the study draws.

- **[`step`](/docs/studies-step) — a series study.** Every output is a per-bar point: a line value, a colored or segmented point, a band between two of the study's own lines, a fixed level. You write per-bar logic; the engine runs it once per bar and, on a live tick, advances only the forming bar from a [checkpoint](/docs/studies-data-flow). One bar in, one point out. Volume, VWAP, Bollinger, CVD are series studies.
- **[`calc`](/docs/studies-calc) — a geometry study.** The output is a multi-bar shape with no single last bar: a box spanning a run, a session strip, a surface re-derived over the visible window. You get the whole bar array and return the whole drawing, recomputed in full on every change. Fair-value gaps, session markers, a 3D terrain are geometry studies.

The test: *does every channel resolve to a point at bar `i`?* Yes → `step`. Any run, box, session, or viewport shape → `calc`. A study defines one form, not both.

> A `step` study streams; a `calc` study recomputes. Choose `step` whenever the study is per-bar — it is what keeps a live tick O(1) instead of O(bars).

Next: write your study as [`calc`](/docs/studies-calc) or [`step`](/docs/studies-step), send its output through the [render channels](/docs/studies-channels), and run it in a [`StudyHost`](/docs/studies-host).
