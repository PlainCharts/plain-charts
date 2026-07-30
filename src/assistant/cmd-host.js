// @ts-check
// Addon-host side of live workspace commands. Some author.workspace actions (add a study to a pane, change a
// pane's symbol/timeframe) mutate the LIVE chart, which lives in the UI window -- so the addon-host broadcasts
// the command and a UI executor (cmd-ui.js) runs it against the real pane and replies. DOM-free.
import { IPC } from '../ipc-contract.js';

/** @type {any} */
const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(IPC.ASSISTANT_CMD) : null;
const TIMEOUT_MS = 8000;
let seq = 0;
/** @type {Map<number, (result: any) => void>} */
const pending = new Map();

if (chan)
  chan.onmessage = (/** @type {MessageEvent} */ e) => {
    const m = e.data;
    if (!m || m.type !== 'reply') return;
    const done = pending.get(m.id);
    if (!done) return;
    pending.delete(m.id);
    done(m.result);
  };

// Run a command in the UI and resolve with its result (rejects on {error} or if no window handled it).
/** @param {string} op @param {any} args @returns {Promise<any>} */
export function runCommand(op, args) {
  if (!chan) return Promise.reject(new Error('no UI channel (is the app running?)'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (/** @type {any} */ result) => {
      if (done) return;
      done = true;
      pending.delete(id);
      if (result && result.error) reject(new Error(String(result.error)));
      else resolve(result || { ok: true });
    };
    pending.set(id, finish);
    chan.postMessage({ type: 'cmd', id, op, args });
    setTimeout(() => finish({ error: 'no UI window handled the command (is a chart open?)' }), TIMEOUT_MS);
  });
}
