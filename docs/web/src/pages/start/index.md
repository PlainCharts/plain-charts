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

Need to connect to a broker that isn't supported? Write your own adapter using the [adapter contract](/docs/data/writing-an-adapter).

## Configure

Open **Settings** to customize Plain Charts for your workflow.

![The Settings dialog](/images/settings.jpg)

Settings are organized into two groups:

### Chart

Everything that affects the current chart. These settings are saved with chart templates, so you can apply the same look and behavior with a single click.

- **Instrument** — Candles, borders, and wicks
- **Canvas** — Chart background and canvas
- **Scales** — Price and time axes
- **Status** — On-chart status line
- **Trading** — On-chart order behavior
- **Time** — Trading sessions and time zone
- **Chart Theme** — Save and load chart layouts and styles

### Global

Everything that applies across the entire application. These settings are saved with your user profile and apply to every chart and window.

- **General** — App-wide preferences
- **Data** — Historical data cache
- **App Theme** — Application theme
- **Hotkeys** — Custom keyboard shortcuts
- **Notifications** — How alerts are delivered
- **Alerts** — Default alert settings
- **Advanced** — Power-user options

### Themes

Customize the look of both your charts and the application.

Choose a built-in theme or create your own in the theme editor.

![The chart theme editor](/images/theme.jpg)

- **Chart themes** — Customize candles, background, grid, crosshair, scales, and more. Saved with chart templates.
- **App themes** — Customize the appearance of the entire application.

Select a preset from the dropdown, or click **New** to create a theme. Organize themes into folders, and import or export them to share with others.

### Vocabulary

Vocabulary packs change the words the app uses, so the screen reads in terms your mind already understands. The same mechanism handles translation into other languages.

![The app running a Spanish vocabulary pack](/images/vocab.jpg)

Several packs are available today. Pick one from the dropdown, or import your own.

Translations are managed through Weblate. To help translate Plain Charts into your native language, join the project on [Weblate](https://hosted.weblate.org/engage/plain-charts/).

> This guide covers the most commonly used settings, not every available option.
