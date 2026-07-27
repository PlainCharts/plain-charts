---
layout: ../../../layouts/DocsLayout.astro
title: Contracts
---

# Contracts

Every boundary in the system is a small, written-down vocabulary — so neither side has to guess the other.

## What a contract is

A **type** describes any value. A **contract** is a type, or a few, promoted to "this is the interface here."

It is the agreed shape at a boundary between two parts that change on their own schedules, written down once so neither side guesses. Every contract is made of types; what makes it a contract is the job — this is the interface — and living at the seam where the boundary is crossed.

## The clearest example: the broker

A broker speaks its own protocol — thousands of terms, evolving on its own schedule. The app speaks a small vocabulary: an order, a position, a fill, a few more. The adapter translates between them.

```
broker              adapter                 app
own protocol   ──▶  translates       ──▶    a small, exact vocabulary
thousands of        broker's words in,      order · position · fill · account · …
terms               the app's out           (each a named, precise shape)
```

The app never learns the broker's thousands of words — only the contract's handful. Each of those is an exact shape, not something to infer.

## What a contract does, in one move

- **Draws a boundary** — each side can change without breaking the other, as long as they still meet at these terms.
- **Defines every term** — one precise shape per word, nothing left to guess.
- **Bounds the vocabulary** — a small, finite set; the app can say and understand exactly these, no more.
- **Gives it a job** — this set *is* the interface here: the trading language at one seam, the messaging format at another, the study output at a third.

## Declared, not inferred

The shape is written in one place, not scattered or guessed.

- A channel name lives once, so a typo can't create a dead channel.
- A message shape is written once, so both ends agree by construction.
- The type checker sits at the boundary, so a mismatch is caught before it runs.

You don't reach this by discipline — the boundary *is* the contract, and there is no other way across. At the untrusted edge, raw broker data is also checked as it arrives and anything outside the vocabulary is refused — a safety layer on top, not the contract itself.

## The same idea at every seam

The pattern repeats wherever two parts meet, each boundary declaring its own vocabulary:

- **Broker adapters** — the neutral trading language (order, position, fill, account…).
- **Window-to-window messaging** — the channels between windows and the shape each carries.
- **The renderer-to-OS bridge** — the window and system actions a chart window can ask the main process for.
- **Studies** — the shape a study computes and hands back.
- **Drawing tools** — the surface a tool registers through.
- **Chart data** — the bar shape the chart draws.

Each is written where that boundary is crossed. The contract files are the map; the rest of the code speaks through them.
