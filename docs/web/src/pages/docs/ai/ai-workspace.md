---
layout: ../../../layouts/DocsLayout.astro
title: The AI Workspace
---

# The AI Workspace

A terminal tab inside the app, running a real shell and Claude Code, wired to the chart you're looking at.

## What it is

A full tab that is a real terminal — run `claude`, `git`, `python`, anything a shell runs.

It starts at the project root, so running `claude` connects to the app's own assistant. From there Claude Code drives the platform — reading your account and charts, placing orders, authoring studies — under the same permissions the [AI assistant](/docs/ai/assistant) uses. It is the assistant docked in your layout, not a chat window bolted on the side.

## Opening it

Workspace Manager ▸ **AI Workspace**. It is a [surface tab](/docs/concepts/workspaces) like the Trade Desk — switch it, rename it, detach it to its own window, and it persists. Put it on a second monitor beside your charts.

## Wired to your live view

What a plain terminal can't be: it is connected to your chart, both ways.

```
you       ── right-click a chart or drawing → "Send to AI" ──▶  context typed into the prompt
                                                                 (symbol, price, the drawing's points)

assistant ── reads your active chart ──▶  symbol · timeframe · visible range · current bar · selected drawing
```

- **Push** — right-click a chart or a drawing, choose **Send to AI**, and the live context lands in the prompt. It reaches the terminal even when detached to another window. Nothing is submitted; you finish the sentence.
- **Pull** — the assistant reads your active chart on its own: symbol, timeframe, visible range, current bar, and any drawing you've selected, with its points.

So you highlight a trendline, Send to AI, the assistant reasons about that exact object, then draws its answer back on the chart. Highlight, ask, act.

## The session survives

The shell — and your Claude Code session — runs in the app's background process, not in the window.

Switch tabs, detach to another window, or reload the chart window, and the shell keeps running. The terminal reconnects and replays its scrollback. It ends only on an explicit restart or when you quit the app. Moving the panel around never drops your session.

Normal terminal clipboard applies (copy-on-select, paste), and the terminal's font and colors read a user-editable style file.
