---
layout: ../../../layouts/DocsLayout.astro
title: The object tree
---

# The object tree

The symbol's filing system for drawings, kept separate from the drawings themselves.

## Four tiers

Drawings pile up: trend lines, fibs, rectangles, notes. The tree sorts them.

```
FILE  (a symbol)
 └─ LAYER      a working surface — tabs down the left edge
     └─ FOLDER named groups, nestable
         └─ OBJECT  one drawing
```

Every tier — layer, folder, drawing — carries its own hidden and locked flag.

## Keyed to the symbol

The tree belongs to the symbol, not the chart pane.

Organize on one chart of a symbol, and the same tree shows on every chart of it. A layout can hold several symbols at once, so keying the tree to the symbol gives each one a single, findable place for its work.

## The tree holds references, not drawings

The drawings live in the drawing engine. The tree holds only their ids.

Drop a drawing in a folder, or move it to another layer, and the drawing never changes. You re-parent a reference. Organizing is cheap and lossless — shape, points, style, and stacking all stay put.

## Hide and lock by own flag

This is the core decision. A drawing is hidden if it, a parent folder, or its layer is hidden. A logical OR up the ancestry. Same for locked.

A container's flag is never written onto its contents.

```
folder hidden   → everything inside is hidden      (the container wins)
folder visible  → each drawing's own flag decides  (your hidden ones stay hidden)
```

Hide a folder and you flip one flag. Show it again and everything returns exactly as you left it — the two lines you hid by hand stay hidden, the rest reappear.

The alternative — cascade — writes `hidden = true` onto all N drawings. That is N writes, and it clobbers each drawing's own state. Un-hiding then reveals everything, including the ones you had hidden yourself. Own-flag inheritance is one flip, and it loses nothing.

## A folder is a mini-layer

Because hiding loses nothing, a folder is a set you can put away and bring back untouched.

Draw a setup, hide a couple of its lines, collapse the folder. Show it later and it is identical — every flag, style, and point as it was. Layer-like behavior at the folder tier, out of the same rule.

## Layers

Layers are the top tier — whole surfaces you switch as tabs down the left edge.

One layer is active. New drawings land there. Keep your key levels on one layer and a scenario sketch on another. Turn one off, draw the alternative on a second, overlap them to compare — without leaving the chart.

Layers are purely organizational. They do not change stacking. Z-order stays a per-drawing property within a layer.

- A layer answers *which set am I looking at, and where do new drawings go.*
- Z-order answers *what is in front.*

Two concerns, kept apart, so neither grows complicated.

## What layers don't touch

Layers are for drawings only.

Indicators are a separate system with their own order and visibility. They sit in the tree under their own heading, with plain folders and no layers. Sub-charts — a compare symbol, an oscillator's surface — also get folders but no layers. Each is its own small space.
