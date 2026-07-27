---
layout: ../../layouts/DocsLayout.astro
title: Stack
---

# Stack

## Maximizing expressiveness while minimizing entropy

Choose the lowest abstraction layer that solves the problem well.

Higher layers are not better by default.

They are useful only when they remove a problem.

## Ecosystem - Provides capability

One environment where the system speaks one language.

- JavaScript (ESM)
- Node.js
- Electron
- HTML/CSS
- npm
- Runtime-loaded modules

## Architecture - Reduces structural entropy

Creates predictable structure.

- Small focused modules
- Stable naming
- Clear boundaries
- Explicit contracts
- Low coupling
- Canonical domain models

## Interfaces - Reduces semantic entropy

Makes knowledge explicit.

- Domain contracts
- Adapter contracts
- IPC contracts
- Public APIs
- Documentation
- Examples
- Design log

## Verification - Reduces implementation entropy

Checks correctness before runtime.

- JSDoc
- `checkJs`
- `tsc --noEmit`
- ESLint

## Development - Enables iteration and debugging

Provides feedback during implementation.

- Electron DevTools
- Chrome DevTools
- Remote debugging
- AI-assisted development

## One responsibility per tool

Each layer earns its place by adding a unique capability.

```text
JavaScript → language

Node.js → system access

Electron → desktop runtime

Libraries → focused functionality

JSDoc + TypeScript → semantic verification

ESLint → correctness checks

AI → implementation acceleration
```

The stack stays low entropy because each layer solves a different problem.

There is little conceptual overlap.

Each tool has a clear role.