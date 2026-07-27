# Data Engine

The execution engine — a self-contained library: broker adapters, the data host, the platform
stores and the order worker. The app (or any other frontend, or a headless terminal) drives it
through one public API and never reaches into its internals.

```
data_engine/
  index.js         PUBLIC API — the only module app code imports (lint-enforced)
  data-host.js     boot entry: the headless data-host window (owns broker sockets, runs adapters)
  order-worker.js  boot entry: the order-worker window (owns all order business logic)

  data/            broker facade + bridge, adapter contract/SDK/registry, trade feed
  orders/          the command funnel, the executor, the worker runtime, book readers, the DSL
  platform/        cross-window stores (orders/fills/positions/accounts/perf) + console
  adapters/        plug-and-play broker adapters (cqg, mt5, oanda, schwab) — drop a folder in
  bus.js           the engine event bus ('logon', 'connections:changed', 'broker:notice')
  ipc.js           the engine's cross-window channels (broker-bus, order-bus, store prefixes)
  status.js        engine log + connection nudge; display sink installable by the app
  policy.js        assistant-order gate seam (fail-safe deny; the app installs its policy)
  timeframes.js    neutral bar-duration math      bar-fields.js  neutral bar extras + agg rules
```

## The boundary

- consumers import `data_engine/index.js` — the broker facade, the platform stores, `command()`,
  the engine bus, the adapter contract, and the seams (`setStatusSink`, `setExecGate`)
- the engine imports NOTHING from the app; app-side behavior (policy, display) is injected
- adapters import the SDK (`/data_engine/data/adapter-sdk.js`) plus the engine's own primitives;
  they are discovered by the server and dynamically imported by the data host — never by the app

## Execution path

```
surface -> command() -> order worker (exec.js) -> broker facade -> data-host -> adapter -> broker
```

One funnel, one executor, one socket owner. Surfaces only send commands and mirror the book.
