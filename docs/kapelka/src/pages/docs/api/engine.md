---
layout: ../../../layouts/DocsLayout.astro
title: Engine API
---

# Engine

Imported from the package root (`index.js`).

### Entry point

- `mountChart(el, options)` → `Chart` — create a chart mounted in a DOM element.

### Plot-type tokens

Passed as the first argument to `addPlot(type, opts, pane)`:

- `Candles` — OHLC candlesticks
- `Line` — single-value line
- `Area` — line with a filled gradient below
- `Baseline` — two-tone line/fill split at a base value
- `Columns` — vertical bars (histogram)
- `Segments` — partitioned / stacked bars (colors per segment in the data)
- `HBars` — horizontal bars at price levels (volume-profile style)

### Enums

- `CursorMode` — `Free` (0), `Magnet` (1), `Hidden` (2)
- `Stroke` — `Solid` (0), `Dotted` (1), `Dashed` (2), `LongDash` (3), `SparseDot` (4)

Two more enum-like values are passed as plain numbers (not exported objects):

- price-scale mode — `0` Regular/Linear, `1` Logarithmic, `2` Percent, `3` Indexed-to-100
- line shape (`lineType`) — `0` Straight, `1` Stepped, `2` Curved

### Chart methods

Returned by `mountChart`.

- **Lifecycle** — `configure(options)`, `getConfig()`, `destroy()`
- **Plots** — `addPlot(type, opts, pane)`, `addCustomPlot(view, opts, pane)`, `removePlot(plot)`
- **Panes** — `panes()`, `addPane()`, `removePane(index)`
- **Axes** — `timeAxis()`, `priceAxis(id)`
- **Cursor & events** — `onCursorMove(cb)` / `offCursorMove(cb)`, `onClick(cb)` / `offClick(cb)`, `setCursor(price, time, plot)` / `clearCursor()`
- **Coordinates** — `priceToY(price)`, `yToPrice(y)`
- **Misc** — `snapshot()` (canvas of the main pane), `rootEl()` (the chart's root DOM node)

### Plot (series) methods

Returned by `addPlot` / `addCustomPlot`.

- **Data** — `feed(bars)` (replace all), `feedBar(bar)` (append or update the latest)
- **Style** — `configure(opts)`, `getConfig()`, `formatPrice()`
- **Coordinates** — `priceToY(price)`, `yToPrice(y)`
- **Price levels** — `addLevel(opts)`, `removeLevel(level)`
- **Markers** — `setMarkers(markers)`
- **Layers** (attached primitives) — `addLayer(primitive)`, `removeLayer(primitive)`
- **Axis** — `priceAxis()`

### timeAxis() object

Returned by `chart.timeAxis()`.

- **Windows** — `timeWindow()` / `setTimeWindow(range)`, `barWindow()` / `setBarWindow(range)`, `zoomTimeWindow(factor, anchor)`
- **Events** — `onTimeWindow(cb)` / `offTimeWindow(cb)`, `onBarWindow(cb)` / `offBarWindow(cb)`
- **Coordinates** — `timeToX(time)` / `xToTime(x)`, `barToX(index)` / `xToBar(x)`
- **Navigation** — `fitAll()`, `scrollToNow()`
- **Metrics** — `width()`, `height()`
- **Config** — `configure(opts)`, `getConfig()`

### priceAxis() object

Returned by `chart.priceAxis(id)`.

- `width()`, `configure(opts)`, `getConfig()`

### Options schema

**Chart options** (passed to `mountChart` / `chart.configure`):

- `layout` — `{ background: { color }, textColor, fontSize, fontFamily }`
- `grid` — `{ vertLines: { visible, color, style }, horzLines: { visible, color, style } }`
- `cursor` — `{ mode (CursorMode), color, labelBg, labelText, vertLine: { color, width, style, showLabel, labelBg }, horzLine: { … } }`
- `timeAxis` — `{ timeVisible, secondsVisible, rightOffset, barSpacing, borderColor, followNewBars, tickFormatter, indexBased }`
- `rightPriceAxis` / `leftPriceAxis` — `{ mode, margins: { top, bottom }, invert, autoScale, visible, borderColor }`
- `localization` — `{ timeFormatter }`
- top-level — `autoSize`, `ib` (index-based x-axis; alias of `timeAxis.indexBased`), `maxZoom`, `conflate` (ms between paints), `candleWidth`, `noOverlapLabels`

**Plot options** (passed to `addPlot` / `plot.configure`):

- Candles — `upColor`, `downColor`, `showBorder`, `borderUpColor`, `borderDownColor`, `showWick`, `wickUpColor`, `wickDownColor`
- Line — `color` (or `lineColor`), `lineWidth`, `lineStyle` (Stroke), `lineType`
- Area — `lineColor`, `lineWidth`, `lineStyle`, `topColor`, `bottomColor`
- Baseline — `topLineColor`, `bottomLineColor`, `baseValue`, `topFillColor1`/`topFillColor2`/`bottomFillColor1`/`bottomFillColor2`
- Columns — `color`, `base`
- HBars — `color`, `side`, `widthFrac`, `thickness`, `fill`
- common — `visible`, `showPriceLine`, `priceLineColor`, `priceLineWidth`, `priceLineStyle`, `showLastValue`, `showCursorMarker`, `showPointMarkers`, `axisId` (overlay scale id), `margins: { top, bottom }`, `overlayLog`, `priceFormat: { precision, formatter }`

**Price-level options** (passed to `plot.addLevel`):

- `price`, `color`, `lineWidth`, `lineStyle`, `showLine`, `showAxisLabel`, `axisLabelColor`, `axisLabelTextColor`, `title`

### Custom-plot contract `[extend]`

The `view` object passed to `addCustomPlot(view, opts, pane)`:

- `priceValues(point)` → `number[]` — **required**; min/max drive pane auto-scale, last drives the cursor.
- `draw(scope)` — **required**; `scope = { ctx, options, series, width, height, barWidth, priceToY, yToPrice, timeToX, xToTime, data:[{ time, x, point }] }`.
- `defaultOptions()` → object — optional; merged under the caller's opts.
- `destroy()` — optional; called on `removePlot`.
