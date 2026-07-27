---
layout: ../../layouts/DocsLayout.astro
title: API reference
---

# API reference

The complete public surface, grouped by the three import points — one page each:

- **[Engine](/docs/api/engine)** — the package root (`index.js`): the chart, its plots, panes, axes, and coordinates.
- **[Skin](/docs/api/skin)** — `skin/`: optional on-chart chrome (legends, controls, config panel).
- **[Studies](/docs/api/studies)** — `studies/`: the study runtime, the registry, and the authoring contract.

Most names are the consumer API — what you call to put a chart on screen and drive it. Two tags flag the exceptions:

- `[extend]` — the author API: what you implement or register to add studies, custom plots, and tools.
- `[internal]` — exposed building blocks the higher layers use; stable-ish, but not the intended entry point for general use.
