---
layout: ../../layouts/DocsLayout.astro
title: Customize
---

# Customize

Extend and arrange Plain Charts to fit how you work.

## Toolbar

Customize the drawing toolbar to include only the tools you use.

Click **⋯** on the toolbar to open **Customize toolbar**, where you can:

- Show or hide tools
- Reorder tools
- Assign keyboard shortcuts

![The Customize toolbar dialog](/images/toolbar.jpg)

Plain Charts includes a set of essential drawing tools in the [repo](https://github.com/PlainCharts/plain-charts/tree/main/packages/tools) to choose from. To create your own, click **Write new tool** and start from one of the provided examples.

## Studies

Add indicators from the **Studies** dialog.

Download ready-made studies from the [repo](https://github.com/PlainCharts/plain-charts/tree/main/packages/studies), or write your own in JavaScript.

![The Studies dialog](/images/studies.jpg)

Studies use vanilla JavaScript with no build step, so there is no new language or toolchain to learn. Start from the provided examples, then see [Writing a study](/docs/studies/writing) for more details.

You can also organize your studies:
- Mark favorites for quick access
- Group studies into your own lists

## Addons

Extend Plain Charts with addons from the **Addons manager**.

Enable an addon, assign a hotkey, configure it, or reload it in place.

![The Addons manager](/images/addons.jpg)

Addons are written in vanilla JavaScript and run on Node.js, giving them full access to the outside world and deeper integration with the app through its API.

To create your own addon, click **Write new addon** and start from the provided examples. See [Writing an addon](/docs/addons/authoring) for more.

## Workspaces

Create and manage workspaces from the **Workspaces manager**, opened with the **+** button next to the chart tabs.

![The Workspaces manager](/images/workspaces.jpg)

Each workspace keeps its own history, layout, and chart memory, so you can switch between separate setups without losing your context.

See [Workspaces](/docs/concepts/workspaces) for more.

## Layouts

Build a multi-pane layout with the **Layout builder**, opened from the button in the top-right corner.

![The layout menu](/images/layout-menu.jpg)

Split, resize, and arrange panes interactively, then click **Apply** to use your layout.

![The interactive layout builder](/images/layout-builder.jpg)
