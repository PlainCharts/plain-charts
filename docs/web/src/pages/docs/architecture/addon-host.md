---
layout: ../../../layouts/DocsLayout.astro
title: The addon host
---

# The addon host

A hidden process runs the background half of your addons, and hosts the bridge an AI uses to drive the app.

## Where it sits

It is one of the app's hidden background processes — no window, no screen — alongside the ones that hold the broker connections, the order logic, and the alerts.

```
hidden processes
  data host     the broker connections
  order host    the order logic
  alert host    the alerts
  addon host    your addons' background code + the AI bridge   ← this page
```

## Two places an addon runs

An addon can have two parts, and they run in different places.

```
  the part that DRAWS                   the part that WORKS
  ───────────────────                   ────────────────────
  runs in a chart window                runs here, in the hidden host
  reads and paints the chart            reaches files, network, programs
  sees the broker feed                  sees the broker feed
  can't touch the machine               has no chart to draw on
```

A panel or an on-chart line is the drawing part. A bot or a data bridge is the background part. One addon may have both. They share the same broker feed and the same disk. (In code these are two entry points — see [the Addons section](/docs/addons/overview).)

## What the background part can reach

No screen, but no fence either. The background part gets:

- **The live broker feed** — symbols, quotes, bars, depth, the trade stream, and order routing — over the one shared connection.
- **The whole machine** — files, network sockets, servers, other programs — with no sandbox.

So it is where work that needs the machine, not the screen, lives: a bridge streaming the feed to another program, a recorder writing every tick to disk, a bot trading its own rules.

## Isolation

It is a separate process, so an addon that crashes or hangs is logged and stepped over. The broker connections and the charts keep running.

It is also the safest place to send an order from. An order sent here never waits on the screen — nothing has to be drawn or finished first. The addon hands it straight to the broker (see [Execution architecture](/docs/architecture/execution-architecture)).

## The AI bridge

The same process opens a local door that an outside AI tool — Claude Code, Cursor — uses to drive the app (an MCP server on `127.0.0.1:8788`).

- Every action passes a **permission gate you set** — off by default.
- A blocked action returns a clean refusal, never a way around it.

The contrast is the point: an addon you install is trusted and gets everything. The AI gets only what you allow.

## Loading and management

Addons are folders you drop in `addons/`. Enabling or disabling one in the Addons panel starts or stops it to match — no build step, no wiring.

How to write one lives in [the Addons section](/docs/addons/overview).
