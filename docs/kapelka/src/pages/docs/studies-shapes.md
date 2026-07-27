---
layout: ../../layouts/DocsLayout.astro
title: Shapes
---

# Shapes

Geometry from a study goes through the [`shapes`](/docs/studies-channels) channel, in three forms — from convenient to fully open.

## Sugar — named shapes

Familiar shapes, each a `{ type, … }`:

- `hline` — `{ type: 'hline', price, color, width, lineStyle, label }` — a horizontal line across the pane.
- `vline` — `{ type: 'vline', time, color, width, lineStyle, label }` — a vertical line at a time.
- `box` — `{ type: 'box', from, to, top, bottom, color, borderColor, borderWidth, lineStyle, label }` — a rectangle in time × price (omit `to` to leave it open to the right edge).
- `band` — `{ type: 'band', from, to, color }` — a vertical span across a time range, full pane height.
- `label` — `{ type: 'label', time, price, text, color, hAlign, vAlign, size, bold, italic }` — anchored text.

```js
shapes: [
  { type: 'hline', price: 70, color: '#b2b5be', lineStyle: 2 },
  { type: 'box', from: t0, to: t1, top: hi, bottom: lo, color: 'rgba(38,166,154,0.1)' },
]
```

## Raw marks — the ether

When no named shape fits, drop to vertices. A shape is `{ marks: [ … ] }`, each an anchored `path` or `text`, and each vertex placed in the chart's own space (`t`/`p`, `vpx`/`vp`, plus `dx`/`dy` pixel offsets). This is the open geometry the sugar expands into — full model on [The ether](/docs/the-ether).

```js
shapes: [{ marks: [
  { closed: true, fill: '#4dd0e1', path: [ {t,p,dy:-6}, {t,p,dx:6}, {t,p,dy:6}, {t,p,dx:-6} ] },  // a diamond
]}]
```

## Named recipes — the shape library

Register a shape once and reuse it by name. A recipe is a function (`params → marks`) or a pure-data template with `$param` slots and `=expr`, shareable as JSON:

```js
import { registerShape } from '../studies/index.js';
registerShape('pin', { params: { color: '#26a69a' }, marks: [ /* … using $price, $color … */ ] });

// then, in calc:
shapes: [{ shape: 'pin', price: 100, color: '#ef5350' }]
```
