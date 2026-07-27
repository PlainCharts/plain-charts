// @ts-check
// MetaTrader 5 broker adapter. Talks to the MT5 bridge EA (MT5_Bridge.mq5) over its newline-JSON TCP protocol.
// UNLIKE CQG/OANDA (which dial OUT via WebSocket/fetch), the EA is a TCP CLIENT that dials IN -- so THIS adapter
// opens a net.Server and the EA connects to it. That needs raw Node TCP, available because the data-host runs with
// nodeIntegration (globalThis.require). Desktop-only: in browser/solo mode there is no Node, so it stays disconnected.
//
// Wire specifics absorbed here (verified live against a demo terminal; see .temp/mt5-lab proof, 16/0):
//   - times: EA emits UTC SECONDS -> bars stay seconds (chart convention); order/fill/position times -> ms.
//   - hedging: MT5 keeps many positions per symbol; we AGGREGATE to ONE net position per symbol for the app store.
//   - identity: Order.id = order ticket, Fill.id = deal ticket, Position.ticket = position ticket (distinct spaces).
//   - commission: MT5 costs are signed-negative; folded to a positive cost -(commission+swap).
//   - OCO bracket: placeOrder({bracket}) -> position-level SL/TP (native OCO: one hits, position closes, other voids).
import { registerBroker } from '/data_engine/data/adapter-sdk.js';
import { bus } from '/data_engine/bus.js';
import { setConn, log } from '/data_engine/status.js';

/** @typedef {import('/data_engine/data/adapter-contract.js').Instrument} Instrument */
/** @typedef {{ n: number, unit: string }} TF */

const net = /** @type {any} */ (globalThis).require ? /** @type {any} */ (globalThis).require('net') : null;

// ---- state (singleton per data-host) ----
const cfg = { host: '127.0.0.1', port: 7892, login: '' };
/** @type {any} */ let server = null;
/** @type {any} */ let sock = null;
let rbuf = '', verified = false, connected = false;
let listening = false, boundKey = '';        // is `server` bound, and to which 'host:port' -> decide reuse vs rebind
/** @type {any} */ let retryTimer = null;     // EADDRINUSE back-off timer (a prior listener may not have released yet)
/** @type {any} */ let acct = null;     // last raw account snapshot
const posMap = new Map();               // position ticket -> raw bridge position
const orderMap = new Map();             // order ticket    -> raw bridge order
const orderSig = new Map();             // order ticket    -> last EMITTED signature (the EA re-pushes every working order every 500ms; only emit on an actual change so the Console/book don't churn)
const symInfo = new Map();              // symbol -> resolved metadata
const quoteSubs = new Map();            // symbol -> Set<cb>
const depthSubs = new Map();            // symbol -> Set<cb>
const barSubs = new Map();              // "symbol|tf" -> Set<cb>
/** @type {Set<any>} */ const tradeCbs = new Set();   // MANY trade subscribers (trade-feed + any proxy relays) -- a single slot lets a second subscriber, or one unsubscribing, clobber the others
let idc = 0;
const rpc = new Map();                  // id -> { resolve }
/** @type {any} */ let pendingBars = null;
/** @type {any} */ let pendingHist = null;
const nextId = () => ++idc;

// ---- gapless live stream (contiguity cursor) ----
// The adapter GUARANTEES a gapless bar stream so the app never has to reconcile holes. Per subscription
// (symbol|tf) it tracks a cursor: the newest bar time delivered contiguously. Every live bar is checked
// against it -- a forward JUMP (T > cursor + one bar) means bars were missed (a socket drop, a reconnect,
// even a single skipped push), so we getBars the missed span and deliver it BEFORE the live bar. getBars
// fires ONLY on an observed jump (demand-driven, no polling). The cursor survives disconnects, so the
// first live bar after a reconnect naturally trips the backfill. See docs: connecting-brokers / data host.
const barCursor = new Map();    // 'symbol|tf' -> newest contiguous bar time (seconds)
const barFilling = new Set();   // 'symbol|tf' with a jump-backfill in flight (don't stack)
// get_bars must be serialized: there is ONE pendingBars slot, and historical bars carry no request id
// (routed by symbol|tf), so two overlapping fetches would corrupt each other. Queue them.
let barsBusy = false;
/** @type {Array<{ symbol: string, tf: string, fromSec: number, toSec: number, resolve: (r: any) => void }>} */
const barsQ = [];
/** step (seconds) for an MT5 tf code (M1/M5/H1/D1/W1/MN1) -- to size the "one bar" jump threshold */
const tfStepSec = (/** @type {string} */ code) => {
  if (code === 'D1') return 86400;
  if (code === 'W1') return 7 * 86400;
  if (code === 'MN1') return 30 * 86400;
  const u = code[0], n = parseInt(code.slice(1), 10) || 1;
  return u === 'H' ? n * 3600 : n * 60;   // 'M' minutes (MN1 handled above), 'H' hours
};
/** one serialized get_bars round-trip; resolves { bars, complete } (or empty on timeout/drop) */
function runGetBars(/** @type {string} */ symbol, /** @type {string} */ tf, /** @type {number} */ fromSec, /** @type {number} */ toSec) {
  return new Promise((resolve) => { barsQ.push({ symbol, tf, fromSec, toSec, resolve }); pumpBars(); });
}
function pumpBars() {
  if (barsBusy || !barsQ.length) return;
  barsBusy = true;
  const job = /** @type {any} */ (barsQ.shift());
  const rid = nextId();
  let settled = false, timer = /** @type {any} */ (null);
  const finish = (/** @type {any} */ r) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); rpc.delete(rid); barsBusy = false; if (pendingBars && pendingBars.id === rid) pendingBars = null; job.resolve(r); pumpBars(); };
  timer = setTimeout(() => finish({ bars: [], complete: true }), 12000);   // EA dropped mid-request -> release the lock
  rpc.set(rid, { resolve: finish });
  pendingBars = { id: rid, symbol: job.symbol, tf: job.tf, bars: [] };
  send({ cmd: 'get_bars', symbol: job.symbol, tf: job.tf, from: job.fromSec, to: job.toSec, id: rid });
}

// ---- transport: net.Server the EA connects into (newline-JSON + login gate) ----
/** @param {any} obj */
function send(obj) { if (sock && verified) { try { sock.write(JSON.stringify(obj) + '\n'); } catch (_) {} } }
/** wire up the connection the EA dialed in on (newline-JSON stream + first-message login gate) @param {any} s */
function handleConn(s) {
  // First-verified-wins. The old adopt-the-newest behavior enabled a connection WAR when the bridge EA sat
  // on two charts: each EA's 3s redial destroyed the other's socket (Jul 14 Experts log: 2,851 alternating
  // connects), and the resulting reconnect storm -- reseed + full snapshot pushes through Wine's socket
  // layer every cycle -- saturated the terminal until its UI froze. While a VERIFIED EA link is live, a
  // second dial-in is rejected loudly; a dead predecessor clears via its 'close' event, freeing the slot.
  if (sock && verified) { log('MT5: second EA connection rejected — one is already active (is the bridge EA attached to more than one chart?)', true); try { s.destroy(); } catch (_) {} return; }
  if (sock) { try { sock.destroy(); } catch (_) {} }   // unverified half-open predecessor -> replace
  sock = s; rbuf = ''; verified = false;
  s.setEncoding('utf8');
  // Dead-peer detection. If MT5 dies UNCLEANLY (freeze, kill) the socket goes half-open: no FIN arrives, so
  // 'close' never fires, `verified` stays true, and first-verified-wins would then reject every EA reconnect
  // for minutes (TCP timeout) -- the "connected -> send error -> disconnecting" wedge. The EA streams
  // constantly when alive (quotes ≤300ms, status/account every 2s), so 12s of total silence == a dead link:
  // trip it and destroy the socket, whose 'close' frees the slot for the reconnecting EA within seconds.
  s.setKeepAlive(true, 10000);
  s.setTimeout(12000);
  s.on('timeout', () => { if (sock === s) { log('MT5 EA link idle >12s — closing the dead socket so the EA can reconnect', true); try { s.destroy(); } catch (_) {} } });
  s.on('data', (/** @type {string} */ chunk) => {
    rbuf += chunk;
    let i;
    while ((i = rbuf.indexOf('\n')) >= 0) {
      const line = rbuf.slice(0, i).trim(); rbuf = rbuf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch (_) { continue; }
      if (!verified) {
        // Gate on the FIRST account message (it carries the login). A blank configured login accepts any EA.
        // Verifying here is ALSO what marks the connection logged-on -- keep the two together so blank-login works.
        if (m.type !== 'account') continue;
        if (cfg.login && String(m.login) !== String(cfg.login)) { try { s.destroy(); } catch (_) {} return; }   // wrong EA
        verified = true; onUp(m);   // -> connected + setConn + bus.emit('logon') + route the account
        continue;
      }
      route(m);
    }
  });
  s.on('close', () => { if (sock === s) { sock = null; verified = false; connected = false; setConn('not connected', '#888'); log('MT5 EA disconnected'); } });
  s.on('error', () => {});
}
function startServer() {
  if (!net) { setConn('not connected (desktop only)', '#cc0'); log('MT5: raw TCP unavailable (browser/solo mode) — desktop only.', true); return; }
  const key = cfg.host + ':' + cfg.port;
  // Already bound to this exact endpoint -> REUSE it, never open a second listener. A manual Connect on top
  // of auto-connect-on-startup used to bind twice: the 2nd bind threw EADDRINUSE and the UI then tracked the
  // DEAD instance while the working socket was orphaned. Same endpoint = same listener; a changed host/port
  // falls through to a clean rebind (so flipping "VM" -> "local" actually re-binds to 127.0.0.1).
  if (server && listening && boundKey === key) { log('MT5 bridge already listening ' + key + ' — reusing'); return; }
  stopServer();
  bindServer(key, 0);
}
/** open the listener; on EADDRINUSE back off and retry a few times -- a prior listener (or a prior data-host
 *  renderer) may not have released the port yet @param {string} key @param {number} attempt */
function bindServer(key, attempt) {
  const s = net.createServer(handleConn);
  server = s;
  s.on('error', (/** @type {any} */ e) => {
    if (server !== s) return;   // superseded by a newer start/stop -> ignore this dead server's error
    if (e && e.code === 'EADDRINUSE' && attempt < 10) {
      try { s.close(); } catch (_) {}
      log('MT5 bridge port ' + cfg.port + ' busy, retrying… (' + (attempt + 1) + ')', attempt >= 3);
      retryTimer = setTimeout(() => { if (server === s) bindServer(key, attempt + 1); }, 300);
      return;
    }
    listening = false; connected = false; setConn('not connected', '#c33');
    log('MT5 listen error: ' + (e && e.message) + (e && e.code === 'EADDRINUSE' ? ' (port ' + cfg.port + ' in use)' : ''), true);
  });
  s.listen(cfg.port, cfg.host, () => { listening = true; boundKey = key; log('MT5 bridge listening ' + key + ' — waiting for the EA to connect…'); });
}
function stopServer() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (sock) { try { sock.destroy(); } catch (_) {} sock = null; }
  if (server) { try { server.close(); } catch (_) {} server = null; }
  listening = false; boundKey = ''; verified = false;
}
/** @param {any} m */
function onUp(m) { verified = true; connected = true; setConn('connected', '#6c6'); log('MT5 EA connected (login ' + m.login + ')'); route(m); bus.emit('logon'); }

// ---- helpers ----
const cur = () => (acct && acct.currency) || 'USD';
const secToMs = (/** @type {any} */ s) => (s != null ? Number(s) * 1000 : null);
/** @param {TF} tf */
const mt5tf = (tf) => { const n = tf.n, u = tf.unit; if (u === 'm') return 'M' + n; if (u === 'h') return 'H' + n; if (u === 'D') return 'D1'; if (u === 'W') return 'W1'; if (u === 'M') return 'MN1'; return 'M1'; };
const foldComm = (/** @type {any} */ f) => -((Number(f.commission) || 0) + (Number(f.swap) || 0));
const barOut = (/** @type {any} */ m) => ({ time: Number(m.time), open: Number(m.open), high: Number(m.high), low: Number(m.low), close: Number(m.close), volume: Number(m.volume) });   // bar time stays SECONDS
const realizedOf = (/** @type {any} */ m) => (m.profit != null ? Number(m.profit) : null);   // MT5 DEAL_PROFIT: gross realized (0 on entry, closed amount on exit)
const posIdOf = (/** @type {any} */ m) => (m.position_id != null ? String(m.position_id) : null);   // MT5 DEAL_POSITION_ID: fills sharing it = one position lifecycle (entry + partials)
const histOrder = (/** @type {any} */ m) => ({ id: String(m.ticket), symbol: m.symbol, side: m.side, type: 'market', qty: Number(m.volume), price: Number(m.price), avgFillPrice: Number(m.price), status: 'filled', tif: 'day', time: secToMs(m.time), accountId: acct && String(acct.login), commission: foldComm(m), commissionCurrency: cur(), realizedPnl: realizedOf(m), positionId: posIdOf(m) });
const orderOut = (/** @type {any} */ o) => { const si = symInfo.get(o.symbol); return ({ id: String(o.ticket), symbol: o.symbol, side: o.side, type: o.order_type, qty: Number(o.volume), price: Number(o.price), limitPrice: o.order_type === 'limit' ? Number(o.price) : null, stopPrice: o.order_type === 'stop' ? Number(o.price) : null, tif: 'day', status: 'working', time: secToMs(o.time), accountId: acct && String(acct.login), stopLoss: Number(o.sl) > 0 ? Number(o.sl) : null, takeProfit: Number(o.tp) > 0 ? Number(o.tp) : null, priceDecimals: si ? Number(si.digits) : null, tickSize: si ? Number(si.tick_size) : null }); };   // MT5 pending orders carry native SL/TP; priceDecimals/tickSize from the resolved symbol so prices format at full precision; time = ORDER_TIME_SETUP (null until the EA sends it)
const accountOut = () => (acct ? { accountId: String(acct.login), currency: acct.currency, balance: Number(acct.balance), equity: Number(acct.equity), marginUsed: Number(acct.margin), marginAvailable: Number(acct.free_margin), unrealizedPL: Number(acct.equity) - Number(acct.balance), hedging: !!acct.hedging } : { accountId: 'default' });
// Map MT5 trade-server retcodes to readable reasons (the EA's _Nak strings carry "retcode=NNNN"). Broker rules
// like "hedging prohibited" surface as 10045/10046 -- decode them so the Console shows WHY, not a raw number.
/** @type {Record<string, string>} */
const RETCODE = { '10004': 'requote', '10006': 'rejected by broker', '10013': 'invalid request', '10014': 'invalid volume', '10015': 'invalid price', '10016': 'invalid stops (too close to price)', '10017': 'trading disabled', '10018': 'market closed', '10019': 'not enough money', '10020': 'price changed', '10021': 'no prices', '10024': 'too many requests', '10027': 'AutoTrading disabled in the terminal', '10030': 'unsupported filling mode', '10031': 'no connection to the trade server', '10040': 'too many open positions', '10041': 'long only', '10042': 'short only', '10043': 'close only', '10044': 'FIFO close required', '10045': 'hedging prohibited (opposite position open)', '10046': 'hedging prohibited (opposite position open)' };
/** @param {any} s @param {string} fallback @returns {string} */
function tradeErr(s, fallback) {
  if (!s) return fallback;
  const m = /retcode=(\d+)/.exec(String(s));
  return (m && RETCODE[m[1]]) ? RETCODE[m[1]] + ' (retcode ' + m[1] + ')' : String(s);
}
// aggregate every open position for `symbol` into ONE net position (hedging-safe)
/** @param {string} symbol */
function netPosition(symbol) {
  const lots = [...posMap.values()].filter((p) => p.symbol === symbol);
  const si = symInfo.get(symbol), decimals = si ? si.digits : null, tickSize = si ? si.tick_size : null, tickValue = si ? si.tick_value : null;
  if (!lots.length) return { symbol, qty: 0, side: 'long', avgPrice: null, accountId: acct && acct.login, priceDecimals: decimals, tickSize, tickValue };
  let netV = 0, bV = 0, bC = 0, sV = 0, sC = 0;
  for (const p of lots) { const v = Number(p.volume); if (p.side === 'buy') { netV += v; bV += v; bC += v * Number(p.open_price); } else { netV -= v; sV += v; sC += v * Number(p.open_price); } }
  const side = netV >= 0 ? 'long' : 'short', qty = Math.abs(netV), avgPrice = side === 'long' ? (bV ? bC / bV : null) : (sV ? sC / sV : null);
  const single = lots.length === 1 ? lots[0] : null;
  /** @type {any} */
  const pos = { symbol, qty, side, avgPrice, accountId: acct && acct.login, priceDecimals: decimals, tickSize, tickValue };
  if (single) { pos.ticket = String(single.ticket); if (Number(single.sl) > 0) pos.stopLoss = Number(single.sl); if (Number(single.tp) > 0) pos.takeProfit = Number(single.tp); }
  return pos;
}
// one raw EA position message -> a per-ticket positionLot event (the INDIVIDUAL hedging position, with its
// native SL/TP and live P&L). Emitted alongside the netted 'position' so the net view is untouched.
/** @param {any} m @returns {any} */
function lotEvent(m) {
  const si = symInfo.get(m.symbol);
  return { kind: 'positionLot', lot: {
    ticket: String(m.ticket), symbol: m.symbol, side: m.side === 'sell' ? 'short' : 'long',
    qty: Number(m.volume), avgPrice: Number(m.open_price), price: Number(m.cur_price),
    stopLoss: Number(m.sl) > 0 ? Number(m.sl) : null, takeProfit: Number(m.tp) > 0 ? Number(m.tp) : null,
    unrealizedPnl: m.profit != null ? Number(m.profit) : null, accountId: acct && String(acct.login),
    priceDecimals: si ? si.digits : null, tickSize: si ? si.tick_size : null, tickValue: si ? si.tick_value : null,
  } };
}
const emit = (/** @type {any} */ ev) => { for (const cb of tradeCbs) { try { cb(ev); } catch (e) { log('trade cb error: ' + (e && /** @type {any} */ (e).message), true); } } };

// ---- inbound message routing ----
/** @param {any} m */
function route(m) {
  switch (m.type) {
    case 'account': acct = m; emit({ kind: 'account', account: accountOut() }); break;
    case 'position': posMap.set(String(m.ticket), m); emit(lotEvent(m)); emit({ kind: 'position', position: netPosition(m.symbol) }); break;   // lot FIRST so the feed sees it's hedged and skips the net journal line
    case 'position_closed': { const p = posMap.get(String(m.ticket)); posMap.delete(String(m.ticket)); if (p) { emit({ kind: 'position', position: netPosition(p.symbol) }); emit({ kind: 'positionLot', lot: { ticket: String(m.ticket), symbol: p.symbol, side: p.side === 'sell' ? 'short' : 'long', qty: 0 } }); } break; }
    case 'order': { const tk = String(m.ticket); orderMap.set(tk, m); const oo = orderOut(m), sig = JSON.stringify(oo); if (orderSig.get(tk) !== sig) { orderSig.set(tk, sig); emit({ kind: 'order', order: oo }); } break; }   // dedupe the 500ms re-push: emit only when the order actually changed (place/modify)
    case 'order_removed': { const tk = String(m.ticket); const o = orderMap.get(tk); orderMap.delete(tk); orderSig.delete(tk); if (o) emit({ kind: 'order', order: { ...orderOut(o), status: 'cancelled' } }); break; }
    case 'fill': {
      if (m.historical) { if (pendingHist) pendingHist.orders.push(histOrder(m)); break; }
      emit({ kind: 'fill', fill: { id: String(m.ticket), symbol: m.symbol, side: m.side, qty: Number(m.volume), price: Number(m.price), time: secToMs(m.time), accountId: acct && String(acct.login), commission: foldComm(m), commissionCurrency: cur(), realizedPnl: realizedOf(m), positionId: posIdOf(m) } });
      break;
    }
    case 'quote': { const subs = quoteSubs.get(m.symbol); if (!subs) break; const bid = Number(m.bid), ask = Number(m.ask); const q = {}; if (isFinite(bid)) q.bid = bid; if (isFinite(ask)) q.ask = ask; if (isFinite(bid) && isFinite(ask)) q.last = (bid + ask) / 2; subs.forEach((/** @type {any} */ cb) => cb(q)); break; }
    case 'depth': { const subs = depthSubs.get(m.symbol); if (subs) subs.forEach((/** @type {any} */ cb) => cb({ bids: m.bids || [], asks: m.asks || [] })); break; }
    case 'bar': {
      if (m.live) {
        const key = m.symbol + '|' + m.tf, subs = barSubs.get(key);
        if (!subs) break;
        const T = Number(m.time), step = tfStepSec(m.tf), cur = barCursor.get(key) || 0;
        if (cur && step && T > cur + step && !barFilling.has(key)) {
          // JUMP: bars were missed between cursor and now -> backfill that span, then keep streaming.
          barFilling.add(key);
          barCursor.set(key, T);   // optimistic: stop re-triggering while the fill is in flight
          runGetBars(m.symbol, m.tf, cur + step, T).then((r) => { barFilling.delete(key); const b = (r && r.bars) || []; if (b.length) subs.forEach((/** @type {any} */ cb) => cb({ bars: b, complete: true })); });
        } else if (T >= cur) barCursor.set(key, T);   // contiguous new bar / forming-bar update -> advance
        subs.forEach((/** @type {any} */ cb) => cb({ bars: [barOut(m)], complete: true }));
      } else if (pendingBars && pendingBars.symbol === m.symbol && pendingBars.tf === m.tf) pendingBars.bars.push(barOut(m));
      break;
    }
    case 'bars_end': { if (pendingBars && pendingBars.id === m.id) { const r = rpc.get(m.id); if (r) r.resolve({ bars: pendingBars.bars, complete: true }); } break; }   // finish() owns cleanup (rpc + pendingBars + pump)
    case 'history_end': { if (pendingHist && pendingHist.id === m.id) { const r = rpc.get(m.id); if (r) { r.resolve(pendingHist.orders); rpc.delete(m.id); } pendingHist = null; } break; }
    case 'symbol_info': { const r = rpc.get(m.id); if (r) { r.resolve(m); rpc.delete(m.id); } break; }
    case 'ack': { const r = rpc.get(m.id); if (r) { r.resolve(m); rpc.delete(m.id); } break; }
    case 'error': { const r = rpc.get(m.id); if (r) { r.resolve({ ok: false, error: m.error }); rpc.delete(m.id); } log('MT5 EA error: ' + m.error, true); break; }
    default: break;   // status / pong
  }
}
/** send a command that expects an ack/symbol_info reply @param {any} cmd @returns {Promise<any>} */
const call = (cmd) => new Promise((resolve) => { const id = nextId(); cmd.id = id; rpc.set(id, { resolve }); send(cmd); });

// ================= the BrokerAdapter surface =================
const adapter = {
  id: 'mt5',
  name: 'MetaTrader 5',
  description: 'Market data and trading through a MetaTrader 5 terminal bridge.',
  capabilities: { marketData: true, trading: true, depth: true },
  // The EA dials IN, so the app is the TCP server; `host` is the bind interface, not a destination.
  // 0.0.0.0 accepts the EA from a Windows VM / another PC on the LAN; 127.0.0.1 is same-machine only.
  // One adapter covers both cases -- the user just flips this dropdown (no separate VM/Windows build).
  form: [
    { key: 'host', type: 'select', label: 'MT5 location', default: '0.0.0.0', options: [
      { value: '0.0.0.0', label: 'VM / another PC (accept over network)' },
      { value: '127.0.0.1', label: 'Same machine (local only)' },
    ] },
    { key: 'port', type: 'number', label: 'Bridge port', default: 7892 },
    { key: 'login', type: 'text', label: 'MT5 login (account #)', default: '', placeholder: 'blank = accept any EA' },
  ],

  /** @param {any} account */
  async connect(account) {
    cfg.host = (account && account.host || '0.0.0.0').trim();
    cfg.port = Number(account && account.port) || 7892;
    cfg.login = String((account && account.login) || '').trim();
    startServer();   // logon fires later, when the EA dials in and its login matches
  },
  disconnect() { connected = false; stopServer(); posMap.clear(); orderMap.clear(); orderSig.clear(); setConn('not connected', '#888'); },
  isConnected() { return connected; },
  serverNow() { return null; },

  /** @param {string} symbol @param {(inst: Instrument|null, meta?: any) => void} cb */
  resolveSymbol(symbol, cb) {
    call({ cmd: 'symbol_info', symbol }).then((m) => {
      if (!m || m.ok === false) return cb(null, { status: (m && m.error) || 'not found' });
      symInfo.set(symbol, m);
      // tick_value is already in the account currency; volume_min/step + contract_size drive position sizing (lots).
      const inst = /** @type {Instrument} */ ({ id: symbol, priceDecimals: Number(m.digits), tickSize: Number(m.tick_size), tickValue: Number(m.tick_value) });
      if (m.volume_min != null) inst.minVolume = Number(m.volume_min);
      if (m.volume_step != null) inst.volumeStep = Number(m.volume_step);
      if (m.contract_size != null) inst.contractSize = Number(m.contract_size);
      cb(inst);
    });
  },

  /** @param {string|number} id @param {Function} cb */
  subscribeQuotes(id, cb) { const s = String(id); let set = quoteSubs.get(s); if (!set) { set = new Set(); quoteSubs.set(s, set); send({ cmd: 'subscribe', symbol: s, id: nextId() }); } set.add(cb); },
  /** @param {string|number} id @param {Function} cb */
  unsubscribeQuotes(id, cb) { const set = quoteSubs.get(String(id)); if (set) { set.delete(cb); if (!set.size) quoteSubs.delete(String(id)); } },

  /** @param {{ id: string, tf: TF, fromMs: number, toMs: number }} req @param {Function} cb */
  getBars({ id, tf, fromMs, toMs }, cb) {
    runGetBars(id, mt5tf(tf), Math.floor(fromMs / 1000), Math.floor(toMs / 1000)).then((r) => cb(r));
  },
  /** @param {{ id: string, tf: TF, fromMs: number }} req @param {Function} cb */
  subscribeBars({ id, tf, fromMs }, cb) {
    const code = mt5tf(tf), key = id + '|' + code;
    this.getBars({ id, tf, fromMs, toMs: Date.now() }, (/** @type {any} */ r) => {
      // seed history + anchor the contiguity cursor at the newest seeded bar
      if (r && r.bars && r.bars.length) { const mx = r.bars.reduce((/** @type {number} */ a, /** @type {any} */ b) => Math.max(a, b.time), 0); if (mx) barCursor.set(key, Math.max(barCursor.get(key) || 0, mx)); }
      cb(r);
    });
    let set = barSubs.get(key); if (!set) { set = new Set(); barSubs.set(key, set); send({ cmd: 'subscribe_bars', symbol: id, tf: code, id: nextId() }); } set.add(cb);
    return { stop: () => { const s = barSubs.get(key); if (s) { s.delete(cb); if (!s.size) { barSubs.delete(key); barCursor.delete(key); barFilling.delete(key); send({ cmd: 'unsubscribe_bars', symbol: id, tf: code, id: nextId() }); } } } };
  },
  /** @param {any} handle */
  drop(handle) { if (handle && handle.stop) handle.stop(); },

  /** @param {string|number} id @param {Function} cb */
  subscribeDepth(id, cb) { const s = String(id); let set = depthSubs.get(s); if (!set) { set = new Set(); depthSubs.set(s, set); send({ cmd: 'subscribe_depth', symbol: s, id: nextId() }); } set.add(cb); },
  /** @param {string|number} id @param {Function} cb */
  unsubscribeDepth(id, cb) { const set = depthSubs.get(String(id)); if (set) { set.delete(cb); if (!set.size) { depthSubs.delete(String(id)); send({ cmd: 'unsubscribe_depth', symbol: String(id), id: nextId() }); } } },

  /** @param {Function} cb */
  subscribeTrade(cb) {
    tradeCbs.add(cb);   // ADD, never replace -- trade-feed and any proxy relay each keep their own subscription
    // replay the current snapshot to THIS new subscriber only (account + net positions + hedging lots + orders)
    if (acct) cb({ kind: 'account', account: accountOut() });
    new Set([...posMap.values()].map((p) => p.symbol)).forEach((sym) => cb({ kind: 'position', position: netPosition(sym) }));
    posMap.forEach((p) => cb(lotEvent(p)));   // replay individual hedging lots (SL/TP/live P&L per ticket)
    orderMap.forEach((o) => cb({ kind: 'order', order: orderOut(o) }));
  },
  /** @param {Function} [cb] */
  unsubscribeTrade(cb) { if (cb) tradeCbs.delete(cb); else tradeCbs.clear(); },   // remove ONLY the given cb (clear-all only on a no-arg call)

  /** @param {Function} cb */
  getPositions(cb) { cb([...new Set([...posMap.values()].map((p) => p.symbol))].map((sym) => netPosition(sym)).filter((p) => p.qty > 0)); },
  /** @param {Function} cb */
  getAccount(cb) { if (!acct) return cb && cb({ error: 'no account yet (connect + give it a moment)' }); cb(accountOut()); },   // no acct -> would key as 'default' (phantom row); trade-feed skips on .error
  /** @param {Function} cb */
  getOrders(cb) { cb([...orderMap.values()].map(orderOut)); },
  /** @param {{ fromMs: number, toMs: number }} range @param {Function} cb */
  getHistory({ fromMs, toMs }, cb) {
    const rid = nextId();
    new Promise((resolve) => { rpc.set(rid, { resolve }); pendingHist = { id: rid, orders: [] }; send({ cmd: 'get_history', from: Math.floor(fromMs / 1000), to: Math.floor((toMs || Date.now()) / 1000), id: rid }); }).then((orders) => cb(orders));
  },

  /** @param {{ symbol?: string, side?: any, qty?: any, type?: string, price?: number, bracket?: any }} order @param {Function} [cb] */
  placeOrder({ symbol, side, qty, type = 'market', price, bracket } = {}, cb) {
    const sl = (bracket && bracket.stopLoss) || 0, tp = (bracket && bracket.takeProfit) || 0, T = String(type).toLowerCase(), vol = Math.abs(Number(qty));
    let cmd;
    if (T === 'limit') cmd = { cmd: 'place_limit', symbol, side, volume: vol, price, sl, tp };
    else if (T === 'stop') cmd = { cmd: 'place_stop', symbol, side, volume: vol, price, sl, tp };
    else cmd = { cmd: String(side).toLowerCase() === 'sell' ? 'sell' : 'buy', symbol, volume: vol, sl, tp };
    call(cmd).then((a) => cb && cb(a && a.ok ? { id: String(a.deal || a.order || ''), status: T === 'market' ? 'filled' : 'submitted', price: a.price } : { error: tradeErr(a && a.error, 'order failed') }));
  },
  /** @param {any} id @param {Function} [cb] */
  cancelOrder(id, cb) { call({ cmd: 'cancel_order', ticket: Number(id) }).then((a) => cb && cb(a && a.ok ? { ok: true } : { error: tradeErr(a && a.error, 'cancel failed') })); },
  /** @param {any} mod @param {Function} [cb] */
  modifyOrder(mod, cb) {
    const ticket = Number(mod.id != null ? mod.id : mod.orderId);
    const price = mod.price != null ? mod.price : 0, sl = (mod.stopLoss != null ? mod.stopLoss : mod.sl) || 0, tp = (mod.takeProfit != null ? mod.takeProfit : mod.tp) || 0;
    const cur = orderMap.get(String(ticket));
    const vol = mod.qty != null ? Math.abs(Number(mod.qty)) : null;
    // MT5 cannot change a PENDING order's volume (TRADE_ACTION_MODIFY carries no volume; the EA's
    // OrderModify path silently kept the old size) -- a RESIZE is DELETE + RE-PLACE with the order's
    // stored params (same symbol/side/type, price, native SL/TP), new volume. The re-placed order gets
    // a NEW ticket: the book swaps cancelled-for-working and the UI re-keys its element.
    if (cur && vol != null && vol !== Math.abs(Number(cur.volume))) {
      const place = { cmd: cur.order_type === 'stop' ? 'place_stop' : 'place_limit', symbol: cur.symbol, side: cur.side, volume: vol,
        price: price || Number(cur.price), sl: sl || (Number(cur.sl) > 0 ? Number(cur.sl) : 0), tp: tp || (Number(cur.tp) > 0 ? Number(cur.tp) : 0) };
      call({ cmd: 'cancel_order', ticket }).then((a) => {
        if (!(a && a.ok)) { if (cb) cb({ error: tradeErr(a && a.error, 'resize failed (cancel)') }); return; }
        call(place).then((b) => { if (cb) cb(b && b.ok ? { ok: true, id: String(b.order || '') } : { error: tradeErr(b && b.error, 'resize failed on re-place -- the order was cancelled') }); });
      });
      return;
    }
    const cmd = cur ? { cmd: 'modify_order', ticket, price, sl, tp } : { cmd: 'modify_position', ticket, sl, tp };
    call(cmd).then((a) => cb && cb(a && a.ok ? { ok: true } : { error: tradeErr(a && a.error, 'modify failed') }));
  },
  /** @param {string} symbol @param {Function} [cb] */
  closePosition(symbol, cb) { call({ cmd: 'close_all', symbol }).then((a) => cb && cb(a && a.ok ? { ok: true } : { error: tradeErr(a && a.error, 'close failed') })); },
  /** close ONE hedging position by its ticket (not the whole symbol) @param {any} ticket @param {Function} [cb] */
  closeLot(ticket, cb) { call({ cmd: 'close', ticket: Number(ticket) }).then((a) => cb && cb(a && a.ok ? { ok: true } : { error: tradeErr(a && a.error, 'close failed') })); },
  /** partially close a hedging position by ticket @param {any} ticket @param {number} qty @param {Function} [cb] */
  closeLotPartial(ticket, qty, cb) { call({ cmd: 'partial_close', ticket: Number(ticket), volume: Math.abs(Number(qty)) }).then((a) => cb && cb(a && a.ok ? { ok: true } : { error: tradeErr(a && a.error, 'partial close failed') })); },
};

registerBroker(adapter);

// Release the listen socket when the data-host window goes away. A hard quit used to leave 7892 bound (the
// renderer lingered), so the NEXT launch hit EADDRINUSE. Closing on unload frees the port across restarts.
try { /** @type {any} */ (globalThis).addEventListener && /** @type {any} */ (globalThis).addEventListener('beforeunload', () => stopServer()); } catch (_) {}

export default adapter;
