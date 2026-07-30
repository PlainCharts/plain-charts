// @ts-check
// CQG WebSocket connection — the DATA plane of the adapter: logon, ping/pong keep-alive, and request
// routing for symbols / bars / sessions / live market data (quotes + DOM). Symbol-resolution and bar
// requests register a callback keyed by their id, so many panes can share one connection and each gets
// only its own replies. The EXECUTION plane (orders/positions/accounts/history) lives in ./trade.js and
// rides this connection through the onLogon/onMessage/onReset hooks — this file never imports it.
//
// This runs wherever the real data layer runs: the browser page (solo) or the
// Electron headless data host. UI windows never import this directly — they talk to
// the data host through the generic broker bridge (src/data/broker-bridge.js).
import { encode, decode } from './protocol.js';
import { bus } from '/data_engine/bus.js';
import { log, setConn } from '/data_engine/status.js';
import { emitRaw } from '/data_engine/data/raw-tap.js'; // diagnostic tap (Data Interceptor); no-op when unused

/** @type {Record<string, string>} */
const SERVERS = { Demo: 'wss://demoapi.cqg.com:443', Live: 'wss://api.cqg.com:443' };

// ---- typedefs for the transport's own STRUCTURED state (raw CQG protocol messages stay `any`) ----
/** @typedef {(...args: any[]) => void} Cb */
/** @typedef {{ reqId: number, level: number, quoteCbs: Set<Cb>, depthCbs: Set<Cb>, bids: Map<number, number>, asks: Map<number, number> }} MdSub */

/** @type {WebSocket | null} */
let ws = null;
let _baseMs = 0;
/** @type {number | null} */
let _brokerSkewMs = null; // broker server time - local time (set at logon)
let seq = 10;

// ---- connection supervision: the socket can die WITHOUT delivering a close event (server restart,
// sleep, NAT drop), leaving a zombie that still looks logged on while every send is silently
// dropped. Keep the last account and revive the connection instead of dead-ending. ----
/** @type {any} */
let _account = null; // last logon account -> fuel for auto-reconnect
let _userClosed = false; // explicit disconnect(): stay down
let _logonRejected = false; // server refused the logon: never auto-retry (credential lockout risk)
let _retryMs = 0; // reconnect backoff (doubles to 60s; reset on successful logon)
let _retryTimer = 0;
let _watchdog = 0;

// The socket is gone (close event, or a zombie caught by the watchdog / send guard): drop the logon
// state so isConnected() tells the truth, surface it, and schedule a revival.
/** @param {string} label */
function markDead(label) {
  _baseMs = 0;
  _brokerSkewMs = null;
  setConn(label, '#888');
  scheduleReconnect();
}

function scheduleReconnect() {
  if (_userClosed || _logonRejected || !_account || _retryTimer) return;
  _retryMs = Math.min(Math.max(_retryMs * 2, 2000), 60000);
  log('Connection lost — reconnecting in ' + Math.round(_retryMs / 1000) + 's…', true);
  _retryTimer = /** @type {any} */ (
    setTimeout(() => {
      _retryTimer = 0;
      connection.connect(_account);
    }, _retryMs)
  );
}

// Catch a socket that died without its close event: still holding a logon while readyState says
// CLOSING/CLOSED. (A fresh connect() zeroes _baseMs first, so CONNECTING never trips this.)
function startWatchdog() {
  if (_watchdog) return;
  _watchdog = /** @type {any} */ (
    setInterval(() => {
      if (_baseMs > 0 && ws && ws.readyState !== WebSocket.OPEN) markDead('offline (no close event)');
    }, 10000)
  );
}
/** @type {Map<number, Cb>} */
const symCbs = new Map(); // information request id -> callback
/** @type {Map<number, Cb>} */
const barCbs = new Map(); // bar request id        -> callback
/** @type {Set<number>} */
const oneShot = new Set(); // bar request ids that are GET (auto-cleaned on complete)
/** @type {Map<any, MdSub>} */
const mdSubs = new Map(); // contractId -> { reqId, cbs:Set } (live quotes, fanned out)
/** @type {Map<number, Cb>} */
const sessCbs = new Map(); // trading-session request id -> callback (one-shot)

// ---- the trade plane's seams (./trade.js registers; one-way, so no import cycle) ----
/** @type {Cb[]} */
const msgHooks = []; // every decoded server message is forwarded here after the data-plane routing
/** @type {Cb[]} */
const logonHooks = []; // fired after a successful logon (the trade plane starts its subscriptions)
/** @type {Cb[]} */
const resetHooks = []; // fired on disconnect (the trade plane clears its state)
/** @param {Cb} cb */
export const onMessage = (cb) => {
  msgHooks.push(cb);
};
/** @param {Cb} cb */
export const onLogon = (cb) => {
  logonHooks.push(cb);
};
/** @param {Cb} cb */
export const onReset = (cb) => {
  resetHooks.push(cb);
};

export const connection = {
  baseMs: () => _baseMs,
  // readyState is part of the truth: a lost close event leaves ws set and _baseMs > 0 on a dead socket
  isConnected: () => !!ws && ws.readyState === WebSocket.OPEN && _baseMs > 0,
  brokerNow: () => (_brokerSkewMs == null ? null : Date.now() + _brokerSkewMs),
  brokerSkewMs: () => _brokerSkewMs, // broker-vs-local clock skew (trade plane stamps cancels with it)
  nextId: () => ++seq, // the shared request-id source (trade requests must not collide with ours)

  /** @param {any} obj */
  send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // never send on a CONNECTING/CLOSING socket (premature resubscribes on the startup race are re-done after logon)
      if (_baseMs > 0) markDead('offline (dead socket)'); // logged on but not OPEN -> the close event was lost; recover now, don't wait for the watchdog
      return;
    }
    try {
      ws.send(encode(obj));
    } catch (e) {
      log('encode error: ' + /** @type {any} */ (e).message, true);
    }
  },

  /** @param {any} account */
  connect(account) {
    _account = account;
    _userClosed = false;
    _logonRejected = false;
    if (_retryTimer) {
      clearTimeout(_retryTimer);
      _retryTimer = 0;
    }
    startWatchdog();
    const url = SERVERS[account.server] || SERVERS.Demo;
    // detach the old handlers first: closing the previous socket must not look like a lost connection
    if (ws) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      } catch (_) {}
    }
    _baseMs = 0;
    setConn('connecting…', '#cc0');
    log(`Opening ${account.server} (${url})…`);
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setConn('logging on', '#cc0');
      connection.send({
        logon: {
          userName: account.username,
          password: account.password,
          clientAppId: (account.appId || 'TradingView').trim(),
          clientVersion: 'js-lwc-1',
          protocolVersionMajor: 2,
          protocolVersionMinor: 230,
        },
      });
    };
    ws.onerror = () => log('WebSocket error (often an Origin rejection).', true);
    ws.onclose = (e) => markDead('offline (' + (e.code || '') + ')');
    ws.onmessage = (ev) => {
      try {
        route(decode(ev.data));
      } catch (e) {
        log('decode: ' + /** @type {any} */ (e).message, true);
      }
    };
  },

  disconnect() {
    _userClosed = true; // the user asked for this: no auto-revival until the next connect()
    if (_retryTimer) {
      clearTimeout(_retryTimer);
      _retryTimer = 0;
    }
    if (_watchdog) {
      clearInterval(_watchdog);
      _watchdog = 0;
    }
    if (ws) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      } catch (_) {}
      ws = null;
    }
    _baseMs = 0;
    _brokerSkewMs = null;
    symCbs.clear();
    barCbs.clear();
    oneShot.clear();
    mdSubs.clear();
    sessCbs.clear();
    resetHooks.forEach((cb) => {
      try {
        cb();
      } catch (_) {}
    }); // the trade plane clears its own state
  },

  /** @param {string} symbol @param {Cb} cb */
  resolveSymbol(symbol, cb) {
    const id = ++seq;
    symCbs.set(id, cb);
    connection.send({ informationRequests: [{ id, symbolResolutionRequest: { symbol } }] });
    return id;
  },

  // text search over CQG products (e.g. "S&P" -> EP). One-shot.
  /** @param {string} term @param {Cb} cb */
  productSearch(term, cb) {
    const id = ++seq;
    symCbs.set(id, cb);
    connection.send({ informationRequests: [{ id, productSearchRequest: { searchTerm: term } }] });
    return id;
  },

  /** @param {any} params @param {Cb} cb */
  subscribeBars(params, cb) {
    const id = ++seq;
    barCbs.set(id, cb);
    connection.send({ timeBarRequests: [{ requestId: id, requestType: 2, timeBarParameters: params }] });
    return id;
  },

  // one-shot historical fetch (REQUEST_TYPE_GET); callback removed when complete
  /** @param {any} params @param {Cb} cb */
  getBars(params, cb) {
    const id = ++seq;
    barCbs.set(id, cb);
    oneShot.add(id);
    connection.send({ timeBarRequests: [{ requestId: id, requestType: 1, timeBarParameters: params }] });
    return id;
  },

  /** @param {number} reqId */
  drop(reqId) {
    if (!reqId) return;
    barCbs.delete(reqId);
    connection.send({ timeBarRequests: [{ requestId: reqId, requestType: 3 }] });
  },

  // live quotes (best bid/ask/trade) per contract; one server subscription
  // fanned out to all interested panes. level 2 = LEVEL_TRADES_BBA.
  /** @param {any} contractId @param {Cb} cb */
  subscribeMarketData(contractId, cb) {
    mdEntry(contractId).quoteCbs.add(cb);
    applyLevel(contractId);
  },
  /** @param {any} contractId @param {Cb} cb */
  unsubscribeMarketData(contractId, cb) {
    const s = mdSubs.get(contractId);
    if (!s) return;
    s.quoteCbs.delete(cb);
    applyLevel(contractId);
  },
  // market depth (DOM / Level 2). Upgrades the contract's md subscription to level 4
  // (LEVEL_TRADES_BBA_DOM); the ladder is built from TYPE_BID/TYPE_ASK quotes (vol 0 = remove).
  /** @param {any} contractId @param {Cb} cb */
  subscribeDepth(contractId, cb) {
    const s = mdEntry(contractId);
    s.depthCbs.add(cb);
    applyLevel(contractId);
    if (s.bids.size || s.asks.size) {
      try {
        cb(buildDom(s));
      } catch (_) {}
    }
  },
  /** @param {any} contractId @param {Cb} cb */
  unsubscribeDepth(contractId, cb) {
    const s = mdSubs.get(contractId);
    if (!s) return;
    s.depthCbs.delete(cb);
    applyLevel(contractId);
  },

  // trading-session times: per trading-day open/close/RTH for a contract's session_info_id, via
  // TradingDayTimeRangeRequest. Times ride the informationRequest envelope and are ms offsets from the
  // logon base (like bars) -- caller passes absolute UTC ms, gets the raw report back. Exactly two of
  // (fromMs, toMs, count) must be set. One-shot.
  /** @param {{ sessionInfoId?: number, fromMs?: number, toMs?: number, count?: number }} [opts] @param {Cb} [cb] */
  getTradingDayRanges({ sessionInfoId, fromMs, toMs, count } = {}, cb) {
    if (!_baseMs) return cb && cb({ error: 'not logged on' });
    if (sessionInfoId == null || sessionInfoId < 0) return cb && cb({ error: 'no session info for this contract' });
    const id = ++seq;
    sessCbs.set(id, /** @type {Cb} */ (cb));
    /** @type {{ sessionInfoId: number, toUtcTime?: number, count?: number, fromUtcTime?: number }} */
    const req = { sessionInfoId };
    // CQG caps a range request (~100 sessions) and fills it FORWARD from `from`, so a wide range returns
    // the OLDEST 100 and misses today. When a count is given, use (to, count) -- "count sessions
    // preceding to" -- to get the RECENT window instead.
    if (count != null && toMs != null) {
      req.toUtcTime = Math.round(toMs - _baseMs);
      req.count = count;
    } else {
      if (fromMs != null) req.fromUtcTime = Math.round(fromMs - _baseMs);
      if (toMs != null) req.toUtcTime = Math.round(toMs - _baseMs);
    }
    connection.send({ informationRequests: [{ id, tradingDayTimerangeRequest: req }] });
    return id;
  },
};

/** @param {any} msg */
function route(msg) {
  if (msg.ping) {
    connection.send({
      pong: {
        token: msg.ping.token,
        pingUtcTime: msg.ping.pingUtcTime,
        pongUtcTime: Date.now() - _baseMs,
      },
    });
  }
  if (msg.logonResult) {
    const r = msg.logonResult;
    if (r.resultCode !== 0) {
      _logonRejected = true; // refused credentials must not be auto-retried into a lockout
      log('Logon failed (code ' + r.resultCode + '): ' + (r.textMessage || ''), true);
      return;
    }
    _baseMs = Date.parse(r.baseTime + 'Z');
    // broker server time = base + relative server_time; remember its skew vs local
    _brokerSkewMs = _baseMs + (r.serverTime || 0) - Date.now();
    _retryMs = 0; // healthy again -> next outage starts the backoff from scratch
    setConn('connected', '#6c6');
    log('Logged on.');
    bus.emit('logon');
    logonHooks.forEach((cb) => {
      try {
        cb();
      } catch (_) {}
    }); // trade plane: request accounts + subscribe to orders/positions/account-summary
  }
  (msg.informationReports || []).forEach((/** @type {any} */ rep) => {
    if (sessCbs.has(rep.id)) {
      // trading-session reply (one-shot; small ranges arrive in one report)
      const scb = sessCbs.get(rep.id);
      if (rep.isReportComplete !== false) sessCbs.delete(rep.id);
      /** @type {Cb} */ (scb)(rep);
      return;
    }
    const cb = symCbs.get(rep.id);
    if (cb && (rep.symbolResolutionReport || rep.productSearchReport)) {
      symCbs.delete(rep.id);
      cb(rep);
    }
  });
  (msg.timeBarReports || []).forEach((/** @type {any} */ rep) => {
    emitRaw('cqg', 'bars', rep); // raw TimeBar report — every field the feed sends
    const cb = barCbs.get(rep.requestId);
    if (!cb) return;
    cb(rep);
    if (oneShot.has(rep.requestId) && rep.isReportComplete !== false) {
      barCbs.delete(rep.requestId);
      oneShot.delete(rep.requestId);
    }
  });
  (msg.realTimeMarketData || []).forEach((/** @type {any} */ rt) => {
    emitRaw('cqg', 'quote', rt); // raw RealTimeMarketData — quotes + market_values (open interest, settlement, ...)
    const s = mdSubs.get(rt.contractId);
    if (!s) return;
    s.quoteCbs.forEach((cb) => cb(rt));
    if (s.depthCbs.size) {
      updateDom(s, rt);
      const dom = buildDom(s);
      s.depthCbs.forEach((cb) => cb(dom));
    }
  });
  (msg.userMessages || []).forEach((/** @type {any} */ um) => {
    if (um.text || um.messageText) log('server: ' + (um.text || um.messageText), true);
  });
  // the trade plane's tap: orders/positions/accounts/history route in ./trade.js. Request ids come from
  // the shared counter, so its membership checks never collide with the maps above.
  msgHooks.forEach((cb) => {
    try {
      cb(msg);
    } catch (_) {}
  });
}

// ---- market-data subscription level manager (quotes=level 2, DOM=level 4) ----
/** @param {any} cid @returns {MdSub} */
function mdEntry(cid) {
  let s = mdSubs.get(cid);
  if (!s) {
    s = { reqId: ++seq, level: 0, quoteCbs: new Set(), depthCbs: new Set(), bids: new Map(), asks: new Map() };
    mdSubs.set(cid, s);
  }
  return s;
}
/** @param {any} cid */
function applyLevel(cid) {
  const s = mdSubs.get(cid);
  if (!s) return;
  const level = s.depthCbs.size ? 4 : s.quoteCbs.size ? 2 : 0; // 4=DOM superset, 2=best bid/ask, 0=off
  if (level === s.level) return;
  // CQG IGNORES a level change on an existing subscription (verified against demoapi: a
  // same-reqId level 2 -> 4 never adds DOM quotes). So drop it (level 0) then re-subscribe
  // with a FRESH request id at the new level.
  if (s.level !== 0) connection.send({ marketDataSubscriptions: [{ contractId: cid, requestId: s.reqId, level: 0 }] });
  if (level === 0) {
    mdSubs.delete(cid);
    return;
  }
  s.level = level;
  s.reqId = ++seq;
  connection.send({ marketDataSubscriptions: [{ contractId: cid, requestId: s.reqId, level }] });
}
// apply a RealTimeMarketData to the contract's DOM ladders. Quote types: 1=bestbid 2=bestask
// 3=bid 4=ask; volume 0 removes that price level. A snapshot resets the book.
/** @param {MdSub} s @param {any} rt */
function updateDom(s, rt) {
  if (rt.isSnapshot) {
    s.bids.clear();
    s.asks.clear();
  }
  (rt.quotes || []).forEach((/** @type {any} */ q) => {
    // DOM levels are TYPE_BID(3) / TYPE_ASK(4). Best bid/ask (1/2) are the top-of-book quote
    // (a moving single price), NOT depth — folding them in would leave stale levels.
    if (q.type !== 3 && q.type !== 4) return;
    const vol = q.volume
      ? Number(q.volume.significand || 0) * Math.pow(10, Number(q.volume.exponent || 0))
      : q.scaledVolume != null
        ? Number(q.scaledVolume)
        : 0;
    const book = q.type === 3 ? s.bids : s.asks;
    if (vol > 0) book.set(q.scaledPrice, vol);
    else book.delete(q.scaledPrice);
  });
}
/** @param {MdSub} s */
function buildDom(s) {
  return {
    bids: [...s.bids.entries()]
      .map(([p, q]) => ({ scaledPrice: p, qty: q }))
      .sort((a, b) => b.scaledPrice - a.scaledPrice),
    asks: [...s.asks.entries()]
      .map(([p, q]) => ({ scaledPrice: p, qty: q }))
      .sort((a, b) => a.scaledPrice - b.scaledPrice),
  };
}

// The trade plane (accounts / orders / positions / account summary / history) lives in ./trade.js,
// registered through the onLogon/onMessage/onReset hooks above.
