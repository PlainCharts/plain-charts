---
layout: ../../layouts/DocsLayout.astro
title: Navigation and zoom
---

# Navigation and zoom

How you move around a kapelka chart — pan, zoom, and scale. These are gestures of the engine itself; try each one on the live chart below.

<figure class="demo">
  <iframe src="/demos/navigation.html" title="Navigation & zoom — try it" loading="lazy"></iframe>
  <figcaption>A live chart — candles with an RSI sub-pane. Pan it, spin the wheel, drag the axes, and grab the pane separator.</figcaption>
</figure>

## Navigation

- **Drag the chart body** → pan (horizontal time + the vertical price of that pane)
- **Shift + wheel** → scroll left / right, no zoom
- **Double-click the bottom time axis** → jump to the latest bars (same as the `»` button)

## Zoom / scale

- **Plain wheel** → time-axis scale (bar spacing — contract / expand candles), right-anchored
- **Ctrl + wheel** → 2D zoom (time and price) around the cursor
- **Drag the price axis** (right scale) → vertical price rescale (Y-zoom)
- **Double-click the price axis** → reset that pane to price auto-fit
- **Drag a pane separator** → resize panes

## Touch

- **One finger** → pan
- **Two fingers** → pinch-zoom time
- **Long-press** → tracking crosshair
- **Flick** → kinetic pan
- **Finger on the price axis** → Y-zoom
