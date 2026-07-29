---
layout: ../../../layouts/DocsLayout.astro
title: Order dialog
---

# Order dialog

Open the **Order dialog** from the **Order** button on the toolbar.

![The Order dialog with an on-chart order primitive](/images/order-dialog.jpg)

The dialog supports broker order types through separate tabs:

- **Market, Limit, Stop** — Place that order type
- **Modify** — Change an existing order

Set the account, symbol, quantity, direction, stop, and target, then click **Buy** or **Sell**.

Enable **Project order** to draw the order as a primitive on the chart. The dialog and the chart primitive stay synchronized, so you can build and adjust an order from either place.

The default primitive uses a kebab-style control. Drag the stop and target handles to set levels, move the control on the chart, and change quantity, direction, or order type directly. Cancel or execute from the same control.

After execution, choose what remains visible on the chart. Hide the entry, stop, or target to keep the display focused on what matters to you.

The on-chart primitive is configurable. Open **Settings → Chart → Trading → Primitives** to choose the primitive and style its colors, placement, and lines.

![On-chart primitive settings](/images/primitives.jpg)

The app ships with a default primitive (**Pill**), but it isn't set in stone. Build your own to match your thinking and visual vocabulary. Examples are available through Pacman.

For more, see [On-chart order primitives](/docs/architecture/on-chart-orders).
