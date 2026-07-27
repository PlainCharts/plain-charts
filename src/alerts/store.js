// @ts-check
// The alert-rule store -- a cross-window KEYED table of alerts, keyed by alert id, replicated over the
// alert-store channel. It bakes in the LAW that the platform store() does not: exactly ONE writer.
//
//   - The alert-host owns the AUTHORITATIVE store (createAlertStore(true)): it writes with set/remove/reset
//     and broadcasts every change; it answers a late window's snapshot request.
//   - Every other window holds a read-only MIRROR (alertMirror()): it adopts the host's broadcasts and
//     exposes reads + subscribe ONLY -- there is no set/remove on a mirror, so a window structurally cannot
//     mutate state. Mutations go through the command funnel (funnel.js) to the host, which writes here.
//
// Unidirectional flow: command -> host writes authoritative store -> broadcast -> mirrors -> render.
import { IPC } from '../ipc-contract.js';

/** @typedef {{ type: 'set' | 'remove' | 'reset', key?: string, value?: any }} AlertStoreEvent */

/**
 * @param {boolean} owner  true = the authoritative host store; false = a mirror (its writers stay unexposed)
 */
function makeStore(owner) {
  /** @type {Map<string, any>} */
  const map = new Map();
  /** @type {Set<(ev: AlertStoreEvent) => void>} */
  const subs = new Set();
  /** @type {BroadcastChannel | null} */
  let bc = null; try { bc = new BroadcastChannel(IPC.ALERT_STORE); } catch (_) {}

  /** @param {AlertStoreEvent} ev */
  const notify = (ev) => { for (const fn of subs) { try { fn(ev); } catch (_) {} } };
  /** @param {string} key @param {any} value */
  const applySet = (key, value) => { map.set(key, value); notify({ type: 'set', key, value }); };
  /** @param {string} key */
  const applyRemove = (key) => { if (map.delete(key)) notify({ type: 'remove', key }); };
  /** @param {[string, any][]} [entries] */
  const applyReset = (entries) => { map.clear(); (entries || []).forEach(([k, v]) => map.set(k, v)); notify({ type: 'reset' }); };

  if (bc) {
    bc.onmessage = (e) => {
      const d = e && e.data; if (!d) return;
      if (owner) {
        // authoritative: mirrors never write, so the host only answers snapshot requests from late joiners.
        if (d.reqSnapshot) { try { bc.postMessage({ reset: [...map.entries()] }); } catch (_) {} }
        return;
      }
      // mirror: adopt the host's broadcasts (read-only).
      if (d.set) applySet(d.set.key, d.set.value);
      else if (d.remove) applyRemove(d.remove.key);
      else if (d.reset) applyReset(d.reset);
    };
    if (!owner) { try { bc.postMessage({ reqSnapshot: true }); } catch (_) {} }   // pull current state on join
  }

  // Single shape (so the host gets the writable type). A mirror's writers exist but are never exposed --
  // alertMirror() hands back a reads-only view, so a window structurally cannot mutate state.
  return {
    /** @param {string} key */ get: (key) => map.get(key),
    all: () => [...map.values()],
    keys: () => [...map.keys()],
    size: () => map.size,
    /** @param {(ev: AlertStoreEvent) => void} fn */ subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    /** @param {string} key @param {any} value */
    set(key, value) { applySet(key, value); if (bc) { try { bc.postMessage({ set: { key, value } }); } catch (_) {} } },
    /** @param {string} key */
    remove(key) { applyRemove(key); if (bc) { try { bc.postMessage({ remove: { key } }); } catch (_) {} } },
    /** @param {[string, any][]} [entries] */
    reset(entries = []) { applyReset(entries); if (bc) { try { bc.postMessage({ reset: [...map.entries()] }); } catch (_) {} } },
  };
}

/** The authoritative store -- the alert-host's single writer. */
export function createAlertStore() { return makeStore(true); }

// The window-side read-only mirror singleton -- every surface (Alerts panel, chart) reads the same replica.
// It omits set/remove/reset, so a window cannot mutate; mutations go through the command funnel to the host.
/** @type {{ get: (k: string) => any, all: () => any[], keys: () => string[], size: () => number, subscribe: (fn: (ev: AlertStoreEvent) => void) => (() => void) } | null} */
let _mirror = null;
export function alertMirror() {
  if (_mirror) return _mirror;
  const s = makeStore(false);
  _mirror = { get: s.get, all: s.all, keys: s.keys, size: s.size, subscribe: s.subscribe };
  return _mirror;
}
