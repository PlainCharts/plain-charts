---
layout: ../../layouts/DocsLayout.astro
title: Low-entropy prompting
---

# Low-entropy prompting

## Challenge

Prevent drift between human intent and AI implementation.

A large objective creates many possible interpretations.

Each interpretation creates a different implementation path.

```text
Goal
  ↓
Many interpretations
  ↓
Many implementations
  ↓
Drift
```

LLMs optimize toward complete solutions.

Humans optimize toward the next correct decision.

Those goals are different.

## Solution

Reduce the search space.

The model should understand the destination.

It should not choose the route.

```text
Vision → Architecture

Step 1 → Verify → Step 2 → Verify → Step 3 → Verify
```

The vision stays fixed.

Execution moves through verified steps.

## Why drift happens

LLMs predict likely continuations.

A large objective creates many plausible interpretations.

```text
Goal
  ↓
Many interpretations
  ↓
Many implementations
  ↓
Drift
```

Drift comes from an unconstrained search space.

The model fills missing information with learned patterns.

Those patterns are useful.

They also introduce assumptions.

More freedom means more opportunities for unintended decisions.

## Solution: reduce the search space

Do not ask:

> Build the trading application.

Ask:

> Implement this verified next step.

Each step removes uncertainty before the next one begins.

```text
Vision
  ↓
Verified brick
  ↓
Verified brick
  ↓
Verified brick
  ↓
Complete system
```

The architecture emerges through verified convergence.

Software engineering reduces the search space of the codebase.

AI engineering reduces the search space of each prompt.