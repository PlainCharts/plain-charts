# Changelog

All notable changes documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Money management: a per-account sizing system that sizes every order from a zone/ladder risk model, set up in a new Money Man desk tab; when an account is on it, ticket, DSL, and on-chart orders all size automatically from the account's live balance and closed-trade history
- Order ticket: picking a money-management account locks the Qt type to Money man, shows the engine's current level and risk (e.g. MIN 0.75% · $2,316.59), and previews the sized Volume live off the moving price -- the same number the worker executes, on the on-chart pill too

### Changed
- Money management sizing is keyed by the exact account (accountId), not the broker -- multiple saved accounts on one protocol can no longer cross-match; config edits now reach every window instantly instead of on a 4-second poll
- Symbol dialog: browse MetaTrader 5 instruments in a tree built from the broker's own symbol groups, with each symbol's broker description
- Symbol dialog: clear (✕) button in the search box that wipes the text in one click without closing the dialog
- Symbol dialog: browse CQG instruments in a tree (group / exchange / instrument type) beside the search, with a saved exchange filter and per-broker recents

### Fixed
- On-chart order pill: on a money-management account it now sizes itself from the engine and the live price with no order dialog open; before, it showed qty 1 until the dialog was opened
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
