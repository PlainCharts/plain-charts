---
layout: ../../layouts/DocsLayout.astro
title: Price format
---

# Price format

You feed the engine continuous prices — a candle low of `0.566803`, a study value of `56.61`. But the numbers it *prints* should read the way the instrument trades: an E-mini bar in quarters, a currency pair in pipettes. `priceFormat` is how you tell a series its increment, and every price the engine draws on that scale lands on it.

## The option

`priceFormat` is a series option, set at creation or with `configure`:

```js
series.configure({
  priceFormat: { precision: 2, minMove: 0.25 },   // E-mini S&P: quarters
});
```

- **`precision`** — how many decimals to show.
- **`minMove`** — the smallest increment the instrument moves in (its tick). A price is quantized to the nearest whole multiple of `minMove` before it is rendered, so it can never display between ticks.
- **`formatter`** — an optional `(price) => string` for full control; when set, it takes over and `precision` / `minMove` are ignored.

## What it touches

Set it once on the series and it flows to every price the engine prints on that scale:

- the crosshair price label,
- the price-axis tick labels,
- the last-value tag,
- price-line labels.

A cursor hovering at `0.566817` reads **0.56680** on a pipette grid, not the raw pixel value. Nothing between ticks ever shows.

## Scope: per price scale

Quantization belongs to the scale, not the whole chart. The main price scale takes the instrument's `minMove`; a study or oscillator pane owns its own value scale (an RSI reads `56.6`, not a rounded tick), and a percentage or indexed scale keeps its own `%` / index formatting. Each scale prints in its own units.

## Two instruments

```js
// E-mini S&P — quarter-point ticks
series.configure({ priceFormat: { precision: 2, minMove: 0.25 } });

// NZD/USD — pipette ticks
series.configure({ priceFormat: { precision: 5, minMove: 0.00001 } });
```
