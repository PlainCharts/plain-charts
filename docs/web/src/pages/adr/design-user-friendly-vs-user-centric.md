---
layout: ../../layouts/DocsLayout.astro
title: User-friendly vs user-centric
---

# User-friendly vs user-centric

## User challenge

Two approaches exist:

```text
User-friendly

Designer > Chooses defaults > User adapts


User-centric

Platform > Provides capabilities > User composes
```

User-friendly delivers solutions.

User-centric delivers capabilities.

They are different goals.

For traders, the difference matters because the user's edge often comes from their own mental model.

A platform that decides too much eventually replaces the user's decisions.

## Architectural question

How do we expose the right abstractions so users can shape the platform where it matters?

## Design & solution

Choose user-centric where user intent matters.

Keep foundations stable where correctness matters.

User-centric does not mean everything is configurable.

It means users control the parts that represent their goals and workflows.

```text
Execution → deterministic and safe

Representation → customizable

Extensions → open capabilities

Permissions → explicit control

Defaults → starting points, not limits
```

Examples:

|Layer|User-friendly|User-centric|
|---|---|---|
|Access|Supported brokers|Adapter interface|
|Representation|Fixed visualization|User-defined representation|
|Interaction|Preset workflow|Composable workflow|
|AI|Built-in assistant|Assistant interface|
|Studies|Fixed indicators|Study API|
|Charting|Fixed tools|Rendering API|

The principle:

```text
User-friendly: reduce decisions.

User-centric: increase meaningful choices.
```

Defaults should remove friction, not remove control.

A default the user cannot leave is a constraint.