---
layout: ../../layouts/DocsLayout.astro
title: Everything is an interface
---

# Everything is an interface

## Challenge

Intent that exists only in someone's head must be reconstructed before anyone can act.

Reconstruction requires inference.

Inference is where ambiguity enters.

## Solution

Make everything an interface.

Anything that would need to be inferred becomes declared.

Contracts, APIs, architecture, documentation, examples, and design logs turn knowledge into something directly consumable.

The consumer follows interfaces instead of reconstructing intent.

## The interfaces

The codebase is a network of interfaces:

- **Contracts** — interface to data
- **APIs** — interface to behavior    
- **Architecture** — interface to system composition
- **Documentation** — interface to knowledge
- **Examples** — interface to usage
- **Design log** — interface to intent

Each interface moves knowledge from implicit to explicit.

```text
knowledge > interface > consumption
```

Without interfaces:

```text
source
  ↓
infer architecture
  ↓
guess conventions
  ↓
implement
```

With interfaces:

```text
contract
  ↓
API
  ↓
example
  ↓
implement
```

The system becomes something humans and AI can navigate instead of something they must reconstruct.