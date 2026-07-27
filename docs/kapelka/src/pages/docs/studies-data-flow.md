---
layout: ../../layouts/DocsLayout.astro
title: The data-flow model
---

# The data-flow model

Series studies stream on a data-flow model taken from trading-vue-js's **DataCube** — reimplemented in vanilla JS, with the scripting stripped out.

The design is portable; the original code is not.

DataCube's data-flow is Vue-free and language-free as ideas. Its *thinness* — the one-line `sma(close, length)` study — is not: that only works because studies are expression strings an interpreter compiles. So we keep the principles and drop the interpreter.

## The principles

Five ideas, all preserved:

- **Resident pool, uploaded once.** The worker owns the bars. The host uploads them once, then sends mutations — a single candle per tick, not a fresh copy per study.
- **One shared window.** The bars become column arrays (`open`, `high`, …) built once and read by every study on the pane. No study owns or copies data.
- **One traversal.** A full run walks the bars once; at each bar, every study's `step` advances together. N studies is one pass, not N.
- **Incremental output.** A live tick advances one bar and emits only the last point; the host feeds it by time.
- **Declared requirements.** A study declares the data it reads (`requires`); each data type is provided once, so the tenth intrabar study costs nothing new.

## The checkpoint

The heart of the streaming path: a study's running state is snapshotted at the last **closed** bar.

```
set-bars (once) ─► resident bars            worker owns them; no per-study copy
                      │
                      ▼
             shared window  o/h/l/c/v/oi    column arrays, built once, read by all
                      │
  full run ─► walk every bar ─► step(i)     N studies, one pass
                      │              └─ snapshot state at the last CLOSED bar (the checkpoint)
                      ▼
  live tick ─► restore checkpoint ─► step(forming bar) ─► one point out
  bar close ─► fold the closed bar into the checkpoint ─► step the new forming bar
```

The snapshot freezes all the settled history once.

Every tick, only the forming bar is recomputed against it.

On close, that bar is folded into the snapshot and the cursor moves to the next forming bar.

The alternative — re-walking all 288 bars on every tick to update the last one — is pure waste, since the closed bars cannot change.

## Cheap output

Because only the last point(s) move, the host feeds them by time and refreshes the legend.

It never rebuilds the plot metadata, panes, price scales, or drawing primitives.

## What we dropped

DataCube's thinness is intrinsically script-based.

Its `script_env` compiles `update:` / `init:` expression strings through `new Function`, and its derived-series memoization keys off call-site ids parsed from that source text.

That machinery only works because studies are strings it interprets.

Ours are plain JavaScript modules — no language, no standard library, no expressions.

## Two kinds of study

The model splits every study cleanly:

- **[series](/docs/studies-step)** — a per-bar `step`, checkpointable, streams incrementally (fills and all).
- **[geometry](/docs/studies-calc)** — a whole-array `calc` with no last bar to isolate (a box over a run, a session strip, a viewport surface), recomputed in full.

No series study falls back to full for convenience.
