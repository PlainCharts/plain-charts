# Changelog

All notable changes documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Bracket on a resting order: a Limit or Stop entry can now carry a stop and target on any broker whose protocol supports it, including CQG netting accounts. CQG places it as a server-side OPO/OCO compound, so the target and stop stay parked until the entry fills, then one filling cancels the other. Each adapter declares its own resting-order bracket support, so the order dialog and the on-chart order pill enable it per broker
- Stats desk tab: a strategy dashboard over your closed round-trips -- an equity curve, an edge/spread (mean ± σ) distribution, and a drag-configurable board of USD summary stats (EV, avg win/loss, win/loss/BE %, max drawdown, max loss streak, profit factor, Sharpe). Opt-in via the desk "+", with the same account + date filters as History plus a "last N trades" sample size; the gear opens a two-grid editor to arrange which tiles show and where

### Removed
- Stats bar: removed the History surface's bottom stats strip and its Trade Desk > Configure > Stats tab (the reorderable, on/off stat list); a dedicated Stats surface replaces it

### Changed
- Symbol dialog: browse MetaTrader 5 instruments in a tree built from the broker's own symbol groups, with each symbol's broker description
- Symbol dialog: clear (✕) button in the search box that wipes the text in one click without closing the dialog
- Symbol dialog: browse CQG instruments in a tree (group / exchange / instrument type) beside the search, with a saved exchange filter and per-broker recents

### Fixed
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
