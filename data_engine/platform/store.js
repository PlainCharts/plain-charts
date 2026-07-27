// @ts-check
// store — a cross-window KEYED STATE table. The second platform primitive (see channel() for streams).
//
// A store is the live set of records for a domain (orders by orderId, positions by key, accounts by
// accountId), replicated into every window. Whoever owns the data (usually the broker in the data-host)
// writes with set()/remove(); every window keeps a replica and subscribe()s to changes. A window that
// opens LATE asks peers for a snapshot and adopts it, so it never starts blank while data already exists.
//
//   const s = store('orders');
//   s.set(key, value) / s.remove(key) / s.reset(entries)   -> mutate + broadcast to all windows
//   s.get(key) / s.all() / s.keys() / s.size()             -> read this window's replica
//   s.subscribe(fn) -> fn({ type:'set'|'remove'|'reset', key, value }); returns unsubscribe
//
// Interface is symmetric: the app and any addon can both read AND write, so a strategy addon can publish
// synthetic records the same way the broker publishes real ones. Self-contained (safe in any window role).
/**
 * @typedef {{ type: 'set' | 'remove' | 'reset', key?: string, value?: any }} StoreEvent
 */
/**
 * @template T
 * @typedef {Object} Store
 * @property {(key: string, value: T) => void} set
 * @property {(key: string) => void} remove
 * @property {(entries?: [string, T][]) => void} reset
 * @property {(key: string) => (T | undefined)} get
 * @property {() => T[]} all
 * @property {() => string[]} keys
 * @property {() => number} size
 * @property {(fn: (ev: StoreEvent) => void) => (() => void)} subscribe
 */
import { IPC } from '../ipc.js';   // the engine's cross-window channel names (single source of truth)

/**
 * @template T
 * @param {string} name
 * @returns {Store<T>}
 */
export function store(name) {
  /** @type {Map<string, T>} */
  const map = new Map();
  /** @type {Set<(ev: StoreEvent) => void>} */
  const subs = new Set();
  /** @type {BroadcastChannel | null} */
  let bc = null; try { bc = new BroadcastChannel(IPC.STORE_PREFIX + name); } catch (_) {}

  /** @param {StoreEvent} ev */
  const notify = (ev) => { for (const fn of subs) { try { fn(ev); } catch (_) {} } };
  /** @param {string} key @param {T} value */
  const applySet = (key, value) => { map.set(key, value); notify({ type: 'set', key, value }); };
  /** @param {string} key */
  const applyRemove = (key) => { if (map.delete(key)) notify({ type: 'remove', key }); };
  /** @param {[string, T][]} [entries] */
  const applyReset = (entries) => { map.clear(); (entries || []).forEach(([k, v]) => map.set(k, v)); notify({ type: 'reset' }); };

  if (bc) {
    bc.onmessage = (e) => {
      const d = e && e.data; if (!d) return;
      if (d.set) applySet(d.set.key, d.set.value);
      else if (d.remove) applyRemove(d.remove.key);
      else if (d.reset) applyReset(d.reset);
      else if (d.reqSnapshot && map.size) { try { bc.postMessage({ reset: [...map.entries()] }); } catch (_) {} }   // answer a late joiner
    };
    try { bc.postMessage({ reqSnapshot: true }); } catch (_) {}   // ask peers to send current state
  }

  return {
    set(key, value) { applySet(key, value); if (bc) { try { bc.postMessage({ set: { key, value } }); } catch (_) {} } },
    remove(key) { applyRemove(key); if (bc) { try { bc.postMessage({ remove: { key } }); } catch (_) {} } },
    reset(entries = []) { applyReset(entries); if (bc) { try { bc.postMessage({ reset: [...map.entries()] }); } catch (_) {} } },
    get(key) { return map.get(key); },
    all() { return [...map.values()]; },
    keys() { return [...map.keys()]; },
    size() { return map.size; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
