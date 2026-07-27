// @ts-check
// CQG broker adapter. Implements the neutral BrokerAdapter contract over the
// CQG WebSocket transport, absorbing every CQG-specific detail — scaled-integer
// prices, base-relative bar times, quote-type enums, and the bar_unit/unit_number
// request params — so nothing protocol-specific leaks out to the core.
import { registerBroker, event } from '/data_engine/data/adapter-sdk.js';   // the adapter SDK: registerBroker + the contract
import { connection } from './transport.js';
import { trading } from './trade.js';
import { loadProtocol, BAR_STATUS } from './protocol.js';
// The CQG-specific transport, treated opaquely at the adapter boundary (it emits raw CQG shapes the
// adapter translates). Two planes behind one surface: the connection (data) + the trade routing.
const transport = /** @type {any} */ ({ ...connection, ...trading });

// neutral timeframe unit -> CQG bar_unit enum (8=MIN,7=HOUR,6=DAY,5=WEEK,4=MONTH)
/** @type {Record<string, number>} */
const BAR_UNIT = { m: 8, h: 7, D: 6, W: 5, M: 4 };

// neutral time-in-force <-> CQG order duration enum. GTD needs a goodThru (UTC ms); the others are a plain
// choice. (CQG also has GTT/ATO/ATC/GFA -- mapped on read-back for display, not offered for entry.)
/** @type {Record<string, number>} */
const TIF_TO_DURATION = { day: 1, gtc: 2, gtd: 3, ioc: 5, fok: 6 };
/** @type {Record<number, string>} */
const DURATION_TO_TIF = { 1: 'day', 2: 'gtc', 3: 'gtd', 4: 'gtd', 5: 'ioc', 6: 'fok', 7: 'ato', 8: 'atc', 9: 'gfa' };   // GTT(4) folds into our 'gtd'
/** @param {any} tf */
const isIntraday = (tf) => tf.unit === 'm' || tf.unit === 'h';

/** @type {any} */
let protoReady = null;                 // load the schema once, lazily, on first connect
/** @type {Map<any, number>} */
const scaleById = new Map();           // contractId -> correctPriceScale (for decode)
/** @type {Map<any, string>} */
const symByContract = new Map();       // contractId -> symbol (for position display)
/** @type {Map<any, number>} */
const sessionInfoById = new Map();     // contractId -> session_info_id (for trading-hours requests)
/** @type {Map<Function, Function>} */
const quoteWrappers = new Map();       // user cb -> wrapped transport cb (for unsubscribe)
/** @type {Map<Function, Function>} */
const depthWrappers = new Map();       // user depth cb -> wrapped transport cb
/** @type {Map<Function, Function>} */
const tradeWrappers = new Map();       // user trade-event cb -> wrapped transport cb

/** @param {any} cid */
const symOf = (cid) => symByContract.get(cid) || ('contract ' + cid);
// CQG's HistoricalOrdersReport carries the FULL contract symbol (e.g. "F.US.MESU26"), but resolveSymbol / the live
// position+order stream use the tradeable SHORT symbol ("MESU26"). Seeded working orders that keep the full form no
// longer match the pane/position symbol, so their dots vanish. Normalise the report symbol to the short form (strip
// the "F.<exchange>." routing prefix) so orders, fills and positions all key on the SAME symbol.
/** @param {any} s */
const shortSym = (s) => (typeof s === 'string' ? s.replace(/^F\.[A-Z0-9]+\./, '') : s);
// price decimals for a contract, from its correct-price scale (0.25 -> 2 dp, 0.00001 -> 5 dp); default 2
/** @param {any} cid @returns {number} */
const decimalsFor = (cid) => { const s = scaleById.get(cid); return (s != null && s > 0) ? Math.max(0, Math.round(-Math.log10(s))) : 2; };

// tick metadata for realized-P&L math (currency per tick). Populated from CONTRACT METADATA, which CQG
// carries in THREE places: the symbol-resolution report (live/charted), the historical-orders report
// (past-traded contracts never resolved this session), and -- when the broker gives neither -- a static
// root->[tickSize, tickValue] fallback table so the common futures always price. Keyed by contractId.
/** @type {Map<any, number>} */
const tickSizeById = new Map();
/** @type {Map<any, number>} */
const tickValueById = new Map();
/** static fallback: instrument root -> [tickSize, tickValue($/tick)] (the liquid CME/COMEX/NYMEX futures) */
const PT_TICK = /** @type {Record<string, [number, number]>} */ ({
  MES: [0.25, 1.25], ES: [0.25, 12.50], MNQ: [0.25, 0.50], NQ: [0.25, 5.00],
  MYM: [1.00, 0.50], YM: [1.00, 5.00], M2K: [0.10, 0.50], RTY: [0.10, 5.00],
  MCL: [0.01, 1.00], CL: [0.01, 10.00], MGC: [0.10, 1.00], GC: [0.10, 10.00],
  SIL: [0.005, 1.00], SI: [0.005, 25.00],
});
// strip the contract month/year suffix: MESM26 -> MES, ESH25 -> ES, EP -> EP
/** @param {any} sym @returns {string} */
const ptRoot = (sym) => String(sym || '').trim().toUpperCase().replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
/** @param {any} cid @param {any} sym @returns {number|undefined} */
const tickSizeOf = (cid, sym) => { const t = tickSizeById.get(cid); if (t != null) return t; const pt = PT_TICK[ptRoot(sym)]; return pt ? pt[0] : undefined; };
/** @param {any} cid @param {any} sym @returns {number|undefined} */
const tickValueOf = (cid, sym) => { const t = tickValueById.get(cid); if (t != null) return t; const pt = PT_TICK[ptRoot(sym)]; return pt ? pt[1] : undefined; };
// account summary -> neutral account shape (shared by getAccount + trade stream)
/** @param {any} s */
const normAccount = (s) => s && ({
  currency: s.currency, balance: s.currentBalance,
  equity: (s.currentBalance || 0) + (s.ote || 0),
  unrealizedPL: s.unrealizedProfitLoss != null ? s.unrealizedProfitLoss : s.ote,
  realizedPL: s.profitLoss, marginUsed: s.totalMargin, marginAvailable: s.purchasingPower,
  positionMargin: s.positionMargin, purchasingPower: s.purchasingPower,
  mvo: s.mvo, mvf: s.mvf, marginCredit: s.marginCredit, cashExcess: s.cashExcess,
  yesterdayBalance: s.yesterdayBalance, workingOrders: s.totalWorkingOrders, filledOrders: s.totalFilledOrders,
  longQty: s.longQty, shortQty: s.shortQty,
  accountId: s.accountId, raw: s,
});

// translate a neutral timeframe into CQG bar request params
/** @param {any} id @param {any} tf @returns {{ contractId: any, barUnit: number, unitNumber?: number, fromUtcTime?: number, toUtcTime?: number }} */
function barParams(id, tf) {
  /** @type {{ contractId: any, barUnit: number, unitNumber?: number, fromUtcTime?: number, toUtcTime?: number }} */
  const p = { contractId: id, barUnit: BAR_UNIT[tf.unit] || 8 };
  if (isIntraday(tf)) p.unitNumber = tf.n;   // unit_number is intraday-only
  return p;
}

// a cqg.Decimal ({ significand, exponent }) -> number; passes plain numbers through; else undefined.
// (CQG sends bar volume as a Decimal, so Number(decimal) was NaN -> volume never rendered.)
/** @param {any} v @returns {number|undefined} */
function dec(v) {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  if (v.significand != null) return Number(v.significand) * Math.pow(10, Number(v.exponent || 0));
  return undefined;
}

// CQG TimeBar (scaled ints, base-relative time) -> neutral Bar. Beyond OHLCV we attach the extra fields
// CQG carries (mostly daily-only): open interest, settlement, exchange close, tick volume. CQG leaves the
// newer cqg.Decimal variants null and populates the deprecated scaled_* fields, so we read the Decimal
// only when present and fall back to scaled_*. Settlement / exchange-close are PRICES (price-scaled like
// OHLC); open-interest / tick-volume are raw COUNTS (no price scale, same as volume). Zero/absent extras
// are omitted so intraday bars aren't tagged with a meaningless 0 (OI updates once a day at settlement).
/**
 * @param {any} b @param {number} scale
 * @returns {(null | { time: number, open: number, high: number, low: number, close: number, volume: (number|undefined), openInterest?: number, tickVolume?: number, settlement?: number, exchangeClose?: number })}
 */
function toBar(b, scale) {
  /** @param {any} v @returns {number|undefined} */
  const px = (v) => (v == null ? undefined : v * scale);
  const time = Math.round((transport.baseMs() + b.barUtcTime) / 1000);
  const close = px(b.scaledClosePrice);
  if (close == null || close <= 0) return null;   // a 0 close = no trade yet in this bar; drop it (else it pins autoscale to 0)
  // volume is a Decimal (field 15); fall back to the deprecated scaled_volume (field 6, a plain int).
  const volume = dec(b.volume) ?? (b.scaledVolume != null ? Number(b.scaledVolume) : undefined);
  /** @type {{ time: number, open: number, high: number, low: number, close: number, volume: (number|undefined), openInterest?: number, tickVolume?: number, settlement?: number, exchangeClose?: number }} */
  const bar = {
    time,
    open: px(b.scaledOpenPrice) ?? close,
    high: px(b.scaledHighPrice) ?? close,
    low: px(b.scaledLowPrice) ?? close,
    close,
    volume,
  };
  // ---- extra fields (attach only when the feed gives a real, positive value) ----
  const oi = dec(b.openInterest) ?? (b.scaledOpenInterest != null ? Number(b.scaledOpenInterest) : undefined);
  if (oi != null && oi > 0) bar.openInterest = oi;                        // count (daily-only)
  const tickVol = b.tickVolume != null ? Number(b.tickVolume) : undefined;
  if (tickVol != null && tickVol > 0) bar.tickVolume = tickVol;           // trade count per bar
  const settle = px(b.scaledSettlementPrice);
  if (settle != null && settle > 0) bar.settlement = settle;             // official daily settle (price)
  const exClose = px(b.scaledExchangeClosePrice);
  if (exClose != null && exClose > 0) bar.exchangeClose = exClose;       // official exchange close (price)
  return bar;
}

// normalize a CQG bar report (errors -> {error}, data -> {bars, complete})
/** @param {any} rep @param {number} scale */
function toBarUpdate(rep, scale) {
  if (rep.statusCode >= 100) {
    const detail = (rep.details && rep.details.text) || '';
    return { bars: [], complete: true, error: (/** @type {Record<number, string>} */ (BAR_STATUS)[rep.statusCode] || rep.statusCode) + (detail ? ' — ' + detail : '') };
  }
  const bars = (rep.timeBars || []).map((/** @type {any} */ b) => toBar(b, scale)).filter(Boolean);
  return { bars, complete: rep.isReportComplete !== false, reachedStart: !!rep.reachedStartOfData };
}

/** @type {import('/data_engine/data/adapter-contract.js').BrokerAdapter} */
const adapter = {
  id: 'cqg',
  name: 'CQG',
  description: 'Futures market data and trading through the CQG gateway.',
  capabilities: { marketData: true, trading: true, depth: true },
  form: [
    { key: 'server', type: 'select', label: 'Server', options: ['Demo', 'Live'], default: 'Demo' },
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'appId', label: 'App ID', type: 'text', default: 'TradingView' },
  ],

  /** @param {any} account */
  async connect(account) {
    if (!protoReady) protoReady = loadProtocol();
    await protoReady;
    transport.connect(account);     // logon completion is broadcast via bus 'logon'
  },
  disconnect() { transport.disconnect(); },
  isConnected() { return transport.isConnected(); },
  serverNow() { return transport.brokerNow(); },

  /** @param {string} symbol @param {Function} cb */
  resolveSymbol(symbol, cb) {
    transport.resolveSymbol(symbol, (/** @type {any} */ rep) => {
      const cm = rep.symbolResolutionReport && rep.symbolResolutionReport.contractMetadata;
      if (rep.statusCode >= 2 && !cm) { cb(null, { status: rep.statusCode }); return; }
      if (!cm) { cb(null, { status: rep.statusCode }); return; }
      const scale = cm.correctPriceScale || 1;
      scaleById.set(cm.contractId, scale);
      symByContract.set(cm.contractId, symbol);
      if (cm.tickSize > 0) tickSizeById.set(cm.contractId, cm.tickSize);
      if (cm.tickValue > 0) tickValueById.set(cm.contractId, cm.tickValue);
      if (cm.sessionInfoId != null && cm.sessionInfoId >= 0) sessionInfoById.set(cm.contractId, cm.sessionInfoId);   // -1 = no session info
      cb({
        id: cm.contractId,
        priceDecimals: scale > 0 ? Math.max(0, Math.round(-Math.log10(scale))) : 2,
        tickSize: cm.tickSize || scale,
        tickValue: cm.tickValue || undefined,
      });
    });
  },

  // live-updating bar subscription
  /** @param {{ id: any, tf: any, fromMs: number }} req @param {Function} cb */
  subscribeBars({ id, tf, fromMs }, cb) {
    const scale = scaleById.get(id) || 1;
    const p = barParams(id, tf);
    p.fromUtcTime = Math.round(fromMs - transport.baseMs());
    return transport.subscribeBars(p, (/** @type {any} */ rep) => cb(toBarUpdate(rep, scale)));
  },

  // one-shot historical fetch (used for lazy older-history)
  /** @param {{ id: any, tf: any, fromMs: number, toMs: number }} req @param {Function} cb */
  getBars({ id, tf, fromMs, toMs }, cb) {
    const scale = scaleById.get(id) || 1;
    const p = barParams(id, tf);
    p.fromUtcTime = Math.round(fromMs - transport.baseMs());
    p.toUtcTime = Math.round(toMs - transport.baseMs());
    return transport.getBars(p, (/** @type {any} */ rep) => cb(toBarUpdate(rep, scale)));
  },

  // trading-hours: neutral per-trading-day session times for a contract + UTC range. Resolves the
  // contract's session_info_id (captured on resolveSymbol) -> CQG TradingDayTimeRange, mapped from
  // base-relative ms to absolute UTC ms. cb({ days:[{ tradeDate, open, close, preOpen, postClose,
  // rthOpen, rthClose }] }) or cb({ error }). Fields CQG omits come back null. This is the foundation
  // of Market Hours -- the daily-anchor corrector, session lines, and status dot all read it.
  /** @param {{ id?: any, fromMs?: number, toMs?: number, count?: number }} [req] @param {Function} [cb] */
  getMarketHours({ id, fromMs, toMs, count } = {}, cb) {
    const sid = sessionInfoById.get(id);
    if (sid == null) return cb && cb({ error: 'no session info for contract ' + id });
    transport.getTradingDayRanges({ sessionInfoId: sid, fromMs, toMs, count }, (/** @type {any} */ rep) => {
      if (!rep || rep.error) return cb && cb({ error: (rep && rep.error) || 'session request failed' });
      if (rep.statusCode >= 100) return cb && cb({ error: 'session request failed (' + rep.statusCode + ')' });
      const base = transport.baseMs();
      /** @param {any} t */
      const abs = (t) => (t == null ? null : base + Number(t));   // base-relative ms -> absolute UTC ms
      const rr = rep.tradingDayTimerangeReport || {};
      const days = (rr.tradingDayTimeRanges || []).map((/** @type {any} */ d) => ({
        tradeDate: abs(d.tradeDate),
        open: abs(d.tradingDayOpenUtcTime),
        close: abs(d.tradingDayCloseUtcTime),
        preOpen: abs(d.tradingDayPreOpenUtcTime),
        postClose: abs(d.tradingDayPostCloseUtcTime),
        rthOpen: abs(d.openPrimaryUtcTime),
        rthClose: abs(d.closePrimaryUtcTime),
      }));
      cb && cb({ days });
    });
  },

  // symbol search by name/description (e.g. "S&P" -> EP "E-Mini S&P 500")
  /** @param {string} query @param {Function} cb */
  searchSymbols(query, cb) {
    const q = (query || '').trim();
    if (!q) return cb([]);   // CQG search needs a term
    transport.productSearch(q, (/** @type {any} */ rep) => {
      const syms = (rep.productSearchReport && rep.productSearchReport.symbols) || [];
      cb(syms.filter((/** @type {any} */ s) => !s.deleted).map((/** @type {any} */ s) => ({ symbol: s.name, name: s.description || '', category: 'Futures' })));
    });
  },

  /** @param {any} handle */
  drop(handle) { transport.drop(handle); },

  /** @param {any} id @param {Function} cb */
  subscribeQuotes(id, cb) {
    const scale = scaleById.get(id) || 1;
    // per-quote size: CQG carries it as a Decimal `volume` (fall back to deprecated scaled_volume, a plain int).
    /** @param {any} x @returns {number|undefined} */
    const sz = (x) => dec(x.volume) ?? (x.scaledVolume != null ? Number(x.scaledVolume) : undefined);
    const wrapped = (/** @type {any} */ rt) => {
      /** @type {{ last?: number, lastSize?: number, bid?: number, bidSize?: number, ask?: number, askSize?: number }} */
      const q = {};
      (rt.quotes || []).forEach((/** @type {any} */ x) => {
        if (x.scaledPrice == null) return;
        const px = x.scaledPrice * scale;
        const s = sz(x);
        // CQG Quote.Type: 0=TRADE, 1=BESTBID, 2=BESTASK, 3=BID(dom), 4=ASK(dom), 5=SETTLEMENT. Only the
        // best bid/ask and the LAST TRADE feed the neutral quote; DOM levels (3/4) belong to depth.
        if (x.type === 0) { q.last = px; if (s != null) q.lastSize = s; }        // TYPE_TRADE (was wrongly 4 = a DOM ask level)
        else if (x.type === 1) { q.bid = px; if (s != null) q.bidSize = s; }     // TYPE_BESTBID
        else if (x.type === 2) { q.ask = px; if (s != null) q.askSize = s; }     // TYPE_BESTASK
      });
      if (q.bid != null || q.ask != null || q.last != null) cb(q);
    };
    quoteWrappers.set(cb, wrapped);
    transport.subscribeMarketData(id, wrapped);
  },
  /** @param {any} id @param {Function} cb */
  unsubscribeQuotes(id, cb) {
    const wrapped = quoteWrappers.get(cb);
    if (!wrapped) return;
    transport.unsubscribeMarketData(id, wrapped);
    quoteWrappers.delete(cb);
  },

  // market depth (DOM). cb({ bids:[{price,qty}], asks:[{price,qty}] }), best-first.
  /** @param {any} id @param {Function} cb */
  subscribeDepth(id, cb) {
    const scale = scaleById.get(id) || 1;
    const wrapped = (/** @type {any} */ dom) => cb({ bids: dom.bids.map((/** @type {any} */ b) => ({ price: b.scaledPrice * scale, qty: b.qty })), asks: dom.asks.map((/** @type {any} */ a) => ({ price: a.scaledPrice * scale, qty: a.qty })) });
    depthWrappers.set(cb, wrapped);
    transport.subscribeDepth(id, wrapped);
  },
  /** @param {any} id @param {Function} cb */
  unsubscribeDepth(id, cb) { const w = depthWrappers.get(cb); if (w) { transport.unsubscribeDepth(id, w); depthWrappers.delete(cb); } },

  // ---- trading (neutral contract) ----
  /** @param {Function} [cb] */
  getAccount(cb) {
    const s = transport.accountSummary();
    if (!s || s.accountId == null) return cb && cb({ error: 'no account summary yet (connect + give it a moment)' });   // no accountId -> would key as 'default' (phantom row)
    cb && cb(normAccount(s));
  },
  /** @param {Function} [cb] */
  getPositions(cb) {
    const acct = transport.tradeAccountId() || null;
    cb && cb(transport.positions().map((/** @type {any} */ p) => ({ symbol: symOf(p.contractId), qty: p.qty, side: p.side, avgPrice: p.avgPrice, accountId: acct, priceDecimals: decimalsFor(p.contractId), tickSize: tickSizeOf(p.contractId, symOf(p.contractId)), tickValue: tickValueOf(p.contractId, symOf(p.contractId)) })));
  },

  // OnTrade: live order/fill/position/account events (CQG pushes these natively)
  // translate CQG's raw execution stream into the neutral CONTRACT events (built with `event.*` so the shapes
  // are guaranteed). This is the reference conforming adapter — a new adapter mirrors exactly this pattern.
  /** @param {Function} cb */
  subscribeTrade(cb) {
    const w = (/** @type {any} */ ev) => {
      if (ev.kind === 'order') {
        const sc = scaleById.get(ev.contractId) || 1;
        // TRIPWIRE: an order event on a contract whose METADATA is not resolved yet emits an unresolved symbol
        // ('contract N') and/or a WRONG-SCALE price (the ||1 fallback leaves the raw scaled integer) -- undrawable or
        // misplaced on the chart while the desk still lists it. The trade-feed sentinel reports the symbol/price
        // cases to the app Console; this line captures the RAW event (data-host devtools/CDP) at the moment of
        // corruption, including the scale case the sentinel cannot see.
        if (!symByContract.has(ev.contractId) || !scaleById.has(ev.contractId)) console.error('[cqg] ORDER TRIPWIRE contract ' + ev.contractId + ' (symbol ' + (symByContract.has(ev.contractId) ? 'ok' : 'MISSING') + ', scale ' + (scaleById.has(ev.contractId) ? 'ok' : 'MISSING') + '): ' + JSON.stringify(ev));
        // CQG sends 0 for an absent scaled price (proto default) -- translate 0 -> null so the app shows blank,
        // not 0.00 (a limit order has no stop, an unfilled order has no fill, etc.)
        const lim = ev.scaledLimitPrice ? ev.scaledLimitPrice * sc : null;
        const stp = ev.scaledStopPrice ? ev.scaledStopPrice * sc : null;
        cb(event.order({ id: ev.orderId, symbol: symOf(ev.contractId), side: ev.side === 2 ? 'sell' : 'buy', type: ev.orderType === 2 ? 'limit' : ev.orderType === 3 ? 'stop' : 'market', qty: ev.qty, price: ev.orderType === 2 ? lim : ev.orderType === 3 ? stp : null, limitPrice: lim, stopPrice: stp, avgFillPrice: ev.avgFillPrice ? ev.avgFillPrice : null, tif: DURATION_TO_TIF[ev.duration] || 'day', status: ev.status, time: ev.submitTime, updateTime: ev.statusTime, expiry: ev.expiry, accountId: ev.accountId, priceDecimals: decimalsFor(ev.contractId), txns: ev.txns, rejectText: ev.rejectText }));
      } else if (ev.kind === 'fill') {
        cb(event.fill({ id: ev.orderId, symbol: symOf(ev.contractId), side: ev.side === 2 ? 'sell' : 'buy', qty: ev.qty, price: ev.avgPrice, time: ev.time, accountId: ev.accountId, tickSize: tickSizeOf(ev.contractId, symOf(ev.contractId)), tickValue: tickValueOf(ev.contractId, symOf(ev.contractId)), commission: ev.commission, commissionCurrency: ev.commissionCurrency }));
      } else if (ev.kind === 'position') {
        cb(event.position({ symbol: symOf(ev.contractId), qty: ev.qty, side: ev.side, avgPrice: ev.avgPrice, accountId: ev.accountId, priceDecimals: decimalsFor(ev.contractId), tickSize: tickSizeOf(ev.contractId, symOf(ev.contractId)), tickValue: tickValueOf(ev.contractId, symOf(ev.contractId)) }));
      } else if (ev.kind === 'account') {
        cb(event.account(normAccount(ev.summary)));
      } else if (ev.kind === 'reject') {
        cb(event.reject({ code: ev.code, text: ev.text }));
      }
    };
    tradeWrappers.set(cb, w);
    transport.onTrade(w);
  },
  /** @param {Function} cb */
  unsubscribeTrade(cb) { const w = tradeWrappers.get(cb); if (w) { transport.offTrade(w); tradeWrappers.delete(cb); } },
  // tif: neutral time-in-force ('day'|'gtc'|'gtd'|'ioc'|'fok'; default 'day'). goodThru (UTC ms) is required for
  // 'gtd'. bracket: { takeProfit?, stopLoss? } (absolute prices) attaches a native OCO bracket -- on fill CQG
  // auto-creates the exit pair. Converted to profit/loss TICK offsets from the entry price (CompoundOrder).
  /** @param {{ symbol?: string, side?: any, qty?: any, type?: string, price?: number, tif?: string, goodThru?: any, bracket?: { takeProfit?: number, stopLoss?: number } }} order @param {Function} [cb] */
  placeOrder({ symbol, side, qty, type = 'market', price, tif = 'day', goodThru, bracket } = {}, cb) {
    this.resolveSymbol(/** @type {string} */ (symbol), (/** @type {any} */ inst) => {
      if (!inst) return cb && cb({ error: 'symbol not resolved: ' + symbol });
      const scale = scaleById.get(inst.id) || 1;
      const T = String(type).toLowerCase();
      const orderType = T === 'limit' ? 2 : T === 'stop' ? 3 : 1;
      const tl = String(tif).toLowerCase();
      // 'gtd' -> CQG GTD (3, good-till-DATE). GTT (4, with a time) is rejected for futures ("order type not
      // allowed for the commodity"), so GTD is date-resolution: the order lives through the chosen trade date.
      const duration = TIF_TO_DURATION[tl] || 1;
      /** @type {{ contractId: any, side: number, qty: number, orderType: number, duration: number, goodThru: any, scaledLimitPrice?: number, scaledStopPrice?: number, exitSide?: number, scaledTp?: number, scaledSl?: number }} */
      const params = {
        contractId: inst.id,
        side: String(side).toLowerCase() === 'sell' ? 2 : 1,
        qty: Math.abs(Number(qty) || 0),
        orderType,
        duration,
        goodThru,
        scaledLimitPrice: (orderType === 2 && price != null) ? Math.round(price / scale) : undefined,
        scaledStopPrice: (orderType === 3 && price != null) ? Math.round(price / scale) : undefined,
      };
      // CONTRACT: bracket price 0 (or absent) = that leg OMITTED. Guard with > 0, not != null -- a 0 slipping
      // through became a marketable LIMIT AT PRICE 0 that filled instantly at the bid and the server OCO then
      // cancelled the real stop (an SL-only bracket closed the position the moment it opened).
      const hasBracket = bracket && (Number(bracket.takeProfit) > 0 || Number(bracket.stopLoss) > 0);   // market too: exits are absolute prices, no entry price needed
      if (hasBracket) {
        params.exitSide = params.side === 2 ? 1 : 2;   // exits are the opposite side of the entry
        params.scaledTp = Number(bracket.takeProfit) > 0 ? Math.round(Number(bracket.takeProfit) / scale) : undefined;   // TP limit price
        params.scaledSl = Number(bracket.stopLoss) > 0 ? Math.round(Number(bracket.stopLoss) / scale) : undefined;       // SL stop price
        transport.placeBracket(params, (/** @type {any} */ r) => cb && cb(r));
      } else {
        transport.placeOrder(params, (/** @type {any} */ r) => cb && cb(r));
      }
    });
  },
  /** @param {Function} [cb] */
  getOrders(cb) {
    cb && cb(transport.orders().map((/** @type {any} */ o) => {
      const scale = scaleById.get(o.contractId) || 1;
      const lim = o.scaledLimitPrice ? o.scaledLimitPrice * scale : null;   // 0 = absent -> null
      const stp = o.scaledStopPrice ? o.scaledStopPrice * scale : null;
      return { id: o.orderId, symbol: symByContract.get(o.contractId) || ('contract ' + o.contractId), side: o.side === 2 ? 'sell' : 'buy', type: o.orderType === 2 ? 'limit' : o.orderType === 3 ? 'stop' : 'market', qty: o.qty, price: o.orderType === 2 ? lim : o.orderType === 3 ? stp : null, limitPrice: lim, stopPrice: stp, tif: DURATION_TO_TIF[o.duration] || 'day', status: 'working', expiry: o.expiry, priceDecimals: decimalsFor(o.contractId) };
    }));
  },
  // account history: all terminal orders over a date range (from/to absolute UTC ms; to defaults to now).
  // Returns neutral order records (with status, ordered qty, fill qty, limit/stop); learns new symbols along
  // the way. Filled ones (qty > 0) also carry the fill price so the fills stream can consume them.
  /** @param {any} range @param {Function} [cb] */
  getHistory(range, cb) {
    transport.getHistory(range || {}, (/** @type {any} */ res) => {
      if (!Array.isArray(res)) return cb && cb(res);   // { error } passthrough
      // read the account HERE (results have arrived) -- the request now defers until the account is known, so
      // reading it before the call would capture 0/null and leave every history row without an account (blank Balance).
      const acct = transport.tradeAccountId() || null;
      cb && cb(res.map((/** @type {any} */ f) => {
        if (f.symbol && !symByContract.has(f.contractId)) symByContract.set(f.contractId, shortSym(f.symbol));
        if (f.tickSize > 0 && !tickSizeById.has(f.contractId)) tickSizeById.set(f.contractId, f.tickSize);      // from the historical report's contract_metadata
        if (f.tickValue > 0 && !tickValueById.has(f.contractId)) tickValueById.set(f.contractId, f.tickValue);
        const scale = scaleById.get(f.contractId) || 1;
        return { id: f.orderId, contractId: f.contractId, symbol: symByContract.get(f.contractId) || shortSym(f.symbol), side: f.side === 2 ? 'sell' : 'buy', type: f.orderType === 2 ? 'limit' : f.orderType === 3 ? 'stop' : 'market', status: f.status, orderQty: f.orderQty, qty: f.qty, price: f.price, limitPrice: f.scaledLimitPrice ? f.scaledLimitPrice * scale : null, stopPrice: f.scaledStopPrice ? f.scaledStopPrice * scale : null, time: f.time, accountId: acct, priceDecimals: decimalsFor(f.contractId), tickSize: tickSizeOf(f.contractId, f.symbol), tickValue: tickValueOf(f.contractId, f.symbol), commission: f.commission, commissionCurrency: f.commissionCurrency };
      }));
    });
  },
  /** @param {any} orderId @param {Function} [cb] */
  cancelOrder(orderId, cb) { transport.cancelOrder(orderId, (/** @type {any} */ r) => cb && cb(r)); },
  // modify a working order's price and/or qty. price re-scaled per the order's own type.
  /** @param {{ orderId?: any, qty?: number, price?: number }} mod0 @param {Function} [cb] */
  modifyOrder({ orderId, qty, price } = {}, cb) {
    const o = transport.findOrder(orderId);   // resolves a stale order_id to its current working record
    if (!o) return cb && cb({ error: 'order not found (not working?): ' + orderId });
    const scale = scaleById.get(o.contractId) || 1;
    /** @type {{ orderId: any, qty?: number, scaledLimitPrice?: number, scaledStopPrice?: number }} */
    const mod = { orderId };
    if (qty != null) mod.qty = qty;
    if (price != null) { if (o.orderType === 2) mod.scaledLimitPrice = Math.round(price / scale); else if (o.orderType === 3) mod.scaledStopPrice = Math.round(price / scale); }
    transport.modifyOrder(mod, (/** @type {any} */ r) => cb && cb(r));
  },
  /** @param {string} symbol @param {Function} [cb] */
  closePosition(symbol, cb) {
    this.resolveSymbol(symbol, (/** @type {any} */ inst) => {
      if (!inst) return cb && cb({ error: 'symbol not resolved: ' + symbol });
      const pos = transport.positions().find((/** @type {any} */ p) => p.contractId === inst.id);
      if (!pos || !pos.qty) return cb && cb({ error: 'no open position in ' + symbol });
      transport.placeOrder({ contractId: inst.id, side: pos.side === 'long' ? 2 : 1, qty: pos.qty, orderType: 1 }, (/** @type {any} */ r) => cb && cb(r));
    });
  },
};

registerBroker(adapter);
export default adapter;
