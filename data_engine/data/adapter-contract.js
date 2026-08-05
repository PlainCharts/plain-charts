// @ts-check
// THE ADAPTER CONTRACT — the single language the data-host (and therefore the whole app) understands. Every
// broker adapter implements THIS interface and emits THESE shapes; nothing downstream is adapter-specific, so
// a conforming adapter is plug-and-play. This file is the source of truth: to write an adapter, read this file.
//
// An adapter is an object with:
//   id            unique string  ('cqg', 'schwab', 'my-broker')
//   name          display name
//   description   one-line summary (package manager)
//   capabilities  { marketData, trading, depth }   — the app gates features off these
//   connect(account, ctx) · disconnect() · isConnected()
//
//   -- market data --
//   resolveSymbol(sym, cb)     cb(instrument|null); instrument = { id, tickSize, priceDecimals, ... }
//   subscribeQuotes(id, cb) / unsubscribeQuotes(id, cb)   cb(QUOTE)
//   subscribeBars / getBars(...)                          cb({ bars:[BAR], ... })
//   subscribeDepth(id, cb)                                cb(DOM)     [capabilities.depth]
//
//   -- execution (capabilities.trading) --
//   subscribeTrade(cb) / unsubscribeTrade(cb)   cb(TRADE_EVENT)
//   getPositions(cb)   cb([POSITION])
//   getAccount(cb)     cb(ACCOUNT)
//   placeOrder(order, cb) · cancelOrder(id, cb) · modifyOrder(mod, cb) · closePosition(symbol, cb)
//     order = { symbol, side, qty, type, price?, tif?, goodThru?, bracket? }
//     bracket = { takeProfit?, stopLoss? } (absolute prices) -> a native OCO bracket the adapter attaches to the
//     entry (CQG CompoundOrder, OANDA takeProfitOnFill/stopLossOnFill, Schwab OCO). On fill the exits arm; when
//     one fills the other cancels. Works on netting (order-level, not position-level).
//   -- snapshot (optional; seeds the order book on connect, complementing the live stream) --
//   getOrders(cb)                 cb([ORDER])          working orders right now
//   getHistory({fromMs,toMs}, cb) cb([ORDER])          filled orders over a past range (the day's fills)
//
// The adapter TRANSLATES its broker's protocol into these neutral SHAPES (build them with `event.*` below so
// they are guaranteed correct):
//   QUOTE     { bid, ask, last, bidSize, askSize, lastSize }
//   BAR       { time, open, high, low, close, volume, ...extra }
//   DOM       { bids:[{price,qty}], asks:[{price,qty}] }
//   POSITION  { symbol, qty, side:'long'|'short', avgPrice, accountId?, priceDecimals? }
//   ACCOUNT   { accountId, currency?, balance?, equity?, realizedPL?, unrealizedPL?, marginAvailable?, ... }
//   TRADE_EVENT (subscribeTrade) — one of:
//     { kind:'order',    order:    { id, symbol, side:'buy'|'sell', type:'market'|'limit'|'stop', qty, price|null, limitPrice?, stopPrice?, avgFillPrice?, tif, status, time?, updateTime?, expiry?, accountId?, priceDecimals? } }
//                        (limitPrice/stopPrice are the REQUESTED prices by type -- a stop-limit has both; avgFillPrice is what filled. expiry = GTD good-thru time.)
//     { kind:'fill',     fill:     { id, symbol, side, qty, price, time, accountId?, commission?, commissionCurrency? } }
//     { kind:'position', position: POSITION }
//     { kind:'account',  account:  ACCOUNT }
//     { kind:'reject',   reject:   { code, text, reason } }
//   `status` is one of ORDER_STATUS. The data-host validates every event against this contract before it
//   reaches the app, and a malformed event is dropped LOUDLY (a warning in the Console) — never silently.

// The CONNECT FORM — an adapter declares `form: [field]`, and the Connections dialog renders it. This is the
// only thing that describes an adapter's credentials/options; there is no generic template. Each field:
//   { key, type, label, default?, placeholder?, options? }
//   types:  text · password · number · bool · select (options: [string] | [{value,label}])
//           note   — static help text (label is the text; no key)
//           action — a button + a live status line; drives an async flow via handlers on the field:
//                    { type:'action', key, label, button?, run(account, ui), status(account) }
//                    ui = { status(msg,kind), openUrl(url), account(), promptInput({placeholder,submit})->Promise<string> }
//   Non-action field values are saved onto the account under `key`. Actions save nothing (e.g. OAuth tokens
//   live server-side). Example: CQG declares server/username/password; Schwab declares clientId/clientSecret/
//   redirectUri + an Authorize action.
// ---- THE CONTRACT SHAPES, as checkable types (the same shapes the block above documents in prose). Other
// modules reference these via `import('./adapter-contract.js').Order` etc. -------------------------------------
/**
 * @typedef {'buy'|'sell'} OrderSide
 * @typedef {'long'|'short'} PositionSide
 * @typedef {'market'|'limit'|'stop'} OrderType
 * @typedef {'in_transit'|'working'|'filled'|'cancelled'|'rejected'|'expired'|'suspended'|'in_cancel'|'in_modify'|'replaced'} OrderStatus
 */
/**
 * @typedef {Object} Quote
 * @property {number} [bid]
 * @property {number} [ask]
 * @property {number} [last]
 * @property {number} [bidSize]
 * @property {number} [askSize]
 * @property {number} [lastSize]
 */
/**
 * @typedef {Object} Bar
 * @property {number} time
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} [volume]
 */
/**
 * @typedef {{ price: number, qty: number }} DomLevel
 * @typedef {{ bids: DomLevel[], asks: DomLevel[] }} Dom
 */
/**
 * An instrument handle. `id` is an OPAQUE broker token the app never introspects -- it only passes it
 * back to the adapter (subscribe/getBars/placeOrder). Some brokers use a string symbol, CQG uses a
 * numeric contractId, so the type is `string|number`.
 * @typedef {Object} Instrument
 * @property {string|number} id
 * @property {number} [tickSize]     min price increment
 * @property {number} [tickValue]    account-currency value of one tickSize move, per 1 unit (lot/contract/share)
 * @property {number} [priceDecimals]
 * @property {number} [minVolume]    smallest tradeable quantity (MT5 lot min; futures 1)
 * @property {number} [volumeStep]   tradeable quantity increment (MT5 0.01 lots; futures 1) -- POSITION SIZING rounds to this
 * @property {number} [maxVolume]    largest tradeable quantity, if the broker caps it
 * @property {number} [contractSize] units of the underlying per 1 lot/contract (MT5 SYMBOL_TRADE_CONTRACT_SIZE); informational
 */
/** One CONNECT-FORM field (see the form doc block above). Every field has `type` + `label`; `key` is
 * absent only on `note` (static help) fields. `action` fields carry run/status handlers. Open for extras.
 * @typedef {{ type: string, label: string, key?: string, default?: any, placeholder?: string, options?: any, button?: string, run?: Function, status?: Function, [k: string]: any }} FormField */
/** One symbol-search result (adapter searchSymbols). @typedef {{ symbol: string, name?: string, category?: string }} SymbolSearchResult */
/**
 * A normalized ORDER (as produced by `event.order`). Numeric fields are `number|null` — absent = null.
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} symbol
 * @property {OrderSide} side
 * @property {OrderType} type
 * @property {number|null} qty
 * @property {number|null} price
 * @property {number|null} limitPrice
 * @property {number|null} stopPrice
 * @property {number|null} avgFillPrice
 * @property {string} tif
 * @property {OrderStatus|string} status
 * @property {number|null} time
 * @property {number|null} updateTime
 * @property {number|null} expiry
 * @property {string|null} accountId
 * @property {number|null} priceDecimals
 * @property {number|null} [stopLoss]  protective stop attached to a RESTING order (e.g. MT5 pending-order SL); null/absent = none
 * @property {number|null} [takeProfit]  protective target attached to a RESTING order (MT5 pending-order TP); null/absent = none
 * @property {{ type: string, fillQty: number|null, text: string|null }[]|null} [txns]  raw per-transaction broker comms (exec reports) for this update -- shown verbatim in the Console
 * @property {string|null} [rejectText]  broker's reject reason (populated on a reject)
 */
/**
 * @typedef {Object} Fill
 * @property {string} id
 * @property {string} symbol
 * @property {OrderSide} side
 * @property {number|null} qty
 * @property {number|null} price
 * @property {number|null} time
 * @property {string|null} accountId
 * @property {number|null} commission
 * @property {string|null} commissionCurrency
 * @property {number|null} [tickSize]    the contract's tick size (min price increment) -- for realized-P&L math
 * @property {number|null} [tickValue]   the contract's tick value (currency per tick) -- for realized-P&L math
 * @property {number|null} [realizedPnl] broker-reported realized P&L in account currency for this fill (0 on an
 *                                       entry, the closed amount on an exit). When present it is EXACT (no tick math);
 *                                       compute-positions prefers it over the tickValue estimate. MT5 supplies it.
 * @property {string|null} [positionId]  broker position-lifecycle id: fills sharing it form ONE trade (the entry plus
 *                                       its partial/full closes). Lets compute-positions group by the BROKER's position
 *                                       (hedging: parent + children) instead of app-reconstructed net-0. MT5 supplies it.
 */
/**
 * @typedef {Object} Position
 * @property {string} symbol
 * @property {number|null} qty
 * @property {PositionSide} side
 * @property {number|null} avgPrice
 * @property {string|null} accountId
 * @property {number|null} priceDecimals
 * @property {number} [stopLoss]     protective stop price -- only a HEDGING adapter links exits to the position; null on netting
 * @property {number} [takeProfit]   protective target price -- same
 * @property {number|null} [tickSize]    the contract's tick size (min price increment) -- for currency P&L
 * @property {number|null} [tickValue]   the contract's tick value (currency per tick) -- for currency P&L
 * @property {number|null} [swap]        accrued overnight financing -- adapter-specific (forex/CFD); null on futures
 * @property {string} [ticket]           the broker's own position/deal id -- broker-specific (MT5 ticket, forex deal id); absent on CQG netting
 */
/**
 * ONE broker-side open position (a HEDGING lot): its own ticket, entry, live price + P&L, and native SL/TP (OCO).
 * Distinct from the netted `Position` (one per symbol) -- a hedging account has many lots per symbol, each with its
 * own protective exits. Kept on a separate channel so the netted view (chart dot, order-ticket) is unaffected.
 * @typedef {Object} PositionLot
 * @property {string} ticket             the broker position ticket (identity)
 * @property {string} symbol
 * @property {PositionSide} side
 * @property {number|null} qty           0 => the lot closed (remove it)
 * @property {number|null} avgPrice      entry/open price
 * @property {number|null} price         current price
 * @property {number|null} stopLoss      native position stop (OCO); null/0 = none
 * @property {number|null} takeProfit    native position target (OCO); null/0 = none
 * @property {number|null} unrealizedPnl broker-reported live P&L in account currency
 * @property {string|null} accountId
 * @property {number|null} priceDecimals
 * @property {number|null} tickSize
 * @property {number|null} tickValue
 * @property {number|null} openTime      when the lot opened (ms)
 */
/** @typedef {{ accountId: string, currency?: string, balance?: number, equity?: number, realizedPL?: number, unrealizedPL?: number, marginAvailable?: number, [key: string]: any }} Account */
/** @typedef {{ takeProfit?: number, stopLoss?: number }} Bracket */
/**
 * The placeOrder INPUT (what the app sends; the adapter translates it to the broker's protocol).
 * @typedef {Object} OrderRequest
 * @property {string} symbol
 * @property {OrderSide} side
 * @property {number} qty
 * @property {OrderType} type
 * @property {number} [price]
 * @property {string} [tif]
 * @property {number} [goodThru]
 * @property {Bracket} [bracket]
 */
/** @typedef {{ code?: any, text: string, reason: string }} Reject */
/**
 * @typedef {{ kind: 'order', order: Order }
 *   | { kind: 'fill', fill: Fill }
 *   | { kind: 'position', position: Position }
 *   | { kind: 'positionLot', lot: PositionLot }
 *   | { kind: 'account', account: Account }
 *   | { kind: 'reject', reject: Reject }} TradeEvent
 */
/**
 * The interface every broker adapter implements. Market-data methods are required; execution/depth/snapshot
 * methods are optional and gated by `capabilities`. Conformed against the CQG reference adapter (Phase 3):
 * the CQG adapter object is annotated `@type {BrokerAdapter}` and type-checks, so this interface is the
 * proven, complete surface -- a new adapter that satisfies it is plug-and-play.
 * @typedef {Object} BrokerAdapter
 * @property {string} id
 * @property {string} [name]         name/description come from the package's meta.json (merged at load), not the adapter object
 * @property {string} [description]
 * @property {{ marketData?: boolean, trading?: boolean, depth?: boolean, restingBracket?: 'order'|'position'|'none' }} capabilities
 *   restingBracket = how a LIMIT/STOP (resting) entry carries an attached stop/target bracket, since a market
 *   bracket and a resting-order bracket are different mechanisms per protocol:
 *     'order'    -- an order-level compound (e.g. CQG OPO->OCO): the exits are children of the entry, placed by
 *                   the server only when the entry fills. Works on NETTING and hedging alike.
 *     'position' -- position-level native SL/TP on the pending order (e.g. MT5): only meaningful on a HEDGING
 *                   account (a netting account has no pending-order SL/TP).
 *     'none'/absent -- no resting-order bracket (attach nothing; a bare resting order only).
 *   The market bracket is separate and always attaches when the adapter can trade. See order-intent.js.
 * @property {FormField[]} [form]
 * @property {(account: any, ctx?: any) => any} connect
 * @property {() => void} disconnect
 * @property {() => boolean} isConnected
 * @property {() => (number|null)} serverNow
 * @property {(sym: string, cb: (inst: Instrument|null, err?: any) => void) => void} resolveSymbol
 * @property {(id: string|number, cb: (q: Quote) => void) => void} subscribeQuotes
 * @property {(id: string|number, cb: (q: Quote) => void) => void} unsubscribeQuotes
 * @property {(...args: any[]) => any} subscribeBars
 * @property {(...args: any[]) => any} getBars
 * @property {(...args: any[]) => any} drop
 * @property {(query: string, cb: (results: SymbolSearchResult[]) => void) => void} [searchSymbols]
 * @property {(req: { id?: string|number, fromMs?: number, toMs?: number, count?: number }, cb: (r: any) => void) => void} [getMarketHours]
 * @property {(id: string|number, cb: (dom: Dom) => void) => void} [subscribeDepth]
 * @property {(id: string|number, cb: (dom: Dom) => void) => void} [unsubscribeDepth]
 * @property {(cb: (ev: TradeEvent) => void) => void} [subscribeTrade]
 * @property {(cb: (ev: TradeEvent) => void) => void} [unsubscribeTrade]
 * @property {(cb: (positions: Position[]) => void) => void} [getPositions]
 * @property {(cb: (account: Account) => void) => void} [getAccount]
 * @property {(order: OrderRequest, cb: (r: any) => void) => void} [placeOrder]
 * @property {(id: string, cb: (r: any) => void) => void} [cancelOrder]
 * @property {(mod: any, cb: (r: any) => void) => void} [modifyOrder]
 * @property {(symbol: string, cb: (r: any) => void) => void} [closePosition]
 * @property {(cb: (orders: Order[]) => void) => void} [getOrders]
 * @property {(range: { fromMs: number, toMs: number }, cb: (orders: Order[]) => void) => void} [getHistory]
 */

export const FORM_FIELD_TYPES = ['text', 'password', 'number', 'bool', 'select', 'note', 'action'];

export const CAPABILITIES = ['marketData', 'trading', 'depth'];
export const ORDER_STATUS = ['in_transit', 'working', 'filled', 'cancelled', 'rejected', 'expired', 'suspended', 'in_cancel', 'in_modify', 'replaced'];
export const TERMINAL_STATUS = ['filled', 'cancelled', 'rejected', 'expired', 'replaced'];   // order leaves the working set
export const ORDER_SIDES = ['buy', 'sell'];
export const POSITION_SIDES = ['long', 'short'];

/** @param {any} v @returns {number|null} */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
/** @param {any} v @returns {string} */
const str = (v) => (v == null ? '' : String(v));

// Canonical constructors — adapters SHOULD build events with these so the shape is guaranteed.
export const event = {
  /** @param {any} o @returns {{ kind: 'order', order: Order }} */
  order: (o) => ({ kind: 'order', order: { id: str(o.id), symbol: str(o.symbol), side: o.side, type: o.type || 'market', qty: num(o.qty), price: o.price != null ? num(o.price) : null, limitPrice: o.limitPrice != null ? num(o.limitPrice) : null, stopPrice: o.stopPrice != null ? num(o.stopPrice) : null, avgFillPrice: o.avgFillPrice != null ? num(o.avgFillPrice) : null, tif: o.tif || 'day', status: str(o.status), time: o.time != null ? num(o.time) : null, updateTime: o.updateTime != null ? num(o.updateTime) : null, expiry: o.expiry != null ? num(o.expiry) : null, accountId: o.accountId != null ? str(o.accountId) : null, priceDecimals: o.priceDecimals != null ? num(o.priceDecimals) : null, stopLoss: o.stopLoss != null ? num(o.stopLoss) : null, takeProfit: o.takeProfit != null ? num(o.takeProfit) : null, txns: Array.isArray(o.txns) ? o.txns.map((/** @type {any} */ t) => ({ type: str(t.type), fillQty: t.fillQty != null ? num(t.fillQty) : null, text: t.text != null ? str(t.text) : null })) : null, rejectText: o.rejectText != null ? str(o.rejectText) : null } }),
  /** @param {any} f @returns {{ kind: 'fill', fill: Fill }} */
  fill: (f) => ({ kind: 'fill', fill: { id: str(f.id), symbol: str(f.symbol), side: f.side, qty: num(f.qty), price: num(f.price), time: f.time != null ? num(f.time) : null, accountId: f.accountId != null ? str(f.accountId) : null, commission: f.commission != null ? num(f.commission) : null, commissionCurrency: f.commissionCurrency || null, tickSize: f.tickSize != null ? num(f.tickSize) : null, tickValue: f.tickValue != null ? num(f.tickValue) : null, realizedPnl: f.realizedPnl != null ? num(f.realizedPnl) : null, positionId: f.positionId != null ? str(f.positionId) : null } }),
  /** @param {any} p @returns {{ kind: 'position', position: Position }} */
  position: (p) => ({ kind: 'position', position: { symbol: str(p.symbol), qty: num(p.qty), side: p.side, avgPrice: p.avgPrice != null ? num(p.avgPrice) : null, accountId: p.accountId != null ? str(p.accountId) : null, priceDecimals: p.priceDecimals != null ? num(p.priceDecimals) : null, tickSize: p.tickSize != null ? num(p.tickSize) : null, tickValue: p.tickValue != null ? num(p.tickValue) : null, swap: p.swap != null ? num(p.swap) : null, ...(p.ticket != null ? { ticket: str(p.ticket) } : {}) } }),
  /** @param {any} p @returns {{ kind: 'positionLot', lot: PositionLot }} */
  positionLot: (p) => ({ kind: 'positionLot', lot: { ticket: str(p.ticket), symbol: str(p.symbol), side: p.side, qty: num(p.qty), avgPrice: p.avgPrice != null ? num(p.avgPrice) : null, price: p.price != null ? num(p.price) : null, stopLoss: p.stopLoss != null ? num(p.stopLoss) : null, takeProfit: p.takeProfit != null ? num(p.takeProfit) : null, unrealizedPnl: p.unrealizedPnl != null ? num(p.unrealizedPnl) : null, accountId: p.accountId != null ? str(p.accountId) : null, priceDecimals: p.priceDecimals != null ? num(p.priceDecimals) : null, tickSize: p.tickSize != null ? num(p.tickSize) : null, tickValue: p.tickValue != null ? num(p.tickValue) : null, openTime: p.openTime != null ? num(p.openTime) : null } }),
  /** @param {any} a @returns {{ kind: 'account', account: Account }} */
  account: (a) => ({ kind: 'account', account: { ...a, accountId: a.accountId != null ? str(a.accountId) : 'default' } }),
  /** @param {any} r @returns {{ kind: 'reject', reject: Reject }} */
  reject: (r) => ({ kind: 'reject', reject: { code: r.code, text: str(r.text), reason: str(r.reason) || str(r.text) || 'rejected' } }),
};

/** @param {any} status @returns {boolean} */
export const isTerminal = (status) => TERMINAL_STATUS.includes(String(status));

// Validate + normalize one incoming trade event at the data-host boundary.
//   -> { ok:true, event } (normalized)  |  { ok:false, reason }
/** @param {any} ev @returns {{ ok: true, event: TradeEvent } | { ok: false, reason: string }} */
export function normalizeTradeEvent(ev) {
  if (!ev || typeof ev !== 'object') return bad('not an object');
  switch (ev.kind) {
    case 'order': {
      const o = ev.order; if (!o || o.id == null) return bad('order.id required');
      if (o.side && !ORDER_SIDES.includes(o.side)) return bad('order.side invalid: ' + o.side);
      return good(event.order(o));
    }
    case 'fill': {
      const f = ev.fill; if (!f || f.id == null) return bad('fill.id required');
      return good(event.fill(f));
    }
    case 'position': {
      const p = ev.position; if (!p || !p.symbol) return bad('position.symbol required');
      return good(event.position(p));
    }
    case 'positionLot': {
      const l = ev.lot; if (!l || l.ticket == null) return bad('positionLot.ticket required');
      return good(event.positionLot(l));
    }
    case 'account': {
      if (!ev.account) return bad('account required');
      return good(event.account(ev.account));
    }
    case 'reject': return good(event.reject(ev.reject || {}));
    default: return bad('unknown kind: ' + (ev.kind == null ? '(none)' : ev.kind));
  }
}
/** @param {TradeEvent} e @returns {{ ok: true, event: TradeEvent }} */
const good = (e) => ({ ok: true, event: e });
/** @param {string} reason @returns {{ ok: false, reason: string }} */
const bad = (reason) => ({ ok: false, reason });
