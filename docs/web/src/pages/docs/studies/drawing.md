---
layout: ../../../layouts/DocsLayout.astro
title: Drawing and context
---

# Drawing and context

The full vocabulary of each render channel, and the `ctx` the engine hands you.

`calc` returns `{ plots, fills, shapes, scale }` — a description of what to draw. For the register/`calc` frame, see [Writing a study](/docs/studies/writing).

<hr>

## `plots` — series

Common fields: `key` (unique in the study), `name` (legend), `type`, `data`, and style (`color`, `lineWidth`, `lineStyle`, `precision`). Style values are defaults — the user can restyle any plot, so set sensible ones and don't assume they stick.

- `lineStyle` — `0..4`, or `'solid' | 'dotted' | 'dashed'`.
- `legend: false` — keep the plot out of the legend read-out (common for volume, bands).
- `precision: 0` — decimals for the legend and axis value.

The point shape in `data` depends on `type`:

```
line | area | baseline    data: [{ time, value }]
histogram                 data: [{ time, value, color? }]        // per-bar colour (volume up/down)
segmented                 data: [{ time, value, segments, wicks?, lines? }]   // partitioned bar
hbar                      data: [{ price, value, color? }]        // horizontal bar keyed by PRICE (volume profile)
```

### The segmented point

A partitioned bar — up/down volume, volume delta:

```js
{
  time, value,                                   // value drives the legend read-out
  segments: [ { from, to, color,                 // a FILLED partition from price `from` → `to`
                fill?, lineWidth?, width? } ],    //   fill:false → hollow outline · width: 0..1 of the bar
  wicks:    [ { from, to, color, width } ],       // thin centred vertical stem(s)
  lines:    [ { level, color, width,             // a bar-width horizontal delineation at `level`
                span?, lineStyle? } ],            //   span: 0..1 narrows it to a layer
}
```

`from` / `to` / `level` are prices on the plot's scale. Zero-anchor a delta bar via an overlay band (below), or the baseline fights the price auto-fit.

### Overlay band

Pin a plot to a sub-region of the price pane — its own invisible scale, auto-fit over just that plot, confined to `[top·H .. (1−bottom)·H]`:

```js
{ key, name, type, data, priceScaleId: 'myband', scaleMargins: { top, bottom } }   // 0..1
```

Volume uses `top: 1 − height%, bottom: 0` to occupy the lower band. Any study can do this — it's the general overlay-scale capability, not volume-only.

<hr>

## `fills` — a shaded band between two plots

```js
fills: [ { top: 'plotKeyA', bottom: 'plotKeyB', color, gradient? } ]
```

Names two existing plot keys; the host paints the polygon between them (a Bollinger envelope, VWAP bands).

<hr>

## `shapes` — declarative marks

Session boxes, guide lines, text, custom geometry. Two forms: named shapes (convenience) and raw `marks` (open geometry). Named shapes are sugar that expands to marks:

```js
{ type: 'band',  from, to, color }                                              // full-height vertical shade
{ type: 'box',   from, to, top, bottom, color, borderColor, borderWidth, lineStyle, label? }
{ type: 'vline', time, color, width, lineStyle, label? }
{ type: 'hline', price, color, width, lineStyle, label? }                        // FULL width
{ type: 'label', time, price, text, color, hAlign, vAlign, size, bold?, italic? }  // or { y } for a pixel offset
```

- `box.to = null` opens the box to the right edge. `band` / `box` fill with `color`; `borderColor` strokes.
- `hline` spans the whole pane; a time-scoped horizontal line needs a raw `marks` path.

### Raw `marks` — the open geometry

A shape can be `{ marks: [ …mark… ] }`, each mark a path or text. Vertices anchor in chart space:

```
t   → x   time (unix SECONDS) — scales/scrolls with the chart, extrapolates into future whitespace
p   → y   price (the pane's price scale)
vpx → x   viewport fraction 0..1 of pane WIDTH   (pin to a left/right edge)
vp  → y   viewport fraction 0..1 of pane HEIGHT  (pin to a top/bottom edge)
dx, dy    pixel offsets — non-scaling (arrowheads, callout insets, label nudges)
```

```js
{ path: [ { t, p }, { t, p } ], stroke, width, dash, closed?, fill?, back? }   // dash: 'solid'|'dashed'|'dotted'|[..]
{ text, at: { t, p, dx?, dy? }, color, align, baseline, size, font, rotate, bold?, italic? }  // \n = multiline
```

- `bold` / `italic` compose into the font, for both raw text marks and the `label` shape.
- Multi-line text stacks on the anchor's side by `baseline`: `'bottom'` grows the block up, `'middle'` centres, `'top'` grows down.
- `back: true` paints the mark behind the candles; the rest paint in front.
- Mix `t/p` (scaling) with `dx/dy` (fixed) freely on one vertex — a callout is a `path` tip plus a `text` at a pixel-offset anchor; a session-high line is a two-point `[{t:from,p:hi},{t:to,p:hi}]` path.

<hr>

## `scale` — bound an oscillator's range

For a sub-pane study, shape its auto-fit:

```js
scale: (hi, lo) => [hi, lo]        // full control of the range
scale: { min, max }                // expand-only: always spans at least [min,max] (spikes still show)
scale: { min, max, hard: true }    // clamp exactly to [min,max]  (e.g. %R: { min:-100, max:0 })
```

<hr>

## `ctx`

| field | what | needs |
|---|---|---|
| `ctx.decimals` | price decimals of the instrument | — |
| `ctx.candle` | `{ up, down }` chart candle colours (match "use chart colours") | — |
| `ctx.intrabar` | array aligned to `bars` — each bar's lower-timeframe sub-bars `[{ open, high, low, close, volume }]` (empty for the forming bar) | `intrabar: true` |
| `ctx.visibleRange` | `{ from, to }` (seconds) of the on-screen bars | `viewport: true` |
| `ctx.self` | per-instance persistent object; survives recomputes (hold display / target state for tweening) | — |
| `ctx.requestFrames(step)` | a per-frame loop on the chart clock — `step()` returns a shapes array (repainted each frame) or `null` to stop; call `ctx.requestFrames(null)` to cancel | — |

### Intrabar delta (CVD / volume delta)

```js
intrabar: true,
calc(bars, p, ctx) {
  const subs = ctx.intrabar || [];
  bars.forEach((b, i) => {
    const sb = subs[i];
    let up = 0, down = 0;
    if (sb && sb.length) for (const s of sb) { (s.close >= s.open ? up : down) += s.volume || 0; }
    else { /* forming bar: approximate from b.close >= b.open ? +b.volume : -b.volume */ }
    // ...emit a segmented point...
  });
}
```

### Animation (a morphing surface)

```js
const animate = p.morph !== false && ctx && ctx.self && typeof ctx.requestFrames === 'function';
if (!animate) { ctx.requestFrames && ctx.requestFrames(null); return { plots, shapes: [{ marks: render(target) }] }; }
const self = ctx.self;
if (!self.display) self.display = target.map(r => r.slice());   // first paint: snap
self.target = target;
let settled = false;
ctx.requestFrames(() => {
  if (settled) return null;                                      // null → loop stops
  // ease self.display toward self.target; set settled when close enough
  return [{ marks: render(self.display) }];                      // this frame's shapes
});
return { plots, shapes: [{ marks: render(self.display) }] };     // initial frame
```

<hr>

## Things that bite

- **`hbar` is keyed by `price`, not `time`** — `{ price, value, color? }`. Everything else is time-keyed.
- **Units don't mix on one axis of one vertex:** raw-mark `t` is seconds, `p` is price, `vp` / `vpx` are 0..1 fractions, `dx` / `dy` are pixels.
- **`ctx.intrabar[i]` can be empty** for the forming bar (the sub-bar fetch lags) — keep a fallback that approximates from the chart bar, or the live edge renders blank.
- **`requestFrames` must terminate** — `step()` returns `null` when settled, and you call `ctx.requestFrames(null)` when animation is off, or you leak a per-frame loop.

<hr>

## Source and examples

Point rendering lives in `lib/kapelka/index.js`; named shapes expand to marks in `lib/kapelka/studies/channels.js`; the marks renderer is `lib/kapelka/studies/primitives/marks.js`; `ctx` is assembled in `lib/kapelka/studies/host.js`.

Mirror by recipe: `volume.js` (overlay band + per-point colour), `volume_up_down.js` and `volume_delta_candle.js` (segmented bars), `volume_cvd.js` (intrabar buy/sell split), `bollinger.js` and `vwap.js` (fills), `session_marker.js` and `time_marker.js` (shapes + raw marks), `pr_terrain.js` (viewport + `ctx.self` / `requestFrames`), `pr_trend_exhaustion.js` (locked `scale`).
