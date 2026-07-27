---
layout: ../../../layouts/DocsLayout.astro
title: Study workers
---

# Study workers

A study's math runs on a background thread; the render thread only maps the result to pixels.

## The render thread only draws

A plot is declarative: given its value at an index, it knows its shape. It never asks what RSI *is* — `RSI = 56.6` arrives as data and it draws where 56.6 goes.

The worker runs the `calc` that produces the 56.6. The render thread does nothing but map data to pixels.

```
bars ─►  worker: calc()  ── postMessage(channels) ─►  render thread ─► pixels
         off the render thread                        data → shape
```

## A generic capability

The worker hardcodes no indicator. The host hands it a study's **URL**; the worker imports it as a native ES module — it self-registers exactly as on the main thread — runs `calc`, and posts back pure render channels.

A study is eligible when its `calc` is a **pure function of bars**: it returns data and never touches the canvas. A study that drives its own per-frame animation stays on the main thread, because it tweens against the render loop.

## Worker-only, no fallback

An eligible study runs on its worker or not at all. A worker failure surfaces as a visible study error — there is no inline path that quietly recomputes on the render thread.

## Isolation

Own thread, own failure. A pathological study — `while (true) {}` — hangs only its worker:

```
worker loops → that study fails → the chart keeps painting
```

Only that study stops updating; the rest of the UI stays live. It is the same failure isolation the platform is built on, down to a single indicator.

## Lifecycle

One worker per pane, shared by that pane's studies; panes compute in parallel.

- Spawned on the first study that needs it.
- Terminated when the pane's last worker-study is removed, and on pane teardown — a closed tab leaves no worker behind.
- A [study board](/docs/concepts/workspaces) is a stack of panes, so each board study computes on its own pane's worker. No special handling.

## Compute vs draw

Receiving a bar is nearly free. The cost is *processing* it, and processing is two things:

- **compute** — the per-bar math (CVD summing volume delta, VWAP accumulating price × volume).
- **draw** — turning the output into series and painting them.

Workers move **compute** off the render thread — the heavy per-tick loop over the bars. **Draw** stays where the pixels are: painting a volume profile's hundreds of bars still costs render time, computed value or not (see [Competition for resources](/docs/architecture/competition-for-resources)).

The data is not the bottleneck; the processing is. Workers take the compute half off the paint thread and leave the draw half at the canvas.
