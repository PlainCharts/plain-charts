// @ts-check
// Schwab real-time streamer: JSON over a single WebSocket, fanned out to all
// subscribers (Schwab allows one stream per user). Needs the Accounts and
// Trading product (for /trader/v1/userPreference). If that's unavailable the
// streamer reports available()=false and the adapter stays on REST polling.
//
// Protocol: ADMIN/LOGIN, then SUBS per service with comma-joined keys. Level-one
// fields we use: 0=symbol, 1=bid, 2=ask, 3=last. Data messages carry only the
// changed fields, so we keep a per-symbol snapshot and emit the merged delta.

import { log } from '/data_engine/status.js';
import { emitRaw } from '/data_engine/data/raw-tap.js';   // diagnostic tap (Data Interceptor); no-op when unused

/** @param {string} sym */
const serviceFor = (sym) => (sym.startsWith('/') ? 'LEVELONE_FUTURES' : 'LEVELONE_EQUITIES');
// Level-one fields we use: 0=symbol, 1=bid, 2=ask, 3=last. The full sets (equities 0-51, futures 0-40)
// were censused in Slice 1 Task 3 -- see .temp/schwab-lab/census-notes.md. bidSize/askSize (4,5) are
// pushable live and a candidate to adopt in Task 5.
const FIELDS = '0,1,2,3';

/**
 * @typedef {{ socketUrl: string, accessToken: string, channel: string, functionId: string, customerId: string, correlId: string, error?: any }} StreamInfo
 * @typedef {import('/data_engine/data/adapter-contract.js').Quote} Quote
 * @typedef {{ cbs: Set<(q: Quote) => void>, last: Quote }} StreamSub
 */

export function createStreamer() {
  /** @type {WebSocket|null} */
  let ws = null;
  /** @type {StreamInfo|null} */
  let info = null;
  let loggedIn = false;
  /** @type {boolean|null} */
  let available = null;        // null=untested, true/false after first connect()
  let reqId = 0;
  /** @type {Promise<boolean>|null} */
  let connecting = null;
  /** @type {Map<string, StreamSub>} */
  const subs = new Map();      // symbol -> { cbs:Set, last:{bid,ask,last} }

  /** @param {string} service */
  const symbolsFor = (service) => [...subs.keys()].filter((s) => serviceFor(s) === service);

  /** @param {string} service @param {string} command @param {any} parameters */
  function send(service, command, parameters) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      requests: [{
        service, command, requestid: String(++reqId),
        SchwabClientCustomerId: /** @type {StreamInfo} */ (info).customerId, SchwabClientCorrelId: /** @type {StreamInfo} */ (info).correlId,
        parameters,
      }],
    }));
  }

  // (re)subscribe the full key set for a service — SUBS replaces, so this is idempotent
  /** @param {string} service */
  function syncService(service) {
    if (!loggedIn) return;
    const syms = symbolsFor(service);
    if (syms.length) send(service, 'SUBS', { keys: syms.join(','), fields: FIELDS });
  }

  /** @param {MessageEvent} ev */
  function onMessage(ev) {
    /** @type {any} */
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    emitRaw('schwab', 'quote', msg);   // raw stream envelope (only fields in FIELDS arrive today)

    (msg.data || []).forEach((/** @type {any} */ d) => {
      (d.content || []).forEach((/** @type {any} */ c) => {
        const sub = subs.get(c.key);
        if (!sub) return;
        /** @type {Quote} */
        const out = {};
        if (c['1'] != null) out.bid = c['1'];
        if (c['2'] != null) out.ask = c['2'];
        if (c['3'] != null) out.last = c['3'];
        if (out.bid != null || out.ask != null || out.last != null) {
          Object.assign(sub.last, out);
          sub.cbs.forEach((cb) => cb(out));
        }
      });
    });
  }

  // open the socket and complete LOGIN; resolves true once logged in, false on failure
  function open() {
    return new Promise((resolve) => {
      let settled = false;
      /** @param {boolean} ok */
      const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      ws = new WebSocket(/** @type {StreamInfo} */ (info).socketUrl);
      ws.onopen = () => send('ADMIN', 'LOGIN', {
        Authorization: /** @type {StreamInfo} */ (info).accessToken,
        SchwabClientChannel: /** @type {StreamInfo} */ (info).channel,
        SchwabClientFunctionId: /** @type {StreamInfo} */ (info).functionId,
      });
      ws.onmessage = (ev) => {
        /** @type {any} */
        let msg; try { msg = JSON.parse(ev.data); } catch (_) { msg = {}; }
        const lr = (msg.response || []).find((/** @type {any} */ r) => r.command === 'LOGIN');
        if (lr) {
          if (lr.content && lr.content.code === 0) {
            loggedIn = true;
            new Set([...subs.keys()].map(serviceFor)).forEach(syncService);
            finish(true);
          } else { finish(false); }
        }
        onMessage(ev);
      };
      ws.onclose = () => { loggedIn = false; ws = null; finish(false); };
      ws.onerror = () => finish(false);
      setTimeout(() => finish(loggedIn), 6000);   // safety: don't hang if no LOGIN reply
    });
  }

  async function connect() {
    if (available === false) return false;
    if (loggedIn) return true;
    if (connecting) return connecting;
    connecting = (async () => {
      const r = await fetch('/api/schwab/stream-info').then((x) => x.json()).catch((e) => ({ error: 'fetch ' + e }));
      if (!r || r.error || !r.socketUrl) {
        available = false; connecting = null;
        log('Streamer: no stream-info (' + ((r && r.error) || 'empty') + ') — using polling.', true);
        return false;
      }
      info = r;
      log('Streamer: connecting ' + /** @type {StreamInfo} */ (info).socketUrl + ' …');
      const ok = await open();
      available = ok;
      log(ok ? 'Streamer: logged in — real-time.' : 'Streamer: login failed — using polling.', !ok);
      connecting = null;
      return ok;
    })();
    return connecting;
  }

  return {
    connect,
    available: () => available === true,
    /** @param {string} sym @param {(q: Quote) => void} cb */
    async subscribe(sym, cb) {
      let sub = subs.get(sym);
      if (!sub) { sub = { cbs: new Set(), last: {} }; subs.set(sym, sub); }
      sub.cbs.add(cb);
      if (sub.last.bid != null || sub.last.ask != null || sub.last.last != null) cb(sub.last);
      const ok = await connect();
      if (ok) syncService(serviceFor(sym));
      return ok;
    },
    /** @param {string} sym @param {(q: Quote) => void} cb */
    unsubscribe(sym, cb) {
      const sub = subs.get(sym);
      if (!sub) return;
      sub.cbs.delete(cb);
      if (!sub.cbs.size) {
        subs.delete(sym);
        if (loggedIn) send(serviceFor(sym), 'UNSUBS', { keys: sym });
      }
    },
    // hard stop: close the socket and drop all subscriptions (called on broker disconnect)
    close() {
      subs.clear(); loggedIn = false; connecting = null;
      try { if (ws) ws.close(); } catch (_) {}
      ws = null;
    },
  };
}
