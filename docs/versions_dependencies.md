# Plain Charts — Version & Dependency Reference

Snapshot of the versions this project runs on and every npm package it depends on.
Captured **2026-07-21**. Nothing else lives in this file.

App: `plain-charts` **0.1.0** — appId `com.etherstrannik.plaincharts`.

---

## Runtime

Bundled by Electron (not separately installable — they move only when Electron does).

| Component | Version |
|-----------|---------|
| Electron  | **43.1.1** |
| Node.js   | **24.18.0** |
| Chromium  | **150.0.7871.114** |
| V8        | 15.0.245.15-electron.0 |
| libuv     | 1.52.1 |
| OpenSSL   | BoringSSL (Electron build) |

---

## Root package — the desktop app (`package.json`)

### Runtime dependencies (shipped)

| Package | Version | What it is |
|---------|---------|------------|
| `@modelcontextprotocol/sdk` | **1.29.0** | MCP — the assistant tool server/client |
| `nodemailer` | **9.0.3** | Email sending (alert notifications) |
| `node-pty` | **1.1.0** | Native PTY — the one compiled module; rebuilt per Electron ABI |
| `@xterm/xterm` | **6.0.0** | Terminal emulator (UI) |
| `@xterm/addon-fit` | **0.11.0** | xterm resize-to-container addon |

### Dev / build dependencies (not shipped)

| Package | Version |
|---------|---------|
| `electron` | **43.1.1** |
| `electron-builder` | **26.15.3** |
| `typescript` | **5.9.3** |
| `eslint` | **10.7.0** |
| `@eslint/js` | **10.0.1** |
| `eslint-plugin-import-x` | **4.17.1** |

Transitive: **340** packages installed under `node_modules/`.

---

## Engine terminal — standalone Node TUI (`data_engine/terminal/`)

Separate package; excluded from the packaged app (`!data_engine/terminal/**`).

### Dependencies

| Package | Version |
|---------|---------|
| `@modelcontextprotocol/sdk` | **1.29.0** |
| `react` | **19.2.7** |
| `ink` | **7.1.1** |
| `zod` | **3.25.76** |

### Dev

| Package | Version |
|---------|---------|
| `esbuild` | **0.25.12** |
| `ink-testing-library` | ^4.0.0 (declared) |

Transitive: **132** packages under `data_engine/terminal/node_modules/`.

---

## Vendored render engine (`lib/kapelka/`)

| Package | Version | Notes |
|---------|---------|-------|
| `kapelka` | **0.1.0** | Vendored source (its own git repo); **zero npm dependencies** |

---

## Docs site (`docs/web/`)

Separate Astro project; never ships in the app. Versions as declared (ranges).

| Package | Version |
|---------|---------|
| `astro` | ^5.6.1 |
| `sharp` | ^0.34.2 |
| `pagefind` | ^1.3.0 (dev) |

---