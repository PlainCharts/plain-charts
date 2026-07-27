---
layout: ../../layouts/DocsLayout.astro
title: The ether
---

# The ether

The interesting thing about kapelka's drawing model isn't any shape it offers — it's how shapes exist at all.

<figure class="demo">
  <iframe src="/demos/momentum-terrain.html" title="Momentum Terrain — the ether" loading="lazy"></iframe>
  <figcaption>A pseudo-3D momentum surface — every quad is a path of vertices; there is no "surface" type. Drag the candles and it re-derives over the visible window. Drag the pane divider to expand it.</figcaption>
</figure>

## Levels of abstraction

**Level 1** is imperative: you think in a fixed vocabulary of shapes and coordinates. You create a line or a box, place it, and to change it you mutate it or delete and redraw. The scene is the running total of your commands, and it's destructive — once drawn, the pixels are pixels.

**Level 2** is declarative, but from a catalog. A shape becomes data-fed and non-destructive: you declare something like `{ type: 'SegmentedBar', fill: 0.75, data }` and the primitive manifests itself from the data — change the data and it re-expresses, never redrawn. The catch is the vocabulary: it's declarative for the shapes it ships and closed to the ones you'd add. A new shape means editing the library. The thinking is *data → a known shape*.

## Data to space modeling

Underneath both is a shift in what you're doing. You're not drawing in space — you're modeling space with data. The space is pure environment, no objects in it yet. A declarative object exists in a primordial state: no position, size, or color until data touches it. The dataset is its DNA, defining how it manifests. Space + object + dataset = manifestation — you describe what exists, and the space resolves the how.

## React's model

This is React's model: *data → description → manifestation* (`state → component → DOM`). You never touch the DOM; you declare what a component is given data, and when the data changes it re-renders. But "true React" takes two things — a declarative flow (the scene is a function of the data) **and** an open, data-defined vocabulary: you can declare *any* form as data, not pick from a catalog and not drop to raw canvas.

## Level 3

That second requirement is Level 3: declarative custom geometry. There's no fixed vocabulary at all. You don't pick from shapes or primitives — you describe the object's nature as a dataset (its geometry, its boundaries, its fill) and a renderer manifests whatever that data describes. The shift is from *pick from our catalog* to *define your own forms as data*. This is where the ether lives.

## Path and text

The engine knows exactly two marks: an anchored **path** and **text**. That's the whole vocabulary. There is no `box`, `diamond`, `ring`, or `callout` primitive anywhere in the library — the engine has never heard of them.

A path is just its vertices. Three make a triangle, four a box, points around a circle a ring, points along a sweep an arc. A diamond isn't a type you select; it's four points you write:

```js
{ marks: [{ closed: true, fill: '#4dd0e1', path: [
  { t, p, dy: -6 }, { t, p, dx: 6 }, { t, p, dy: 6 }, { t, p, dx: -6 },
] }] }
```

That diamond lives only in your study's file. To put a new shape on screen before, you'd open the library, add an `else if (type === 'diamond') { …canvas… }`, and ship a new version. Here you write the vertices and it renders — the engine still knows only `path` and `text`. You didn't get a bigger catalog; you got two marks to compose anything from.

The other mark is **text** — a string anchored to the same coordinates, so a label rides the chart exactly like a path does.

## Anchored in the chart

Every vertex names where it lives in the chart's own space, and it can mix a data anchor with a pixel offset. Per axis:

- `t` — time → x (and it extrapolates into the whitespace past the last bar)
- `p` — price → y
- `vpx` / `vp` — a viewport fraction (0–1) of the pane's width / height — pin to an edge instead of to data
- `dx` / `dy` — a pixel nudge, for the parts that shouldn't scale (an arrowhead, a callout body, an inset)

The mix is the whole point. A callout can put its tip at a bar's price (`{ t, p }`) and hold its body a fixed number of pixels away (`{ t, p, dx, dy }`) — the tip tracks the data through pan and zoom while the body stays a constant size. Because the anchors are `t`/`p`, a shape scales and moves with the chart; because a vertex can also take `vpx`/`vp`, a shape can stay pinned to the pane — a corner label, a legend — while everything scrolls beneath it.

That extra handle — a viewport/pixel coordinate alongside time and price — is what a time×price model can't express. It's how a fixed-size projection stays put while you pan, and how a third dimension can be projected down into pixel offsets: the chart has two data axes, and the ether gives every vertex a third place to stand.

## One substance, one renderer

There's a single renderer beneath everything drawn. `paintMark` and `paintMarks` are stateless: a canvas context plus a coordinate scope (`{ timeToX, priceToY, width, height }`) go in, marks come out as pixels. Give it the scope of any pane and it paints there; it holds no state of its own.

Studies render their marks through it — and so do the drawing tools. A trendline you draw and an exhaustion box a study emits are the same substance underneath, resolved the same way every frame. There's no separate "annotations" path and "tools" path; there's one.

The same geometry serves interaction. `resolveVertex` — the function that turns a vertex into a pixel — is exported, so a tool can hit-test itself from the very marks it draws: its clickable shape *is* its drawn shape. Author the geometry once and it's both what you see and what you click, so a tool becomes a pure recipe with no separate hit-test code. (Where a hit area genuinely differs from the drawing — a thin line you still want easy to grab — a tool can keep its own test.)

## Immediate-mode, not managed

A study's `calc()` is a pure function: data in, a description out — an array of marks. It holds no object identities, no handles, no lifecycle. Where a retained-mode model has you create an object, mutate it, and delete it by hand — maintaining the scene bar by bar, under object caps — the ether keeps none of that. The engine takes the returned marks and re-derives the whole picture every recompute.

That's what makes it feel alive. A shape that morphs as you scroll isn't being repainted — it's the same function re-run over a new visible window. Nothing is being maintained, so nothing can fall out of sync; the picture is simply a function of the data at that moment.

The trade is deliberate. Immediate-mode has no identity, so nothing transitions: as the data changes, a shape snaps to its new state rather than gliding to it. Smooth morphing would mean giving marks stable keys and interpolating between frames — a small reconciler with retained state. That's worth paying inside a single study where the motion earns its keep, but the engine doesn't impose it everywhere: the default is stateless and honest, and animation is something a study opts into, not a tax the whole engine carries.

## The catalog is sugar

None of this retires the familiar shapes. A `box`, `vline`, `hline`, `band`, or `label` still works — it's just **sugar** that expands to marks before it's drawn (`shapesToMarks`). The catalog is a convenience on top of the substance, not a limit beneath it: reach for a named shape when it fits, drop to vertices when it doesn't.

You can name your own, too. A shape can be a recipe — `{ shape: 'name', ...params }` — registered once and reused. A recipe is either a small function (`params → marks`) or a pure-data template: marks with `$param` slots, so it's shareable as plain JSON. Templates bind values with `"$name"` and evaluate `"=expr"` — arithmetic, comparisons, `&&`/`||`, a ternary like `"=$up ? '#26a69a' : '#ef5350'"` — through a tiny cached parser, with no `eval` and no `Function`.

So a menu is just a folder of recipes. Pick one when one fits; write vertices when none does; drop a new recipe in the folder, or share a pack of them. The catalog is optional because the substance underneath is the base — paths and text, all the way down.
