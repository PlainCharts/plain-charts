# Changelog

All notable changes documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Object tree: drag a layer tab up or down to reorder the layer column
- Position tool: a Risk/reward input in the Profit level section sets the target from your desired R multiple
- Create limit order from the Position tool: right-click it and the order dialog opens prefilled with entry, stop, target, and the risk-computed quantity
- Studies can declare their own alert conditions: the Fair Value Gap study offers Bullish/Bearish FVG and their mitigations
- Alert a study's value against a number you type (RSI Crossing Up 35)
- Alerts on indicators: price crossing an attached study's line fires, even with every chart closed
- Alerts on a Vertical Line: a one-shot time alert bound to the line
- Time alerts have a Name field; an unnamed alert titles itself from its live schedule
- Alerts on a Rectangle: touch, enter from below/above, or close beyond the zone, within its drawn time span
- Alerts on drawn lines: the trend-line family, level ray, and path evaluate exactly as drawn and follow drags
- Alerts on a Horizontal Ray
- Bracket (stop + target) on a resting Limit or Stop order, per broker support, including CQG netting accounts
- Stats desk tab: equity curve, edge distribution, and a configurable board of summary stats over closed trades

### Removed
- The History stats bar and its Trade Desk > Configure > Stats tab; the Stats surface replaces them

### Changed
- Position tool: the Inputs tab is laid out two fields per row, so the dialog no longer scrolls
- Drawing settings open on the tool's Inputs tab when it has one, instead of always Style
- Layer tab menu reordered: Hide, Lock, Rename, then Remove
- Symbol dialog: browse MetaTrader 5 instruments in a tree of the broker's own groups
- Symbol dialog: clear (✕) button in the search box
- Symbol dialog: browse CQG instruments in a tree, with a saved exchange filter and per-broker recents
- Creating an alert on a drawing opens the Add-condition dialog first, pre-set to Price Crossing that drawing
- Indicator alerts follow the study instance: edit its settings and the alert fires on the new values; removing the study asks, then removes both
- Alert conditions are a list of sentences, each crafted in its own Add-condition dialog
- Alert feeds load history back to the drawing's oldest anchor
- "Create alert on" is offered only on drawings that can carry an alert

### Fixed
- Range tools select only by their stems and measure line; the area inside the span stays workable, like the Fib
- Mouse-wheel zoom works on timeframes with few bars (the Monthly chart no longer freezes)
- Daily charts: month labels sit on the first bar that trades the new month, not one session late
- Object tree: dragging a selection near the list's edge now scrolls smoothly toward it, instead of the browser's on-and-off native scroll
- Object tree: the Clone button shows its icon again
- Undo/redo keeps drawings in their layers and folders instead of dumping them into the active layer
- Create limit order from the Position tool: the dialog's Price field can no longer end up at the live price instead of the box's entry
- Critical: a resting bracket entry that fills in pieces no longer multiplies its stop coverage on netting accounts
- Position tool: an exactly-fitting quantity no longer loses one step to floating-point rounding
- Alert conditions refuse studies the engine cannot compute headless, instead of saving an alert that never fires
- The #price placeholder uses the instrument's decimals
- Alert notifications send your Name and Message with placeholders substituted; nothing is invented
- Picking Value in an alert condition shows a plain number defaulting to 0
- An alert that can never fire shows Unsupported and refuses to save, instead of sitting Active in silence
- A Market projection can no longer be dragged off the live price
- Placing an order clears the on-chart planning projection
- The order dialog picks up a stop dragged on the chart while it was closed
- Symbol dialog: CQG search matches by symbol code, not only by description
- The order ticket grows to fit the quick buttons instead of hiding Buy/Sell
- A rejected modify on a pending order shows its error in the ticket status line

## [0.1.0] - 2026-07-28

Initial release.

- Charting engine (kapelka) — a framework-free, zero-dependency port of trading-vue-js
- Multi-broker execution through plug-in adapters: CQG, MetaTrader 5, Schwab, and OANDA
- Data engine — a headless data host, platform stores (orders, positions, fills, accounts, console), and an order worker that owns bracket/OCO logic
- Data caching — opt-in persistent store of historical bars per broker and symbol
- Studies computed off the render thread, drawing tools, and on-chart order primitives
- Object tree — organize drawing objects into layers and folders
- Trade desk — console, orders, positions, history, and accounts with configurable columns
- Watchlist — track symbols with live quotes
- Chart trading — place, move, and close orders and brackets directly on the chart via draggable lines
- Order ticket with risk-based position sizing and OCO brackets
- Alerts — price, time, and moving-percent conditions with a persistent log
- Addon system — extension modules that run in a Node.js-enabled host with access to internal APIs and external Node
- Package manager (Pacman) — browse, install, and remove studies, tools, addons, adapters, themes, and vocabulary
- Assistant with policy-gated MCP integration
- Command registry — one action, many triggers (rebindable hotkeys, menus, assistant)
- App themes, chart templates, and translatable vocabulary packs
- Multi-window setup with tabs and chart layouts
- Runs as an Electron desktop app or served in the browser
