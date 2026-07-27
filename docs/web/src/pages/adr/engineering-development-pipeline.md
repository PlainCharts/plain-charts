---
layout: ../../layouts/DocsLayout.astro
title: Development pipeline
---

# Development pipeline

## Challenge

Build a pipeline that fits AI-assisted development.

The loop is:

```text
generate → verify → fix → run → debug → repeat
```

Each step needs fast feedback.

## Solution

Give each tool one clear responsibility.

No overlap.

Each layer catches a different type of error.

|Layer|Responsibility|
|---|---|
|JSDoc|Defines contracts|
|TypeScript (`checkJs` + `tsc --noEmit`)|Verifies contracts|
|ESLint|Checks code quality and patterns|
|DevTools|Inspects runtime behavior|
|AI|Assists across every layer|

## AI-assisted development loop

AI works through iteration.

```text
generate
  ↓
static verification
  ↓
fix
  ↓
run
  ↓
runtime debugging
  ↓
repeat
```

Each layer catches mistakes earlier.

A wrong assumption is corrected before it spreads.

## The layered system

Each layer reduces a different uncertainty:

```text
Expressiveness
  ↓
JavaScript + ESM

Architecture
  ↓
Modules + contracts + low coupling

Static verification
  ↓
TypeScript + ESLint

Runtime
  ↓
Node.js + Electron + DevTools

Development
  ↓
AI
```

The result is a stack that keeps JavaScript's flexibility while reducing uncertainty at every stage.