---
layout: ../../layouts/DocsLayout.astro
title: Introduction
---

# Introduction

First Steps got you running. This section explains how Plain Charts is built, so you can extend it with a clear mental model of what happens underneath.

## Two cores

Plain Charts is built on two engines, each of which can run independently:

- **kapelka** — Renders the charts. A framework-free, zero-dependency port of trading-vue-js.
- **Data engine** — Runs execution: broker adapters, a headless data host, platform stores, and the order worker.

The application layers on top of both. See [Execution architecture](/docs/architecture/execution-architecture) and [Contracts](/docs/architecture/contracts).

## How it runs

The same application runs in several roles:

- **data-host** — Headless. Owns the broker connections and the authoritative stores.
- **UI** and **addon-host** — Proxy requests to the data host over a communication channel.
- **solo** — Runs everything in a single browser page.

See [The multi-window host model](/docs/architecture/multi-window-host-model) and [The data host](/docs/architecture/data-host).

## What you extend

Studies, tools, adapters, and addons are plain ES modules composed at runtime against documented APIs.

- **Studies** — Compute off the render thread. See [Writing a study](/docs/studies/writing).
- **Adapters** — Translate a broker protocol into a neutral contract. See [Broker adapters](/docs/data/broker-adapter).
- **Addons** — Run in a Node.js host with access to the app's API. See [The addon system](/docs/addons/overview).
- **Assistant** — Uses the same command surface through policy-gated MCP. See [The AI assistant](/docs/ai/assistant).
