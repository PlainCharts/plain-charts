# Changelog

All notable changes documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Connections: for a CQG account, choose which exchanges your market-data subscription covers (foundation for the upcoming symbol browser)

### Fixed
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
