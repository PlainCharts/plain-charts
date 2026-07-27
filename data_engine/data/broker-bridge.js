// @ts-check
// Generic, protocol-agnostic data bridge for the multi-window ecosystem (Electron).
//
// The REAL broker + every adapter run once in the headless data host. Each UI window holds a
// thin PROXY broker whose for(id)/active() return proxy adapters; data calls forward to the
// host over a BroadcastChannel (callback-correlated), and synchronous reads (isConnected /
// connections / labelOf / serverNow) come from a state snapshot the host broadcasts on
// connection changes. New brokers plug into the host only — windows never hold data code.
//
// The browser build is 'solo': no bridge, the real broker runs in the page (see broker.js).
import { bus } from '../bus.js';
import { log } from '../status.js';
import { listBrokers } from './registry.js';
import { onRaw, emitRaw, setRawActivity } from './raw-tap.js';   // diagnostic raw feed (Data Interceptor)
import { IPC } from '../ipc.js';   // the engine's cross-window channel names (single source of truth)

// NOTE: assistant order enforcement (policy gate + per-order confirm) lives in the ORDER WORKER now
// (src/orders/exec.js assistantOrder), not here. The data host no longer re-checks orders by origin.

/** @typedef {{ conns: any[], activeId: (string|null), adapters: Record<string, any> }} Snap */

const winAny = /** @type {any} */ (typeof window !== 'undefined' ? window : {});   // Electron preload globals (desktop, require) aren't in DOM lib
const Q = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams('');
const DESKTOP = !!(winAny && winAny.desktop && winAny.desktop.isDesktop);
const QROLE = Q.get('role');
// solo | host | proxy. The headless data host is 'host'; UI windows are 'proxy'. The Node-
// enabled addon-host renderer has no desktop preload, so it identifies itself via role=addon
// and joins as a plain proxy consumer (reusing this same data bridge — no new channel). The
// order-host (role=orders, the Order Worker) joins the same way: a proxy that reads the book and
// forwards low-level order verbs to the data-host.
export const ROLE = QROLE === 'data' ? 'host' : (DESKTOP || QROLE === 'addon' || QROLE === 'orders') ? 'proxy' : 'solo';
const WIN = Q.get('win') || 'solo';
/** @type {any} */   // BroadcastChannel in non-solo roles; null in solo (where the bridge is never used). Payloads are dynamic.
const chan = (ROLE !== 'solo') ? new BroadcastChannel(IPC.BROKER_BUS) : null;

// ---------------- UI side: proxy broker + proxy adapters + state mirror ----------------
/** @type {Snap} */
let snap = { conns: [], activeId: null, adapters: {} };
let seq = 1;
/** @type {Map<number, { cb: Function, one?: boolean, untilComplete?: boolean }>} */
const cbs = new Map();    // callId -> { cb, one }      (replies routed back from the host)
/** @type {Map<Function, number>} */
const qmap = new Map();   // quote cb -> callId         (so unsubscribeQuotes matches by identity)

/** @param {string} target @param {(string|null)} id @param {string} method @param {any[]} args @param {number} [callId] */
function send(target, id, method, args, callId) {
  chan.postMessage({ dir: 'out', win: WIN, target, id, method, args, callId });
}

/** @param {string} id */
function proxyAdapter(id) {
  return {
    id,
    label: (snap.adapters[id] && snap.adapters[id].label) || '',
    isConnected: () => !!(snap.adapters[id] && snap.adapters[id].connected),
    serverNow: () => { const a = snap.adapters[id]; return a && a.skew != null ? Date.now() + a.skew : null; },
    /** @param {string} symbol @param {Function} cb */
    resolveSymbol(symbol, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'resolveSymbol', [symbol], c); return c; },
    /** @param {any} params @param {Function} cb */
    subscribeBars(params, cb) { const c = ++seq; cbs.set(c, { cb }); send('adapter', id, 'subscribeBars', [params], c); return c; },
    // a one-shot fetch that may arrive over MULTIPLE chunked reports (CQG streams
    // history newest->oldest); keep the callback until a report says complete.
    /** @param {any} params @param {Function} cb */
    getBars(params, cb) { const c = ++seq; cbs.set(c, { cb, untilComplete: true }); send('adapter', id, 'getBars', [params], c); return c; },
    /** @param {number} [handle] */
    drop(handle) { if (handle == null) return; cbs.delete(handle); send('adapter', id, 'drop', [], handle); },
    /** @param {string} symId @param {Function} cb */
    subscribeQuotes(symId, cb) { const c = ++seq; cbs.set(c, { cb }); qmap.set(cb, c); send('adapter', id, 'subscribeQuotes', [symId], c); },
    /** @param {string} symId @param {Function} cb */
    unsubscribeQuotes(symId, cb) { const c = qmap.get(cb); if (c == null) return; qmap.delete(cb); cbs.delete(c); send('adapter', id, 'unsubscribeQuotes', [symId], c); },
    /** @param {string} symId @param {Function} cb */
    subscribeDepth(symId, cb) { const c = ++seq; cbs.set(c, { cb }); qmap.set(cb, c); send('adapter', id, 'subscribeDepth', [symId], c); },
    /** @param {string} symId @param {Function} cb */
    unsubscribeDepth(symId, cb) { const c = qmap.get(cb); if (c == null) return; qmap.delete(cb); cbs.delete(c); send('adapter', id, 'unsubscribeDepth', [symId], c); },
    /** @param {string} query @param {Function} cb */
    searchSymbols(query, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'searchSymbols', [query], c); },
    // trading — one request/one reply, forwarded to the real adapter in the host
    /** @param {any} order @param {Function} cb */
    placeOrder(order, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'placeOrder', [order], c); return c; },
    /** @param {any} mod @param {Function} cb */
    modifyOrder(mod, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'modifyOrder', [mod], c); return c; },
    /** @param {string} orderId @param {Function} cb */
    cancelOrder(orderId, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'cancelOrder', [orderId], c); return c; },
    /** @param {string} symbol @param {Function} cb */
    closePosition(symbol, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'closePosition', [symbol], c); return c; },
    /** @param {any} ticket @param {Function} cb */
    closeLot(ticket, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'closeLot', [ticket], c); return c; },
    /** @param {any} ticket @param {number} qty @param {Function} cb */
    closeLotPartial(ticket, qty, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'closeLotPartial', [ticket, qty], c); return c; },
    /** @param {Function} cb */
    getOrders(cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'getOrders', [], c); return c; },
    /** @param {Function} cb */
    getPositions(cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'getPositions', [], c); return c; },
    /** @param {Function} cb */
    getAccount(cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'getAccount', [], c); return c; },
    /** @param {any} range @param {Function} cb */
    getHistory(range, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'getHistory', [range], c); return c; },
    /** @param {any} params @param {Function} cb */
    getMarketHours(params, cb) { const c = ++seq; cbs.set(c, { cb, one: true }); send('adapter', id, 'getMarketHours', [params], c); return c; },
    // OnTrade: a live stream (cb stays alive until unsubscribeTrade), matched by identity like quotes
    /** @param {Function} cb */
    subscribeTrade(cb) { const c = ++seq; cbs.set(c, { cb }); qmap.set(cb, c); send('adapter', id, 'subscribeTrade', [], c); },
    /** @param {Function} cb */
    unsubscribeTrade(cb) { const c = qmap.get(cb); if (c == null) return; qmap.delete(cb); cbs.delete(c); send('adapter', id, 'unsubscribeTrade', [], c); },
  };
}

export const proxyBroker = {
  /** @param {any} account */
  connect(account) { send('broker', null, 'connect', [account]); },
  /** @param {string} [id] */
  disconnect(id) { send('broker', null, 'disconnect', [id]); },
  /** @param {string} id */
  setActive(id) { send('broker', null, 'setActive', [id]); },
  /** @param {string} [id] */
  isConnected(id) {
    const a = snap.adapters[/** @type {string} */ (id || snap.activeId)];
    return !!(a && a.connected);
  },
  serverNow() { const a = snap.adapters[/** @type {string} */ (snap.activeId)]; return a && a.skew != null ? Date.now() + a.skew : null; },
  active() { return snap.activeId ? proxyAdapter(snap.activeId) : null; },
  /** @param {string} [id] */
  for(id) { const real = id || snap.activeId; return real ? proxyAdapter(real) : null; },
  /** @param {string} [id] */
  labelOf(id) { const a = snap.adapters[/** @type {string} */ (id || snap.activeId)]; return (a && a.label) || ''; },
  connections() { return snap.conns; },
  /** @param {...any} a */
  resolveSymbol(...a) { const x = /** @type {any} */ (this.active()); return x && x.resolveSymbol(...a); },
  /** @param {...any} a */
  subscribeBars(...a) { const x = /** @type {any} */ (this.active()); return x && x.subscribeBars(...a); },
  /** @param {...any} a */
  getBars(...a) { const x = /** @type {any} */ (this.active()); return x && x.getBars(...a); },
  /** @param {...any} a */
  drop(...a) { const x = /** @type {any} */ (this.active()); return x && x.drop(...a); },
  /** @param {...any} a */
  subscribeQuotes(...a) { const x = /** @type {any} */ (this.active()); return x && x.subscribeQuotes(...a); },
  /** @param {...any} a */
  unsubscribeQuotes(...a) { const x = /** @type {any} */ (this.active()); return x && x.unsubscribeQuotes(...a); },
  /** @param {...any} a */
  subscribeDepth(...a) { const x = /** @type {any} */ (this.active()); return x && x.subscribeDepth(...a); },
  /** @param {...any} a */
  unsubscribeDepth(...a) { const x = /** @type {any} */ (this.active()); return x && x.unsubscribeDepth(...a); },
  /** @param {...any} a */
  placeOrder(...a) { const x = /** @type {any} */ (this.active()); return x && x.placeOrder(...a); },
  /** @param {...any} a */
  modifyOrder(...a) { const x = /** @type {any} */ (this.active()); return x && x.modifyOrder(...a); },
  /** @param {...any} a */
  cancelOrder(...a) { const x = /** @type {any} */ (this.active()); return x && x.cancelOrder(...a); },
  /** @param {...any} a */
  closePosition(...a) { const x = /** @type {any} */ (this.active()); return x && x.closePosition(...a); },
  /** @param {...any} a */
  getOrders(...a) { const x = /** @type {any} */ (this.active()); return x && x.getOrders(...a); },
  /** @param {...any} a */
  getPositions(...a) { const x = /** @type {any} */ (this.active()); return x && x.getPositions(...a); },
  /** @param {...any} a */
  getAccount(...a) { const x = /** @type {any} */ (this.active()); return x && x.getAccount(...a); },
  /** @param {...any} a */
  getHistory(...a) { const x = /** @type {any} */ (this.active()); return x && x.getHistory(...a); },
  /** @param {...any} a */
  getMarketHours(...a) { const x = /** @type {any} */ (this.active()); return x && x.getMarketHours(...a); },
  /** @param {...any} a */
  subscribeTrade(...a) { const x = /** @type {any} */ (this.active()); return x && x.subscribeTrade(...a); },
  /** @param {...any} a */
  unsubscribeTrade(...a) { const x = /** @type {any} */ (this.active()); return x && x.unsubscribeTrade(...a); },
};

if (ROLE === 'proxy') {
  // Replies to THIS window's calls arrive on its private channel (broker-bus:in:<win>) -- one listener, so no
  // fan-out clone-and-drop across every window. Every message here is a callId reply for us.
  const inChan = new BroadcastChannel(IPC.BROKER_IN_PREFIX + WIN);
  inChan.onmessage = (/** @type {MessageEvent} */ e) => {
    const m = e.data; if (!m || m.callId == null) return;
    const r = cbs.get(m.callId);
    if (r) {
      try { r.cb(...(m.payload || [])); } catch (_) {}
      // one-reply calls clean up immediately; chunked fetches (getBars) persist
      // until a report carries complete, matching the host/transport one-shot.
      if (r.one) cbs.delete(m.callId);
      else if (r.untilComplete) { const u = m.payload && m.payload[0]; if (u && u.complete) cbs.delete(m.callId); }
    }
  };
  // The shared bus now carries only broadcasts (snapshots, connection events, notices, log lines, raw feed).
  chan.onmessage = (/** @type {MessageEvent} */ e) => {
    const m = e.data; if (!m || m.dir !== 'in') return;
    if (m.snap) { snap = m.snap; bus.emit('connections:changed'); return; }
    if (m.event) { if (m.to && m.to !== WIN) return; bus.emit(m.event); return; }
    // broker:notice originates in the headless host (where the real adapter runs); re-emit it on
    // this UI window's bus so the Connections dialog / status can show connect + market-data errors.
    if (m.notice) { if (m.to && m.to !== WIN) return; bus.emit('broker:notice', m.notice); return; }
    if (m.logLine) { if (m.to && m.to !== WIN) return; log(m.logLine.text, m.logLine.err); return; }
    if (m.raw) { emitRaw(m.raw.broker, m.raw.channel, m.raw.msg); return; }   // raw feed forwarded from the host
  };
  chan.postMessage({ dir: 'out', win: WIN, hello: true });   // ask the host for the current snapshot
  // ask the host to forward the raw broker feed only while something in this window is listening
  setRawActivity((/** @type {boolean} */ active) => chan.postMessage({ dir: 'out', win: WIN, rawtap: active ? 'on' : 'off' }));
}

// ---------------- Host side: serve UI calls + broadcast connection state ----------------
/** @param {any} core */
export function startHost(core) {
  /** @type {Map<string, any>} */
  const relays = new Map();   // 'win:callId' -> { handle?, qcb?, cancelled?, settle? }
  // Per-window REPLY channels: the host posts each window's results to broker-bus:in:<win>, a channel only that
  // window listens on -- so a quote/bar/trade reply is cloned once (into its target), not fanned into every
  // window and dropped by callId. Broadcasts (snap/event/notice/raw) still go on the shared `chan`.
  /** @type {Map<string, BroadcastChannel>} */
  const replyChans = new Map();
  /** @param {string} win */
  const replyChan = (win) => { let c = replyChans.get(win); if (!c) { c = new BroadcastChannel(IPC.BROKER_IN_PREFIX + win); replyChans.set(win, c); } return c; };
  /** @param {string} win @param {number} callId @param {any[]} payload */
  const post = (win, callId, payload) => { try { replyChan(win).postMessage({ callId, payload }); } catch (_) {} };

  // Per-broker history-request limiter. Every window's getBars / subscribeBars runs HERE, in the single
  // data host, so N windows opening at once (or a study board spawning many panes) can fire a wall of
  // simultaneous history fetches and trip a broker's active-request cap. Funnel history requests through
  // a per-broker queue (keyed by adapter id) that keeps at most HIST_CAP in flight; the rest wait and
  // fire as slots free. Broker-agnostic: each broker's queue is independent, so a busy CQG never throttles
  // Schwab. A job settles (frees its slot) when its INITIAL batch reports complete/error -- getBars is
  // one-shot, subscribeBars then keeps streaming live with no slot held. Live subscribeBars jumps the
  // queue ahead of backfill getBars so a live chart never waits behind deep-fill. A safety timeout frees
  // any slot whose fetch never settles, so a dead request can't pin the queue forever.
  const HIST_CAP = 3;
  const HIST_GUARD_MS = 45000;
  /** @type {Map<string, { active: number, queue: Function[] }>} */
  const brokerQ = new Map();   // brokerId -> { active, queue: [] }
  /** @param {string} id */
  const qFor = (id) => { let q = brokerQ.get(id); if (!q) { q = { active: 0, queue: [] }; brokerQ.set(id, q); } return q; };
  /** @param {string} id */
  const pump = (id) => { const q = qFor(id); while (q.active < HIST_CAP && q.queue.length) { q.active++; (/** @type {Function} */ (q.queue.shift()))(); } };
  /** @param {string} id */
  const release = (id) => { const q = qFor(id); if (q.active > 0) q.active--; pump(id); };
  /** @param {string} id @param {Function} job @param {boolean} [front] */
  const enqueue = (id, job, front) => { const q = qFor(id); front ? q.queue.unshift(job) : q.queue.push(job); pump(id); };

  function buildSnap() {
    /** @type {Record<string, any>} */
    const adapters = {};
    listBrokers().forEach((b) => {
      const ad = core.for(b.id);
      const sn = (ad && ad.serverNow) ? ad.serverNow() : null;
      adapters[b.id] = { label: b.name || b.id, connected: core.isConnected(b.id), skew: sn != null ? sn - Date.now() : null };
    });
    const act = core.active();
    return { conns: core.connections(), activeId: act ? act.id : null, adapters };
  }
  const announce = () => chan.postMessage({ dir: 'in', snap: buildSnap() });

  bus.on('connections:changed', () => { announce(); chan.postMessage({ dir: 'in', event: 'connections:changed' }); });
  bus.on('logon', () => { announce(); chan.postMessage({ dir: 'in', event: 'logon' }); });
  // forward broker notices (connect outcome, market-data failures) to every UI window so errors
  // raised by the real adapter here in the host are never invisible in the proxy windows.
  bus.on('broker:notice', (n) => chan.postMessage({ dir: 'in', notice: n }));

  // Raw feed forwarding (Data Interceptor): only while a proxy window is listening. When the first
  // proxy asks, attach an onRaw listener that broadcasts each raw message (JSON-sanitized so it clones
  // over the channel); detach when the last proxy stops.
  /** @type {Set<string>} */
  const rawWins = new Set();
  /** @type {(() => void) | null} */
  let rawOff = null;
  const updateRawForward = () => {
    if (rawWins.size && !rawOff) {
      rawOff = onRaw((/** @type {any} */ broker, /** @type {any} */ channel, /** @type {any} */ msg) => {
        let safe; try { safe = JSON.parse(JSON.stringify(msg)); } catch (_) { return; }
        try { chan.postMessage({ dir: 'in', raw: { broker, channel, msg: safe } }); } catch (_) {}
      });
    } else if (!rawWins.size && rawOff) { rawOff(); rawOff = null; }
  };

  chan.onmessage = (/** @type {MessageEvent} */ e) => {
    const m = e.data; if (!m || m.dir !== 'out') return;
    if (m.hello) { announce(); return; }
    if (m.rawtap) { if (m.rawtap === 'on') rawWins.add(m.win); else rawWins.delete(m.win); updateRawForward(); return; }
    const key = m.win + ':' + m.callId;
    if (m.target === 'broker') {
      if (m.method === 'connect') {
        const acc = m.args[0];
        // ecosystem-wide single session: if that protocol is already connected, don't reopen —
        // re-sync the asking window and fire it a logon so its panes subscribe (this is how a
        // window that opened into a live session, e.g. a detached tab, gets its data).
        if (acc && core.isConnected(acc.protocol)) { announce(); chan.postMessage({ dir: 'in', to: m.win, event: 'logon' }); }
        else Promise.resolve(core.connect(acc)).catch((/** @type {any} */ err) => {
          const msg = (err && (err.stack || err.message)) || String(err);
          console.error('[data-host] connect failed', msg);   // visible in the launcher terminal
          chan.postMessage({ dir: 'in', to: m.win, logLine: { text: 'Connect failed: ' + msg, err: true } });
        });
      } else if (m.method === 'disconnect') core.disconnect(m.args[0]);
      else if (m.method === 'setActive') core.setActive(m.args[0]);
      return;
    }
    if (m.target === 'adapter') {
      const ad = core.for(m.id); if (!ad) return;
      // All orders (user, addon, assistant) arrive here as plain low-level verbs. Assistant policy + per-order
      // confirm are enforced upstream in the order worker (src/orders/exec.js), so this side just dispatches.
      switch (m.method) {
        case 'resolveSymbol': ad.resolveSymbol(m.args[0], (/** @type {any} */ inst, /** @type {any} */ err) => post(m.win, m.callId, [inst, err])); break;
        case 'subscribeBars': {
          /** @type {{ handle: any, cancelled: boolean, settle: any }} */
          const rec = { handle: null, cancelled: false, settle: null };
          relays.set(key, rec);
          enqueue(m.id, () => {
            if (rec.cancelled) { release(m.id); return; }
            let done = false, guard = /** @type {any} */ (null);
            const settle = () => { if (done) return; done = true; if (guard) { clearTimeout(guard); guard = null; } release(m.id); };
            rec.settle = settle;
            guard = setTimeout(settle, HIST_GUARD_MS);
            rec.handle = ad.subscribeBars(m.args[0], (/** @type {any} */ u) => {
              post(m.win, m.callId, [u]);
              if (u && (u.complete || u.error)) settle();   // initial batch done -> free the slot; live keeps streaming
            });
          }, true);   // live feed jumps ahead of backfill getBars
          break;
        }
        case 'getBars': {
          /** @type {{ cancelled: boolean, settle: any }} */
          const rec = { cancelled: false, settle: null };
          relays.set(key, rec);
          enqueue(m.id, () => {
            if (rec.cancelled) { release(m.id); return; }
            let done = false, guard = /** @type {any} */ (null);
            const settle = () => { if (done) return; done = true; if (guard) { clearTimeout(guard); guard = null; } relays.delete(key); release(m.id); };
            rec.settle = settle;
            guard = setTimeout(settle, HIST_GUARD_MS);
            ad.getBars(m.args[0], (/** @type {any} */ u) => {
              if (!rec.cancelled) post(m.win, m.callId, [u]);
              if (u && (u.complete || u.error)) settle();
            });
          });
          break;
        }
        case 'drop': {
          const r = relays.get(key);
          if (r) {
            r.cancelled = true;
            if (r.settle) { try { r.settle(); } catch (_) {} }   // free the slot if the initial fetch is still in flight
            if (r.handle != null) { try { ad.drop(r.handle); } catch (_) {} }
            relays.delete(key);
          }
          break;
        }
        case 'subscribeQuotes': { const qcb = (/** @type {any} */ q) => post(m.win, m.callId, [q]); relays.set(key, { qcb }); ad.subscribeQuotes(m.args[0], qcb); break; }
        case 'unsubscribeQuotes': { const r = relays.get(key); if (r && r.qcb) { try { ad.unsubscribeQuotes(m.args[0], r.qcb); } catch (_) {} relays.delete(key); } break; }
        case 'subscribeDepth': { if (ad.subscribeDepth) { const dcb = (/** @type {any} */ d) => post(m.win, m.callId, [d]); relays.set(key, { dcb }); ad.subscribeDepth(m.args[0], dcb); } break; }
        case 'unsubscribeDepth': { const r = relays.get(key); if (r && r.dcb && ad.unsubscribeDepth) { try { ad.unsubscribeDepth(m.args[0], r.dcb); } catch (_) {} relays.delete(key); } break; }
        case 'searchSymbols': if (ad.searchSymbols) ad.searchSymbols(m.args[0], (/** @type {any} */ res) => post(m.win, m.callId, [res])); break;
        case 'placeOrder': ad.placeOrder ? ad.placeOrder(m.args[0], (/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [{ error: 'broker has no order routing' }]); break;
        case 'modifyOrder': ad.modifyOrder ? ad.modifyOrder(m.args[0], (/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [{ error: 'no modify' }]); break;
        case 'cancelOrder': ad.cancelOrder ? ad.cancelOrder(m.args[0], (/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [{ error: 'no cancel' }]); break;
        case 'closePosition': ad.closePosition ? ad.closePosition(m.args[0], (/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [{ error: 'no close' }]); break;
        case 'closeLot': ad.closeLot ? ad.closeLot(m.args[0], (/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [{ error: 'no closeLot' }]); break;
        case 'closeLotPartial': ad.closeLotPartial ? ad.closeLotPartial(m.args[0], m.args[1], (/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [{ error: 'no partial close' }]); break;
        case 'getOrders': ad.getOrders ? ad.getOrders((/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [[]]); break;
        case 'getPositions': ad.getPositions ? ad.getPositions((/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [[]]); break;
        case 'getAccount': ad.getAccount ? ad.getAccount((/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [{ error: 'no account info' }]); break;
        case 'getHistory': ad.getHistory ? ad.getHistory(m.args[0], (/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [{ error: 'no account history' }]); break;
        case 'getMarketHours': ad.getMarketHours ? ad.getMarketHours(m.args[0], (/** @type {any} */ r) => post(m.win, m.callId, [r])) : post(m.win, m.callId, [{ error: 'no market hours' }]); break;
        case 'subscribeTrade': { if (ad.subscribeTrade) { const tcb = (/** @type {any} */ ev) => post(m.win, m.callId, [ev]); relays.set(key, { tcb }); ad.subscribeTrade(tcb); } break; }
        case 'unsubscribeTrade': { const r = relays.get(key); if (r && r.tcb && ad.unsubscribeTrade) { try { ad.unsubscribeTrade(r.tcb); } catch (_) {} relays.delete(key); } break; }
      }
    }
  };
}
