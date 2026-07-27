---
layout: ../../layouts/DocsLayout.astro
title: Enforcing modularity
---

# Enforcing modularity

## Challenge

Find the right structure without freezing the wrong structure too early.

During exploration, the shape of the system is still unknown.

Premature modularity creates boundaries before the seams are clear.

## Solution

Separate exploration from consolidation.

Architecture emerges after exploration.

It cannot be fully designed before the shape is known.

Trying to enforce modularity during exploration creates premature boundaries.

The right sequence is:

```
Explore
   ↓
Discover shape
   ↓
Stabilize boundaries
   ↓
Enforce structure
```

## Why AI cannot maintain structure during exploration

Modularity requires stable boundaries.

```text
module = a boundary that will not move
```

During exploration, boundaries are unknown.

The work is discovering where the seams belong.

Without established structure, AI has no pattern to follow.

```text
no pattern → no constraint → no modularity
```

AI is not failing to maintain architecture, because architecture does not exist yet.

## The two-mode cycle

```text
EXPLORE                    CONSOLIDATE
--------                   ------------
shape unknown              shape known
probe ideas                define boundaries
allow change               enforce patterns
AI follows intent           AI follows structure
      |                          ^
      |______ milestone _________|
```

The transition happens when the shape is stable enough to name its parts.

Before that point, structure slows discovery.

After that point, lack of structure slows progress.

## AI needs the mode signal

AI only sees the current state.

It cannot know whether disorder is intentional exploration or accidental neglect.

The human must communicate the mode.

```text
Explore:
"Find the shape. Do not optimize structure yet."

Consolidate:
"Apply existing patterns. Enforce boundaries."
```

The skill is not always writing structured code.

The skill is knowing when structure helps and when it blocks discovery.