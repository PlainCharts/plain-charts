---
layout: ../../../layouts/DocsLayout.astro
title: Skin API
---

# Skin

Imported from `skin/`. Optional on-chart chrome (legends, controls, config panel) layered on a chart + study host.

### Entry

- `createSkin(host, opts)` → skin — attaches the default set of chrome to a StudyHost/chart. This is the skin root's only export, and the one you normally call.

### Pieces `[extend]`

Exported from their individual skin modules (not the skin root), for assembling chrome by hand:

- Legends — `attachPriceLegend(skin)`, `attachStudyLegend(skin)`, `attachOverlayLegend(skin)`
- Chrome — `attachControls(skin)`, `attachConfig(skin)`

### Utilities `[internal]`

- `paneGeom(chart, series)`, `scaleWidth(chart)`, `chromeVisible(host, a)`, `studyLabel(a, opts)`, `ensureStyles()`
