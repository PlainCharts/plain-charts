// @ts-check
// The alert COMMAND funnel -- the one path that mutates alert state, resolved by role exactly like the
// engine's order funnel (data_engine/orders/index.js), but APP-OWNED (alerts are not engine code):
//   - alert-host  (role=alerts): the ENGINE. registerAlertHandler(action, fn) installs the mutation logic;
//     it listens on the alert-bus, runs the handler, and acks the result to the requesting window.
//   - other windows (proxy): CLIENTS. alertCommand(action, payload) posts to the alert-bus and awaits the
//     host's ack (callId-correlated). A surface therefore holds NO alert logic -- it sends a command and
//     reflects the read-only store mirror.
//   - solo (browser, no host): LOCAL -- the same page registers handlers and alertCommand runs them in-page.
//
// This is the ONLY mutator (LAW: single source of truth + unidirectional flow). Windows never write the
// store; they send a command here and the host writes.
import { IPC } from '../ipc-contract.js';

const Q = new URLSearchParams(location.search);
const WIN = Q.get('win') || 'solo';
const IS_HOST = Q.get('role') === 'alerts'; // the dedicated alert-host process
const LOCAL = !IS_HOST && !Q.get('win'); // solo/browser: no separate host -> run in-page
/** @type {BroadcastChannel | null} */
const chan = LOCAL ? null : new BroadcastChannel(IPC.ALERT_BUS);

/** @type {Map<string, (payload: any, cmd: any) => any>} */
const handlers = new Map();
/** Install a command handler (host side, or in-page for solo). @param {string} action @param {(payload: any, cmd: any) => any} fn */
export function registerAlertHandler(action, fn) {
  handlers.set(action, fn);
}

/** @param {{ action: string, payload: any }} cmd */
async function run(cmd) {
  const fn = handlers.get(cmd && cmd.action);
  if (!fn) throw new Error('unknown alert command: ' + (cmd && cmd.action));
  return await fn(cmd.payload, cmd);
}

// HOST: answer commands on the bus.
if (IS_HOST && chan) {
  chan.addEventListener('message', async (/** @type {MessageEvent} */ e) => {
    const m = e.data;
    if (!m || m.dir !== 'cmd') return;
    let ack;
    try {
      ack = { dir: 'ack', to: m.win, callId: m.callId, ok: true, result: await run(m.cmd) };
    } catch (err) {
      ack = {
        dir: 'ack',
        to: m.win,
        callId: m.callId,
        ok: false,
        error: /** @type {any} */ (err && /** @type {any} */ (err).message) || String(err),
      };
    }
    chan.postMessage(ack);
  });
}

// CLIENT: correlate acks back to their command by callId.
/** @type {Map<number, { resolve: (v: any) => void, reject: (e: any) => void, timer: any }>} */
const pending = new Map();
let seq = 0;
if (!IS_HOST && chan) {
  chan.addEventListener('message', (/** @type {MessageEvent} */ e) => {
    const m = e.data;
    if (!m || m.dir !== 'ack' || m.to !== WIN) return;
    const p = pending.get(m.callId);
    if (!p) return;
    pending.delete(m.callId);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error || 'alert command failed'));
  });
}

const SLOW_ACK_MS = 6000; // warn (don't reject) when the host is slow/absent -- a dead host shows up as this repeating

/**
 * Send a semantic alert command to the host and await its result. In solo, runs the handler in-page.
 * @param {string} action  one of: create | update | remove | toggle
 * @param {any} payload
 * @returns {Promise<any>}
 */
export function alertCommand(action, payload) {
  const cmd = { action, payload };
  if (LOCAL || !chan) return Promise.resolve().then(() => run(cmd));
  return new Promise((resolve, reject) => {
    const callId = ++seq;
    const timer = setInterval(
      () => console.warn('[alert] no ack yet for "' + action + '" -- alert-host busy or down'),
      SLOW_ACK_MS,
    );
    pending.set(callId, { resolve, reject, timer });
    chan.postMessage({ dir: 'cmd', win: WIN, callId, cmd });
  });
}
