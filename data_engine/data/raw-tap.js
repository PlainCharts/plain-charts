// @ts-check
// Raw feed tap — a diagnostic seam for the Data Interceptor (see .temp/DATA.md).
//
// Broker adapters call emitRaw() with their RAW decoded message at the point BEFORE they strip it
// down to the neutral OHLCV bar / bid-ask quote. The interceptor subscribes via onRaw() to DISCOVER
// each broker's field schema (register the constants, not the data) and stream live values.
//
// This is test-only: it is a no-op whenever nothing is listening (the app never subscribes), so it
// costs nothing in normal use. Nothing in the app depends on it.
//
//   broker  — 'cqg' | 'schwab' | 'oanda'
//   channel — 'bars' (historical batch) | 'quote' (realtime) | ... (adapter's choice)
//   msg     — the raw decoded message object, verbatim (the interceptor walks it)
/** @typedef {(broker: string, channel: string, msg: any) => void} RawListener */

/** @type {Set<RawListener>} */
const listeners = new Set();
/** @type {((active: boolean) => void) | null} */
let onActivity = null;   // optional: called (active) when the listener count crosses 0<->1

// The bridge (Electron proxy) sets this to ask the host to start/stop forwarding raw messages only
// while something is actually listening in this window -- so the heavy raw feed crosses the process
// boundary on demand, not always. In solo mode nothing sets it (adapters + listeners share a page).
/** @param {(active: boolean) => void} fn */
export function setRawActivity(fn) { onActivity = fn; }

/** @param {RawListener} fn @returns {() => void} */
export function onRaw(fn) {
  const wasEmpty = listeners.size === 0;
  listeners.add(fn);
  if (wasEmpty && onActivity) { try { onActivity(true); } catch (_) {} }
  return () => {
    if (!listeners.delete(fn)) return;
    if (listeners.size === 0 && onActivity) { try { onActivity(false); } catch (_) {} }
  };
}

/** @param {string} broker @param {string} channel @param {any} msg */
export function emitRaw(broker, channel, msg) {
  if (!listeners.size || msg == null) return;   // zero cost when the interceptor isn't open
  for (const fn of listeners) { try { fn(broker, channel, msg); } catch (_) {} }
}
