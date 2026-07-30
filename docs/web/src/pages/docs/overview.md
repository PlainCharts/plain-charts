---
layout: ../../layouts/DocsLayout.astro
title: Overview
---

# Overview

The spine the whole system stands on. Everything else hangs off these parts.

## Stack
- Vanilla JavaScript (ESM) plain ES modules, no build step, no framework
- Electron or browser one codebase runs as a desktop app or served in a browser
- HTML and CSS the UI is the web platform you already know
- Node.js host, not sandboxed addons run in a full Node.js process with the whole npm ecosystem and system access
- Runtime-loaded modules studies, tools, adapters, and themes load as plain files you drop in, no recompile
- Studies in plain JS authored in vanilla JavaScript, computed off the render thread

## Ownership

```
                                        USER
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                   UI WINDOW                                          │
│                                                                                      │
│  Workspace → Panes → Price Canvas (Ether)                                            │
│                        │                                                             │
│         ┌──────────────┴──────────────┐                                              │
│         ▼                             ▼                                              │
│   Drawing Engine                 Study Worker                                        │
│         │                             │                                              │
│         └──────────────┬──────────────┘                                              │
│                        ▼                                                             │
│                  Object Tree                                                         │
│                                                                                      │
│  Command Registry                                                                    │
│  ├─ Hotkeys                                                                          │
│  ├─ Menus                                                                            │
│  ├─ Toolbar                                                                          │
│  └─ AI / MCP                                                                         │
│                                                                                      │
└───────────────┬─────────────────┬─────────────────┬─────────────────┬────────────────┘
                │                 │                 │                 │
             Data             Orders            Alerts               AI
                │                 │                 │                 │
                ▼                 ▼                 ▼                 ▼
      ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
      │   Data Host    │ │   Order Host   │ │   Alert Host   │ │   Addon Host   │
      │────────────────│ │────────────────│ │────────────────│ │────────────────│
      │ Broker         │ │ Brackets       │ │ Rules          │ │ MCP Server     │
      │ Adapters       │ │ OCO            │ │ Conditions     │ │ Addons         │
      │ Contract       │ │ Stop Logic     │ │ Action Log     │ │ Injected API   │
      │ Stores         │ │ Fill Engine    │ │ Actions        │ │ Node Runtime   │
      └──────┬─────────┘ └────────────────┘ └──────┬─────────┘ └──────┬─────────┘
             │                                     │                  │
             ▼                                     ▼                  ▼
         Brokers                            Notifications       External APIs

                 ┌──────────────────────────────────────────────┐
                 │              Main Process                    │
                 │──────────────────────────────────────────────│
                 │ Window lifecycle                             │
                 │ Native menus                                 │
                 │ IPC backbone                                 │
                 │ Workspace / tab placement                    │
                 └──────────────────────────────────────────────┘
```

## Chart & drawings

**kapelka** — the price-rendering canvas
- panes, grid
- x/y = data axes (time, price)
- vpx/vp = viewport anchor, per point
- dx/dy = pixel nudge
- the ether = what you draw on

**Drawing engine** — tools + objects
- tools create, objects hold state
- paints through the ether (a drawing = a study's marks, same substance)

**Object tree** — organize
- layers, folders
- orders + hides
- governs, renders nothing

## Market & orders

adapters translate → contract normalizes → data host aggregates → order host executes

**Adapters** — per-broker protocol translators
- one per broker (CQG, MT5, Schwab, OANDA)
- broker wire → neutral shape

**Contract** (`adapter-contract.js`) — the neutral shape
- Order / Fill / Position / Account / TradeEvent
- app stays protocol-blind; a missing field goes here, never in the app

**Data host** — headless, single owner
- owns broker sockets, runs adapters + trade-feed
- holds platform stores (orders, positions, fills, accounts, console)
- single source of truth, mirrored to every window

**Order host** — owns all order logic
- brackets, OCO-on-flat, stop auto-sizing
- positions/history derived from fills, not stored

## Studies off-thread

**Study worker** — computes, off the render thread
- background thread, runs each study's pure calc/step
- returns descriptions (plots + ether marks)
- the chart just draws what comes back

## The action surface

**Command registry** — one action, many triggers
- hotkey / menu / AI all resolve to the same command id
- the single surface addons and MCP call through

## Extensibility

One `api` surface, two callers. Programmatic = full trust; AI = same calls, behind the policy gate.

**Addons** — programmatic
- code you write, in the Node addon-host, calling the `api` directly
- reach in — injected `api` (chart, broker, console, stores, commands)
- reach out — Node window, not sandboxed: npm, fs, sockets, child processes, external services

**Assistant (LLM)** — AI
- reaches the same `api` via the MCP server in that host
- tools mirror the command registry: any command → the model can call it

## Alerts

**Alert host** (`role=alerts`) — hidden window, the Alert engine
- single owner of the rules + log
- watches price, time, watchlist conditions
- fires actions: toast, email, Telegram, webhook, sound

## Electron system

```
                         Main Process
                               │
      ┌──────────────┬──────────┼─────────────┬───────────────┐
      ▼              ▼          ▼             ▼               ▼
 UI Window      Data Host   Order Host   Alert Host    Addon Host
      │
      ▼
 Study Worker

Processes
 Main
 ├── UI
 ├── UI
 ├── UI
 ├── Data
 ├── Orders
 ├── Alerts
 └── Addons
```

**Main process** — spawns windows, owns menu / IPC backbone

**Hosts** — headless windows, one per role
- data-host, order-host, alert-host, addon-host
- each an OS process, Node-enabled

**Workspaces / tabs** — what a UI window holds and persists
- a tab = a viewport onto one workspace (layout, symbols, drawings)
- autosaved; arrangement (which window holds which tab) owned by the main process

**UI windows** — own almost nothing, proxy on every axis
- broker / stores → data-host
- orders → order-host
- alerts → alert-host
- automation / AI → addon-host

**Web Worker** — a thread inside a window
- the study worker (thread, not process)

**Walls** — crossed by messages
- window ↔ window: IPC / BroadcastChannel
- window ↔ worker: postMessage
