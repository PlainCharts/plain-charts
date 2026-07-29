---
layout: ../../layouts/DocsLayout.astro
title: Getting started
---

# Getting started

From download to a running app.

## Install

The easiest way to get started is to download a prebuilt desktop app for your platform.

- **Windows, macOS, and Linux:** Download the latest release from the [Releases](https://github.com/PlainCharts/plain-charts/releases) page and run it.

If you'd rather build from source:

```bash
git clone https://github.com/PlainCharts/plain-charts.git
cd plain-charts
npm install
npm start
```

> **Note:** `npm install` builds `node-pty` as a native module, so you'll need Node.js and a working C/C++ toolchain installed.

## Add packages

Plain Charts starts with a small core. Add only the features you need using the built-in package manager, **Pacman**.

![Pacman, the built-in package manager](/images/pacman.jpg)

Open **Pacman** to browse and install packages by category:

- **Studies** — Indicators and computations
- **Tools** — Drawing tools
- **Adapters** — Broker connections
- **Addons** — Extension modules
- **Themes** — App and chart themes
- **Vocabulary** — Interface language packs

Prefer to grab them yourself? Browse the packages directly on GitHub:

- [Addons](https://github.com/PlainCharts/plain-charts/tree/main/addons)
- [Adapters](https://github.com/PlainCharts/plain-charts/tree/main/data_engine/adapters)
- [Everything else](https://github.com/PlainCharts/plain-charts/tree/main/packages) — studies, tools, themes, and vocabulary

Install the packages you want, then connect to your broker.

## Connect

To start charting or trading, connect Plain Charts to your broker.

Open **Connections**, add an account, choose your broker's protocol, and connect. Plain Charts uses **adapters** to communicate with each broker, and four are included out of the box.

Each broker has its own setup guide:

- **[CQG](https://github.com/PlainCharts/plain-charts/blob/main/data_engine/adapters/cqg/info.md)** — Cloud gateway for futures
- **[MetaTrader 5](https://github.com/PlainCharts/plain-charts/blob/main/data_engine/adapters/mt5/info.md)** — Connect through a local MT5 terminal using the bridge EA
- **[Schwab](https://github.com/PlainCharts/plain-charts/blob/main/data_engine/adapters/schwab/info.md)** — Stocks and options, with a one-time developer app setup
- **OANDA** — Forex and CFDs
