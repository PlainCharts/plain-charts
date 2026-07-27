---
layout: ../../../layouts/DocsLayout.astro
title: Timeframe
---

# Timeframe

Run any study on a higher timeframe than the chart.

A built-in Timeframe field sits at the top of every indicator's settings — no study declares it, no study code changes. Pick a higher timeframe; the study computes on it, then draws back on the chart.

<hr>

## The control

Type the timeframe: a bare number is minutes, an `h` suffix is hours — `5`, `30`, `1h`, `12h`. Blank, or a value at or below the chart's own timeframe, means Chart — no aggregation.

The entry must be above the chart timeframe and under one day; a multiple of the chart timeframe aligns cleanest. It stores per study as a reserved `__tf` param in seconds, and persists with the study.

<hr>

## What `calc` sees

The host aggregates the chart bars up to the chosen timeframe — OHLCV, bucketed to clock boundaries — and hands `calc` the coarser bars. Same `bars` argument, same point shape, just fewer and wider. The study needs no awareness; it computes on whatever bars it receives.

```
chart bars (5m) ──aggregate──▶ HTF bars (15m) ──▶ calc(bars, p, ctx)
```

`ctx.timeframe` carries the active timeframe in seconds, or `null` when the study runs on the chart — for the rare study that adapts.

<hr>

## How outputs map back

- **Shapes** anchor by absolute time (`t` in seconds), so boxes, lines, and labels land on the chart axis unchanged.
- **Line plots** (`line` / `area` / `baseline`) forward-fill onto the chart bars with a step hold: each chart bar takes the value of the most recent higher-timeframe bar that has already closed, so there is no lookahead. `histogram`, `segmented`, and `hbar` pass through at their higher-timeframe times.
- **Fills** follow the plots they reference.

<hr>

## Limits

- **Higher, and intraday.** The timeframe must be above the chart's and below one day. Daily, weekly, and monthly need session and calendar alignment — a futures day isn't UTC midnight, a week isn't seven days from the epoch — which this version doesn't do.
- **Aggregated from chart bars.** The coarser bars are built from the bars already loaded; there is no separate fetch.
- **Not combined with intrabar.** While a higher timeframe is active, a study's lower-timeframe sub-bars (`ctx.intrabar`) are skipped.

<hr>

## Source

The rollup and forward-fill are `aggregateBars` / `forwardFillPlots` in `lib/kapelka/studies/channels.js`; the host applies them around `calc` in `lib/kapelka/studies/host.js`. The Timeframe control renders in `src/studies/settings.js`.
