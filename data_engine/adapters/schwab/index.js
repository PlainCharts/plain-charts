// @ts-check
// Charles Schwab broker adapter. Implements the neutral BrokerAdapter contract
// against the Schwab Market Data API, proxied through our own server (which
// holds the OAuth secret and attaches the Bearer token). No streamer is used —
// this app key has Market Data only, so live quotes/bars come from polling.
//
// Wire specifics that stay inside this module: OAuth (manual code-paste flow),
// REST price-history with periodType/frequencyType mapping, client-side bar
// aggregation for units Schwab doesn't serve natively, and snapshot quotes.
import { registerBroker } from '/data_engine/data/adapter-sdk.js';
import { bus } from '/data_engine/bus.js';
import { setConn, log } from '/data_engine/status.js';
import { barMs } from '/data_engine/timeframes.js';
import { createStreamer } from './streamer.js';
import { emitRaw } from '/data_engine/data/raw-tap.js'; // diagnostic tap (Data Interceptor); no-op when unused
import { j, decimalsOf, mdFail } from './common.js'; // shared REST plumbing (leaf)
import { pollMs, fetchCandles } from './history.js'; // tf->query mapping + aggregation + candle fetch
import { trader, stopTradePolling } from './trader.js'; // the execution plane (BLIND legs quarantined there)

/**
 * @typedef {import('/data_engine/data/adapter-contract.js').Quote} Quote
 * @typedef {import('/data_engine/data/adapter-contract.js').Bar} Bar
 * @typedef {import('/data_engine/data/adapter-contract.js').Instrument} Instrument
 * @typedef {{ unit: string, n: number }} Timeframe
 * @typedef {{ tradeDate: number|null, open: number, close: number, preOpen: number|null, postClose: number|null, rthOpen: number|null, rthClose: number|null }} SessionDay
 * @typedef {{ cbs: Set<(q: Quote) => void>, timer: any }} QuotePoller
 */

/** @type {Map<string, QuotePoller>} */
const quotePollers = new Map(); // symbol -> { timer, cbs:Set }
/** @type {Set<{ stop: () => void }>} */
const barStops = new Set(); // active bar-subscription stop handles (so disconnect can kill them)
const streamer = createStreamer();
let connected = false;

// --- REST polling fallback for quotes (used when the streamer is unavailable) ---
/** @param {string} id @param {(q: Quote) => void} cb */
function pollSubscribe(id, cb) {
  let s = quotePollers.get(id);
  if (!s) {
    s = { cbs: new Set(), timer: null };
    quotePollers.set(id, s);
    const poll = async () => {
      const data = await j('/api/schwab/md/quotes?symbols=' + encodeURIComponent(id)).catch(() => null);
      emitRaw('schwab', 'quote-rest', data); // raw /quotes snapshot (poll)
      if (!data || data.error) return;
      const key = data[id] ? id : Object.keys(data)[0];
      const q = key && data[key] && data[key].quote;
      if (!q) return;
      /** @type {Quote} */
      const out = {};
      if (q.bidPrice != null) out.bid = q.bidPrice;
      if (q.askPrice != null) out.ask = q.askPrice;
      if (q.lastPrice != null) out.last = q.lastPrice;
      if (out.bid != null || out.ask != null || out.last != null)
        /** @type {QuotePoller} */ (s).cbs.forEach((c) => c(out));
    };
    poll();
    s.timer = setInterval(poll, 2000);
  }
  s.cbs.add(cb);
}
/** @param {string} id @param {(q: Quote) => void} cb */
function pollUnsubscribe(id, cb) {
  const s = quotePollers.get(id);
  if (!s) return;
  s.cbs.delete(cb);
  if (!s.cbs.size) {
    clearInterval(s.timer);
    quotePollers.delete(id);
  }
}

const adapter = {
  id: 'schwab',
  capabilities: { marketData: true, trading: true, depth: false, restingBracket: /** @type {const} */ ('none') }, // no order placement (display-only)
  // app creds live on the account; Authorize is a declarative ACTION that runs the OAuth flow (open the
  // broker's page, paste the redirect URL back, exchange server-side) using the adapter's own hooks below.
  form: [
    { key: 'clientId', label: 'App Key (Client ID)', type: 'text' },
    { key: 'clientSecret', label: 'App Secret', type: 'password' },
    { key: 'redirectUri', label: 'Callback URL', type: 'text', default: 'https://127.0.0.1' },
    {
      key: 'authorize',
      type: 'action',
      label: 'Authorization',
      button: 'Authorize with Schwab',
      /** @param {any} account @param {any} ui */
      run: async (account, ui) => {
        if (!account.clientId) return ui.status('Enter your App Key (Client ID) above first.', 'err');
        const url = await adapter.authUrl(account);
        if (!url)
          return ui.status(
            'Could not build the authorize URL — check the App Key and that the server is running.',
            'err',
          );
        ui.openUrl(url);
        ui.status('A broker tab opened. Log in & approve, then paste that page’s URL below.');
        const pasted = await ui.promptInput({
          placeholder: 'Paste the https://127.0.0.1/?code=… URL here',
          submit: 'Submit code',
        });
        if (!pasted) return;
        ui.status('exchanging…');
        const r = await adapter.exchangeAuth(pasted, account);
        ui.status(
          r && r.ok ? '✓ authorized — Save the account, then Connect' : '✗ ' + ((r && r.error) || 'failed'),
          r && r.ok ? 'ok' : 'err',
        );
      },
      status: async () => {
        const st = await adapter.authStatus().catch(() => ({}));
        return {
          ok: !!(st && st.authorized),
          text: st && st.authorized ? '✓ authorized (token ~' + st.expiresInSec + 's)' : 'not authorized yet',
        };
      },
    },
  ],

  /** @param {any} account */
  async connect(account) {
    // push this account's creds to the server so token refresh can use them
    if (account && account.clientId) {
      await j('/api/schwab/creds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: account.clientId,
          clientSecret: account.clientSecret,
          redirectUri: account.redirectUri,
        }),
      }).catch(() => {});
    }
    const st = await j('/api/schwab/auth/status').catch(() => ({ reason: 'transient' }));
    if (!st.authorized) {
      connected = false;
      // A present-but-dead token used to report "connected" while every market-data call
      // silently returned []. Now the status endpoint tells the truth; surface WHY -- to the
      // top bar, the log, AND the Connections dialog (broker:notice), so the user isn't left
      // staring at "Connecting..." with no result.
      const detail = st.error ? ' [' + st.error + ']' : '';
      const msg =
        (st.reason === 'transient'
          ? 'Schwab: could not reach the token service — will retry. If this persists, re-Authorize.'
          : 'Schwab session expired (the refresh token lasts 7 days). Open Connect → Authorize with Schwab to re-grant market-data access.') +
        detail;
      setConn(st.reason === 'transient' ? 'reconnecting' : 're-authorize', st.reason === 'transient' ? '#cc0' : '#c33');
      log(msg, true);
      bus.emit('broker:notice', { id: 'schwab', ok: false, error: true, message: msg });
      return;
    }
    connected = true;
    const streaming = await streamer.connect();
    setConn('connected', '#6c6');
    const okMsg = streaming
      ? 'Schwab connected — real-time streaming quotes.'
      : 'Schwab connected — polling quotes (add Accounts and Trading + re-authorize for streaming).';
    log(okMsg);
    bus.emit('broker:notice', { id: 'schwab', ok: true, error: false, message: okMsg });
    bus.emit('logon'); // panes resolve their symbols
  },
  // hard stop: kill quote pollers + bar subscriptions and close the streamer socket.
  disconnect() {
    connected = false;
    quotePollers.forEach((s) => clearInterval(s.timer));
    quotePollers.clear();
    stopTradePolling();
    [...barStops].forEach((h) => {
      try {
        h.stop();
      } catch (_) {}
    });
    try {
      streamer.close();
    } catch (_) {}
    setConn('not connected', '#888');
  },
  isConnected() {
    return connected;
  },
  serverNow() {
    return null;
  },

  /** @param {string} symbol @param {(inst: Instrument|null, meta?: any) => void} cb */
  resolveSymbol(symbol, cb) {
    j('/api/schwab/md/quotes?symbols=' + encodeURIComponent(symbol))
      .then((data) => {
        emitRaw('schwab', 'quote-rest', data); // raw /quotes snapshot (resolveSymbol)
        if (!data || data.error) {
          mdFail('resolve ' + symbol, data && data.error);
          cb(null, { status: (data && data.error) || 'error' });
          return;
        }
        const key = data[symbol] ? symbol : Object.keys(data)[0];
        const row = key && data[key];
        if (!row) {
          cb(null, { status: 'not found' });
          return;
        }
        const q = row.quote || {};
        const ref = row.reference || {};
        // Prefer Schwab's REAL tick (quote.tick) -- futures supply it (e.g. /MES = 0.25). Equities omit it,
        // so fall back to inferring from the quote's decimal coarseness. tickAmount (currency per tick) and
        // futureMultiplier (contract size) come straight from the payload when present.
        const realTick = q.tick != null && Number.isFinite(q.tick) && q.tick > 0 ? q.tick : null;
        const tickSize =
          realTick != null ? realTick : Math.pow(10, -decimalsOf(q.bidPrice, q.askPrice, q.lastPrice, q.closePrice));
        /** @type {Instrument} */
        const inst = { id: symbol, tickSize, priceDecimals: decimalsOf(tickSize) };
        if (q.tickAmount != null && Number.isFinite(q.tickAmount)) inst.tickValue = q.tickAmount;
        if (ref.futureMultiplier != null && Number.isFinite(ref.futureMultiplier))
          inst.contractSize = ref.futureMultiplier;
        cb(inst);
      })
      .catch(() => cb(null, {}));
  },

  // Live bars. Seed with REST history, then drive the forming candle:
  //  - streaming: update high/low/close from every trade tick (real-time),
  //    reconciling against official OHLC every 30s
  //  - polling fallback: refresh the trailing window on a timer
  /** @param {{ id: string, tf: Timeframe, fromMs: number }} req @param {(u: { bars: Bar[], complete: boolean, error?: any }) => void} cb */
  subscribeBars({ id, tf, fromMs }, cb) {
    let stopped = false;
    /** @type {Bar|null} */
    let forming = null; // the current (live) bar
    let historyLoaded = false; // gate stream ticks until history seeds the chart
    const barSecs = Math.max(1, Math.round(barMs(tf) / 1000));
    const barStartNow = () => Math.floor(Date.now() / 1000 / barSecs) * barSecs;

    fetchCandles(id, tf, fromMs, Date.now()).then(({ bars, error }) => {
      if (stopped) return;
      if (error) {
        cb({ bars: [], complete: true, error });
        return;
      }
      if (bars.length) forming = { ...bars[bars.length - 1] };
      historyLoaded = true;
      cb({ bars, complete: true }); // this is what seeds + fits the view
    });

    /** @type {((q: Quote) => void)|null} */
    let streamCb = null;
    /** @type {any} */
    let timer = null;
    if (streamer.available()) {
      streamCb = (q) => {
        // ignore ticks until history is in, else one tick would seed+fit a single bar
        if (stopped || q.last == null || !historyLoaded) return;
        const t = barStartNow();
        if (!forming || t > forming.time) {
          forming = { time: t, open: q.last, high: q.last, low: q.last, close: q.last, volume: 0 };
        } else {
          forming.high = Math.max(forming.high, q.last);
          forming.low = Math.min(forming.low, q.last);
          forming.close = q.last;
        }
        cb({ bars: [{ ...forming }], complete: true }); // tick-by-tick candle
      };
      streamer.subscribe(id, streamCb);
      timer = setInterval(async () => {
        // reconcile official OHLC
        if (stopped) return;
        const { bars } = await fetchCandles(id, tf, Date.now() - barSecs * 3000, Date.now());
        if (!stopped && bars.length) {
          forming = { ...bars[bars.length - 1] };
          cb({ bars, complete: true });
        }
      }, 30000);
    } else {
      timer = setInterval(async () => {
        if (stopped) return;
        const { bars } = await fetchCandles(id, tf, Date.now() - Math.max(barMs(tf) * 3, 60000), Date.now());
        if (!stopped && bars.length) cb({ bars, complete: true });
      }, pollMs(tf));
    }

    const handle = {
      stop: () => {
        stopped = true;
        if (timer) clearInterval(timer);
        if (streamCb) streamer.unsubscribe(id, streamCb);
        barStops.delete(handle);
      },
    };
    barStops.add(handle);
    return handle;
  },

  // one-shot history (older-bars backfill). An empty window is NOT reported as the
  // start of data: Schwab serves nothing for market-closed gaps (weekends/holidays),
  // and the pane skips past those. The pane's gap-hop cap decides the true end.
  /** @param {{ id: string, tf: Timeframe, fromMs: number, toMs: number }} req @param {(u: { bars: Bar[], complete: boolean, error?: any }) => void} cb */
  getBars({ id, tf, fromMs, toMs }, cb) {
    fetchCandles(id, tf, fromMs, toMs).then(({ bars, error }) => {
      if (error) {
        cb({ bars: [], complete: true, error });
        return;
      }
      cb({ bars, complete: true });
    });
  },

  // trading-hours from Schwab's /markets endpoint (per single date -- we query a small window around
  // `to`, enough for the status dot/popup). Two paths:
  //   futures ('/'-prefixed): the future market. Product = the symbol root (/MESU26 -> MES); each
  //     regularMarket segment is a tradeable session window (open/close). One product per query, the
  //     segments span several days so a couple of dates cover the window.
  //   equities/options: the equity market -- open = pre-market start, close = post-market end, RTH =
  //     regular market (options trade in equity hours). isOpen=false (weekend/holiday) -> no session.
  /** @param {{ id?: string|number, toMs?: number, count?: number }} [req] @param {(r: { days?: SessionDay[], error?: string }) => void} [cb] */
  async getMarketHours({ id } = {}, cb) {
    try {
      const sym = String(id || '');
      // Anchor the per-date window on NOW. The model passes a forward margin in toMs (now + ~10 days) for
      // its coverage bookkeeping -- centering the queries there would fetch next week and miss today's
      // session. Schwab's per-date hours only feed the (always-current) status dot/popup.
      const end = Date.now();
      /** @param {any} s @returns {number|null} */
      const ms = (s) => (s ? Date.parse(s) : null);
      /** @param {number} off */
      const dstr = (off) => new Date(end + off * 86400000).toISOString().slice(0, 10);

      if (sym[0] === '/') {
        // ---- futures ----
        const root = sym.replace(/^\//, '').replace(/[FGHJKMNQUVXZ]\d{1,2}$/, ''); // /MESU26 -> MES
        /** @type {string[]} */
        const fdates = [];
        for (let i = -1; i <= 4; i++) fdates.push(dstr(i)); // consecutive -- segments are sparse in holiday weeks
        const reps = await Promise.all(
          fdates.map((date) =>
            j('/api/schwab/md/markets?markets=future&date=' + date)
              .then((d) => {
                emitRaw('schwab', 'hours', d);
                return d;
              })
              .catch(() => null),
          ),
        );
        /** @type {Set<string>} */
        const seen = new Set();
        /** @type {SessionDay[]} */
        const days = [];
        for (const d of reps) {
          const prod = d && d.future && d.future[root];
          const segs = prod && prod.isOpen !== false && prod.sessionHours && prod.sessionHours.regularMarket;
          for (const seg of segs || []) {
            const open = ms(seg.start),
              close = ms(seg.end);
            if (open == null || close == null || close - open < 30 * 60000) continue; // drop sub-30m slivers
            const key = open + '|' + close;
            if (seen.has(key)) continue;
            seen.add(key);
            days.push({ tradeDate: null, open, close, preOpen: null, postClose: null, rthOpen: null, rthClose: null });
          }
        }
        cb && cb({ days: days.sort((a, z) => a.open - z.open) });
        return;
      }

      // ---- equities / options ----
      /** @type {string[]} */
      const dates = [];
      for (let i = -2; i <= 4; i++) dates.push(dstr(i));
      const reports = await Promise.all(
        dates.map((date) =>
          j('/api/schwab/md/markets?markets=equity&date=' + date)
            .then((d) => {
              emitRaw('schwab', 'hours', d);
              return { date, d };
            })
            .catch(() => ({ date, d: null })),
        ),
      );
      /** @type {SessionDay[]} */
      const days = [];
      for (const { date, d } of reports) {
        const eq = d && d.equity && (d.equity.EQ || Object.values(d.equity)[0]);
        const sh = eq && eq.isOpen !== false && eq.sessionHours;
        if (!sh) continue;
        const pre = sh.preMarket && sh.preMarket[0],
          reg = sh.regularMarket && sh.regularMarket[0],
          post = sh.postMarket && sh.postMarket[0];
        const open = ms(pre ? pre.start : reg && reg.start),
          close = ms(post ? post.end : reg && reg.end);
        if (open == null || close == null) continue;
        days.push({
          tradeDate: Date.parse(date + 'T00:00:00Z'),
          open,
          close,
          preOpen: ms(pre && pre.start),
          postClose: ms(post && post.end),
          rthOpen: ms(reg && reg.start),
          rthClose: ms(reg && reg.end),
        });
      }
      cb && cb({ days: days.sort((a, z) => a.open - z.open) });
    } catch (e) {
      cb && cb({ error: 'market hours: ' + ((e && /** @type {any} */ (e).message) || e) });
    }
  },

  /** @param {{ stop?: () => void }} handle */
  drop(handle) {
    if (handle && handle.stop) handle.stop();
  },

  // real-time via the streamer when available, else REST polling
  /** @param {string|number} id @param {(q: Quote) => void} cb */
  subscribeQuotes(id, cb) {
    const sid = /** @type {string} */ (id); // Schwab ids are always the string symbol; the contract's id is opaque (string|number)
    if (streamer.available()) streamer.subscribe(sid, cb);
    else pollSubscribe(sid, cb);
  },
  /** @param {string|number} id @param {(q: Quote) => void} cb */
  unsubscribeQuotes(id, cb) {
    const sid = /** @type {string} */ (id);
    if (streamer.available()) streamer.unsubscribe(sid, cb);
    else pollUnsubscribe(sid, cb);
  },

  // symbol search (Schwab instruments API; assetType -> category)
  /** @param {string} query @param {(rows: { symbol: string, name: string, category: string }[]) => void} cb */
  searchSymbols(query, cb) {
    const q = (query || '').trim();
    if (!q) return cb([]); // huge universe — needs a query
    j('/api/schwab/md/instruments?symbol=' + encodeURIComponent(q) + '&projection=symbol-search')
      .then((data) => {
        emitRaw('schwab', 'search', data); // raw /instruments response
        if (!data || data.error) {
          mdFail('symbol search', data && data.error);
          return cb([]);
        }
        const ins = Array.isArray(data.instruments) ? data.instruments : [];
        cb(
          ins.map((/** @type {any} */ i) => ({
            symbol: i.symbol,
            name: i.description || '',
            category: i.assetType || '',
          })),
        );
      })
      .catch((e) => {
        mdFail('symbol search', String((e && e.message) || e));
        cb([]);
      });
  },

  // The TRADER layer (account/positions/orders/history + the OnTrade polling loop) lives in
  // ./trader.js — the adapter's execution plane and the home of its BLIND / verification-debt code.
  ...trader,

  // ---- OAuth hooks driven by the Authorize ACTION in `form` above. They take the account being edited
  // so the creds come straight from the form. ----
  /** @param {any} account */
  async authUrl(account) {
    const r = await j('/api/schwab/auth/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: account.clientId, redirectUri: account.redirectUri }),
    });
    return r.url;
  },
  async authStatus() {
    return j('/api/schwab/auth/status').catch(() => ({}));
  },
  /** @param {any} pasted @param {any} account */
  async exchangeAuth(pasted, account) {
    const v = (pasted || '').trim();
    const body = {
      clientId: account.clientId,
      clientSecret: account.clientSecret,
      redirectUri: account.redirectUri,
      ...(v.startsWith('http') || v.includes('code=') ? { url: v } : { code: v }),
    };
    return j('/api/schwab/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((e) => ({ error: String(e) }));
  },
};

registerBroker(adapter);
export default adapter;
