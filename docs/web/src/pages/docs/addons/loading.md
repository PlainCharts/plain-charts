---
layout: ../../../layouts/DocsLayout.astro
title: How addons load and run
---

# How addons load and run

A folder on disk becomes a running addon across three planes.

An addon is a folder read straight off disk — no build, no registration list. The app discovers folders, tracks which are enabled, and runs them across three planes:

- **management** — discover, enable, edit; runs no addon code
- **runtime** — executes the background context, in the Node host
- **UI** — the panel and chart access, in a chart window

Each plane runs in a different place. That is the capability split from [the overview](/docs/addons/overview), made concrete.

<hr>

## The folder package

```
addons/
  my-addon/
    index.js       (required)  the addon module
    icon.png       (optional)  rail icon; served at /addons/my-addon/icon.png
    vocab.json     (optional)  words merged into the app's vocabulary
    config.json    (written)   the saved settings (api.save writes this)
```

Only `index.js` is required. Drop a folder in `addons/`, or write one from the manager, and it appears in the list.

<hr>

## The management plane

Server-side (`addon-host.js`). It never executes addon code — it's the control surface the Addons panel talks to over `/api/addons/*`:

- **discover** — list folders that have an `index.js`, with their icon and vocabulary
- **toggle** — write the enabled state to `settings/addons/addons.json`
- **save / read / remove** — write an addon's source, read it for the editor, delete its folder
- **config** — write `config.json` and mark the addon for reload
- **reload** — bump a revision so the runtime restarts it

```json
// settings/addons/addons.json
{ "order-ticket": true, "price-watch": false, "_rev": { "order-ticket": 3 } }
```

`_rev` is how a save, config, or reload asks the runtime to restart one addon: bump the number and the runtime notices.

<hr>

## The runtime

`src/addons/runtime.js`, in the Node-enabled addon host — a hidden window. It:

1. watches `settings/addons/addons.json`, polling every 1.5s
2. **starts** any enabled addon whose `start(ctx)` it hasn't run; **stops** any that was disabled
3. **restarts** an addon whose `_rev` changed — clears the module from Node's `require` cache and re-requires it
4. writes `settings/addons/addons-status.json` — running, error, logs — for the manager

This is where `require('fs' | 'net' | 'child_process')` works. It has the broker data on `ctx.data`, but no charts.

<hr>

## The UI plane

`src/panels/addons.js`, in a chart window. It puts each enabled addon's icon on the right rail and, on click, opens the addon's UI:

- fetches the source and reads its exports (`ui` / `popup` / `inputs`)
- builds the `api` object — `data`, `chart` (bound to the active pane), `onRaw`, `save`, `close`, `onClose` — and calls `ui(root, api)`
- opens **docked** by default, a slide-out beside the charts, or a **popup** dropdown when the addon sets `popup: true`

> A chart window is not Node-enabled: `require` inside `ui()` is a harmless stub. Node lives in the runtime.

<hr>

## Which window runs what

```
  Chart window(s)  ── UI plane ────  ui(root, api)     chart + data + onRaw
        │
        │  broker-bus (shared connection)
        │
  Data host        ── owns the real broker connections (headless)
        │
  Addon host       ── runtime ─────  start(ctx)/stop()  data + full Node
                      (Node-enabled, hidden, isolated)
```

The addon host proxies the same data bridge as the chart windows, so `ctx.data` and `api.data` are the same broker feed. It runs isolated, so a crash there is caught and logged without touching the data host or the charts.

<hr>

## The lifecycle

1. **Create** — drop a folder in `addons/`, or write one in the manager
2. **Enable** — the manager writes `addons.json`; the runtime calls `start(ctx)`
3. **Open** — click the rail icon or press its hotkey; the UI plane calls `ui(root, api)`
4. **Configure** — `api.save(cfg)` writes `config.json` and bumps `_rev`; the runtime restarts with the new config
5. **Edit, disable, delete** — Save or Reload bumps `_rev` and re-runs `start`; disable calls `stop()`; delete removes the folder
