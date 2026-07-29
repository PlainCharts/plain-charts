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

Make Plain Charts speak your language.

Vocabulary packs change the terms used throughout the application. They can also translate the interface into other languages.

![The app running a Spanish vocabulary pack](/images/vocab.jpg)

Choose a vocabulary pack from the dropdown, or import your own.

Want to help translate Plain Charts? Join the project on [Weblate](https://hosted.weblate.org/engage/plain-charts/) to contribute translations for your language.

> This guide covers the most commonly used settings, not every available option.

## Customize

Extend and arrange Plain Charts to fit how you work.

### Toolbar

Customize the drawing toolbar to include only the tools you use.

Click **⋯** on the toolbar to open **Customize toolbar**, where you can:

- Show or hide tools
- Reorder tools
- Assign keyboard shortcuts

![The Customize toolbar dialog](/images/toolbar.jpg)

Plain Charts includes a set of essential drawing tools in the [repo](https://github.com/PlainCharts/plain-charts/tree/main/packages/tools) to choose from. To create your own, click **Write new tool** and start from one of the provided examples.

### Studies

Add indicators from the **Studies** dialog.

Download ready-made studies from the [repo](https://github.com/PlainCharts/plain-charts/tree/main/packages/studies), or write your own in JavaScript.

![The Studies dialog](/images/studies.jpg)

Studies use vanilla JavaScript with no build step, so there is no new language or toolchain to learn. Start from the provided examples, then see [Writing a study](/docs/studies/writing) for more details.

You can also organize your studies:
- Mark favorites for quick access
- Group studies into your own lists

### Addons

Extend Plain Charts with addons from the **Addons manager**.

Enable an addon, assign a hotkey, configure it, or reload it in place.

![The Addons manager](/images/addons.jpg)

Addons are written in vanilla JavaScript and run on Node.js, giving them full access to the outside world and deeper integration with the app through its API.

To create your own addon, click **Write new addon** and start from the provided examples. See [Writing an addon](/docs/addons/authoring) for more.

### Workspaces

Create and manage workspaces from the **Workspaces manager**, opened with the **+** button next to the chart tabs.

![The Workspaces manager](/images/workspaces.jpg)

Each workspace keeps its own history, layout, and chart memory, so you can switch between separate setups without losing your context.

See [Workspaces](/docs/concepts/workspaces) for more.

### Layouts

Build a multi-pane layout with the **Layout builder**, opened from the button in the top-right corner.

![The layout menu](/images/layout-menu.jpg)

Split, resize, and arrange panes interactively, then click **Apply** to use your layout.

![The interactive layout builder](/images/layout-builder.jpg)
