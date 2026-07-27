---
layout: ../../../layouts/DocsLayout.astro
title: The AI assistant
---

# The AI assistant

An AI can operate the running app — locally, and only with the permissions you grant.

## What it is

The app offers its own actions to an outside AI over [MCP](https://modelcontextprotocol.io), the protocol AI tools speak.

The AI does what you can do — read your charts and account, pull market data, author studies, arrange panes, place orders — but only the parts you switch on. It is not a bolted-on chatbot; it is the app's own actions, offered to the AI under permissions you set.

## Local only, off by default

- **Off until you turn it on** — Settings ▸ App ▸ Assistant. Nothing listens otherwise.
- **On your machine only** — the server answers on `127.0.0.1:8788`, never the network. It can place orders when you allow it, so it is never reachable from outside.

## Connecting

Point any MCP client — Claude Code, Cursor — at the local address:

```
claude mcp add --transport http plain-charts http://127.0.0.1:8788/mcp
```

The app must be running with the assistant on.

## What it can do, in tiers

Four groups of permissions, each a switch you set. A switch is read on every action, so flipping one takes effect at once.

- **Read** — charts, market data, account, positions, logs. *On by default.*
- **Author** — studies, drawings, alerts, layout, appearance. *On by default.*
- **Control** — broker connections, addons. *Off by default.*
- **Execute** — place, modify, cancel orders. *Off by default.*

## How execution is gated

The AI never touches the app's internals — only a surface that checks your permissions first.

Orders are checked **twice**: once at that surface, and again where the order reaches the broker. An order that slips past the first check is still stopped at the second.

```
AI client ─▶ gated surface (your permissions) ─▶ the broker boundary (re-checked) ─▶ broker
                         │ if "confirm every order" is on
                         ▼
                  you approve it in a window  (no answer, no order)
```

The contrast with an addon is the point: an addon you install is trusted and gets everything; the AI gets only what you switch on. The server itself runs inside [the addon host](/docs/architecture/addon-host).
