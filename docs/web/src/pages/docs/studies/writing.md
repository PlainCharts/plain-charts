---
layout: ../../../layouts/DocsLayout.astro
title: Writing a study
---

# Writing a study

A study is one JavaScript file in `packages/studies/`, and the app draws it.

The app discovers the file and loads it at runtime — no build step, no imports, no core files touched. It computes and draws through the engine's study capability (kapelka); the module, its modularity, and its settings are the app's layer.

<hr>

## The shape of a study

One file, one `Studies.register(...)` call. `Studies` is a global — no imports.

```js
Studies.register({
  id: 'my_study',    // unique, STABLE — it keys the study on the user's charts
  name: 'My Study',
  overlay: true,     // true = draw on the price pane · false = its own sub-pane
  inputs: [ /* settings — see Settings */ ],
  calc(bars, p, ctx) {
    // ... plain JS ...
    return { plots, fills, shapes, scale };   // what to draw (not how)
  },
});
```

Two optional flags widen what `calc` sees: `viewport: true` recomputes against only the on-screen bars (`ctx.visibleRange`); `intrabar: true` exposes lower-timeframe sub-bars in `ctx.intrabar`.

<hr>

## The calc contract

`calc(bars, p, ctx)` is a pure function of the bars. It returns a description of what to draw and never touches the canvas.

- **`bars`** — `[{ time, open, high, low, close, volume }]`, ascending. `time` is in seconds; every point you emit reuses those second values.
- **`p`** — the user's input values, keyed by each input's `key` (`p.length`, `p.source`…).
- **`ctx`** — `decimals`, chart `candle` colours, `intrabar` sub-bars, `visibleRange`, `self` (a persistent per-instance bag), `requestFrames` (a per-frame loop).

Read a price source input with `Studies.priceOf(bar, key)` — it resolves `close` / `open` / `hl2` / `hlc3` / `ohlc4` — rather than reaching into `bar.close` yourself.

`calc` returns render channels: `plots` (line-ish series), `fills` (bands between two plots), `shapes` (boxes, guide lines, labels), and `scale` (bounds for an oscillator). All optional, but emit at least `plots` or `shapes`. The full vocabulary is in [Drawing and context](/docs/studies/drawing).

<hr>

## A worked example — SMA

```js
Studies.register({
  id: 'sma_demo', name: 'SMA', overlay: true,
  inputs: [
    { key: 'len', name: 'Length', type: 'number', default: 20, min: 1 },
    { key: 'src', name: 'Source', type: 'source', default: 'close' },
    { key: 'line', name: 'Line', type: 'stroke', default: { color: '#e0a030', width: 2, style: 'solid' } },
  ],
  calc(bars, p) {
    const L = Math.max(1, p.len | 0), out = []; let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      const v = Studies.priceOf(bars[i], p.src); sum += v;
      if (i >= L) sum -= Studies.priceOf(bars[i - L], p.src);
      if (i >= L - 1) out.push({ time: bars[i].time, value: sum / L });   // after warm-up
    }
    const s = (typeof p.line === 'string') ? { color: p.line } : (p.line || {});
    return { plots: [{ key: 'ma', name: 'SMA', type: 'line', data: out,
      color: s.color, lineWidth: s.width, lineStyle: s.style }] };
  },
});
```

<hr>

## Things that bite

- **`Studies` is a global — never `import` it.** Helpers go inline at the top of the file.
- **`id` must be unique and stable.** It keys the study on saved charts; renaming it orphans them.
- **`time` is seconds** — for the bars and for every point you emit.
- **Warm up first.** Emit points only once the window is full (`i >= length - 1`), or the leading values are garbage.
- **`overlay: false`** gives the study its own sub-pane — use `scale` to bound its range.

<hr>

## Source and examples

The study API is `lib/kapelka/studies/registry.js` (`Studies.register`); `lib/kapelka/studies/host.js` runs `calc` and paints the result. Modules live in `packages/studies/`.

Worth reading: `vwap.js` (source + stroke + fills, day-window), `ma_ribbon.js` (many MA types, dense settings), `session_marker.js` (tabs + shapes), and the `volume*.js` family (overlay bands, intrabar).
