---
layout: ../../layouts/DocsLayout.astro
title: Overview
---

# Overview

kapelka is an open source declarative, reactive charting engine written in vanilla JavaScript — no framework, zero dependencies — based on the canvas rendering core of [trading-vue-js](https://github.com/tvjsx/trading-vue-js) (by C451).

Its simple API, built on an open geometry of paths and text rather than a fixed menu of shapes, lets you describe charts and annotations as data.

## Origin

The chart engine is built on trading-vue-js, an open-source charting library that was written inside the Vue framework — meaning its drawing and math code isn't standalone, it was built as the internals of Vue components and expects Vue to be running underneath it. To run it without Vue, the engine keeps a small stand-in that imitates just enough of Vue to keep those original drawing classes working, so they run in a plain browser with no framework. The result is the same working engine, now noticeably smaller and honest about what it contains, with the Vue stand-in kept only where it's genuinely still needed.

The original project has not been maintained since **April 2021**. This is part of why it was worth extracting the engine on its own terms: the rendering core is solid and self-contained, and freeing it from the abandoned Vue shell keeps it usable.

The rendering core is the foundation of the engine. On top of it kapelka adds a reactive, declarative layer: an open geometry where every shape is just a path of vertices and text, anchored in the same time-and-price space as the candles and rendered by one substance shared between studies and drawing tools — plus a studies system, more series types, and other capabilities. [The ether →](/docs/the-ether)

## Declared, not drawn

Most rendering engines are canvases you plot dots on: you compute positions and issue draw commands, and the chart is the running total of your operations. kapelka is the other kind — an environment you feed datasets to. You don't draw the chart; you state what exists and the engine reconciles the screen to match. It's React, but for a chart.

That works because the components are deliberately dumb. A plot knows one thing: *given my value at this index, here is my shape.* RSI can't measure distance or reason about the chart; the candle just turns OHLC into a body and wicks. And nothing computes *meaning* — `RSI = 56.6` arrives as data (the indicator math lives upstream), so the renderer never asks "what is RSI," only "where does 56.6 go."

What pre-exists isn't the candle — it's the environment: the coordinate space, the scales, the viewport, the transforms. Data doesn't draw *into* it; it *populates* it, and the dumb primitives read the mapping and resolve themselves into pixels. Feeding the engine is less "plot a candle" than telling a candle where it'll be and how big — and it materializes. The market environment doesn't need to be drawn — it exists in its primordial form, and you feed it the dataset that brings each object to life.

## Data to screen

kapelka isn't a fixed catalog of chart types you fill in. It's an environment that maps your data to screen coordinates: it owns the viewport — scrolling, scaling, reactivity — and hands you the transforms.

```js
chart.timeAxis().timeToX(t)   // time  -> x
chart.timeAxis().xToTime(x)   // x     -> time
chart.priceToY(price)         // price -> y
chart.yToPrice(y)             // y     -> price
```

With these plus the standard canvas API you can draw anything in data coordinates. The crucial part: the engine's own candles, lines, and studies are themselves just consumers of these same transforms — they have no special status over what you draw. Bring any data, and you render it the way the engine renders price.

## License

<a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener"><img src="/agplv3.png" alt="AGPL v3 — Free Software" width="155" height="51" /></a>

kapelka is Free Software: You can use, study, share, and improve it at your will. Specifically you can redistribute and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. Derived from trading-vue-js (C451), MIT — original notice retained for the ported render core.
