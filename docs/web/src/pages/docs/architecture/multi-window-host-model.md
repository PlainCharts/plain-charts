---
layout: ../../../layouts/DocsLayout.astro
title: The multi-window host model
---

# The multi-window host model

Traders run many windows; the engine runs once, headless, and every window is a thin view of it.

## Why not an engine per window

Multi-monitor is the base case. A trading station is two screens minimum, four or more is normal — never one.

Give each window its own engine and six windows mean six broker sockets, six order books, six alert engines. You get inconsistent books, duplicate orders, connection-limit rejections, and races between windows fighting over one account.

So the host model isn't just cheaper — it's the only correct one. Every screen must show the same truth: one position, one working-orders list, one connection.

## The shape

The engine runs in headless host windows. Chart windows subscribe.

```
  headless hosts (the engine)          chart windows (thin views)
  ┌─────────────┐
  │ data-host   │  broker sockets, adapters, stores  ◄── w1  (chart)
  │ order-host  │  order worker                      ◄── w2  (chart)
  │ alert-host  │  alert engine                      ◄── w3  (chart)
  │ addon-host  │  addons + MCP                       ◄── …   (many)
  └─────────────┘
        one source of truth          read-only mirrors, per-view state
```

A window holds no execution logic — only a read-only mirror of the state it shows. A new window subscribes to the pool; it does not spin up another engine.

## What a window costs

The real app state per window is tiny. The rest is the Chromium shell and the weight of the loaded page.

- **JS heap** (the actual logic and data): chart ~20M, hosts 8-15M.
- **Paint is cheap.** A visible chart's canvas backing stores total ~4.7M (measured, 11 layers, DPR 1).
- **A headless host is a near-empty page** — the data host has 0 canvases and 8 DOM nodes, pure logic.

A window is expensive because it loads the full UI document — thousands of DOM nodes, the CSS render tree, every feature module — not because it paints pixels. Hosts stay small because they load a tiny page, not because they're hidden.

## The memory arithmetic

Judge memory by PSS, not RSS. RSS counts the shared ~120MB Electron framework in every process, so summing it overstates the app ~2.4×. PSS charges shared pages once, so the rows sum to the real footprint.

One chart plus the four hosts, measured with `smem`:

```
  PID Name          PSS
25630 electron      7.7M   zygote
25631 electron     11.7M   zygote
25672 electron     24.2M
25671 electron     26.3M
25737 electron     52.5M   host
25738 electron     55.6M   host
25740 electron     56.2M   host
25739 electron     57.1M   host
25666 electron     74.7M
25762 electron     86.5M   chart w2
25749 electron    123.9M   chart w1
--------------------------
   11             576.4M
```

The fixed cost is the hosts — a ~220M tax you pay whether you open one chart or four. Each added chart is ~124M on top. Four charts land near `220M + 4×124M ≈ 716M` PSS — a real station, on one core of memory.

## What you get

- Cheap thin windows over a shared engine.
- One source of truth every window is a consistent view of.
- Isolation: a broker socket crash can't take down your charts; orders dispatch even if a chart freezes; execution state survives a data-host restart.

The architecture is shaped by multi-window, not merely tolerant of it. See [The data host](/docs/architecture/data-host) and [Competition for resources](/docs/architecture/competition-for-resources).
