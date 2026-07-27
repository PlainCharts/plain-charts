---
layout: ../../layouts/DocsLayout.astro
title: Psychology and phases
---

# Psychology and phases

## User Challenge

The interface has no concept of what phase the trader is in.

The interface shows one static view across states that have different information needs.

```

Planning: thesis, level, invalidation, size.

In-position: price, destination.

Review: was the thesis right, independent of what it paid.

```

Legibility is state-dependent.

It doesn't mean that information is not correct.

It is poorly timed.

Stop level is essential pre-entry and irrelevant post-entry.

Entry price is essential pre-entry and toxic post-entry.

## Architectural Question

Should the interface adapt to the trading phase, showing only what is relevant to the current state, instead of one static view?


## Design & solution


### What is the minimum set

Entry line removed, because it manufactures above/below.

Stop invisible, because it's already placed and doing its job.

P&L absent, because it's a result variable in a process moment.

Post-entry, the trader needs current price and destination. Nothing else.


## Psychology and Phases


### Above/below the line

Entry price creates a spatial frame with moral weight.

Above is winning, below is losing.

Remove the reference point and both disappear — there is only price and destination.

Phase: in-position defect. Entry price was essential during planning.


### Hands on the stop

Stop moved repeatedly, back and forth, after entry.

The stop was calculated correctly and sized correctly.

Touching it post-entry is acting on a variable that is no longer decidable.

Phase: the stop is a planning object executing in the broker layer. Visible post-entry, it reads as an open decision.


### Attachment to unrealized profit

Price runs, comes back to entry, trader closes at breakeven.

Nothing about the thesis changed. What changed was that a number he had already counted as his stopped being his.

Phase: P&L is a review-phase object rendered live.


### Time in drawdown

Three hours, no new price information, conviction erodes.

Duration substitutes for evidence.

Phase: elapsed time has no in-position job. Same class of defect as P&L.


### Partials misread as one position

A partial creates a new position with new levels.

The trader keeps reading the old one.

Entry line at the original price.

Stop 25% higher.

Half the size gone.

Price returning to the original entry is a return to a level that no longer describes anything he holds.

Phase: in-position display shows a position that has already changed twice, not the current state of the position.


### Selective irrelevance — the empty day

Market moved, others participated, the model had nothing.

Reads as exclusion rather than as a filter working correctly.

Phase: review defect. No-trade renders as absence when it was a decision.


### Entitlement from effort

Hours at the screen create an expectation of compensation.

Employment logic in a probability game.

Phase: review defect. Nothing in the log records vigilance, only fills.