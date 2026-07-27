---
layout: ../../layouts/DocsLayout.astro
title: Streaming and performance
---

# Streaming and performance

The engine is built to take a live feed and stay smooth. Data is applied the moment it arrives — reads always see the latest — while the work that costs, the paint, is bounded so a firehose of updates can't drown the frame.

## Feeding data

A series takes data two ways:

- **`feed(bars)`** — replace the whole series with a new array. Rows are sorted by time; if there's no view yet, the chart fits to the data.
- **`feedBar(bar)`** — stream one bar. Its time decides what happens:
  - **same time as the last bar** → updates that bar in place (the forming/live bar),
  - **newer time** → appends it,
  - **older time** → inserts it in sorted position (a historical backfill).

```js
candles.feed(history);                 // load a batch
candles.feedBar({ time, open, high, low, close });  // then stream ticks
```

So the common live loop is one `feed` for history, then a `feedBar` per tick — the same call whether the tick refines the current bar or opens a new one. When a genuinely new bar appends and you're at the right edge, the view follows it; that behavior is `followNewBars`, covered under [Time axis → The right edge](/docs/time-axis).

## Bounding the paint rate

Under a fast feed, the cost isn't storing data — it's painting. `conflate` caps how often the chart repaints:

```js
mountChart(el, { conflate: 100 });   // at most one paint every 100ms
```

The value is milliseconds between paints. **Data is always applied immediately** — every `feedBar` updates the store and any read stays current; only the *render cadence* is bounded. A burst of twenty `feedBar` calls inside 50ms still collapses to a single repaint on the next window.

The default is `0` — paint once per animation frame (browser-paced, ~60fps), which is already coalesced and right for most feeds. Reach for a non-zero `conflate` only when a single symbol streams faster than the eye can use — tens of updates per frame — and you'd rather spend those cycles elsewhere.

## Fewer candles when zoomed out

Zoom out far enough that more than one bar falls in a single pixel column and drawing every bar is wasted work — they'd paint over the same pixels. The candle painter merges them automatically: within each pixel column it keeps the **open of the first** bar, the **close of the last**, and the **true high and low** across the column — one composite candle per column. A view of thousands of bars then draws only about as many candles as the chart is wide.

It's automatic and touches drawing only. The crosshair, studies, drawing tools, and gridlines all still read the full data — nothing is discarded, only the render count is cut. So a deep zoom-out stays fast without you managing level-of-detail yourself.

## Keeping the view readable

Two caps stop a zoom from degenerating into an unreadable smear.

**`maxZoom`** — the most bars the view will show at once (default 500). Zooming out stops there, so candles never compress into a solid wall. (A companion `minZoom` caps zooming *in* — the fewest bars on screen, default 25.)

**`maxVZoom`** — a cap on vertical over-compression, as a ratio (default 3). The visible price span won't exceed `maxVZoom` times the visible data's own high-to-low range, so dragging the price axis can't squash the bars into a flat line. Because it's a ratio, it's instrument-agnostic — no per-symbol tuning. Zooming *in* is left alone.

```js
mountChart(el, { maxZoom: 800, maxVZoom: 4 });
```

## Cleanup

Every subscription is a paired `on*` / `off*`, so anything you attach you can detach:

- `onCursorMove` / `offCursorMove`
- `onClick` / `offClick`
- `onTimeWindow` / `offTimeWindow` and `onBarWindow` / `offBarWindow` (on `timeAxis()`)

When you're done with the whole chart, `destroy()` tears it all down in one call:

```js
chart.destroy();
```

It disconnects the resize observer, removes the chart's DOM from your container, and clears every subscription set — so no callbacks linger and nothing keeps the chart alive. Removing the DOM also drops the input listeners with it. Call it when unmounting a view or swapping a chart out, and there's nothing left to leak.
