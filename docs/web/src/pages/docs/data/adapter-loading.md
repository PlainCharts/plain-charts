---
layout: ../../../layouts/DocsLayout.astro
title: How adapters load
---

# How adapters load

Drop a folder in. The app finds it, loads it, and builds its connect form. No wiring.

For the concept behind an adapter, see [Broker adapters](/docs/data/broker-adapter).

## Where they live

Each adapter is a folder under `data_engine/adapters/`. Only one entry file is required. A multi-file adapter keeps its extra files in its own folder.

```
data_engine/adapters/
  cqg/      entry file + its own protocol files
  schwab/
  oanda/
```

The app scans this folder. Every folder with an entry file is an adapter. Drop one in and it appears. There is no list to register it in. A button in the Connections dialog opens this folder in your file manager.

## Loaded at startup

At startup the app loads each adapter. Loading adds it to the shared broker list. The app waits until every adapter has registered. So the list is complete before anything reads it.

Loading happens once, at startup. A newly added adapter is picked up on the next start. It is not hot-loaded mid-session.

## Quarantined behind the data host

Adapters run behind the [data host](/docs/architecture/data-host). Every event an adapter emits is checked against the [contract](/docs/architecture/contracts) there. A malformed one is dropped loudly. You see a warning in the Console. A new or broken adapter cannot corrupt anything downstream.

## The connect form builds itself

The Connections dialog renders whatever each adapter declares. There is no broker-specific code in the dialog.

One adapter asks for a user and a password. Another runs an OAuth button with a live status line. Another takes a single token. The dialog changes nothing to support any of them.

## Capabilities gate features

Each adapter declares what it can do. Market data. Trading. Depth. The app turns features on or off from that.

An adapter without trading never feeds the Orders, Positions, or Accounts views. A trading one lights them up on its own.

## Connecting

You connect an account. The app finds the adapter by the account's protocol. The adapter opens its own session and starts translating. Quotes and bars go to the charts. Orders, positions, and accounts go to the app-wide stores.
