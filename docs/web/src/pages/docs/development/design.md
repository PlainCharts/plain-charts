---
layout: ../../../layouts/DocsLayout.astro
title: Design
---

# Design

The agent that builds the UI can see it, measure it, and operate it, so you direct with taste instead of counting pixels.

<hr>

## Why it exists

A coding agent is blind. It writes CSS it cannot see.

So you become its eyes: "the box is 16px too far right," "that line moved," "what is that." Every small fix costs you a screenshot and a sentence.

This gives the agent its own eyes, a ruler, and a hand. The spoon-feeding stops.

<hr>

## The loop

You show a reference. You name the guide. The tool reads reality. You fix.

```
show → tell → measure → fix
```

The tool reads. You judge. It reports what is on screen. It never decides the design.

<hr>

## Measure it

You name the guide in plain words — "align this to the account box." The agent turns that into a number and proves the result.

```
account box, right edge:  209.6
volume box,  right edge:  188.0   → 21.6px short
```

It edits the CSS and re-measures until the gap is zero. The check pins an edge to a named guide and fails loudly when it misses. That is how "close but wrong" gets caught, not just "moved."

<hr>

## Drive it

The agent can operate the interface, not just photograph it.

It forces a hover or focus and watches the state paint. It dispatches a real click and captures what follows — a menu that opens, a tab that switches.

A still screenshot shows none of that. Driving it is how a hover that never paints, or a dropdown that will not open, gets caught.

<hr>

## Check it

Beyond layout, it reads what the eye would otherwise have to squint at.

| It reads | It catches |
| --- | --- |
| the accessibility tree | a `<div>` posing as a button, an icon with no name |
| the WCAG contrast ratio | text under the 4.5:1 floor |
| a deterministic re-render | a real regression, not render noise |

<hr>

## Build from nothing

The agent does not need the running app. It renders arbitrary HTML in its own headless window.

So a new page or component can be drawn, seen, and measured before a line of it touches the app.

<hr>

## Why you stay in the loop

Taste cannot be automated. Measurement can.

Without the instrument, your taste is spent counting pixels — the one job a machine does better. With it, your attention goes only where it is irreplaceable: is this right, is this what you meant, is it good.

The tool removes the arithmetic so your judgment is not buried under it.

<hr>

## An instrument, not a template

A file that declares what a dashboard should look like replaces your direction with a canned one. That canned result is the thing you look at and reject.

So there is no house style here. The guide is whatever you point at, in the moment. The tool measures that, and only that.

> Two forms carry it: one drives the running app over its debug port, the other renders arbitrary HTML with no app at all. Both live in `.claude/skills/`.
