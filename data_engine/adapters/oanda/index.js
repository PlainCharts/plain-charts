// @ts-check
// OANDA v20 broker adapter. Implements the neutral BrokerAdapter contract against
// OANDA's REST API, proxied through our own server (which holds the API token and
// attaches the Bearer header — OANDA's API is CORS-restricted). No streamer here:
// live quotes/bars come from REST polling (mirrors the Schwab polling path).
//
// Auth is a static personal API token (no OAuth dance): the user pastes their
// token + account ID and picks Practice/Live. Wire specifics kept in this module:
// instrument naming (EUR_USD), granularity mapping with client-side aggregation
// for intervals OANDA doesn't serve natively, and midpoint candles.
import { registerBroker } from '/data_engine/data/adapter-sdk.js';
import { bus } from '/data_engine/bus.js';
import { setConn, log } from '/data_engine/status.js';
import { emitRaw } from '/data_engine/data/raw-tap.js'; // diagnostic tap (Data Interceptor); no-op when unused
import { barMs } from '/data_engine/timeframes.js';
import { foldExtras } from '/data_engine/bar-fields.js';

// neutral timeframe: { n, unit } (unit: 'm'|'h'|'D'|'W'|'M')
/** @typedef {{ n: number, unit: string }} TF */

// resilient JSON fetch: never throws. Non-JSON / network error -> { error }.
/** @param {string} url @param {RequestInit} [opts] @returns {Promise<any>} */
const j = (url, opts) =>
  fetch(url, opts)
    .then(async (r) => {
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch (_) {
        return { error: (text || '').slice(0, 200) || 'HTTP ' + r.status };
      }
    })
    .catch((e) => ({ error: String((e && e.message) || e) }));

// decimals from a sample price string (fallback when displayPrecision is absent)
/** @param {any} p @returns {number} */
function decimalsOf(p) {
  if (p == null || !isFinite(p)) return 5;
  const s = String(p),
    i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(8, s.length - i - 1);
}

// OANDA instrument format is BASE_QUOTE (EUR_USD, XAU_USD, SPX500_USD)
/** @param {any} s @returns {string} */
const normInst = (s) =>
  String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[/\s-]+/g, '_');

const NATIVE_MIN = [1, 2, 4, 5, 10, 15, 30];
const NATIVE_HR = [1, 2, 3, 4, 6, 8, 12];
/** @param {TF} tf @returns {number} */
const pollMs = (tf) => (tf.unit === 'm' || tf.unit === 'h' ? 3000 : 60000);

// neutral tf -> { granularity code, aggregation bucket secs (0 = native), base bar ms }
/** @param {TF} tf @returns {{ g: string, bucket: number, baseMs: number }} */
function granularity(tf) {
  if (tf.unit === 'm')
    return NATIVE_MIN.includes(tf.n)
      ? { g: 'M' + tf.n, bucket: 0, baseMs: tf.n * 60000 }
      : { g: 'M1', bucket: tf.n * 60, baseMs: 60000 };
  if (tf.unit === 'h')
    return NATIVE_HR.includes(tf.n)
      ? { g: 'H' + tf.n, bucket: 0, baseMs: tf.n * 3600000 }
      : { g: 'H1', bucket: tf.n * 3600, baseMs: 3600000 };
  if (tf.unit === 'D') return { g: 'D', bucket: 0, baseMs: 86400000 };
  if (tf.unit === 'W') return { g: 'W', bucket: 0, baseMs: 7 * 86400000 };
  return { g: 'M', bucket: 0, baseMs: 30 * 86400000 }; // monthly
}

// bucket native candles up to a coarser interval (for non-native minute/hour counts)
// neutral OHLCV bar (extra fields folded in by foldExtras)
/** @typedef {{ time: number, open: number, high: number, low: number, close: number, volume: number, [key: string]: any }} OhlcvBar */
/** @param {OhlcvBar[]} bars @param {number} secs @returns {OhlcvBar[]} */
function aggregate(bars, secs) {
  if (!secs) return bars;
  /** @type {Map<number, OhlcvBar>} */
  const out = new Map();
  bars.forEach((b) => {
    const t = Math.floor(b.time / secs) * secs;
    let o = out.get(t);
    if (!o) {
      o = { time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 };
      out.set(t, o);
    } else {
      o.high = Math.max(o.high, b.high);
      o.low = Math.min(o.low, b.low);
      o.close = b.close;
      o.volume += b.volume || 0;
    }
    foldExtras(o, b); // carry extra fields (liquidity/etc.) through aggregation
  });
  return [...out.values()].sort((a, b) => a.time - b.time);
}

// --- Market Hours (synthesised). FX has no session-schedule endpoint; it trades continuously from
// Sun 17:00 to Fri 17:00 New York (no daily maintenance break), so we generate the trading days
// directly. NY offset shifts with US DST -- probe it with Intl (17:00 is far from the 2am switch, so a
// single probe is exact).
const NY_TZ = 'America/New_York';
/** @param {number} utcMs @returns {number} */
function nyOffsetHours(utcMs) {
  const tzn = /** @type {Intl.DateTimeFormatPart} */ (
    new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(utcMs))
      .find((p) => p.type === 'timeZoneName')
  ).value; // "GMT-4" / "GMT-5"
  const m = /GMT([+-]\d+)/.exec(tzn);
  return m ? parseInt(m[1], 10) : -5;
}
// UTC ms for HH:00 New York on the calendar date y/mo/d.  NY_local = UTC + off  ->  UTC = local - off.
/** @param {number} y @param {number} mo @param {number} d @param {number} hour @returns {number} */
function nyClockUtc(y, mo, d, hour) {
  const guess = Date.UTC(y, mo, d, hour, 0, 0);
  return guess - nyOffsetHours(guess) * 3600000;
}
// The `count` most recent FX trading days ending at/before `end` (ms). A trading day CLOSES 17:00 NY
// on a weekday D and opened 17:00 NY the previous calendar day.
// neutral trading-day session shape (same as CQG's getMarketHours days)
/** @typedef {{ tradeDate: number, open: number, close: number, preOpen: number|null, postClose: number|null, rthOpen: number|null, rthClose: number|null }} MarketDay */
/** @param {number} end @param {number} count @returns {MarketDay[]} */
function fxTradingDays(end, count) {
  /** @type {MarketDay[]} */
  const days = [];
  const startNy = new Date(end + nyOffsetHours(end) * 3600000); // NY calendar date of `end`
  let y = startNy.getUTCFullYear(),
    mo = startNy.getUTCMonth(),
    d = startNy.getUTCDate();
  let guard = 0;
  while (days.length < count && guard++ < 800) {
    const wd = new Date(Date.UTC(y, mo, d)).getUTCDay(); // weekday of this NY date
    if (wd >= 1 && wd <= 5) {
      // FX closes Mon..Fri; Sat/Sun have no close
      days.push({
        tradeDate: Date.UTC(y, mo, d),
        open: nyClockUtc(y, mo, d - 1, 17),
        close: nyClockUtc(y, mo, d, 17),
        preOpen: null,
        postClose: null,
        rthOpen: null,
        rthClose: null,
      });
    }
    const prev = new Date(Date.UTC(y, mo, d - 1));
    y = prev.getUTCFullYear();
    mo = prev.getUTCMonth();
    d = prev.getUTCDate();
  }
  return days.sort((a, z) => a.open - z.open);
}

// midpoint candles ending at toMs. OANDA caps a request at 5000 candles, so size
// `count` to the window in base-bar units (capped) — recent-most when capped.
/** @param {string} inst @param {TF} tf @param {number} fromMs @param {number} toMs @returns {Promise<{ bars: OhlcvBar[], error?: string }>} */
async function fetchCandles(inst, tf, fromMs, toMs) {
  const { g, bucket, baseMs } = granularity(tf);
  const count = Math.min(5000, Math.max(1, Math.ceil((toMs - fromMs) / baseMs)));
  /** @type {{ granularity: string, count: string, price: string, to?: string }} */
  const params = { granularity: g, count: String(count), price: 'M' };
  // Only pin `to` for a genuinely historical window. For a trailing/latest request (toMs ~ now)
  // we OMIT it: OANDA rejects a `to` at/after its own server now, and client clock skew (or a
  // restored future view) easily pushes Date.now() past it -> "Invalid value for 'to'. Time is in
  // the future". Without `to`, OANDA returns the most recent `count` candles up to its own now.
  if (toMs < Date.now() - 5 * 60 * 1000) params.to = (toMs / 1000).toFixed(0);
  const qs = new URLSearchParams(params);
  const data = await oj('/api/oanda/md/v3/instruments/' + encodeURIComponent(inst) + '/candles?' + qs.toString());
  emitRaw('oanda', 'bars', data); // raw candles response (mid-only until price='MBA')
  if (!data || data.error || data.errorMessage || !Array.isArray(data.candles)) {
    return { bars: [], error: (data && (data.errorMessage || data.error)) || 'no data' };
  }
  const bars = data.candles
    .filter((/** @type {any} */ c) => c.mid)
    .map((/** @type {any} */ c) => ({
      time: Math.floor(parseFloat(c.time)),
      open: +c.mid.o,
      high: +c.mid.h,
      low: +c.mid.l,
      close: +c.mid.c,
      volume: c.volume || 0,
    }));
  return { bars: aggregate(bars, bucket) };
}

/** @typedef {{ cbs: Set<Function>, timer: any }} QuotePoller */
/** @type {Map<string, QuotePoller>} */
const quotePollers = new Map(); // inst -> { timer, cbs:Set }
/** @type {Map<Function, any>} */
const tradePollers = new Map(); // trade-event cb -> interval timer (OnTrade polling)
/** @type {Set<{ stop: () => void }>} */
const barStops = new Set(); // active bar-subscription stop handles (so disconnect can kill them)
let connected = false;
/** @type {any[]|null} */
let instrCache = null; // cached full instrument list for symbol search
// the token lives on the account (accounts.json); we pass it to our proxy per
// request as headers, so there's no duplicate server-side credential file.
const cfg = { token: '', accountId: '', environment: 'practice' };
/** @param {string} url @returns {Promise<any>} */
const oj = (url) => j(url, { headers: { 'X-OANDA-Token': cfg.token, 'X-OANDA-Env': cfg.environment } });
// trading request (POST/PUT) through the /tx/ proxy; same token headers + a JSON body
/** @param {string} txPath @param {string} method @param {any} [body] @returns {Promise<any>} */
const ojx = (txPath, method, body) =>
  j('/api/oanda/tx/' + txPath, {
    method,
    headers: { 'X-OANDA-Token': cfg.token, 'X-OANDA-Env': cfg.environment, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
/** @param {string} suffix @returns {string} */
const acctPath = (suffix) => 'v3/accounts/' + encodeURIComponent(cfg.accountId) + suffix;
/** @param {string} inst @returns {string} */
const pricingUrl = (inst) =>
  '/api/oanda/md/v3/accounts/' + encodeURIComponent(cfg.accountId) + '/pricing?instruments=' + encodeURIComponent(inst);

/** @param {string} inst @param {Function} cb */
function pollSubscribe(inst, cb) {
  let s = quotePollers.get(inst);
  if (!s) {
    s = { cbs: new Set(), timer: null };
    quotePollers.set(inst, s);
    const poll = async () => {
      const data = await oj(pricingUrl(inst)).catch(() => null);
      emitRaw('oanda', 'quote', data); // raw pricing response (bids/asks incl. liquidity, closeout, time)
      const px = data && data.prices && data.prices[0];
      if (!px) return;
      const bid = px.bids && px.bids[0] ? +px.bids[0].price : px.closeoutBid != null ? +px.closeoutBid : null;
      const ask = px.asks && px.asks[0] ? +px.asks[0].price : px.closeoutAsk != null ? +px.closeoutAsk : null;
      /** @type {import('/data_engine/data/adapter-contract.js').Quote} */
      const out = {};
      if (bid != null) out.bid = bid;
      if (ask != null) out.ask = ask;
      if (bid != null && ask != null) out.last = (bid + ask) / 2;
      if (Object.keys(out).length) /** @type {QuotePoller} */ (s).cbs.forEach((c) => c(out));
    };
    poll();
    s.timer = setInterval(poll, 1500);
  }
  s.cbs.add(cb);
}
/** @param {string} inst @param {Function} cb */
function pollUnsubscribe(inst, cb) {
  const s = quotePollers.get(inst);
  if (!s) return;
  s.cbs.delete(cb);
  if (!s.cbs.size) {
    clearInterval(s.timer);
    quotePollers.delete(inst);
  }
}

const adapter = {
  id: 'oanda',
  capabilities: { marketData: true, trading: true, depth: false },
  form: [
    { key: 'server', type: 'select', label: 'Server', options: ['Practice', 'Live'], default: 'Practice' },
    { key: 'token', label: 'API Token', type: 'password' },
    { key: 'accountId', label: 'Account ID', type: 'text' },
  ],

  /** @param {any} account */
  async connect(account) {
    cfg.token = ((account && account.token) || '').trim();
    cfg.accountId = ((account && account.accountId) || '').trim();
    cfg.environment = ((account && account.server) || '').toLowerCase() === 'live' ? 'live' : 'practice';
    instrCache = null; // refetch instruments for the new account
    const st = await oj('/api/oanda/status').catch(() => ({}));
    if (!st.authorized) {
      connected = false;
      setConn('not connected', '#cc0');
      log('OANDA: check your API token and Account ID (and Practice/Live).', true);
      return;
    }
    connected = true;
    setConn('connected', '#6c6');
    log('OANDA connected (' + cfg.environment + ') — polling quotes & candles.');
    bus.emit('logon'); // panes resolve their symbols
  },
  // hard stop: kill every poller (quotes, bars, trade events) so nothing keeps fetching after disconnect.
  disconnect() {
    connected = false;
    quotePollers.forEach((s) => clearInterval(s.timer));
    quotePollers.clear();
    tradePollers.forEach((t) => clearInterval(t));
    tradePollers.clear();
    [...barStops].forEach((h) => {
      try {
        h.stop();
      } catch (_) {
        /* ignore */
      }
    });
    setConn('not connected', '#888');
  },
  isConnected() {
    return connected;
  },
  serverNow() {
    return null;
  },

  /** @param {string} symbol @param {(inst: import('/data_engine/data/adapter-contract.js').Instrument|null, meta?: any) => void} cb */
  resolveSymbol(symbol, cb) {
    const inst = normInst(symbol);
    oj(
      '/api/oanda/md/v3/accounts/' +
        encodeURIComponent(cfg.accountId) +
        '/instruments?instruments=' +
        encodeURIComponent(inst),
    )
      .then((data) => {
        const row = data && Array.isArray(data.instruments) && data.instruments[0];
        if (row && row.displayPrecision != null) {
          const decimals = Math.min(8, Math.max(0, row.displayPrecision));
          return cb({ id: inst, priceDecimals: decimals, tickSize: Math.pow(10, -decimals) });
        }
        // fallback: infer precision from a pricing snapshot
        oj(pricingUrl(inst))
          .then((pd) => {
            const px = pd && pd.prices && pd.prices[0];
            const p = px && ((px.bids && px.bids[0] && px.bids[0].price) || px.closeoutBid);
            if (p == null) return cb(null, { status: (data && data.errorMessage) || 'not found' });
            const decimals = decimalsOf(+p);
            cb({ id: inst, priceDecimals: decimals, tickSize: Math.pow(10, -decimals) });
          })
          .catch(() => cb(null, {}));
      })
      .catch(() => cb(null, {}));
  },

  // live bars: seed with REST history, then refresh the trailing window on a timer
  /** @param {{ id: string, tf: TF, fromMs: number }} req @param {Function} cb */
  subscribeBars({ id, tf, fromMs }, cb) {
    let stopped = false;
    const inst = normInst(id);
    fetchCandles(inst, tf, fromMs, Date.now()).then(({ bars, error }) => {
      if (stopped) return;
      if (error) {
        cb({ bars: [], complete: true, error });
        return;
      }
      cb({ bars, complete: true }); // seeds + fits the view
    });
    const timer = setInterval(async () => {
      if (stopped) return;
      const { bars } = await fetchCandles(inst, tf, Date.now() - Math.max(barMs(tf) * 3, 60000), Date.now());
      if (!stopped && bars.length) cb({ bars, complete: true });
    }, pollMs(tf));
    const handle = {
      stop: () => {
        stopped = true;
        clearInterval(timer);
        barStops.delete(handle);
      },
    };
    barStops.add(handle);
    return handle;
  },

  // one-shot history (older-bars backfill). An empty window is NOT reported as the
  // start of data: forex is closed on weekends, so a small intraday lookback can land
  // in a gap. The pane skips past empty windows (gap-hop cap decides the true end).
  /** @param {{ id: string, tf: TF, fromMs: number, toMs: number }} req @param {Function} cb */
  getBars({ id, tf, fromMs, toMs }, cb) {
    fetchCandles(normInst(id), tf, fromMs, toMs).then(({ bars, error }) => {
      if (error) {
        cb({ bars: [], complete: true, error });
        return;
      }
      cb({ bars, complete: true });
    });
  },

  // trading-hours: synthesised FX sessions (Sun 17:00 -> Fri 17:00 NY, continuous). Same neutral shape
  // as CQG's getMarketHours -- feeds the status dot / popup / daily-anchor corrector. No RTH split.
  /** @param {{ fromMs?: number, toMs?: number, count?: number }} [req] @param {Function} [cb] */
  getMarketHours({ toMs, count } = {}, cb) {
    try {
      const end = toMs != null ? toMs : Date.now();
      const n = Math.max(1, count != null ? count : 60);
      cb && cb({ days: fxTradingDays(end, n) });
    } catch (e) {
      cb && cb({ error: 'market hours: ' + ((e && /** @type {any} */ (e).message) || e) });
    }
  },

  /** @param {any} handle */
  drop(handle) {
    if (handle && handle.stop) handle.stop();
  },

  /** @param {string|number} id @param {Function} cb */
  subscribeQuotes(id, cb) {
    pollSubscribe(normInst(id), cb);
  },
  /** @param {string|number} id @param {Function} cb */
  unsubscribeQuotes(id, cb) {
    pollUnsubscribe(normInst(id), cb);
  },

  // ---- trading (neutral order contract) ----
  // placeOrder({ symbol, side:'buy'|'sell', qty, type:'market'|'limit'|'stop', price?, tif? }, cb)
  //   -> cb({ id, status:'filled'|'submitted', price?, error? })
  /** @param {{ symbol?: string, side?: any, qty?: any, type?: string, price?: number, tif?: string }} order @param {Function} [cb] */
  placeOrder({ symbol, side, qty, type = 'market', price, tif } = {}, cb) {
    /** @type {{ instrument: string, units: string, type?: string, price?: string, timeInForce?: string }} */
    const order = {
      instrument: normInst(symbol),
      units: String((String(side).toLowerCase() === 'sell' ? -1 : 1) * Math.abs(Number(qty) || 0)),
    };
    const T = String(type).toLowerCase();
    if (T === 'limit' || T === 'stop') {
      order.type = T.toUpperCase();
      order.price = String(price);
      order.timeInForce = tif || 'GTC';
    } else order.type = 'MARKET';
    ojx(acctPath('/orders'), 'POST', { order }).then((r) => {
      const err = r && (r.error || r.errorMessage);
      if (!r || err) return cb && cb({ error: err || 'order failed' });
      const fill = r.orderFillTransaction,
        create = r.orderCreateTransaction;
      cb &&
        cb({
          id: (create && create.id) || (fill && (fill.orderID || fill.id)),
          status: fill ? 'filled' : 'submitted',
          price: fill && fill.price,
          raw: r,
        });
    });
  },
  /** @param {any} orderId @param {Function} [cb] */
  cancelOrder(orderId, cb) {
    ojx(acctPath('/orders/' + encodeURIComponent(orderId) + '/cancel'), 'PUT', null).then((r) => {
      const err = r && (r.error || r.errorMessage);
      cb && cb(err ? { error: err } : { ok: true, raw: r });
    });
  },
  /** @param {Function} [cb] */
  getOrders(cb) {
    oj('/api/oanda/md/' + acctPath('/pendingOrders')).then((r) => {
      cb &&
        cb(
          ((r && r.orders) || []).map((/** @type {any} */ o) => ({
            id: o.id,
            symbol: o.instrument,
            side: Number(o.units) < 0 ? 'sell' : 'buy',
            qty: Math.abs(Number(o.units)),
            type: (o.type || '').toLowerCase(),
            price: o.price,
            status: (o.state || '').toLowerCase(),
          })),
        );
    });
  },
  // OnTrade for OANDA (REST, no push): poll positions + account and emit on change.
  /** @param {Function} cb */
  subscribeTrade(cb) {
    let lastPos = '',
      lastAcct = '';
    const tick = () => {
      this.getPositions((/** @type {any[]} */ ps) => {
        const s = JSON.stringify(ps);
        if (s !== lastPos) {
          lastPos = s;
          ps.forEach((/** @type {any} */ p) => cb({ kind: 'position', position: p }));
        }
      });
      this.getAccount((/** @type {any} */ a) => {
        if (a && !a.error) {
          const s = JSON.stringify(a);
          if (s !== lastAcct) {
            lastAcct = s;
            cb({ kind: 'account', account: a });
          }
        }
      });
    };
    tick();
    tradePollers.set(cb, setInterval(tick, 2500));
  },
  /** @param {Function} cb */
  unsubscribeTrade(cb) {
    const t = tradePollers.get(cb);
    if (t) {
      clearInterval(t);
      tradePollers.delete(cb);
    }
  },

  // account info (balance / equity / margin / P&L) — the EA "account" surface
  /** @param {Function} [cb] */
  getAccount(cb) {
    oj('/api/oanda/md/' + acctPath('/summary')).then((r) => {
      const a = r && r.account;
      if (!a) return cb && cb({ error: (r && (r.error || r.errorMessage)) || 'no account' });
      cb &&
        cb({
          currency: a.currency,
          balance: Number(a.balance),
          equity: Number(a.NAV),
          unrealizedPL: Number(a.unrealizedPL),
          realizedPL: Number(a.pl),
          marginUsed: Number(a.marginUsed),
          marginAvailable: Number(a.marginAvailable),
          leverage: a.marginRate ? Math.round(1 / Number(a.marginRate)) : null,
          openPositions: Number(a.openPositionCount || 0),
          openTrades: Number(a.openTradeCount || 0),
          raw: a,
        });
    });
  },
  /** @param {Function} [cb] */
  getPositions(cb) {
    oj('/api/oanda/md/' + acctPath('/openPositions')).then((r) => {
      cb &&
        cb(
          ((r && r.positions) || []).map((/** @type {any} */ pp) => {
            const net = Number((pp.long && pp.long.units) || 0) + Number((pp.short && pp.short.units) || 0);
            return {
              symbol: pp.instrument,
              qty: Math.abs(net),
              side: net < 0 ? 'short' : 'long',
              pl: Number(pp.pl || 0),
            };
          }),
        );
    });
  },
  // close an open position entirely (market) — convenience for "flatten". OANDA rejects closing
  // a side that has no units, so query the position and close only the side(s) actually open.
  /** @param {string} symbol @param {Function} [cb] */
  closePosition(symbol, cb) {
    const inst = normInst(symbol);
    oj('/api/oanda/md/' + acctPath('/positions/' + encodeURIComponent(inst))).then((r) => {
      const pos = r && r.position;
      const longU = Number((pos && pos.long && pos.long.units) || 0);
      const shortU = Number((pos && pos.short && pos.short.units) || 0);
      /** @type {{ longUnits?: string, shortUnits?: string }} */
      const body = {};
      if (longU > 0) body.longUnits = 'ALL';
      if (shortU < 0) body.shortUnits = 'ALL';
      if (!body.longUnits && !body.shortUnits) return cb && cb({ error: 'no open position in ' + inst });
      ojx(acctPath('/positions/' + encodeURIComponent(inst) + '/close'), 'PUT', body).then((r2) => {
        const err = r2 && (r2.error || r2.errorMessage);
        cb && cb(err ? { error: err } : { ok: true, raw: r2 });
      });
    });
  },

  // symbol search: the account's tradeable instruments, filtered by query
  /** @param {string} query @param {Function} cb */
  searchSymbols(query, cb) {
    const q = normInst(query);
    /** @type {Record<string, string>} */
    const CLASS = { CURRENCY: 'Forex', INDEX: 'Indices', COMMODITY: 'Commodities', METAL: 'Metals', BOND: 'Bonds' };
    /** @param {any} i @returns {string} */
    const cat = (i) => {
      const t = (i.tags || []).find((/** @type {any} */ x) => x.type === 'ASSET_CLASS');
      return (t && CLASS[t.name]) || (i.type === 'METAL' ? 'Metals' : 'Forex');
    };
    /** @param {any[]|null} list */
    const done = (list) =>
      cb(
        (list || [])
          .filter(
            (/** @type {any} */ i) =>
              !q || i.name.toUpperCase().includes(q) || (i.displayName || '').toUpperCase().includes(q),
          )
          .map((/** @type {any} */ i) => ({ symbol: i.name, name: i.displayName || '', category: cat(i) })),
      );
    if (instrCache) return done(instrCache);
    oj('/api/oanda/md/v3/accounts/' + encodeURIComponent(cfg.accountId) + '/instruments')
      .then((data) => {
        instrCache = data && Array.isArray(data.instruments) ? data.instruments : [];
        done(instrCache);
      })
      .catch(() => cb([]));
  },
};

registerBroker(adapter);
export default adapter;
