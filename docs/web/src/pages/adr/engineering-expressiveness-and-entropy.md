---
layout: ../../layouts/DocsLayout.astro
title: Expressiveness and Entropy
---

# Expressiveness and Entropy

## Challenge

The work is a collaboration.

The human is the architect.

The AI is the coder.

The environment must support both.

The goal is not individual productivity.

It is the combined productivity of the architect and AI working together.

## Solution

Build a stack that stays expressive while keeping entropy low.

Language choice is secondary.

AI changes programming from a language problem into a communication problem.

What matters is how many ways the stack allows the same idea to be expressed.

Low entropy means:
- canonical patterns
- explicit contracts
- one clear way to express each concept

A smaller search space helps both humans and AI.

Fewer possibilities mean faster decisions and more reliable results.

## LLMs and low entropy

LLMs do not understand code the way humans do.

They predict patterns from examples.

Consistency is their strongest signal.

When a codebase represents the same idea the same way every time, the model has a clearer pattern to follow.

A single `Order` shape is easier to understand than five valid `Order` shapes.

One async pattern is easier to follow than callbacks, promises, generators, and async/await all mixed together.

Every task is a search problem:

```
Problem
  ↓
Possible implementations
  ↓
Correct implementation
```

Entropy controls the size of that search space.

High entropy:
- many valid solutions
- more decisions
- more wrong paths

Low entropy:
- fewer valid solutions
- clearer patterns
- faster convergence

The goal is not to reduce what the system can express.

The goal is to reduce how many ways the same idea can be expressed.

## Entropy is a stack property

Entropy does not come from the language alone.

It comes from the whole stack.

```
Language
  +
Libraries
  +
Tooling
  +
Architecture
  =
System entropy
```

A language exists inside an ecosystem.

Patterns, libraries, tools, and architecture all shape how many choices remain.

This is why tools matter.

TypeScript, ESLint, ESM, and `tsc` do not make JavaScript less expressive.

They guide that expressiveness toward consistent patterns.

The best stack is not the one with maximum freedom.

It is the one that keeps expressive power while removing unnecessary choices.

Every layer that converges on one clear way of working reduces the search space for everyone - Human or AI.