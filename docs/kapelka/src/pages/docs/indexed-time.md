---
layout: ../../layouts/DocsLayout.astro
title: Indexed time
---

# Indexed time

In index-based mode the horizontal axis is not a clock — it is an **ordered list of time points**, and a
bar's position is simply its place in that list. This page explains that model: how time and position
convert, and how the same model covers both the loaded **past** and the empty **future**. For spacing,
labels and configuration, see [Time axis](/docs/time-axis); this page is about what sits underneath it.

## Position is an index, not a time

The axis holds an ordered list of time points. Each point has an integer **index** — its slot. A bar's
x-coordinate is a straight linear function of that index (evenly spaced by the bar width); real time
never enters the coordinate arithmetic.

So two neighboring points are always exactly one slot apart on screen, no matter how far apart they are
in real time. That is the whole reason session gaps collapse: a weekend or an overnight halt has no bars,
so it takes up **no index** — the axis just steps from the last Friday bar to the first Sunday bar with
nothing between them. The gap disappears because it was never a slot.

## Converting between time and index

Everything on the chart is placed through two conversions over that ordered list:

- **time → index** — locate the time among the points. An exact match returns its index; a time between
  two points returns a fractional index by interpolation; a time before the first or after the last point
  is extrapolated by the bar interval.
- **index → time** — the inverse. A whole index returns that point's time (a direct lookup); a fractional
  index interpolates between its neighbors; an index past either end extrapolates.

The public coordinate methods — `timeToX`, `xToTime`, `barToX`, `xToBar` — are built on these, and they
take and return real seconds and bar indices in **both** spacing modes, so calling code reads the same
whichever mode the chart is in. Because a candle, a drawing anchor, a study shape and an axis tick all go
through the same two conversions, they share one consistent grid.

## The past: points come from the data

Every bar you feed adds a point, and its index is its position among all points, ascending by time.
Nothing fills the gaps — there is no slot reserved for missing time. A market that is shut over the
weekend simply contributes no points there, so the axis carries straight from the last bar before the
break to the first bar after it.

This is why the past is exact: the points **are** the data. Where a bar exists, there is a slot; where no
bar exists, there is nothing to place.

## The future: whitespace extends the same list

Past the last bar there is no data — but the axis can still hold points out there. A **whitespace point**
is a time slot with no price: it occupies an index and carries a time, yet it paints no candle and takes
no part in the price scale. Feed a run of them and the axis indexes them exactly like bars — index → time
by the same lookup.

```js
chart.setFutureWhitespace(times);   // future time slots (seconds), index-based mode
```

This gives two ways for the axis to describe the future:

- **Without whitespace** — the space after the last bar (`rightOffset`) is *extrapolated* by the bar
  interval: a uniform forward clock. Simple, but it steps through calendar time literally, weekends
  included.
- **With whitespace** — the future is *described*, not extrapolated. Because the supplied points are just
  more entries in the ordered list, whatever cadence they follow becomes the axis: if they skip the
  weekend, so does the future, mirroring the past.

The engine only indexes the points; it does not invent them. What the future slots *are* — their cadence,
which sessions they follow — is decided by the application that supplies them.

## One axis, one mapping

Because position is an index and everything resolves through the same two conversions:

- candles, value series, drawings, study shapes and axis ticks all sit on one grid;
- a time in the past resolves to a real bar; a time in the future resolves to a whitespace slot when one
  exists, or an extrapolated position when it does not;
- the past collapses gaps because the bars define it — and the future can collapse them too, whenever it
  is described with whitespace rather than left to extrapolate.
