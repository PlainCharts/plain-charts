---
layout: ../../layouts/DocsLayout.astro
title: AI as a first-class participant
---

# AI as a first-class participant

## User challenge

AI can already control applications through extension APIs.

```text
AI > Python > MT5 > Broker
```

The capability exists.

The architecture does not.

The question is not:

"Can AI control the application?"

The question is:

"Is AI a designed participant in the application?"

## Architectural question

Should AI be a first-class participant with its own interface, permissions, and controls?

## Design & solution

Make AI part of the platform architecture.

```text
AI Workspace > Application API > ...
```

AI uses the same application interfaces as other platform actions.

The platform owns:

```text
Permissions → what AI can do

Safety → what requires approval

Audit → what AI did
```

The AI can read and create.

Execution remains controlled.

The difference between a scripting bridge and a first-class AI is not capability.

It is responsibility.