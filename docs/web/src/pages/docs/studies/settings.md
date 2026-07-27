---
layout: ../../../layouts/DocsLayout.astro
title: Settings
---

# Settings

Declare an `inputs` array; the dialog builds itself.

A study declares its settings as the `inputs: [...]` array inside `Studies.register({...})` — no hand-written HTML per study. Every capability here is opt-in, so a plain `inputs` list keeps working.

```js
Studies.register({
  id: 'my_study', name: 'My Study', overlay: true,
  inputs: [ /* ...input objects... */ ],
  calc(bars, p, ctx) { /* read p[key]; return { plots, fills, shapes, scale } */ },
});
```

`p` is the flat map of the user's current values, keyed by each input's `key`.

<hr>

## The input object

Every entry is a plain object. Required: `key` (unique — also the `p[key]` param) and `type`. `name` is the visible label.

### Control types

| type | control | value | notable fields |
|---|---|---|---|
| `number` (default) | number box | number | `min`, `max`, `step` |
| `bool` | checkbox | boolean | — |
| `select` | dropdown | option `key` | `options: [{key,name}]` |
| `source` | price-source dropdown | `'close'`/`'open'`/`'hl2'`/`'hlc3'`/`'ohlc4'` | read with `Studies.priceOf(bar, p.src)` |
| `text` | text box | string | `placeholder` |
| `color` | colour swatch (opacity → rgba) | colour string | with a `stroke` / `text` binding it becomes a combined picker (below) |
| `stroke` | colour + width + style swatch | object `{color, width, style}` | one object param, not three |
| `range` | slider | number | `min`, `max`, `step` |
| `tz` | UTC-offset stepper `[-] hours [+]` | number (hours east of UTC; 0 = UTC) | read in `calc` as `p[key] * 3600` seconds |
| `level` | guide-line row `[x] Name [value] [stroke]` | object `{value, show, color, width, style}` | the study renders it as an hline |

`style` in strokes is `'solid'` / `'dotted'` / `'dashed'`.

### Layout and behaviour fields (all opt-in)

| field | effect |
|---|---|
| `name` | the label — or a function `(p) => string` for a live label. Re-resolved on tab/panel render. |
| `tab: 'Name'` | put the input on a tab. Tabs appear in first-declared order. Inputs with no `tab` fall under a default "Inputs" tab. |
| `group: 'Header'` | a section header within a tab (rendered when the group value changes) |
| `hidden: true` | static — not rendered as its own row. For `right` siblings and stroke sibling keys. Not for conditional hiding — use `showWhen`. |
| `inline: 'id'` | controls sharing this id render on one flex row, each a labeled cell; wraps if narrow. Any control types. |
| `noLabel: true` | suppress an inline cell's label (control only) |
| `label: 'Text'` | override an inline cell's label (defaults to `name`) |
| `width: 96` or `'6rem'` | size a single control (select / number / text) |
| `right: 'key'` or `['k1','k2']` | on a bool host only: render sibling control(s) inline and unlabeled. Siblings must be `hidden: true`. |
| `showWhen: cond` | hide the row/cell live when the condition is false |
| `enableWhen: cond` | grey out + disable the row/cell live when the condition is false |
| `showDuration: true` | on a number input, show a live `= 1h 30m` read-out (bar-count → wall-clock on the current TF) |
| `legend: true` | (number inputs) surface this value in the study legend after the name (`MA 9`). Off by default; never applies to `hidden` inputs. |

### Conditions (`showWhen` / `enableWhen`)

```
'someKey'              → truthy value of another input
{ key, value }         → params[key] === value
{ key, in: [...] }     → [...].includes(params[key])
(params) => boolean    → full predicate over the current param map
```

They re-evaluate on every change and toggle display / disabled without rebuilding the DOM, so focus and scroll survive. They work at row level and per inline cell.

<hr>

## Combined swatches

A `color` input can fold sibling params into one picker, so "Border" or "Label" is a single control instead of several rows:

- `stroke: { width: 'wKey', lineStyle: 'sKey' }` → a stroke swatch (colour + width + line style, live line preview).
- `text: { size: 'szKey', bold: 'bKey', italic: 'iKey' }` → a text swatch (colour + size + bold + italic, live "Text" preview).

The named siblings are separate inputs you also declare, each `hidden: true` — the swatch edits them, and they stay real params you read in `calc`. (Unlike `type: 'stroke'`, one object param, the `stroke:` / `text:` bindings keep the colour and each extra as their own flat params.)

```js
{ key: 'label', type: 'color', name: 'Label', default: '#9c27b0',
  text: { size: 'lsize', bold: 'lbold', italic: 'litalic' } },
{ key: 'lsize',   type: 'number', default: 12,    hidden: true },
{ key: 'lbold',   type: 'bool',   default: false, hidden: true },
{ key: 'litalic', type: 'bool',   default: false, hidden: true },
// calc reads p.label (colour), p.lsize, p.lbold, p.litalic
```

<hr>

## `inline` vs `right`

- **`inline: 'id'`** — the general primitive. Multiple labeled controls on one row, any types, wraps. The default choice.
- **`right`** — the compact helper. Unlabeled siblings hosted by a bool. Use only for a checkbox followed by bare controls (a dense "MA #1 [SMA▾][Close▾][20][■]" row).

<hr>

## Escape hatch: `settingsView`

For a truly bespoke dialog, a study may declare a function instead of (or beside) `inputs`:

```js
Studies.register({
  id: 'x', name: 'X', overlay: true,
  settingsView({ pane, index, container, params, setParam, rerender }) {
    // full control of the dialog BODY; you still get the shell (header, drag, Defaults, Close).
    // params() = live map · setParam(key, value) = update + recompute live · rerender() = rebuild body.
    container.appendChild(/* your DOM */);
  },
  calc(bars, p, ctx) { /* ... */ },
});
```

Reach for this only when the declarative fields can't express the layout — almost no study needs it.

<hr>

## Per-study dialog CSS

The dialog element gets the class `std-<id>` (e.g. `std-ma_ribbon`), so a study can size or tweak only its own dialog in `index.html`:

```css
.dialog.std-dlg.std-ma_ribbon { width: 480px; }                       /* wider dialog */
.dialog.std-dlg.std-ma_ribbon .set-controls select { width: 100px; }  /* tighter dropdowns */
```

Defaults are 132px select / 70px number; the more specific `.dialog.std-dlg.std-<id>` selector beats them.

<hr>

## Worked examples

A plain study (rows):

```js
inputs: [
  { key: 'len', type: 'number', name: 'Length', default: 20, min: 1 },
  { key: 'src', type: 'source', name: 'Source', default: 'close' },
  { key: 'line', type: 'stroke', name: 'Line', default: { color: '#2962ff', width: 2, style: 'solid' } },
]
```

Combined swatches + inline rows + conditional grey-out:

```js
inputs: [
  // Row: Display | Border | Bkgnd. Border is a stroke swatch, greyed for the 'Bands' display type;
  // the bg swatch greys when Bkgnd is off.
  { key: 'viz', type: 'select', name: 'Display', options: VIZ, default: 'T & B', inline: 'col' },
  { key: 'border', type: 'color', name: 'Border', default: '#9c27b0', inline: 'col',
    enableWhen: (p) => p.viz !== 'Bands', stroke: { width: 'bwidth', lineStyle: 'bstyle' } },
  { key: 'showbg', type: 'bool', name: 'Bkgnd', default: true, inline: 'col' },
  { key: 'bg', type: 'color', name: '', noLabel: true, default: 'rgba(156,39,176,0.15)',
    inline: 'col', enableWhen: 'showbg' },
  { key: 'bstyle', type: 'select', options: STYLES, default: 'solid', hidden: true },
  { key: 'bwidth', type: 'number', default: 2, hidden: true },
]
```

Tabs + a live toggle label:

```js
inputs: [
  { key: 'en1', type: 'bool', default: true, tab: 'Quick',
    name: (p) => (p.name1 ? `Session 1: ${p.name1}` : 'Session 1') },   // live label
  { key: 'days', type: 'number', name: 'Days to show', default: 3, tab: 'Display' },
  { key: 'name1', type: 'text', name: 'Session name', default: 'London', tab: 'S1' },
  // tabs render in first-seen order: Quick, Display, S1, ...
]
```

Compact unlabeled row:

```js
inputs: [
  { key: 'show1', type: 'bool', name: 'MA #1', default: true, right: ['type1','source1','length1','line1'] },
  { key: 'type1',   type: 'select', name: 'Type',   options: MA_TYPES, default: 'SMA', hidden: true },
  { key: 'source1', type: 'source', name: 'Source', default: 'close', hidden: true },
  { key: 'length1', type: 'number', name: 'Length', default: 20, min: 1, hidden: true },
  { key: 'line1',   type: 'stroke', name: 'Line', default: { color: '#f6c309', width: 2, style: 'solid' }, hidden: true },
]  // → "☑ MA #1  [SMA▾] [Close▾] [20] [■]" — one dense row, no per-control labels
```

<hr>

## Things that bite

- **`hidden` is static, not conditional.** To hide a row based on another input, use `showWhen`; `hidden` only means "don't render as its own row" — its value still lives in `p`.
- **`inline` members must not be `hidden`** (they render as cells); **`right` siblings must be `hidden`** (the bool host pulls them in). Reverse it and controls go missing or double up.
- **First-tab gotcha:** if some inputs have no `tab`, a stray "Inputs" tab appears first. Give every input a `tab`, and declare the intended first tab's inputs first.
- **`stroke` value is an object** `{color, width, style}`. Migrating an old plain colour: `v => (typeof v === 'string' ? { color: v } : (v || {}))`.
- **Combined-swatch siblings must be their own `hidden: true` inputs**, or they render as stray rows and the swatch has nothing to write to.

<hr>

## Source and examples

`src/studies/settings.js` generates the settings dialog. Per-study CSS lives in `index.html` (search `.set-inline`, `.std-dlg`).

Mirror: `session_marker.js` (tabs + inline + conditionals), `ma_ribbon.js` (dense `right` rows), `vwap.js` (stroke pickers + optional fills).
