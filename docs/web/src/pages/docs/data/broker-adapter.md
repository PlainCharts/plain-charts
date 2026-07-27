---
layout: ../../../layouts/DocsLayout.astro
title: Broker adapters
---

# Broker adapters

The app speaks one language. Each broker gets a small translator, so adding a broker touches nothing else.

## The problem

The app connects to many brokers. Each broker speaks its own protocol.

One says `BUY`. One says `1`. One says `PURCHASE_ORDER`. All three mean the same thing.

If the app learned every broker's language, adding a broker would touch code everywhere. That does not scale.

So the app speaks one language. Each broker gets a translator.

## The adapter

An adapter is a translator for one broker. It speaks that broker's protocol on one side. It speaks the app's fixed language on the other. One module per broker.

The broker sends `BUY`. The app's word is `buy`. The adapter turns `BUY` into `buy` inside itself. The rest of the app never sees `BUY`. It only ever sees `buy`.

Adding a broker means writing one translator. Nothing else in the app changes.

## The contract

The app understands a small, fixed set of words. That set is the [contract](/docs/architecture/contracts). One shared file. Every adapter follows it.

The vocabulary for trading is short: an order, a fill, a position, an account, a reject. Each has an exact shape. A broker might send a hundred fields. The adapter keeps these and drops the rest.

The contract also checks the words. A malformed message is rejected loudly. You see a warning. A broken or brand-new adapter cannot corrupt anything downstream. It just tells you what it got wrong.

## One contract, many adapters

Two things, kept straight.

- **The contract.** One shared file, owned by the app. It never changes per broker.
- **The adapters.** One per broker, independent. Each knows only the contract.

An adapter knows nothing about the other adapters. It knows nothing about the app's internals.

## How data travels

Everything the broker sends flows the same path. The [data host](/docs/architecture/data-host) is the one place adapters live.

```
BROKER          ADAPTER              DATA HOST           APP
own protocol ─▶ translate to      ─▶ check + route  ─▶   charts · orders ·
                the app's words       bad → dropped        positions · accounts
                                      loud
```

When the broker reports a fill:

1. The broker sends its own message.
2. The adapter translates it into a contract shape.
3. The data host checks it. It drops a bad message with a warning and routes a valid one to the charts and the app-wide stores.
4. The app reads it. No view or addon knows which broker it came from.

The data host does not translate. Translation happens inside the adapter. The data host only checks and routes words that already arrived in the app's language.

## Actions go back the same way

Placing or cancelling an order runs the path in reverse.

You call a neutral action: place, cancel, modify, close. The data host routes it to the right adapter. The adapter translates it into the broker's protocol and sends it. Same contract, opposite direction.

## Where next

- [How adapters load](/docs/data/adapter-loading). Where adapters live, how the app finds them, how a connection is made.
- [Writing an adapter](/docs/data/writing-an-adapter). The interface to implement and the shapes to emit.
