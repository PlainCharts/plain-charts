---
layout: ../../layouts/DocsLayout.astro
title: Changelog
---

# Changelog

This is the record of how kapelka came to be — what it's made of, and what has changed. kapelka began as a de-framework port of `trading-vue-js` (by C451): its plain-JavaScript rendering core lifted out, the Vue shells set aside, and one engine built to drive that core through an API of its own. What follows is the map of that work and everything added since.

## The idea in one paragraph

`trading-vue-js` keeps its heavy math and canvas rendering in plain JavaScript, with thin Vue shells on top for canvas setup and event wiring. The port lifted that rendering core out intact, replaced the shells with a single `Engine` that drives it, and exposed a clean chart API on top. The result is a zero-dependency, framework-free chart engine with its own API — the author's rendering modules, made drivable. Everything else — studies, drawing tools, the skin — sits on that API, and the engine has since grown a substantial surface of its own.

## What was extracted

The heart of kapelka is the author's rendering core, copied in with its directory structure mirrored so its internal imports resolved with no edits. This is `trading-vue-js` code, driven rather than rewritten:

- **The render, layout, and axis core** — the coordinate transforms (`t2screen`/`$2screen` and their inverses), the layout and candle geometry, gridline and axis-tick generation, log-scale math, the price and time axis rendering, the crosshair and magnet, time-to-index mapping, and the update loop.
- **The drawing primitives** — the plain canvas classes for candles, lines, pins, prices, rays, and segments.
- **The utilities** — math, geometry, canvas layers, constants, and the input helpers those modules lean on.

The core came over intact; the framework around it is what changed.

## What was left out

The port's deliverable is the render engine, its panes and coordinate system, and its extension API — not the example content that shipped around it. So a large part of `trading-vue-js` was deliberately not carried over:

- **The Vue shells** — every `.vue` component (the chart, grid, sidebar, toolbar, legend, and the rest). One engine replaces them all.
- **The bundled overlays and tools** — the indicator and drawing-tool components. kapelka brings its own study system and drawing tools.
- **The data layer** — the DataCube, its script engine, and the standard indicator library. The consumer owns its data and studies.
- **Build tooling, tests, icons, and demo assets** — out of scope for a library core.

What stayed is the rendering core; what left is everything that assumed a particular app around it.

## [Unreleased]

### Added

- Configurable time-axis label gap (`timeAxis.labelGap`) — minimum pixels before crowded labels drop.
- Display timezone for the time axis (`timeAxis.timezone`) — day and intraday ticks land on local time; data and coordinates stay UTC.
- Bold and italic text marks — studies and drawing tools can render styled labels.
- Vertical over-compression clamp (`maxVZoom`) — caps how far the price axis can squash the data. Default 3×.
- Ctrl + wheel zooms both axes around the cursor; plain wheel still adjusts bar spacing.
- Double-click the time axis to scroll to the latest bar.
- The engine and its chart API — `mountChart`, `addPlot` / `removePlot`, `feed` / `feedBar`, `panes()`, `timeAxis()`, `priceAxis()`, plus the primitive host that runs custom renderers.
- The ether — a declarative drawing substance: shapes are data (an anchored `path` and `text`) resolved by one stateless renderer every frame. Includes a shape-library of reusable recipes (`$param` / `=expr`, no `eval`), price-anchored gradient band fills, and cross-pane shape emission (a sub-pane study can draw on the price pane).
- The study system — `StudyHost`, the study registry, and a gallery of example indicators.
- The skin pack — an optional, framework-free chrome layer (legend, controls, config window).
- Chart-less panes — a pane owns its domain from its own series, so a study stands alone with no candles behind it (study boards).
- New series types — `Segments` (partitionable bars, with hollow `fill:false` parts) and `HBars` (horizontal bars at price levels), plus `addCustomPlot` for bringing your own render primitive.
- Overlay price scales — `axisId` + `margins` put any series on its own region-confined auto-fit scale.
- Percent and Indexed-to-100 axis modes; main-axis margins with baseline anchoring; a log-scale fix for narrow sub-1 ranges.
- Stepped and curved line types (`lineType`).
- Touch — one-finger pan, pinch-zoom, long-press tracking cursor, axis-drag Y-zoom, and kinetic pan.
- Crosshair follows the cursor into the whitespace past the last bar.
- Streaming — render conflation, data-point conflation (merge candles sharing a pixel column), and auto-scroll on new bars (`followNewBars`).
- Full unsubscribe surface, and `destroy()` clears all subscriptions.

### Fixed

- No startup overzoom when only a few bars have loaded — the initial fit keeps the full window and fills the left with whitespace.
- Rescaling a candle-less sub-pane no longer crashes.
- Gap-adjacent time-axis labels no longer vanish — collision is measured in pixels, not bar count.
- No phantom date label at UTC midnight when a display timezone is set.
- Day and intraday ticks are gap-robust and session-aware — they land on the first bar of a new day or round-clock step, so instruments with session gaps still get regular labels.
- Study legend shows only the study name — internal inputs are no longer appended (opt in with `legend: true`).
- Multi-line text marks stack on the correct side of their anchor — an above-anchored label keeps all its lines above.
- Drawings sent to back now render behind the candles (paneView `zOrder` honored).
- `configure({ handleScroll, handleScale })` now actually locks pan and zoom.
- Segmented series `drawBackground` is honored — plugin backgrounds layer behind foregrounds.
- Markers on the candle series now draw (`setMarkers` on the main series).

### Changed

- Index-based time-axis labels now land on round clock times (06:00, 06:30, …) instead of every N bars.
- Sub-pane controls can hide the remove button (`_noRemove`) for host-managed study sets.

### Removed

- The baked-in volume histogram — volume is now a study on an overlay scale, open to any series. The raw `bar.volume` field stays; only the hardcoded rendering was removed.
