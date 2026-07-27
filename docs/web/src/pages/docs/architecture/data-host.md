---
layout: ../../../layouts/DocsLayout.astro
title: The data host
---

# The data host

One headless process owns every broker socket; the engine and every window read from it.

## Where it sits

The data host is one part of `data_engine` — the execution engine, shipped as a single library behind one public API.

```
data_engine  (one library, one public API — index.js)
├─ adapters/      cqg · mt5 · oanda · schwab
├─ data host   ── owns the sockets, runs the adapters   ← this page
├─ order worker   owns all order business logic (its own process)
└─ platform       stores: orders · positions · fills · accounts
```

It owns **connections and market data**, not order logic. The order worker holds that, in its own process, and reads the book the data host publishes.

## Three roles, one codebase

Every window runs the same code and resolves its role at startup.

- **host** — one hidden window (`?role=data`). Runs the real brokers and the adapters. No UI, never shown.
- **proxy** — every other window (charts, the order/alert/addon hosts). Holds no data code; a stand-in broker forwards calls to the host and receives the answers.
- **solo** — the browser build. No second process, so the broker runs in the page.

Panes, studies, and addons all import the same `broker` and never know which role they got.

## One connection, shared

The host keeps one live session per broker — **not one per window**.

- Connect CQG once; every window draws from that session. A second window doesn't log in again.
- Close a window and the session stays up for the rest. The connection belongs to the host.
- It is not many clients to one broker. It is **one client serving them all**.

## Many brokers, one language

The host holds several brokers open at once — CQG futures, Schwab equities, OANDA forex — one of them the active default.

Each broker speaks its own wire protocol. An **adapter** wraps it in one neutral interface — resolve a symbol, subscribe to bars and quotes, fetch history, place and manage orders, read the session calendar — and seals the protocol inside. What comes back is the same shape for everyone: a bar update is `{ bars, complete }`, an error is `{ error }`.

Adapters are plug-and-play: drop a folder in `data_engine/adapters/`, it registers itself, the server discovers it, the host loads it. Nothing else changes.

## The bridge

A proxy call carries an adapter, a method, its arguments, and a **call id**.

```
proxy:  broker.subscribeQuotes(sym, cb)
   ── broker-bus ─►  host runs the real method
                     reply routed back to the asking window, by call id  ─►  cb
```

A one-shot fetch cleans up when a reply says `complete`; a live subscription keeps its callback and streams update after update. Cheap state — connected? label? server clock? — is read from a snapshot the host broadcasts on every connection change, with no round trip.

## Metering history requests

One host shares the connection but concentrates the load. Open many windows, or a board that spawns a dozen panes, and their history fetches fire at once — past the broker's in-flight cap.

So the host queues them, per broker:

```
requests from all windows ─►  CQG    [ ■ ■ ■ ]  3 in flight, rest wait
                              Schwab  [ ■ ■   ]
                              OANDA   [ ■     ]   (each broker independent)
```

- A few requests per broker run at once; the rest start as slots free.
- A slot frees when its first batch reports `complete`; a live subscription then streams holding **no slot**.
- Live subscriptions jump ahead of history backfill, so a live feed never waits on someone's deep scroll.
- A safety timeout frees any slot whose fetch never answers.

However many windows you open, each broker sees an orderly trickle.

## What it is not

- **Not the order engine.** It carries the low-level verb to the socket; the order worker owns the logic — see the multi-window model in [The multi-window host model](/docs/architecture/multi-window-host-model).
- **Not the whole engine.** It is `data_engine`'s socket-owning entry, one of several.
