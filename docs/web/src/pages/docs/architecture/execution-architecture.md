---
layout: ../../../layouts/DocsLayout.astro
title: Execution architecture
---

# Execution architecture

Sending an order is a transport problem, kept off the render path and out of the surfaces entirely.

## Two problems, kept apart

Drawing a chart and sending an order are different jobs. One is pixels reacting to state; the other is an instruction reaching a broker.

Plain Charts keeps them on separate code paths that share only data. The renderer could freeze solid and an order would still go out.

## The command funnel

A surface never places an order. It sends a **semantic command** and the order worker does the rest.

```
surface:  command({ type: 'place', … })
   ── order-bus ─►  order worker   (order-host — its own process)
                    runs the logic: brackets · OCO · stop sizing · reconcile
                    ── broker-bus ─►  data-host ─► adapter ─► broker
```

- Surfaces hold **no order logic** — they send a command and mirror the book. The worker owns every rule.
- The broker verb (`placeOrder` / `modifyOrder` / `cancelOrder`) lives only in the worker's executor and the adapter — nowhere in the app.
- Two process hops, both off the render thread: window → order-host, order-host → data-host.

## On-chart beads are projections

The draggable stop, the target bead, the order string on the canvas — these are a *projection* of order and position state, not the execution path.

Their click sends the same `command()` a panel button does. If a bead fails to draw, the order still sends. Delete every bead and execution is untouched. The chart is one way to trigger an order; it is never a dependency of placing one.

## What fails independently

Each subsystem runs in its own process, so one can crash without touching the others.

```
  data-host    broker sockets + adapters
  order-host   the order worker — all order logic
  alert-host   the alert engine
  addon-host   automation addons
  app windows  charts, panels, on-chart addons
```

A renderer crash can't reach an order already sent. The worker keeps its book, the data host keeps streaming, and orders keep flowing whether or not any chart is alive.

## The honest boundary

A command is *dispatched* from the window that sends it, on that window's thread — so a hard render hang can delay the send (never the order once it's away).

For execution that needs no canvas — a rules engine, an auto-bracket — put it in an addon in the addon host. It runs in a separate process, fully clear of the render thread. The remaining render-thread cost is covered in [Competition for resources](/docs/architecture/competition-for-resources).

## Sent means sent

A command never times out. An order, once sent, can't be recalled, so the worker always answers — the broker's ack or reject, or the handler's own error.

A slow ack journals a warning to the Console and keeps waiting; it never rejects and crashes the sender. A genuinely dead worker shows up as those warnings repeating — the fix is a restart, not a thrown error the sender can do nothing with.

See [The data host](/docs/architecture/data-host) for the socket side of the same path.
