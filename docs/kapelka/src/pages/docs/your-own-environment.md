---
layout: ../../layouts/DocsLayout.astro
title: Your own environment
---

# Your own environment

Both axes are yours to design. A chart's bottom is an open region — place any study there and it renders on its own scale, auto-fit to just its data. The price axis is open the same way: horizontal, price-anchored primitives live along it, a volume profile among them.

Nothing there is fixed, and nothing is repainted — each is data resolved to pixels every frame. You describe what belongs on an axis and the engine draws it; the environment is yours to compose.

## The bottom is yours

The strip along the bottom of the price pane is an overlay scale — a study placed there gets its own invisible price scale, confined to a region you set with top and bottom margins, and auto-fit to just that study's values. It shares the pane with the candles but reads on its own range, so the two never share a scale.

Any study can take that region: volume, an RSI, a delta line, whatever you write. It isn't tied to one indicator — it's a place, and you decide what lives there. Stack a few, each on its own region, and one pane carries the price plus several overlays cleanly.

<figure class="demo">
  <iframe src="/demos/rsi-bottom.html" title="RSI on the bottom overlay" loading="lazy"></iframe>
  <figcaption>An RSI riding the bottom of the price pane on its own overlay scale — same pane as the candles, its own 0–100 range.</figcaption>
</figure>

## The price axis is yours

The price axis carries its own kind of primitive: horizontal bars anchored to price levels instead of to time. Where a line or candle reads left-to-right along time, an `hbar` series reads bottom-to-top along price — each row is a `{ price, segments }` value, and each segment is a colored length drawn out from the axis edge.

A volume profile is exactly this. It buckets a range of bars into price rows, splits each row's volume into up and down `segments`, and feeds them as horizontal bars. The engine draws them against the price scale, growing from the right edge (or the left — `side` picks which) to a fraction of the pane's width you set. Nothing is anchored to a bar or a moment; the whole shape lives on price, and it re-resolves as the scale moves.

It's the same idea as the bottom overlay, turned ninety degrees: a region of the chart given over to a series that reads on the axis it belongs to. The bottom gave a study its own price scale; the price axis gives a series its own geometry along price. Both are places you compose, not fixtures you inherit.

<figure class="demo">
  <iframe src="/demos/volume-profile.html" title="Volume profile on the price axis" loading="lazy"></iframe>
  <figcaption>A volume profile — horizontal <code>hbar</code> rows anchored to price, each split into up/down volume. It lives on the price axis, not on time.</figcaption>
</figure>

## You design the environment

Neither axis is spoken for. The bottom of a pane isn't reserved for volume; the price axis isn't reserved for candles. Each is a region you hand to whatever reads on it — a study on its own scale, an `hbar` series along price, a line, a profile — and the engine fits it there and redraws it as the chart moves.

That's the whole posture of kapelka: the chart is not a fixed layout you place indicators into, but a space you compose. You decide what belongs on each axis and how much room it takes; the scales, the fitting, the per-frame redraw are the engine's job. Nothing is repainted and nothing is baked in — every series and every study is data resolved to pixels, on the axis you gave it.
