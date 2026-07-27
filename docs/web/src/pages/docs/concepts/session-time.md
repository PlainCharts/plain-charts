---
layout: ../../../layouts/DocsLayout.astro
title: Session time and the future axis
---

# Session time and the future axis

Day and week lines land on the real session open — for any instrument, on both the loaded past and the empty future.

## The problem

A day separator has to sit where the session actually starts. That time differs by instrument.

- Futures reopen Sunday 18:00 ET.
- Forex, Sunday 17:00.
- Equities, Monday 09:30.

And it has to hold on both sides of *now*: the past you loaded, and the future with no bars in it yet.

## Two layers

One idea solves it: a per-instrument **session model** that drives a correct time grid. The app owns the model. The engine owns the axis.

```
session model  (app, per instrument)
   │
   ├─ PAST:   re-stamp the daily candles to the true open
   │
   └─ FUTURE: project the next session slots ─▶ engine indexes them
                                                 like real bars
```

- The app **learns** each instrument's session and projects it forward.
- The engine turns those times into bar positions.

## Learned from bars, not an API

The app never trusts a market-hours feed. One broker reported CME futures an hour off from its own bars.

Instead it reads the instrument's own intraday bars, which are ground truth:

- fetch a few days of a fine timeframe;
- cut into sessions at every gap — a gap means the market was shut;
- the reopen after the **biggest** gap is the weekend open, the recurring rule;
- the **median** session gives the typical length.

Two learned numbers: when a session starts, and how long it runs. One algorithm, no per-asset branching.

## The past is anchored to candles

The past is known. Its reference is the daily candles.

Brokers often stamp a daily bar in the maintenance gap — say 17:30 — not the true 18:00 open. The model re-stamps each daily bar to the real open, so lines land there and match across timeframes.

The underlying bars keep their native times. Only the display copy moves, so caching and paging are untouched.

## The future is projected, then indexed

The future is unknown. There are no bars out there.

The app projects it with the same model: step forward one timeframe at a time, and when a step lands in a gap, jump to the next session's open. Weekends drop out.

Those projected times go to the engine as empty slots — a time with no price. The engine indexes them like real bars. So a future bar maps to a real session time, not raw forward clock time.

That is what makes the future axis gapless. The past has no weekend bars; now the future has no weekend slots.

## Why the markers land

A study like **Day Marker** never calls the session model. It just draws lines from its own start-time setting.

They land correctly because the grid underneath is already correct:

- past lines reference the session-anchored candles;
- future lines snap onto the projected slots.

The same model sits on both ends, so past and future agree. A future week frames on real Monday-to-Monday boundaries, weekend collapsed, exactly like the weeks behind it.
