---
layout: ../../layouts/DocsLayout.astro
title: Panes and coordinates
---

# Panes and coordinates

A kapelka chart is a vertical stack of panes. Each pane is a self-contained window: it owns its own price scale, auto-fit to just what lives in it, and draws its own series and studies. Panes share one time axis left-to-right, so everything scrolls and zooms together — but nothing shares a vertical scale it wasn't given.

## Every pane owns its domain

A pane's horizontal domain — which bars it spans — comes from its *domain series*: the candle series if the pane has one, otherwise the first series with data. So the pane reads its x from that series' own timestamps and its y from that series' own values. Two panes on the same chart can hold entirely different data and each fits itself; the price scale of one never leaks into the other.

That's the whole model: a pane is not a strip borrowed from the chart above it. It's a window with its own coordinates, placed in the stack.

<figure class="demo">
  <iframe src="/demos/two-panes.html" title="Three panes, each its own window" loading="lazy"></iframe>
  <figcaption>Three panes in one chart, no candles behind any — an RSI, a volume delta, and a cumulative volume delta. Each stands on its own scale; they share only the time axis.</figcaption>
</figure>

## No candles required

Because a pane's domain comes from *whatever series it holds*, a pane needs no candles at all. Put a lone RSI in an empty chart and the RSI becomes the domain series — it owns the x-axis from its own timestamps and the y-axis from its own values. The oscillator stands entirely on its own, no price chart behind it.

That's exactly what the chart above is: three studies, no candles anywhere. The first study claims the main pane; each next one takes a fresh pane below it. Nothing is borrowed from a price chart that isn't there — each pane is a complete window in its own right.

Stack these and you have a study board: a column of independent panes, each reading its own data on its own scale, all scrolling on the shared time axis. It's the same mechanism whether one pane sits under candles or a dozen panes sit alone — a pane is a window, and you decide what goes in it.

## The coordinate spine

Underneath every pane is one pair of transforms: time to x, price to y — and their inverses. `timeToX` places a timestamp on the horizontal axis; `priceToY` places a value on the pane's vertical scale; `xToTime` and `yToPrice` read a pixel back into data. That's the whole coordinate system, and every pane resolves through its own copy of it.

Everything drawn goes through the same spine. A candle, a study's marks, a drawing tool, the crosshair readout — each asks the pane where a time and a price land, and paints there. Because the transforms are shared, a study annotation and a hand-drawn trendline sit in the exact same space and stay locked to the data through every pan and zoom.

It's also what the ether's vertices anchor to: a `t`/`p` vertex is just a call into this spine, which is why a shape scales and moves with the chart. Two data axes and their transforms are the ground everything else — series, studies, tools, marks — is built on.
