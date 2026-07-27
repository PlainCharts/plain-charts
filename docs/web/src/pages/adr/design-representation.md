---
layout: ../../layouts/DocsLayout.astro
title: Representation
---

# Representation

## User challenge

The platform defines how market information is understood.

It answers:

"What does trading look like?"

But traders do not all think in the same vocabulary.

The problem is not representation.

The problem is fixed representation.

## Architectural question

Should representation be fixed by the platform or defined by the trader?

## Design & solution

Separate trade data from visual representation.

The engine provides data and coordinate space.

Modules decide how information is expressed.

```text
Market data
    ↓
Coordinate system
    ↓
User-defined representation
```

Studies and drawing tools become representations, not fixed platform features.

Examples:

- A trader can visualize risk as R instead of dollars.
- A trader can hide P&L completely.
- A trader can create custom drawings for their own process.    

Execution does not depend on the representation.

The platform provides defaults.

The user defines the vocabulary.

```text
Default: starting point

Custom representation: user's mental model
```