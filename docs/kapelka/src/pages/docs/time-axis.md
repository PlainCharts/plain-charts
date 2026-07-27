---
layout: ../../layouts/DocsLayout.astro
title: Time axis
---

# Time axis

The time axis places every bar along the horizontal and chooses the labels beneath them. You pick how bars are spaced; the axis decides where the ticks fall and what they read.

## Two ways to space bars

**Real-time spacing** (default) — each bar sits at its real timestamp. Evenly-sampled bars line up neatly, but missing time — a weekend, an overnight session halt — leaves a proportional gap on the axis, because the next bar's timestamp is that much further along.

**Index-based spacing** (`indexBased: true`, aliased `ib`) — bars are spaced evenly by position, one slot each, so session gaps collapse to nothing and the chart stays tidy. The axis still reads real clock times (next section) — only the spacing changes.

Set it at mount:

```js
mountChart(el, { timeAxis: { indexBased: true } });   // or the top-level `ib: true`
```

It's chosen at mount and fixed for the chart's life — not toggled live. Either way, the coordinate methods (`timeToX`, `xToTime`, `barToX`, `xToBar`) take and return real seconds / bar indices, so your code reads the same in both modes.

## Labels land on round times

You might expect index-based spacing to label every N-th bar — but the axis reads real clocks in both modes. Ticks fall on round-clock boundaries — the top of the hour, the start of the day — not on arbitrary bar counts.

It works by choosing a nice time step (targeting roughly one label per axis-width of pixels), then snapping that step up to a whole multiple of the real bar interval so ticks land on bars that exist. In real-time mode that step is just clock time. In index-based mode the step is tracked in real milliseconds even though bars are positioned by index — so a 15-minute chart labels 09:00, 09:15, 09:30, not "every 25 bars."

The effect: whichever spacing you pick, the labels read like a clock — evenly spaced in *time*, on round values a person recognizes.

## Session-aware ticks

Instruments with session gaps rarely have a bar sitting exactly on midnight or an exact round hour, so a naive "label the bar at 00:00" rule leaves blank spans. The axis instead places ticks by *crossing*, comparing each bar to the one before it:

- A **day** tick lands on the **first bar of a new calendar day** — the bar where the day changed from the previous one — not on an exact-midnight bar that may not exist.
- An **intraday** tick lands on the **first bar that crosses a round-clock step**, not one that sits exactly on it.

So a futures session that opens at 09:30 and rolls at 18:00 still gets a clean day label and a steady hourly cadence — the first bar after each boundary carries the tick — instead of empty axis where no bar happens to fall on the round time.

## Display timezone

By default the axis classifies ticks in UTC — day and month boundaries land on UTC midnight. Set a display timezone to move those boundaries onto local time:

```js
chart.configure({ timeAxis: { timezone: -4 } });   // hours east of UTC (−4 = US Eastern)
```

`timezone` shifts only the tick **classification** — where the day/month/year boundaries fall and where the intraday round-clock steps land — so a day label sits on *local* midnight and the hourly ticks read as local hours. It's live-settable, so a timezone chip can update the axis without a rebuild.

What it does **not** touch: your data and the coordinates stay UTC. Bar timestamps, `timeToX`, the price mapping — none of it moves; only the axis's sense of where a "day" begins shifts. And it composes cleanly with a custom `tickFormatter` (next section): the formatter still receives real UTC seconds, and the boundary rank is already timezone-aware, so there's no double-shift to guard against.

## No overlapping labels

The axis never lets two labels collide. As it lays ticks out it measures the real **pixel** gap between neighbors; if they'd sit closer than a threshold, one is dropped. The threshold is `labelGap` in pixels, defaulting to 48 — raise it for more breathing room, lower it for denser labels:

```js
mountChart(el, { timeAxis: { labelGap: 64 } });
```

When two labels crowd, **rank** decides which survives: a year outranks a month, a month a day, a day an intraday time. The higher-rank label stays; the lower-rank one drops.

Because the test is in pixels rather than bar counts, a gap-adjacent pair — two real round ticks that land on neighboring bars after a session gap — stays visible whenever there's screen room, and drops only on a true pixel overlap.

## Formatting

Two hooks control the text; both receive real UTC seconds.

**`tickFormatter`** — the axis ticks. Called once per tick as `(seconds, tickType) => string`. `tickType` is the tick's rank — `0` year, `1` month, `2` day, `3` intraday — so you can render a year as `2024`, a day as `15`, an intraday tick as `09:30`. The rank is already timezone-aware; return any string, or omit the hook for the built-in formatting.

**`localization.timeFormatter`** — the crosshair readout. Called as `(seconds) => string` for the time label under the cursor; use it for a full timestamp.

```js
mountChart(el, {
  timeAxis:     { tickFormatter: (sec, type) => (type <= 2 ? fmtDate(sec) : fmtTime(sec)) },
  localization: { timeFormatter: (sec) => new Date(sec * 1000).toISOString() },
});
```

Both are live-settable via `configure`.

## The right edge

Two options govern the space after the last bar and what happens when new bars arrive.

**`rightOffset`** — how many bars of empty space to leave between the last bar and the right edge (default 6; `0` sits flush). It's the whitespace the ether can extrapolate into — a shape anchored past the last bar draws there. Changing it live shifts the view in place rather than resetting, so the scroll position is kept:

```js
chart.timeAxis().configure({ rightOffset: 12 });
```

**`followNewBars`** — when a new bar arrives and you're already at the right edge, the view auto-scrolls to keep it in sight (default on). Turn it off to stay parked in history while data streams in:

```js
mountChart(el, { timeAxis: { followNewBars: false } });
```

`timeAxis().configure({ barSpacing })` is a companion: it sets the zoom by pixels-per-bar, keeping the right edge pinned — handy for a programmatic "fit to this bar width."
