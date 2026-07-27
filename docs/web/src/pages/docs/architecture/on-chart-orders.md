---
layout: ../../../layouts/DocsLayout.astro
title: On-chart order primitives
---

# On-chart order primitives

An order drawn on the chart is a swappable picture with no logic in it — it mirrors the book and reports your gestures, nothing more.

## A swappable picture

The draggable stop, the target bead, the projected order line — each is drawn by a **primitive**: a renderer picked from a registry. The string-and-beads is one; the pill is another.

It is the same pattern as the [broker adapters](/docs/architecture/contracts): one contract, swappable renderers. The primitive draws. It holds no order logic.

## State down, gestures up

```
   the overlay ── state (down) ──▶ primitive ─▶ pixels
        ▲                             │
        └──────── gesture (up) ───────┘
                  "the user dragged to here"
```

The overlay — the layer that manages what's drawn — hands the primitive the full state, and the primitive just reflects it. A drag or click reports the gesture back; the primitive says *what happened*, the overlay decides *what it means*. Swap the primitive and the order logic is untouched, because it was never in the primitive.

## A projection, not a control

What's drawn is a projection of two things:

- **The live book** — real orders and positions, from any source: a dialog, the assistant, even the broker's own terminal. If it's on the book, it's on the chart.
- **A planning layer** — a pre-trade sketch: a projected entry, a stop and target. UI only; it never touches a broker.

The book wins. The overlay draws the live orders first and falls through to the plan only when you are flat. With a position open, only an *armed* ladder draws — an unarmed plan is hidden, because its entry is already real orders in the live layer.

## A drag requests a price

Dragging a bead does not move an order. It asks for a price.

```
drag a bead ─▶ overlay ─▶ command ─▶ order worker ─▶ broker
                                         │
       bead re-settles ◀── book updates ◀┘        rejected → snaps back
```

The command goes to the [order worker](/docs/architecture/execution-architecture), never through the chart's own code. The bead only ever mirrored the book, so a rejected order snaps it back to where the book still says it is.

That is the whole guarantee: the chart is a way to *trigger* an order and a picture of the *result*, never the thing that holds it.
