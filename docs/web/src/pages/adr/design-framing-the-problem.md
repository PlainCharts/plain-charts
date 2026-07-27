---
layout: ../../layouts/DocsLayout.astro
title: Framing the problem
---

# Framing the problem

Defining the problem space reduces the search space.

## The problem space

- **Access** — How do I reach the market?
- **Commercial** — What kind of application am I using?
- **Representation** — How is market information shown?
- **Interaction** — How do I work with it?

## Engineering process

```text
Problem space
─────────────
Access
Commercial
Representation
Interaction
      ↓
User challenges
      ↓
Architectural questions
      ↓
Design
```

Each layer builds on the previous one.

## Asking the right questions

Start with observations.

Turn them into user challenges.

Turn user challenges into architectural questions.

Architectural questions lead to design.

For example:

> Who shapes your behavior?

That is an observation.

Not an engineering question.

It has no design surface.

Instead ask:

> Should representation be fixed by the platform or defined by the trader?

That question can be researched, designed, and implemented.

It leads to architectural decisions such as:

- configurable representations
- user-defined geometry
- custom order visualization
- alternative risk representations
- custom drawing tools

The goal is not to defend an opinion.

The goal is to turn observations into buildable questions.