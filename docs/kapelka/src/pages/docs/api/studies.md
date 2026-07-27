---
layout: ../../../layouts/DocsLayout.astro
title: Studies API
---

# Studies

Imported from `studies/`.

### StudyHost `[use]`

The runtime that drives a set of studies on one chart. `new StudyHost(chart, opts)`.

opts: `getBars()` (required), `priceDecimals`, `mainSeries()`, `barTimes()`, `isHidden()`, `persist(list)`, `intrabar(tf, fromMs, toMs)`, `resolveLowerTf(study)`.

- **Lifecycle** — `setData(bars)`, `resetIntrabar()`
- **Manage** — `add(id, params, opts)`, `remove(i)`, `clearAll()`, `list()`, `count()`, `studyAt(i)`
- **Params & style** — `setParam(i, key, value)`, `setStyle(i, key, patch)`, `styleOf(i, key)`, `resetDefaults(i)`, `plotMetaOf(i)`
- **Panes** — `movePane(a, dir)`, `setPaneMode(a, mode)`
- **Viewport** — `setVisibleRange(range)` (recompute viewport studies over the visible window)
- **Persistence** — `serialize()`, `applyTemplate(studies)`, `relink()`, `toggleHidden(i)`
- **Events** — `on(event, fn)`

### Registry / authoring `[extend]`

- `Studies` — authoring facade: `register(study)`, `unregister(id)`, `priceOf`, `SOURCES`
- Functions — `registerStudy(study)`, `unregisterStudy(id)`, `getStudy(id)`, `listStudies()`, `setRegisterHook(fn)`
- Helpers — `priceOf(bar, source)`, `SOURCES` (price-source map)

### Study definition contract `[extend]`

A study author registers `{ id, name, overlay, inputs, calc(bars, params, ctx) }`, where `calc` returns render channels:

- `plots` — series (type + options + data)
- `fills` — bands between two named plots
- `shapes` — markers / labels / hlines anchored in price/time
- `markers` — glyphs on bars
- `segments` — partitioned bars
- `scale` — a pane y-range provider
- `stack` — stacked-area edges

### Shape library `[extend]`

- `registerShape(name, recipe)`, `unregisterShape(name)`, `getShape(name)`, `listShapes()`, `resolveShape(spec)`

### Primitives toolkit `[internal]`

- `timeToX`, `createBandPrimitive`, `createMarkPrimitive`, `paintMark`, `paintMarks`
