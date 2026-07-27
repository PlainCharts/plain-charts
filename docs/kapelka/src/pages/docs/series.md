---
layout: ../../layouts/DocsLayout.astro
title: Series
---

# Series

A series is a data-fed plot. You add one with `addPlot(type, opts, paneIndex)`, hand it rows with `feed(rows)`, and the engine does the rest — fits it into the pane's scale, draws it every frame, and reports its value under the crosshair. The `type` is one of a small set of tags; `paneIndex` places it (0 is the main pane).

```js
const line = chart.addPlot(Line, { color: '#2563eb', lineWidth: 2 }, 0);
line.feed([{ time, value }, ...]);
```

## The vocabulary

Seven built-in types cover the common shapes, each reading a simple row:

- **Candles** (`Candlestick`) — OHLC bars. Row: `{ time, open, high, low, close }`.
- **Line** — a stroked line through values. Row: `{ time, value }`. `lineType` picks straight / stepped / curved.
- **Area** — a line with a filled region beneath it. Row: `{ time, value }`.
- **Baseline** — a line split above/below a baseline price, each side its own color. Row: `{ time, value }`.
- **Columns** (`Histogram`) — vertical bars from a baseline. Row: `{ time, value, color? }`.
- **Segments** (`Segmented`) — a partitionable bar: stacked filled parts, hollow (`fill:false`) parts, bar-width lines, and a centered wick. Row: `{ time, segments:[{from,to,color}], wick?, lines?, value }`. The stacked-bar / volume-delta / hollow-candle vocabulary.
- **HBars** (`HBar`) — the ninety-degree twin: horizontal bars at price levels, anchored to a chart edge. Row: `{ price, value, color? }`. What volume profiles are built from.

## Bring your own

When none of the seven fit, `addCustomPlot(view, opts, paneIndex)` registers your own data-fed primitive as a first-class series. The renderer lives in *your* code; the engine feeds it data, places it in a pane, auto-scales it, and reports it under the crosshair — exactly like a built-in.

A `view` is two functions (plus two optional ones):

- **`draw(scope)`** — paint the series. `scope` hands you the canvas `ctx`, the pane's transforms (`priceToY`/`yToPrice`, `timeToX`/`xToTime`), its `width`/`height`/`barWidth`, your resolved `options`, and `data` as `[{ time, x, point }]` — each row's x pixel already computed, `point` being the row you fed.
- **`priceValues(point)`** — return the values that matter for this row. Their min/max drive the pane's auto-fit; the last one drives the crosshair readout. This is what makes a custom series scale and read like any other.
- **`defaultOptions()`** *(optional)* — base options merged under the caller's.
- **`destroy()`** *(optional)* — cleanup on `removePlot`.

You feed it like any series — `s.feed([{ time, value }, ...])` — and draw whatever the data describes:

```js
const lolli = chart.addCustomPlot({
  priceValues: (pt) => [pt.value, 0],          // include the baseline in the scale
  draw({ ctx, data, priceToY, options }) {
    const y0 = priceToY(0);
    for (const { x, point } of data) {
      const y = priceToY(point.value);
      ctx.strokeStyle = ctx.fillStyle = point.value >= 0 ? options.up : options.down;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y); ctx.stroke();   // stem
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill();        // head
    }
  },
}, { up: '#5b9c7b', down: '#2a2e39' }, 0);
lolli.feed(momentum);
```

The engine never knew about lollipops — the same way it never knew about diamonds in the ether. You brought the renderer; it brought the coordinates.

<figure class="demo short">
  <iframe src="/demos/custom-lollipop.html" title="A custom lollipop series" loading="lazy"></iframe>
  <figcaption>A lollipop series — a stem and a circle at each tip — that no built-in type draws, added through <code>addCustomPlot</code>. It auto-scales and reads under the crosshair because <code>priceValues</code> reports its values.</figcaption>
</figure>
