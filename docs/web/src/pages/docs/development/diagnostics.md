---
layout: ../../../layouts/DocsLayout.astro
title: Electron diagnostics & debugging system
---

# Electron diagnostics & debugging system

When any process dies, its cause is on disk before it exits.

A renderer crash, native segfault, hang, blank window, or OOM is captured from the main process — which survives — so debugging never depends on catching it live in DevTools. All main-process instrumentation is in `electron/main.js`; the renderer forwarder is in `electron/preload.js`. No runtime dependency (no `electron-log`) — Node built-ins and Electron APIs writing JSON lines.

<hr>

## Why this exists

The app is multi-process, and a fault can land in any of them:

| Process | Role | Window |
| --- | --- | --- |
| **main** | window/tab manager, lifecycle, IPC hub | — |
| **data-host** | broker sockets, adapters, platform stores (headless) | `data-host.html` |
| **order-host** | Order Worker (headless) | `order-host.html` |
| **addon-host** | Node-enabled addon runtime + MCP server (headless) | `addon-host.html` |
| **alert-host** | Alert engine (headless) | `alert-host.html` |
| **chart / UI windows** | the charts, panels, dialogs | `index.html` |
| **order-ticket** | standalone order window | `order-ticket.html` |
| **server** | forked Node static/API server | — |

A dying renderer takes its DevTools console with it. Logging from the main process, and capturing native crashes via `crashReporter` (which no JS handler ever sees), is what recovers the cause after the fact. The pipeline:

```
   Exception / process death / hang
             │
             ▼
        Capture            (handlers in main + preload)
             │
             ▼
        Enrich             (versions, memory, window dump, run id)
             │
             ▼
        Persist            (SYNC JSON line -> logs/app.log + stderr)
             │
             ▼
        Report             (crashReporter minidump, node diagnostic report)
             │
             ▼
        Exit
```

<hr>

## Where output lands

| Artifact | Path | What it is |
| --- | --- | --- |
| **Structured log** | `logs/app.log` | one JSON object per line; rotated to `logs/app.log.1` at 5 MB |
| **stderr mirror** | your terminal | every log line is also written to stderr — visible under `npm start` / `electron .` |
| **Node diagnostic report** | `logs/report-<timestamp>.json` | written on a main-process `uncaughtException`: stacks, native modules, loaded libraries, env, heap stats |
| **Native minidump** | `app.getPath('crashDumps')` (under the Electron user-data dir) | C++ segfault dumps from `crashReporter`; symbolize with `minidump_stackwalk` |

`logs/` is git-ignored. Every line:

```json
{ "ts": "2026-07-19T21:14:07.881Z", "run": "e3d3…", "proc": "main",
  "level": "fatal", "sub": "process", "msg": "render-process-gone",
  "meta": { "url": "index.html?win=w1", "reason": "crashed", "exitCode": 133, "windows": [ … ], "mem": { … } } }
```

| Field | Meaning |
| --- | --- |
| `ts` | ISO timestamp |
| `run` | per-launch UUID (`crypto.randomUUID()`) — correlate main + renderer + host lines from one session |
| `proc` | emitter (`main`; renderer lines are tagged via `sub: "renderer-console"` / `renderer`) |
| `level` | `debug` · `info` · `warn` · `error` · `fatal` |
| `sub` | subsystem: `lifecycle` · `proc` · `process` · `window` · `nav` · `preload` · `renderer` · `renderer-console` · `mem` · `report` · `signal` · `crashReporter` |
| `msg` | short event name |
| `meta` | event-specific payload |

> Writes are synchronous (`fs.appendFileSync`) so the line flushes before a fatal exit — buffered logging is a classic reason crash logs vanish.

<hr>

## What's captured

**Main-process JavaScript**

| Handler | Emits | Notes |
| --- | --- | --- |
| `process.on('uncaughtException')` | `fatal main uncaughtException` | stack, window dump, memory; then writes a Node diagnostic report |
| `process.on('unhandledRejection')` | `error main unhandledRejection` | rejection stack |
| `process.on('warning')` | `warn main process-warning` | deprecations, EventEmitter leaks |
| `process.on('SIGINT'/'SIGTERM'/'SIGHUP')` | `warn signal <SIG>` | window dump before an orderly exit |
| `Error.stackTraceLimit = 100` | — | deeper stacks than the default 10 |

**Process death** (fires in main, which survives)

| Handler | Emits | Payload |
| --- | --- | --- |
| `app.on('render-process-gone')` | `fatal process render-process-gone` | `reason` (`crashed`/`oom`/`killed`/`launch-failed`/`integrity-failure`), `exitCode`, dying window `url`, full window dump, memory |
| `app.on('child-process-gone')` | `fatal process child-process-gone` | `type` (GPU / utility / Pepper…), `reason`, `exitCode`, `name`, `serviceName` |

`render-process-gone` is the single most useful event for the "it just vanished" bug — it names the reason though the renderer and its console are already gone.

**Per-window** — attached to every window, visible or headless, via `app.on('web-contents-created')`:

| Event | Emits | Catches |
| --- | --- | --- |
| `unresponsive` / `responsive` | `error/info window …` | hangs (not crashes) — a wedged renderer |
| `console-message` | `warn/error renderer-console` | every renderer warning/error (`level >= 2`), with source `file:line` |
| `did-fail-load` | `error nav did-fail-load` | page load failures |
| `did-fail-provisional-load` | `error nav did-fail-provisional-load` | navigation aborted before commit |
| `did-finish-load` | `info lifecycle page-loaded` | milestone — the window's page finished loading |
| `preload-error` | `fatal preload preload-error` | a preload script threw (before the UI exists) |

**Renderer-forwarded errors** (`electron/preload.js`) — installed in every window that has a preload, and running before the UI exists, so early failures are caught too:

- `window.addEventListener('error', …)` → `ipcRenderer.send('diag:renderer-error', {type:'error', message, source, line, col, stack})`
- `window.addEventListener('unhandledrejection', …)` → `… {type:'unhandledrejection', message, stack}`

Main receives these on `ipcMain.on('diag:renderer-error')` and logs `error renderer <type>` with the window URL.

**Native crashes** — `crashReporter.start({ submitURL: '', uploadToServer: false })` writes a minidump for a C++ segfault (native addon, GPU process, Chromium itself). JS handlers never run for those; this is the only thing that catches them. Dumps land in `app.getPath('crashDumps')`.

**Enrichment helpers**

- `dumpWindows()` — a snapshot of every live `BrowserWindow`: `{id, url, title, visible, loading, devtools, crashed}`. Attached to fatal events, so you know which window died and what state the others were in.
- **Boot record** (`info proc boot`) — `pid`, Electron / Chromium / Node / V8 versions, `os`, `arch`, `argv`, log path.
- **Memory** — `process.memoryUsage()`, attached to fatals and emitted on a heartbeat.

**Startup milestones** — emitted as `info lifecycle <name>`:

```
app-ready → server-forked → server-up → hosts-created → windows-booted → page-loaded (per window)
```

The last milestone localizes the failure: stop at `hosts-created` → a host window failed to boot; stop at `server-forked` → the server never came up.

**Memory heartbeat** — a 60-second `debug mem heartbeat` records `rssMB` / `heapMB`. Steady growth ahead of a `render-process-gone` with `reason: "oom"` is the OOM signature. The interval is `unref()`-ed, so it never keeps the app alive.

<hr>

## DevTools & remote debugging

These predate the forensic suite and remain the primary interactive tools.

**CDP endpoint (`127.0.0.1:9222`)**

```js
const DEV = !app.isPackaged;
const DEBUG_PORT = 9222;
const DEBUG_ON = settings.debugPort != null ? !!settings.debugPort : DEV;   // on by default in dev, off in a packaged build
if (DEBUG_ON) app.commandLine.appendSwitch('remote-debugging-port', String(DEBUG_PORT));
```

- **Default** — ON in an unpackaged (dev) run, OFF when packaged.
- **Override** — the Development settings tab writes `settings.debugPort`; it applies on the next launch (the switch must be set before app-ready).
- **State readout** — `ipcMain.on('debug-info')` returns `{ port, active, dev }`.

Attach Chrome DevTools or any CDP client to any window, visible or headless, without focusing the app. Read its console, set breakpoints, or drive it: `import()` a module and call it via `Runtime.evaluate` (e.g. `platform.accounts.all()` in the data-host) — the standard ad-hoc verification in this codebase, which has no unit tests. `GET http://127.0.0.1:9222/json` lists targets with their `webSocketDebuggerUrl`.

**In-app DevTools toggle** — the Development settings checkbox:

```js
ipcMain.on('devtools', (e, { on }) => {
  apply(BrowserWindow.fromWebContents(e.sender));   // this window
  apply(dataHost);                                   // + the hidden data host (where the broker runs)
});
```

It opens the detached DevTools for the current window and the otherwise-invisible headless data-host. Reached from the renderer via `window.desktop.devtools(on)` / `window.desktop.debugInfo()`.

**Window liveness switches** — keep every window painting when unfocused (a multi-monitor requirement), which also means CDP sees live, non-throttled behavior on background windows:

```js
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// + per-window webPreferences: { backgroundThrottling: false }
```

<hr>

## Coverage

| Failure class | Caught by | Where it lands |
| --- | --- | --- |
| Main-process JS exception | `uncaughtException` + Node report | `logs/app.log` + `logs/report-*.json` |
| Main-process promise rejection | `unhandledRejection` | `logs/app.log` |
| Renderer JS error / rejection | preload forwarder → `diag:renderer-error` | `logs/app.log` (`renderer`) |
| Renderer warning/error log | `console-message` | `logs/app.log` (`renderer-console`) |
| Renderer process death (crash/oom/killed) | `render-process-gone` | `logs/app.log` (`process`, + window dump) |
| GPU / utility process death | `child-process-gone` | `logs/app.log` (`process`) |
| Renderer hang | `unresponsive` | `logs/app.log` (`window`) |
| Preload script failure | `preload-error` | `logs/app.log` (`preload`) |
| Blank window / nav failure | `did-fail-load` / `did-fail-provisional-load` | `logs/app.log` (`nav`) |
| Native C++ segfault | `crashReporter` minidump | `app.getPath('crashDumps')` |
| OOM growth | memory heartbeat + fatal memory | `logs/app.log` (`mem`) |
| Init-order failure | milestones | `logs/app.log` (`lifecycle`) |
| **Live inspection / breakpoints** | **CDP `:9222` + DevTools toggle** | interactive |

> No user-space handler runs for a hard OS termination — `SIGKILL`, kernel panic, or power loss will not be logged. Everything short of that is covered.

<hr>

## Read a crash

1. Run from a terminal so you see stderr live: `npm start` (or `electron .`).
2. Reproduce the fault.
3. Read the last few lines of `logs/app.log`: the `render-process-gone` / `child-process-gone` line with `reason` + `exitCode`, any `renderer-console` / `renderer` error just before it, and the `windows` dump.
4. Correlate interleaved sessions by their shared `run` id.

Interpreting `reason`:

| `reason` | Meaning | Typical next step |
| --- | --- | --- |
| `crashed` | renderer hit a fault (often native — GPU / select popup / native addon) | check `child-process-gone` (GPU) + `crashDumps` minidump |
| `oom` | out of memory | check the `mem` heartbeat trend before it |
| `killed` | process was killed (external / OS) | check system logs |
| `launch-failed` | renderer never started | check preload / page load / `nav` failures |

**Live debugging** — confirm the CDP port in Development settings (or run in dev), attach DevTools or a CDP client to `127.0.0.1:9222`; `GET /json` lists the windows.

**Native symbolication** — `minidump_stackwalk <dump> <symbols>` on files under `app.getPath('crashDumps')`.

<hr>

## Extensions (not enabled)

- **Launch switches** — `--inspect` / `--inspect-brk` attach Node DevTools to the main process even if Electron DevTools never opens; `--enable-logging` routes Chromium's internal logging to stderr (verbose; for GPU / compositor issues).
- `app.getAppMetrics()` — per-process CPU/memory sampling (the heartbeat logs main-process memory only).
- `did-start-navigation` logging — full navigation tracing beyond the failure events already captured.
- IPC tracing — channel / sender / duration / exceptions; many Electron bugs are IPC bugs.
- A crash-report upload endpoint — `crashReporter` is currently local-only (`uploadToServer: false`).

<hr>

## Files

| File | Contains |
| --- | --- |
| `electron/main.js` | the full diagnostics block (logger, handlers, milestones, heartbeat) + the CDP/DevTools wiring |
| `electron/preload.js` | renderer `window.onerror` / `unhandledrejection` forwarding to `diag:renderer-error` |
| `src/settings/sections/development.js` | Development settings UI: DevTools toggle + remote-debugging-port state |
| `logs/app.log` (+ `.1`) | structured run log (git-ignored) |
| `logs/report-*.json` | Node diagnostic reports |
| `app.getPath('crashDumps')` | native minidumps |
