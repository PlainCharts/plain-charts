---
layout: ../../../layouts/DocsLayout.astro
title: Windows, tabs & workspaces
---

# Windows, tabs & workspaces

The app's containment model — window frames, tab points, workspace remembers, chart requests.

## The chain

Each container has one job.

```
WINDOW        an OS frame
 └─ TAB        points to a workspace
     └─ WORKSPACE   one saved file — the memory
         └─ LAYOUT    a grid of cells
             └─ CHART   one cell: a symbol on a broker
```

Two things do not nest. Market data is shared sideways across everything. Drawings key by symbol, not by any container. What nests and what doesn't is the whole design.

## Windows

An OS frame, nothing more.

Every window is the whole app. A hidden process owns the shared broker connections — see [The data host](/docs/architecture/data-host). The main process tracks which tabs belong to which window, and a tab lives in exactly one.

Rearranging windows just moves tabs. It changes nothing inside a tab.

## Tabs

A tab is a thin pointer — an id, a name, and a workspace id.

The tab bar is only an index. The workspace file is the source of truth. The tab just says *show this workspace here.*

## Workspaces

A workspace is one file, and that file is the memory.

Layout, panes, drawings, object tree, ranges, settings — all live there, autosaved as you work. Everything you'd call "my chart setup" is a single portable file.

## Layout and charts

The layout is part of the workspace — a grid of cells plus their sizes.

Charts nest into the cells. Each chart carries its own symbol, broker, timeframe, and settings. Change the layout and the same workspace re-nests its charts into the new cells.

The chart is the leaf. It is also where the two non-nesting things come in.

## Data flows sideways

Market data is not scoped to a workspace.

The real connections live once in the [data host](/docs/architecture/data-host). Every window and workspace holds a thin proxy over that one host. There is one connection per broker, reused everywhere.

```
workspace A ─┐
workspace B ─┼─▶ one data host ─▶ one connection per broker
workspace C ─┘
```

Open the same broker in a second workspace and it joins the live session. A chart's symbol and broker decide only *which* data it asks for. The connection is shared.

## Drawings key by symbol

Inside a workspace, drawings sort by symbol, not by chart or cell.

Switch a chart to another symbol and it reads that symbol's own set. Each symbol behaves like its own space. How that set is organized is [The object tree](/docs/concepts/object-tree).

These are keys inside the one workspace file, not separate files. There are three scopes:

```
scope    lives in              shared with
local    the pane              that chart only
symbol   the workspace file    same-symbol charts, this workspace
global   one shared file       same-symbol charts, everywhere
```

Only global sits outside the workspace. A global drawing shows on that symbol in every workspace and window.
