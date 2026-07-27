---
layout: ../../layouts/DocsLayout.astro
title: Access
---

# Access

## User challenge

The client bundles market access.

```
Exchange > Infrastructure > Broker > Client > User
```

The provider decides which clients are supported.

The user chooses from the given options.

This couples three separate concerns:

- market access
- execution
- user experience

A user cannot choose one execution path and a different interface.

## Architectural question

Can market access and client experience become separate layers?

## Design & solution

Use an adapter interface.

External trading platforms become protocol adapters, not application dependencies.

```text
             App
              │
      Adapter interface
              │
      ┌───────┴────────┐
      ▼                ▼
 API adapter     Local bridge
                       │
                       ▼
                   MT5 / NT8
                       │
                       ▼
                    Broker
```

Two connection paths:

- Open protocols connect directly through adapters.
- Closed protocols connect through local bridges.

The app does not execute orders.

The adapter connects.

The execution platform remains responsible for execution, protocol handling, and broker communication.

The app becomes the orchestration layer.