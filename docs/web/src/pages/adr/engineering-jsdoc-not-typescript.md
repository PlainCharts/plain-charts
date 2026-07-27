---
layout: ../../layouts/DocsLayout.astro
title: JSDoc, not TypeScript
---

# JSDoc, not TypeScript

## Challenge

Add type safety and explicit contracts without adding a build step.

The architecture depends on runtime-loaded JavaScript:

```
Core → Engine → Addons → Studies → Tools
```

TypeScript adds a compilation step, which changes how that code is shipped.

## Solution

Use JSDoc + `checkJs` + `tsc --noEmit` for contracts and type checking without a build step.

ESLint handles quality.

Plain `.js` ships as written.

## Why not TypeScript?

TypeScript solves type safety.

The architecture needs type safety without compilation.

The system loads JavaScript directly:

```text
Core → Engine → Addons → Studies → Tools
```

A full TypeScript migration changes the runtime model.

Plugins and third-party addons must become compiled artifacts instead of shipped `.js` source.

The real question is:

Is TypeScript the goal?

Or is lower entropy the goal?

|Approach|Type checking|Build step|Ship authored JS|
|---|---|---|---|
|Vanilla JS|No|No|Yes|
|JSDoc + checkJs + tsc|Most|No|Yes|
|Full TypeScript|Most|Yes|No|

JSDoc-checked JavaScript reaches the target.

It adds contracts and verification without changing the runtime model.

## The review layers

Each tool answers a different question.

`tsc` + JSDoc:

Is it correct?

ESLint:

Is it clean?

Architecture review:

Is it the right design?