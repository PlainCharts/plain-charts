// @ts-check
// Order-worker side of assistant order confirmation. When execute.confirm is on, an assistant order pauses here
// and waits for the user to approve it in a UI window. Broadcasts a request on the assistant-confirm channel
// and resolves on the reply, or DENIES after a timeout (fail-safe -- an order the user isn't present to
// approve does not go through). DOM-free; imported by the worker executor (src/orders/exec.js).
import { IPC } from '../ipc-contract.js';

/** @type {any} */
const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(IPC.ASSISTANT_CONFIRM) : null;
const TIMEOUT_MS = 30000;
let seq = 0;
/** @type {Map<number, (ok: boolean) => void>} */
const pending = new Map();

if (chan)
  chan.onmessage = (/** @type {MessageEvent} */ e) => {
    const m = e.data;
    if (!m || m.type !== 'reply') return;
    const resolve = pending.get(m.id);
    if (!resolve) return;
    pending.delete(m.id);
    resolve(!!m.approved);
  };

// Ask the UI to approve one assistant order. Resolves true (approved) / false (denied or timed out).
/** @param {string} method @param {any} order @param {(string|null)} brokerId @returns {Promise<boolean>} */
export function requestOrderConfirm(method, order, brokerId) {
  if (!chan) return Promise.resolve(false); // no cross-window channel -> cannot confirm -> deny
  const id = ++seq;
  return new Promise((resolve) => {
    let done = false;
    const finish = (/** @type {boolean} */ ok) => {
      if (done) return;
      done = true;
      pending.delete(id);
      resolve(ok);
    };
    pending.set(id, finish);
    chan.postMessage({ type: 'request', id, method, order, brokerId });
    setTimeout(() => {
      if (!done) {
        try {
          chan.postMessage({ type: 'cancel', id });
        } catch (_) {}
        finish(false);
      }
    }, TIMEOUT_MS);
  });
}
