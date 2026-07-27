---
layout: ../../layouts/DocsLayout.astro
title: Framework
---

# Framework

## Challenge

Use a framework or keep the stack plain.

A framework can organize the UI.

It also adds another layer of concepts between the logic and the runtime.

The question is whether that layer solves a problem the architecture actually has.

## Solution

No framework.

Keep the core in plain JavaScript.

## Frameworks

A framework is not only a library.

It introduces another language.

React has hooks, context, state patterns, and framework conventions.

Each abstraction adds more concepts to understand.

Plain JavaScript reduces the gap:

```text
Problem → JavaScript → API → Solution
```

Fewer layers mean less to infer.

## The deciding factor

A framework should solve a real problem.

The hard problems here are:

- TCP/WebSocket transport
- trading logic
- synchronization
- Electron IPC
- persistence
- charts
- settings

A framework does not solve those problems.

It organizes the UI.

The UI was never the hard part.