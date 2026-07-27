// @ts-check
// The alert LOG store -- THE MAILBOX. An ordered, capped ring of fire events (one entry per fire, from ANY
// producer: price / time / watchlist), replicated over the alert-log channel. It obeys the same ONE-WRITER
// law as the rule store (store.js), only the shape differs -- an ordered ring, not a keyed table.
//
//   - The alert-host owns the AUTHORITATIVE log (createAlertLog()): it appends with push(), clears, and
//     broadcasts every change; it answers a late window's snapshot request.
//   - Every other window holds a read-only MIRROR (alertLogMirror()): it adopts the host's broadcasts and
//     exposes reads + subscribe ONLY -- a window structurally cannot append. Fires happen in the host.
//
// Unidirectional flow: a fire in the host -> push here -> broadcast -> mirrors -> Log tab / badge render.
import { IPC } from '../ipc-contract.js';

// The ring cap. A recurring alert must not grow the mailbox unbounded; the oldest entries fall off.
export const LOG_CAP = 500;

// A log entry is EVENT DATA ONLY: when it fired, which alert, the fire price, and -- for a WATCHLIST alert --
// WHICH list symbol fired (a single-symbol alert omits it; the Log reads the alert's own symbol). The rest of
// the spec (name / tf / message / conditions) is NOT copied here -- the Log tab looks it up live by `alertId`.
// The cascade (an alert's entries are pruned when it's removed) guarantees the alert outlives its entries.
/** @typedef {{ id:string, at:number, alertId:string, price?:number, symbol?:string }} LogEntry */
/** @typedef {{ type:'push'|'clear'|'reset'|'prune'|'remove', entry?:LogEntry, alertId?:string, id?:string }} LogEvent */

/**
 * @param {boolean} owner  true = the authoritative host log; false = a mirror (its writers stay unexposed)
 */
function makeLog(owner) {
  /** @type {LogEntry[]} */
  let ring = [];   // oldest-first, newest at the end; capped at LOG_CAP (oldest dropped on overflow)
  /** @type {Set<(ev: LogEvent) => void>} */
  const subs = new Set();
  /** @type {BroadcastChannel | null} */
  let bc = null; try { bc = new BroadcastChannel(IPC.ALERT_LOG); } catch (_) {}

  /** @param {LogEvent} ev */
  const notify = (ev) => { for (const fn of subs) { try { fn(ev); } catch (_) {} } };
  /** @param {LogEntry} entry */
  const applyPush = (entry) => { ring.push(entry); if (ring.length > LOG_CAP) ring = ring.slice(ring.length - LOG_CAP); notify({ type: 'push', entry }); };
  const applyClear = () => { ring = []; notify({ type: 'clear' }); };
  /** @param {LogEntry[]} [entries] */
  const applyReset = (entries) => { ring = (entries || []).slice(-LOG_CAP); notify({ type: 'reset' }); };
  /** cascade: drop every entry for a removed alert. @param {string} alertId */
  const applyPrune = (alertId) => { const n = ring.length; ring = ring.filter((x) => x.alertId !== alertId); if (ring.length !== n) notify({ type: 'prune', alertId }); };
  /** drop ONE entry by its id (the alert is untouched -- this only edits the mailbox). @param {string} id */
  const applyRemove = (id) => { const n = ring.length; ring = ring.filter((x) => x.id !== id); if (ring.length !== n) notify({ type: 'remove', id }); };

  if (bc) {
    bc.onmessage = (e) => {
      const d = e && e.data; if (!d) return;
      if (owner) {
        // authoritative: mirrors never write, so the host only answers snapshot requests from late joiners.
        if (d.reqSnapshot) { try { bc.postMessage({ reset: ring }); } catch (_) {} }
        return;
      }
      // mirror: adopt the host's broadcasts (read-only).
      if (d.push) applyPush(d.push);
      else if (d.clear) applyClear();
      else if (d.reset) applyReset(d.reset);
      else if (d.prune) applyPrune(d.prune);
      else if (d.remove) applyRemove(d.remove);
    };
    if (!owner) { try { bc.postMessage({ reqSnapshot: true }); } catch (_) {} }   // pull current state on join
  }

  // Single shape (so the host gets the writable type). A mirror's writers exist but are never exposed --
  // alertLogMirror() hands back a reads-only view, so a window structurally cannot append.
  return {
    all: () => ring.slice(),                  // oldest-first copy (the persisted order)
    recent: () => ring.slice().reverse(),     // newest-first (the Log tab renders this)
    size: () => ring.length,
    /** @param {(ev: LogEvent) => void} fn */ subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    /** @param {LogEntry} entry */
    push(entry) { applyPush(entry); if (bc) { try { bc.postMessage({ push: entry }); } catch (_) {} } },
    clear() { applyClear(); if (bc) { try { bc.postMessage({ clear: true }); } catch (_) {} } },
    /** @param {LogEntry[]} [entries] */
    reset(entries = []) { applyReset(entries); if (bc) { try { bc.postMessage({ reset: ring }); } catch (_) {} } },
    /** cascade-prune every entry for a removed alert (host-only; the mirror never exposes this). @param {string} alertId */
    pruneByAlert(alertId) { applyPrune(alertId); if (bc) { try { bc.postMessage({ prune: alertId }); } catch (_) {} } },
    /** remove ONE entry by id (host-only; the alert is untouched). @param {string} id */
    remove(id) { applyRemove(id); if (bc) { try { bc.postMessage({ remove: id }); } catch (_) {} } },
  };
}

/** The authoritative log -- the alert-host's single writer. */
export function createAlertLog() { return makeLog(true); }

// The window-side read-only mirror singleton -- the Log tab and (later) the unseen-fires badge read this.
// It omits push/clear/reset, so a window cannot append; fires happen in the host and broadcast here.
/** @type {{ all: () => LogEntry[], recent: () => LogEntry[], size: () => number, subscribe: (fn: (ev: LogEvent) => void) => (() => void) } | null} */
let _mirror = null;
export function alertLogMirror() {
  if (_mirror) return _mirror;
  const s = makeLog(false);
  _mirror = { all: s.all, recent: s.recent, size: s.size, subscribe: s.subscribe };
  return _mirror;
}
