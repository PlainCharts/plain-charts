// @ts-check
// The `orders` FACADE -- the one surface every window uses to drive order control, resolved by role like `broker`:
//   - order-host  (role=orders): the WORKER. register(type, handler) installs command logic; it listens on the
//     order-bus, runs the handler, and acks the result back to the requesting window.
//   - other windows (proxy): CLIENTS. command(cmd) posts to the order-bus and awaits the worker's ack (callId-
//     correlated), exactly like the broker proxy forwards to the data-host.
//   - solo (browser, no hosts): LOCAL -- the same page registers the handlers and command() runs them in-page.
// A surface therefore never contains order business logic; it only sends a command and reflects the book.
import { IPC } from '../ipc.js';
import { platform } from '../platform/index.js';

const Q = new URLSearchParams(location.search);
const WIN = Q.get('win') || 'solo';
const IS_WORKER = Q.get('role') === 'orders';                 // the dedicated order-host process
const LOCAL = !IS_WORKER && !Q.get('win');                    // solo/browser: no separate hosts -> run in-page
const chan = LOCAL ? null : new BroadcastChannel(IPC.ORDER_BUS);

/** @type {Map<string, (cmd: any) => any>} */
const handlers = new Map();
/** Install a command handler (worker side, or in-page for solo). @param {string} type @param {(cmd: any) => any} fn */
export function register(type, fn) { handlers.set(type, fn); }

/** @param {any} cmd */
async function run(cmd) {
  const fn = handlers.get(cmd && cmd.type);
  if (!fn) throw new Error('unknown order command: ' + (cmd && cmd.type));
  return await fn(cmd);
}

// WORKER: answer commands on the bus.
if (IS_WORKER && chan) {
  chan.addEventListener('message', async (/** @type {MessageEvent} */ e) => {
    const m = e.data; if (!m || m.dir !== 'cmd') return;
    /** @type {import('../ipc.js').OrderAck} */
    let ack;
    try { ack = { dir: 'ack', to: m.win, callId: m.callId, ok: true, result: await run(m.cmd) }; }
    catch (err) { ack = { dir: 'ack', to: m.win, callId: m.callId, ok: false, error: (/** @type {any} */ (err) && /** @type {any} */ (err).message) || String(err) }; }
    chan.postMessage(ack);
  });
}

// CLIENT: correlate acks back to their command by callId.
/** @type {Map<number, { resolve: (v: any) => void, reject: (e: any) => void, timer: any }>} */
const pending = new Map();
let seq = 0;
if (!IS_WORKER && chan) {
  chan.addEventListener('message', (/** @type {MessageEvent} */ e) => {
    const m = e.data; if (!m || m.dir !== 'ack' || m.to !== WIN) return;
    const p = pending.get(m.callId); if (!p) return;
    pending.delete(m.callId); clearInterval(p.timer);
    if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'order command failed'));
  });
}

// How long a command may go unanswered before we start SAYING so (journal warnings, repeating).
// Never a rejection: an order, once sent, cannot be taken back -- the worker always answers
// eventually (the broker's ack/reject, or the handler's own error), and rejecting early only
// crashed surfaces while the order lived on (a 9s MT5 ack vs the old 8s timeout). A genuinely
// dead worker shows up as these warnings repeating in the Console -- the remedy is a restart,
// not a thrown error the sender can do nothing with.
const SLOW_ACK_MS = 8000;

/**
 * Send a semantic order command to the worker and await its result. In solo, runs the handler in-page.
 * Never times out: settles on the worker's real answer, journaling while the ack is slow.
 * @param {{ type: string, [k: string]: any }} cmd
 * @returns {Promise<any>}
 */
export function command(cmd) {
  if (LOCAL || !chan) return Promise.resolve().then(() => run(cmd));   // solo: no worker process, run here
  return new Promise((resolve, reject) => {
    const callId = ++seq;
    const sent = Date.now();
    const timer = setInterval(() => {
      const secs = Math.round((Date.now() - sent) / 1000);
      platform.console.post({ level: 'warn', cat: 'journal', src: 'orders', msg: 'no ack yet for "' + cmd.type + '" (' + secs + 's) -- worker busy or broker slow; the book will confirm' });
    }, SLOW_ACK_MS);
    pending.set(callId, { resolve, reject, timer });
    /** @type {import('../ipc.js').OrderCmd} */
    const msg = { dir: 'cmd', win: WIN, callId, cmd };
    chan.postMessage(msg);
  });
}

export const orders = { register, command };
