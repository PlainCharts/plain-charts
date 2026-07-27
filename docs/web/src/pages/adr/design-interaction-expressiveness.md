---
layout: ../../layouts/DocsLayout.astro
title: "Interaction: Expressiveness"
---

# Interaction: Expressiveness

## User challenge

A platform provides a vocabulary.

The trader thinks in a mental model.

The question is whether the vocabulary can express that model.

```text
Mental model > Desired expression > Available vocabulary
```

When the vocabulary is limited, the trader translates their ideas into the available concepts.

Over time, interaction follows the platform's language.

```text
Think > Express > Interact > Reinforce
```

This is an engineering problem.

The interface shapes what can be expressed.

## Architectural question

How do we let traders express their own mental models?

## Design & solution

Keep the substrate low-level.

Let users create the vocabulary above it.

```text
Engine
 ↓
Coordinates
Canvas
Input
 ↓
User-defined concepts
```

Tools and studies become authored expressions.

They can represent concepts beyond fixed platform terms.

The goal is not a correct vocabulary.

The goal is an expressive one.

The platform should not be fluent in one trading language.

It should support many.