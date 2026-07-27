---
layout: ../../layouts/DocsLayout.astro
title: Electron
---

# Electron

## Challenge

Stay inside the JavaScript ecosystem.

Staying in JavaScript limits the choice to desktop runtimes that combine Chromium with full Node.js: Electron and NW.js.

## Solution

Choose Electron.

Unlike NW.js, Electron enforces a clear IPC boundary.

The boundary creates a lower-entropy architecture.

Its mature ecosystem provides stronger context for developers and AI.

## The field

A desktop runtime needs a UI layer and a system layer.

Keeping both in JavaScript requires full Node.js support.

That leaves two options: Electron and NW.js.

## Electron combines two ecosystems

Electron combines Chromium and Node.js in one runtime.

The UI uses browser capabilities.

The execution layer uses Node capabilities.

The application already needs both.

## IPC is the contract boundary

Electron creates a natural boundary:

```
Core
  ↓
IPC contract
  ↓
Engine / Addons
```

This is where typed contracts belong.

Messages crossing the boundary become defined domain shapes instead of arbitrary data.

That reduces semantic entropy.

## AI benefits

Electron has a mature ecosystem.

Its documentation and established patterns provide stronger context for developers and AI.

Electron also supports the Chrome DevTools Protocol.

AI can inspect the running app, make changes, and verify the result.

This creates a closed feedback loop between implementation and reality.

## The runtime AI development standardized on

Electron is already the runtime behind modern AI development tools.

VS Code and Cursor use Electron.

Choosing Electron inherits existing AI infrastructure: terminals, processes, MCP, and local tooling.

The AI Workspace uses that foundation instead of rebuilding it.