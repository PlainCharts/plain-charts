// @ts-check
// UI-window side of assistant order confirmation. Listens for the data host's confirm requests and shows a
// modal (regardless of focus -- when the assistant fires an order you are in your chat client, not this app,
// so gating on focus would suppress every prompt). The user's Approve/Deny goes back over the channel. Every
// UI window prompts; the first answer wins at the host, and its reply (or the host's timeout cancel) aborts
// the modal in the other windows so only one decision is needed. Loaded only in UI windows (via main.js).
import { IPC } from '../ipc-contract.js';
import { confirmDialog } from '../ui/confirm.js';

/** @type {any} */
const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(IPC.ASSISTANT_CONFIRM) : null;
/** @type {Map<number, AbortController>} */
const shown = new Map(); // request id -> its dialog's abort controller (to dismiss on cross-window resolve)

// Human-readable one-liner for an order request (best-effort over an open-shaped order object).
/** @param {string} method @param {any} o */
function describe(method, o) {
  o = o || {};
  if (method === 'cancelOrder') return 'Assistant wants to CANCEL order ' + (o.id || o.orderId || o);
  if (method === 'closePosition') return 'Assistant wants to FLATTEN ' + (o.symbol || o);
  const verb = method === 'modifyOrder' ? 'MODIFY' : String(o.side || '').toUpperCase() || 'ORDER';
  const price = o.price != null ? ' @ ' + o.price : o.type ? ' ' + o.type : '';
  return ('Assistant wants to ' + verb + ' ' + (o.qty != null ? o.qty + ' ' : '') + (o.symbol || '') + price)
    .replace(/\s+/g, ' ')
    .trim();
}

if (chan)
  chan.onmessage = async (/** @type {MessageEvent} */ e) => {
    const m = e.data;
    if (!m) return;
    // Another window answered, or the host timed out -> dismiss this window's open modal for that request.
    if (m.type === 'reply' || m.type === 'cancel') {
      const ac = shown.get(m.id);
      if (ac) {
        shown.delete(m.id);
        ac.abort();
      }
      return;
    }
    if (m.type !== 'request' || shown.has(m.id)) return;
    const ac = new AbortController();
    shown.set(m.id, ac);
    try {
      if (typeof window !== 'undefined' && window.focus) window.focus();
    } catch (_) {} // best-effort raise
    const approved = await confirmDialog({
      title: 'Approve assistant order?',
      message: describe(m.method, m.order),
      yes: 'Approve',
      no: 'Deny',
      signal: ac.signal,
    });
    shown.delete(m.id);
    if (ac.signal.aborted) return; // resolved elsewhere -- don't send a second answer
    try {
      chan.postMessage({ type: 'reply', id: m.id, approved: !!approved });
    } catch (_) {}
  };
