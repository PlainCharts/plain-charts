---
layout: ../../layouts/DocsLayout.astro
title: Getting started
---

# Getting started

kapelka is zero-dependency ES modules with no build step — the browser runs the files directly. Put them next to your page and import.

## A chart in one file

```html
<!DOCTYPE html>
<html>
<body>
  <div id="chart" style="height: 400px"></div>
  <script type="module">
    import { mountChart, Candles } from './index.js';

    const chart = mountChart(document.getElementById('chart'), {
      layout: { background: { color: '#ffffff' }, textColor: '#333' },
      timeAxis: { indexBased: true },
    });

    const bars = [
      { time: 1704067200, open: 100, high: 105, low: 98,  close: 103 },
      { time: 1704070800, open: 103, high: 108, low: 102, close: 107 },
      { time: 1704074400, open: 107, high: 109, low: 104, close: 105 },
      // …more bars…
    ];

    const candles = chart.addPlot(Candles, {}, 0);
    candles.feed(bars);
  </script>
</body>
</html>
```

Open the file in a browser — no bundler, no install. `mountChart` puts a chart in the div, `addPlot` adds a candle series, `feed` gives it data (times in **seconds**). That's a working chart:

<figure class="demo short">
  <iframe src="/demos/first-chart.html" title="Your first chart" loading="lazy"></iframe>
  <figcaption>A candle series on a mounted chart — the whole of the snippet above.</figcaption>
</figure>

## Stream updates

Once it's on screen, feed it live one bar at a time:

```js
candles.feedBar({ time: 1704078000, open: 105, high: 106, low: 103, close: 104 });
```

The same time as the last bar updates it (the forming bar); a newer time appends a new one. See [Streaming and performance](/docs/streaming-and-performance).

## Add an indicator

Studies run on top through `StudyHost`:

```js
import { StudyHost } from './studies/index.js';
import './studies/modules/index.js';   // registers the gallery (rsi, bollinger, volume_profile, …)

const host = new StudyHost(chart, { getBars: () => bars, mainSeries: () => candles });
host.setData(bars);
host.add('rsi', { length: 14 });        // claims its own pane, computes from the bars
```

See [Studies](/docs/studies) to write your own.

## Where to next

- [The ether](/docs/the-ether) — how shapes exist as data
- [Your own environment](/docs/your-own-environment) — both axes are yours
- [Panes and coordinates](/docs/panes-and-coordinates) — the pane and coordinate model
- [Series](/docs/series) and [Studies](/docs/studies) — the building blocks
- [API reference](/docs/api) — the full surface
