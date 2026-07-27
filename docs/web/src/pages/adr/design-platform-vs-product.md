---
layout: ../../layouts/DocsLayout.astro
title: Platform vs product
---

# Platform vs product

## User challenge

Products optimize for completion.

Platforms optimize for possibility.

```text
Product: What does the user need today?

Platform: What should be possible tomorrow?
```

A product is built around features.

A platform is built around capabilities.

Features change.

Capabilities last.

## Architectural question

What capabilities should the platform expose?

## Design & solution

Build around stable primitives.

Do not optimize around today's studies, indicators, or AI tools.

Optimize around what allows new tools to exist.

An operating system follows this model.

It does not solve specific user problems.

It provides primitives:

```text
Filesystem
Networking
Processes
Memory
Permissions
IPC
GUI
```

Applications consume those capabilities:

```text
Operating System
      ↓
Photoshop · Chrome · VS Code · Blender
```

The same pattern applies to a trading platform:

```text
Trading Platform
      ↓
Market Data
Execution
Rendering
Studies
Workspaces
Commands
Permissions
Projects
AI
Extensions
```

These are platform services.

Features are built on top of them.

Design principle:

```text
Product: Optimize for completion.

Platform: Optimize for possibility.
```

Features expire.

Capabilities compound.