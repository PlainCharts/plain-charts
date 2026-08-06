# Changelog

All notable changes documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Indicator threshold alerts: a study's own value against a number you type, on the study's own scale (RSI Crossing Up 35, BB Upper Greater Than a level). Crossings compare consecutive bars of the study line. Guide lines (RSI's 70/30 bands) are decoration, not alert targets, and switching a condition's Object resets the Value to a fresh 0
- Alerts on indicators: price crossing an overlay study's line fires for real. Pick an attached study as a condition Object (a multi-plot study offers a band picker: Upper/Basis/Lower), and the alert engine computes the study headless on its own bar feed, so it fires with every chart closed. Many alerts on one study share a single computation
- Alerts on a Vertical Line: "Create alert" on a vline opens the time-alert dialog pre-set to a one-shot at the line's instant. The alert is bound to the line: dragging the line re-schedules it, the bell rides the line, and deleting either removes both. A one-shot pointed at the past refuses to save
- Time alerts: a Name field in the dialog (default: the date only). Left empty, the panel titles the row from the live schedule, so a dragged line can never leave a stale time in the title
- Alerts on a Rectangle: the zone fires only within its drawn time span. Crossing = a bar touches the box (a gap straight through counts), Crossing Up/Down = entering through the bottom/top edge, Greater/Less Than = closing beyond it. Moving or resizing the box updates its alert, and the bell sits on the box's right edge
- Alerts on drawn lines: the trend-line family (trend line, ray, extended line), the level ray, and the multi-point path can now carry alerts. Price is tested against the line exactly as drawn, at every slope and strand, on the alert's own interval; rays extrapolate, a finite line past its end simply never fires. Dragging the line updates its alert, and the on-chart bell badge sits on the line where it meets the price scale
- Alerts on a Horizontal Ray: right-click a horizontal ray, Create alert, and it evaluates like a horizontal line (fixed price level, follows the line when dragged)
- Bracket on a resting order: a Limit or Stop entry can now carry a stop and target on any broker whose protocol supports it, including CQG netting accounts. CQG places it as a server-side OPO/OCO compound, so the target and stop stay parked until the entry fills, then one filling cancels the other. Each adapter declares its own resting-order bracket support, so the order dialog and the on-chart order pill enable it per broker
- Stats desk tab: a strategy dashboard over your closed round-trips -- an equity curve, an edge/spread (mean ± σ) distribution, and a drag-configurable board of USD summary stats (EV, avg win/loss, win/loss/BE %, max drawdown, max loss streak, profit factor, Sharpe). Opt-in via the desk "+", with the same account + date filters as History plus a "last N trades" sample size; the gear opens a two-grid editor to arrange which tiles show and where

### Removed
- Stats bar: removed the History surface's bottom stats strip and its Trade Desk > Configure > Stats tab (the reorderable, on/off stat list); a dedicated Stats surface replaces it

### Changed
- Symbol dialog: browse MetaTrader 5 instruments in a tree built from the broker's own symbol groups, with each symbol's broker description
- Symbol dialog: clear (✕) button in the search box that wipes the text in one click without closing the dialog
- Symbol dialog: browse CQG instruments in a tree (group / exchange / instrument type) beside the search, with a saved exchange filter and per-broker recents

### Changed
- Alert bar feeds now load history back to the drawing's oldest anchor, so an alert on a line or box anchored days or weeks ago evaluates on real bars exactly where it is drawn, instead of approximating from a fixed 300-bar window
- Drawing alerts: "Create alert on" is offered only on drawings that can carry an alert. Annotations and measurement tools (text, symbol, callout, arrow, the ranges, fib, position) no longer offer it, in the right-click menu or the price-scale quick editor

### Fixed
- Alert dialog: picking Value in a condition now shows a plain number defaulting to 0 (a Value is scale-agnostic: a price against Price, an indicator level against a study), instead of an empty box hinting "Price"
- Alerts: an alert whose condition can never be evaluated now shows an Unsupported status with a red dot in the panel, and the create/edit dialog refuses to save it with a clear warning. Before, such alerts (e.g. anchored to a trend line or a horizontal ray) saved fine, showed Active, and silently never fired
- Planning pill: a Market projection can no longer be dragged off the live price. The pill refuses the drag until you cycle its type to Limit or Stop; switch back to Market and it locks to the live price again
- Order dialog: placing an order now clears the on-chart planning projection, so the gray planning primitive no longer lingers on top of the order you just placed. Placement ends the planning session, the same way the pill's cancel and confirm already did
- Order dialog: opening it now picks up a stop that was dragged on the chart while it was closed; a stale startup snapshot no longer wins over the live plan
- Symbol dialog: CQG search now matches by symbol code (e.g. EP), not only by description
- Order ticket: the window now grows to fit your quick buttons instead of squishing the form and hiding Buy/Sell
- Order ticket: a rejected modify on a pending order now shows the error in the ticket status line instead of nothing

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
