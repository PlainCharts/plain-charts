---
layout: ../../layouts/DocsLayout.astro
title: Library structure
---

# Library structure

A map of what the library contains — the top level, plus one level into `core/` and `studies/`.

```
kapelka/
├── index.js        the engine — the public chart API and primitive host
├── index.html      landing page (forwards to examples/)
├── core/           the rendering core
│   ├── components/
│   │   ├── js/              the ported render, layout, and axis core
│   │   ├── primitives/      the ported canvas draw classes
│   │   ├── renderers/       the value-series painters (line, area, candle, hbar, …)
│   │   ├── input.js         native mouse and touch input
│   │   └── primitives-host.js   the series-attached primitive host
│   ├── stuff/              math, geometry, and canvas utilities
│   ├── series.js           the Series data model (feed, options, price-lines, markers)
│   ├── overlay-scales.js   independent, region-confined price scales
│   ├── enums.js            public enums and series type tags
│   ├── build_layout.js     the componentless layout pipeline
│   ├── theme.js            theme resolvers
│   ├── events.js           crosshair and click event emission
│   └── yscale.js           Y-scale helpers
├── studies/        the study system
│   ├── host.js             StudyHost — drives every study
│   ├── registry.js         the study registry (the plug socket)
│   ├── shape-lib.js        named shape recipes ($param / =expr)
│   ├── primitives/         the ether (marks), plus band and geometry
│   └── modules/            a gallery of example indicators
├── skin/           optional chrome — legend, controls, config window
└── examples/       runnable demos
```
