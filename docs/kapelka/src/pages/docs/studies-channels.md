---
layout: ../../layouts/DocsLayout.astro
title: Render channels
---

# Render channels

Both forms produce the same channels: [`calc`](/docs/studies-calc) returns them directly, a [`step`](/docs/studies-step) study declares `plots` / `shapes` / `fills` and emits per-bar points from `step`. Each key is a channel the host renders. All are optional — draw only what the study needs.

## `plots` — the series

An array of series. Each:

- `key` — unique within the study (anchors style overrides and fills).
- `name` — legend label (default: `key`).
- `type` — `'line'`, `'histogram'`, `'area'`, `'baseline'`, `'segmented'`, `'hbar'`, or a custom type. (Lowercase strings here, matching the study series set; the row shapes are on the [Series](/docs/series) page.)
- `data` — the rows for that type.
- style defaults — `color`, `lineWidth`, `lineStyle`, `lineType`, `fillOpacity`, `precision`, `legend`, `visible`, `markers`. Users can override these.
- overlay scale — `priceScaleId` + `scaleMargins: { top, bottom }` put the plot on its own region-confined scale.
- `stack: 'group'` — plots sharing a group accumulate into stacked bands.

```js
plots: [{ key: 'rsi', name: 'RSI', type: 'line', color: '#ff8800', lineWidth: 1.5, data: rsiData }]
```

## `fills` — bands between two plots

Each fill pairs two plot `key`s:

- `top`, `bottom` — the plot keys to fill between.
- `color`.
- `gradient` (optional) — `{ at: [priceHi, priceLo], colors: [...] }` for a price-anchored vertical gradient that stays locked to those prices.

```js
fills: [{ top: 'upper', bottom: 'lower', color: 'rgba(33,150,243,0.10)' }]
```

## `shapes` — geometry and annotations

An array; each entry is either sugar (`{ type: 'hline'|'vline'|'box'|'band'|'label', … }`), a named recipe (`{ shape: 'name', …params }`), or raw marks (`{ marks: [ … ] }`). Set `overlay: true` on a shape to draw it on the price pane from a sub-pane study. Covered fully on [Shapes](/docs/studies-shapes).

## `markers` — glyphs on bars

- `{ time, position: 'aboveBar' | 'belowBar', color, text }`

## `scale` — shape the pane's auto-fit

Either a function `(hi, lo) => [newHi, newLo]`, or an object:

- `{ min, max }` — expand the auto range to at least include `min` / `max`.
- `{ min, max, hard: true }` — clamp exactly to `[min, max]`.

```js
scale: { min: 0, max: 100, hard: true }   // e.g. an RSI pane pinned to 0–100
```
