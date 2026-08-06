// @ts-check
// Bar FEED for the alert engine -- a ref-counted subscription to live bars through the sealed data_engine
// facade (broker.resolveSymbol + subscribeBars). Many alerts on the same broker:symbol:tf share ONE
// underlying subscription; the last listener to leave drops it. Runs in the alert-host, which consumes the
// engine as a proxy (data flows from the data-host over the existing bridge) -- it never opens a socket.
//
// Each listener is called with { last, closed, tail }:
//   last   = the newest bar (the forming bar) from the latest report
//   closed = the bar that just CLOSED (set only on the report where a newer bar first appears), else null
//   tail   = a bounded ring of the most recent bars in time order (newest last, the forming bar), so a
//            relative condition (e.g. Moving %) can look back N bars -- eval stays pure over what it's handed.
// -- enough for every alert cadence: once / per-bar / per-minute read `last`; per-bar-close reads `closed`.
import { broker, barMs } from '../../data_engine/index.js';
import { mergeTail, BAR_TAIL_CAP, capForSpan } from './eval.js'; // pure bar-tail ring + sizing (the pure core, node-testable)

/** @typedef {{ time:number, open:number, high:number, low:number, close:number }} Bar */
/** @typedef {{ id: string, unit: string, n: number }} Tf */
/** @typedef {{ cb: Function, sinceMs: (number|null) }} Listener */
/** @typedef {{ spec: { brokerId: (string|null), symbol: string, tf: Tf }, listeners: Set<Listener>, handle: (number|null), prevLast: (Bar|null), starting: boolean, tail: Bar[], fromMs: (number|null), cap: number }} Feed */

// Default history span for a feed with no deeper requirement. A listener whose alert is anchored to old
// drawing geometry (a segments/region extent) asks for more via `sinceMs`, so the bar grid reaches back to
// the oldest anchor and the eval interpolates exactly instead of extrapolating off the tail's edge.
const DEFAULT_SPAN_MS = 3 * 86400000;

/** the tail-ring size covering `spanMs` at this interval -- capForSpan (pure core) with barMs bound.
 * @param {Tf} tf @param {number} spanMs */
const capFor = (tf, spanMs) => capForSpan(tf ? barMs(tf) : 0, spanMs);

/** the fromMs this feed needs now: its deepest listener requirement, else the default span. @param {Feed} f */
const neededFromMs = (f) => {
  let min = Date.now() - DEFAULT_SPAN_MS;
  for (const l of f.listeners) if (l.sinceMs != null && l.sinceMs < min) min = l.sinceMs;
  return min;
};

/** @type {Map<string, Feed>} */
const feeds = new Map();

/** @param {string|null} brokerId @param {string} symbol @param {Tf} tf */
const keyOf = (brokerId, symbol, tf) => (brokerId || '*') + '|' + symbol + '|' + (tf && tf.id);
/** @param {string|null} brokerId */
const adapterFor = (brokerId) => (brokerId ? broker.for(brokerId) : broker.active());
/** @param {string|null} brokerId */
const connected = (brokerId) => {
  try {
    return broker.isConnected(brokerId || undefined);
  } catch (_) {
    return false;
  }
};

/** @param {Feed} f */
function start(f) {
  if (f.handle != null || f.starting) return;
  const { brokerId, symbol, tf } = f.spec;
  if (!connected(brokerId)) return; // not connected yet -- retryIdle() picks it up on logon
  const ad = /** @type {any} */ (adapterFor(brokerId));
  if (!ad || !ad.resolveSymbol || !ad.subscribeBars) return;
  f.starting = true;
  ad.resolveSymbol(symbol, (/** @type {any} */ inst) => {
    f.starting = false;
    if (!feeds.has(keyOf(brokerId, symbol, tf))) return; // released while resolving
    if (!inst || !inst.id) {
      console.warn('[alert-feed] could not resolve', symbol);
      return;
    }
    // depth is read HERE, not before resolve: a deeper listener that joined mid-resolution is honored
    const fromMs = neededFromMs(f);
    f.fromMs = fromMs;
    f.cap = capFor(tf, Date.now() - fromMs);
    f.handle = ad.subscribeBars({ id: inst.id, tf, fromMs }, (/** @type {any} */ u) => onReport(f, u));
  });
}

/** @param {Feed} f @param {any} u */
function onReport(f, u) {
  if (!u || u.error || !u.bars || !u.bars.length) return;
  const last = u.bars[u.bars.length - 1];
  let closed = null;
  if (f.prevLast && last.time > f.prevLast.time) closed = f.prevLast; // a newer bar appeared -> the previous forming bar has closed
  f.prevLast = last;
  f.tail = mergeTail(f.tail, u.bars, f.cap || BAR_TAIL_CAP); // the recent-bars ring (sized to reach the deepest anchor)
  for (const l of f.listeners) {
    try {
      l.cb({ last, closed, tail: f.tail });
    } catch (err) {
      console.error('[alert-feed] listener error', err);
    }
  }
}

/** @param {Feed} f */
function stop(f) {
  if (f.handle == null) return;
  const ad = /** @type {any} */ (adapterFor(f.spec.brokerId));
  if (ad && ad.drop) {
    try {
      ad.drop(f.handle);
    } catch (_) {}
  }
  f.handle = null;
}

/**
 * Subscribe to a shared bar feed. Returns an unsubscribe fn; the underlying subscription is dropped when the
 * last listener leaves. `tf` is a resolved timeframe object ({id,unit,n}) -- the adapter needs unit/n, and the
 * headless host can't resolve an id string (the tf registry only initializes in chart windows).
 * `sinceMs` (epoch ms) asks for history at least that deep -- an extent-anchored alert passes its oldest
 * anchor so interpolation runs on real bars; if the live subscription is shallower, it restarts deeper.
 * @param {string|null} brokerId @param {string} symbol @param {Tf} tf
 * @param {(ev: { last: Bar, closed: Bar|null, tail: Bar[] }) => void} cb
 * @param {number} [sinceMs]
 */
export function subscribeBarFeed(brokerId, symbol, tf, cb, sinceMs) {
  const key = keyOf(brokerId, symbol, tf);
  let f = feeds.get(key);
  if (!f) {
    f = {
      spec: { brokerId, symbol, tf },
      listeners: new Set(),
      handle: null,
      prevLast: null,
      starting: false,
      tail: [],
      fromMs: null,
      cap: BAR_TAIL_CAP,
    };
    feeds.set(key, f);
  }
  /** @type {Listener} */
  const l = { cb, sinceMs: sinceMs != null && Number.isFinite(sinceMs) ? sinceMs : null };
  f.listeners.add(l);
  // the new listener needs older bars than the live subscription carries -> resubscribe deeper (the tail
  // rebuilds from the deeper seed; one closed-bar detection restarts, which costs nothing)
  if (f.handle != null && f.fromMs != null && neededFromMs(f) < f.fromMs) {
    stop(f);
    f.prevLast = null;
    f.tail = [];
  }
  start(f);
  return () => {
    f.listeners.delete(l);
    if (!f.listeners.size) {
      stop(f);
      feeds.delete(key);
    }
  };
}

// (Re)start any feed that has listeners but no live handle -- called when a broker connects (logon /
// connections:changed), since a feed created while disconnected stays idle until there's an adapter.
export function retryIdle() {
  for (const f of feeds.values()) if (f.listeners.size && f.handle == null) start(f);
}
