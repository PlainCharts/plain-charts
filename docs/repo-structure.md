# Repository structure — important locations

Paths are repo-root-relative (leading `/`).

## Two engines (the foundation)

- `/lib/kapelka` — RENDER engine (vendored de-Vue trading-vue-js port; its own git repo)
- `/data_engine` — EXECUTION engine (adapters + data host + platform stores + order worker)
- `/data_engine/index.js` — the engine's ONLY public import surface (deep imports = lint error)
- `/data_engine/README.md` — engine API reference

## Hosts & windows (multi-window model, role from `?role=`)

- `/index.html` — chart / UI window (ROLE proxy)
- `/data-host.html` — headless data host, `role=data` (owns broker sockets + platform stores)
- `/addon-host.html` — headless addon host, `role=addon` (Node-enabled)
- `/order-host.html` — headless order host, `role=orders`
- `/alert-host.html` — headless alert host, `role=alerts` (runs the alert engine)
- `/order-ticket.html` — standalone Order ticket OS window (inline CSS lives here)

## Electron shell

- `/electron/main.js` — main process: window/tab assignment, BrowserWindow creation, app.log rotate
- `/electron/preload.js` — preload bridge
- `/server.js` — local server (port 8011): `/api/*`, adapter server-hooks, accounts API

## Data engine internals (`/data_engine`)

- `/data_engine/adapters/` — broker adapters: `cqg` (REFERENCE), `mt5`, `oanda`, `schwab`
- `/data_engine/data/adapter-contract.js` — THE contract (types, `event.*` builders, `normalizeTradeEvent`)
- `/data_engine/data/registry.js` — adapter registry (`getBroker`, `listBrokers`)
- `/data_engine/data/trade-feed.js` — bridges every broker's stream into the platform stores
- `/data_engine/data/raw-tap.js` — `emitRaw`/`onRaw` diagnostic tap (Data Interceptor)
- `/data_engine/platform/` — authoritative stores: orders, positions, fills, accounts, console
- `/data_engine/orders/` — order worker (exec, reconcile; owns all order logic)
- `/data_engine/terminal/` — standalone headless TUI (excluded from packaging)

## App source (`/src`) by subsystem

- `/src/main.js` — renderer bootstrap
- `/src/chart/` — chart panes (`pane.js` drives kapelka); `/src/chart/order-view/` = on-chart orders
- `/src/studies/` — studies RUNTIME: `registry.js`, `host.js`, `library.js`, `user-loader.js` (study packs live in `/packages/studies/`)
- `/src/tools/` — drawing-tool RUNTIME: engine, toolbar, `user-loader.js` (tool packages live in `/packages/tools/`)
- `/src/commands/` — command registry: `registry.js`, `builtin.js`, `keybindings.js`
- `/src/surface/` — Trade Desk (`desk.js`) + mini-tabs (Console/Orders/Positions/History/Accounts)
- `/src/panels/` — right-rail panels + the `rightpanel.js` coordinator
- `/src/alerts/` — alert engine: `funnel.js`, `store.js`, `log-store.js`, `host.js`, `eval.js`, `alerts-panel.js`
- `/src/order-ticket/` — Order ticket window UI (entry/limit/stop/modify, quotes, plan sync)
- `/src/settings/` — settings store + `theme.js`
- `/src/i18n/` — i18n runtime (`t()`, vocab loader); vocab packs live in `/packages/vocab/`
- `/src/ipc-contract.js` — BroadcastChannel channel names (the IPC contract)

## Packages (`/packages`) — the app's installable content

One home for every installable content class, discovered at runtime and excluded from the release (a blank slate the package manager fills). Drop a folder/file in and it loads.

- `/packages/studies/` — study packages (`<id>/<id>.js` + optional `meta.json`; `Studies.register`)
- `/packages/tools/` — drawing-tool packages (`<id>/tool.js` + optional `icon.png`, `vocab.json`)
- `/packages/primitives/` — on-chart order renderers (`<id>/index.js`; `pill` is the built-in default, ships)
- `/packages/vocab/` — official vocabulary packs (flat `<locale>.json`, Weblate-owned; user custom packs stay in `settings/appearance/vocab/`)
- `/packages/themes/` — app theme files (`<name>.json`); `Dark`/`Light` are the code-baked floor (`src/settings/theme.js`), the active one is `settings.json`'s `currentTheme`
- `/packages/chart-templates/` — chart-appearance templates (`<name>.json`); the active one per mode is `settings.json`'s `themeModes.<mode>.chart`

Adapters are the ENGINE's installable slot (`/data_engine/adapters/`), not app content. Addons are the Node-host apps (`/addons/`, below). Both stay put.

## Addons (`/addons`) — EA-like modules, run in the addon host

- `data-interceptor`, `perf-monitor`, `position-manager`, `screenshot`, `tv-bridge`
- `/addons/addon-globals.d.ts` — addon API typings

## Config & settings

- `/settings/` — COMMITTED (workspaces, prefs) — EXCEPT `/settings/brokers/` (credentials, excluded). Theme/chart-template FILES moved to `/packages/`; only the active SELECTION lives here (`settings.json`).
- `/settings/appearance/` — `colors.json`, `palettes.json`, and `vocab/` (user custom vocab packs; official packs live in `/packages/vocab/`)
- `/packaging/seed-settings.json` — first-run `settings.json` seed, dropped into the release by electron-builder `extraFiles` (default themes + chart template + timeframe bar)
- `/contract-coverage.csv` — adapter contract-coverage matrix (CQG/Schwab/OANDA/MT5 columns)
- `/package.json` — deps + electron-builder `build` config (`build.icon`, packed `files`)
- `/icon.png` — app icon (512×512)
- `/CLAUDE.md`, `/CLAUDE.local.md` — agent instructions
- `/logs/app.log` — main-process log (rotates to `.1` at 5 MB, on startup only)

## Docs & notes (raw agent output vs published site)

- `/docs/web/src/pages/docs` — Astro USAGE documentation (published, human-facing)
- `/docs/web/src/pages/adr` — Astro ADR "Schema" documentation (published, human-facing)
- `/.docs/projects` — project notes: to-spec + to-slice output (`specs.md`, `plan.md`, `slices/`)
- `/.docs/adr` — raw ADR-skill output (`0001-…`, `0002-…`, `0003-…`)
- `/.temp` — scratch / lab work (gitignored); e.g. `/.temp/schwab-lab/`

## Skills (`/.claude/skills`) — self-contained agent skills

- `design-studio` (the model: SKILL + craft + templates + tooling), `adr`, `to-spec`, `to-slice`,
  `grill-me`, `refactoring`, `codebase-design`, `web-inspect`, `webpage`, `diagnosing-bugs`, `git-workflow`

## Verification & debug

- `npm run typecheck` — `tsc --noEmit` (checkJs strict, JSDoc types)
- `npm run lint` — eslint (`import-x/no-cycle` = error)
- CDP debug port `127.0.0.1:9222` (set by `npm start`)
