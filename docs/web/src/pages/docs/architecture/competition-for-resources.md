---
layout: ../../../layouts/DocsLayout.astro
title: Competition for resources
---

# Competition for resources

An idle chart is nearly free. You spend from there by choosing what to draw — and each thing you draw is bounded to its own cost.

## An idle chart is free

Candles and nothing else do almost no work. A price arrives, the last bar updates, the chart repaints. That is the whole loop.

- **No polling.** Live data is pushed to the chart; it never asks for anything on a timer.
- **No per-tick math.** An empty chart computes nothing, so there is nothing to repeat.

Nothing to multiply means nothing to slow down. Open twenty candle charts and you will not find a lag.

## You pay for what you draw

The moment you add a study you start spending, and studies differ.

- **Light** — computed off session boundaries: day and week separators, an opening price, a few levels. Ten of them barely register.
- **Heavy** — a running total over many bars: volume delta, VWAP. It walks a run of bars and redoes it every price. One is fine; ten across your charts is felt.

That is not a flaw in any study. It is the honest cost of what you asked to see.

## Each thing you draw is bounded

The engine holds every consumer to the work it actually needs.

- A running-total study looks back a few hundred bars, not the whole history — a bounded loop, the same line drawn.
- A hidden study stops computing and drops its data feed; showing it again computes once.
- A study that only needs the screen recomputes on pan and zoom, over the visible range.

So cost tracks what is *on* the chart, not how much history sits behind it.

## The one thread that matters

One thread draws the charts. It also schedules the click that sends an order.

- The heavy study **math** runs off this thread (see [Study workers](/docs/architecture/study-workers)). But the **drawing** stays on it — painting a volume profile's hundreds of bars costs time here, computed value or not.
- Sending the order is safe: it leaves on a separate process, and the drawing can't touch it (see [Execution architecture](/docs/architecture/execution-architecture)).
- But the click that *starts* it is scheduled on this drawing thread. A window buried in chart work takes a beat longer to reach that click.

Keep what you draw cheap and the thread stays free — a button press never waits behind a pile of chart math.

## The shortest path

The safest way to send an order has no chart in it at all: an order from an addon in the addon host.

That path is a separate process — no bead to draw, no study to finish. It builds the order and sends it, and everything happening on the chart is simply not in the way (see [The addon host](/docs/architecture/addon-host)).

## Rule of thumb

An idle platform is effectively free, however many windows you open. You spend from that budget deliberately, by choosing what to draw: the light things are nearly free, the heavy things are heavy honestly, and the engine bounds each one so the cost is only ever what is on screen.
