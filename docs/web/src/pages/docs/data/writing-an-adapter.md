---
layout: ../../../layouts/DocsLayout.astro
title: Writing an adapter
---

# Writing an adapter

An adapter translates your broker's protocol into the app's vocabulary.

## Start from a shipped one

The fastest start is to copy an adapter and change the translation. Three ship, each showing a different shape.

- `data_engine/adapters/cqg` is the fullest reference. Market data, depth, full trading.
- `data_engine/adapters/schwab` shows OAuth.
- `data_engine/adapters/oanda` is a compact REST one.

## One import

An adapter imports one stable module, the SDK. It announces itself with `registerBroker`. It builds neutral events with `event`.

```js
import { registerBroker, event } from '/data_engine/data/adapter-sdk.js';

registerBroker({ id: 'my-broker', label: 'My Broker', /* … */ });
```

Import anything else from the app by absolute path, so your folder can sit anywhere. Keep your own sibling files relative, like `./transport.js`.

## Implement what you support

Implement only what your broker does. The app degrades around what you leave out.

| area | members |
|---|---|
| identity | `id`, `label`, `capabilities: { marketData, trading, depth }` |
| lifecycle | `connect(account, ctx)`, `disconnect()`, `isConnected()` |
| connect form | `form: [field]` — the credentials dialog |
| market data | `resolveSymbol`, `subscribeQuotes` / `unsubscribeQuotes`, `subscribeBars` / `getBars`, `subscribeDepth` |
| execution | `subscribeTrade` / `unsubscribeTrade`, `getPositions`, `getAccount` |
| actions | `placeOrder`, `cancelOrder`, `modifyOrder`, `closePosition` |

The `account` passed to `connect` carries what the user typed into your form, such as `account.username`.

## Emit the neutral shapes

Translate the broker's messages into contract shapes. Always build them with `event`. Then the shape is guaranteed, and the data host accepts them.

```js
subscribeTrade(cb) {
  onBrokerOrder(o  => cb(event.order({ id: o.ref, symbol: o.sym, side: o.buy ? 'buy' : 'sell',
                                       type: o.kind, qty: o.qty, price: o.px, tif: o.tif, status: o.state })));
  onBrokerFill(f   => cb(event.fill({ id: f.ref, symbol: f.sym, side: f.side, qty: f.qty, price: f.px, time: f.ms })));
  onBrokerPos(p    => cb(event.position({ symbol: p.sym, qty: p.qty, side: p.long ? 'long' : 'short', avgPrice: p.avg })));
  onBrokerAcct(a   => cb(event.account({ accountId: a.id, balance: a.bal, equity: a.eq })));
  onBrokerReject(r => cb(event.reject({ code: r.code, text: r.text })));
}
```

The `status` should be a canonical order status, like `working`, `filled`, `cancelled`, or `rejected`. Quotes, bars, and depth are plain objects: `{ bid, ask, last }`, `{ time, open, high, low, close, volume }`, `{ bids, asks }`.

A wrong shape shows a `dropped malformed trade event` warning in the Console. It names the field that is off. Fix it and re-run.

## Declare the connect form

The dialog renders whatever your `form` says. There is no template. Each field is `{ key, type, label, default?, options? }`.

```js
form: [
  { key: 'server',   type: 'select',   label: 'Server', options: ['Demo', 'Live'], default: 'Demo' },
  { key: 'username', type: 'text',     label: 'Username' },
  { key: 'password', type: 'password', label: 'Password' },
],
```

Field types are `text`, `password`, `number`, `bool`, `select`, `note`, and `action`. An `action` is a button the adapter drives, such as an OAuth authorize. Its handler gets a `ui` helper to open a URL, prompt for input, and report status.

```js
{ key: 'authorize', type: 'action', label: 'Authorization', button: 'Authorize',
  run: async (account, ui) => {
    ui.openUrl(await myAuthUrl(account));
    const pasted = await ui.promptInput({ placeholder: 'Paste the redirect URL' });
    const r = await myExchange(pasted, account);
    ui.status(r.ok ? 'authorized' : r.error, r.ok ? 'ok' : 'err');
  },
}
```

Plain fields save onto the account. Actions save nothing, because tokens live server-side.

## Test it

Drop your folder in `data_engine/adapters/`. Restart the app. Open **Connect**, pick your protocol, fill the form, and connect.

Watch the **Console**. Logon, subscribes, order events, and any contract warnings show there. That is the whole loop.
