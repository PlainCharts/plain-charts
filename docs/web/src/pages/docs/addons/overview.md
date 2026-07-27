---
layout: ../../../layouts/DocsLayout.astro
title: The addon system
---

# The addon system

Your own code, running inside the app with nothing walled off.

An addon reads and draws on the live chart, consumes the broker's real-time data, and places, modifies, and cancels orders. Through Node.js it reaches the whole machine — files, sockets, HTTP servers, other processes. No sandbox, no prompts.

The point is to build on the platform without forking it:

- a bot that fires orders on its own rules
- a custom order-entry ticket
- a bridge that streams the feed to another program
- a recorder that writes every tick to disk

You deliver it as one module at `addons/<id>/index.js`, loaded off disk — no build step, no wiring into core files. Enable it and it runs.

> An addon runs with full system access. It carries the same trust as any Node program you launch yourself.

<hr>

## What an addon touches

- **The chart** — read the active pane, follow crosshair, click, range, and symbol changes, and draw on it.
- **The data stream** — resolve symbols and subscribe to quotes, bars, depth, and the trade stream over the shared broker connection.
- **Order routing** — place, modify, cancel, and flatten, and receive fill and position events live.
- **The raw feed** — every field a broker sends, before the app strips it to neutral shapes.
- **The machine** — full Node.js: files, sockets, servers, child processes, any `require`.

<hr>

## Two contexts

Capability splits across two entry points. Learn the split.

```
  ui(root, api)                         start(ctx) / stop()
  ───────────────                       ────────────────────
  runs in a CHART window                runs in the headless Node host
  ┌───────────────────────┐            ┌───────────────────────────┐
  │  api.chart  (read+draw)│            │  ctx.data  (broker stream)│
  │  api.data   (broker)   │            │  full Node: require(...)  │
  │  api.onRaw  (raw feed) │            │  fs · net · child_process │
  │  save / close / onClose│            │  (no chart here)          │
  │  (no Node here)        │            │                           │
  └───────────────────────┘            └───────────────────────────┘
```

`ui(root, api)` runs where the charts live: panels, buttons, lines on the chart. It has `api.chart`, `api.data`, and `api.onRaw`, but no Node — `require` is inert.

`start(ctx)` / `stop()` runs in a hidden Node host: automation and system integration. It has `ctx.data` and the full run of Node, but no chart.

An addon that wants both writes both. They share the same broker data and the same disk, so they coordinate naturally. Most need only one — a panel is `ui()`, a file logger is `start()`.

<hr>

## In the app

An enabled addon behaves like a built-in tool:

- an **icon** on the right rail that toggles its UI
- an optional **hotkey** to open it
- a docked **slide-out** beside the charts, or a small **popup** for quick actions
- its own **vocabulary** (`vocab.json`) merged into the app's wording
- persistent settings (`config.json`) and a slot in the Addons manager

<hr>

## On the machine

The background context is a Node-enabled renderer with no sandbox — deliberate, because an addon is trusted code you wrote or installed.

Shipped addons prove the depth: one appends the live feed to a file, another opens an HTTP server and streams the feed to an external program.

That context runs in its own hidden window. If an addon throws, the host logs the error and moves on — the broker connections and the charts are untouched.
