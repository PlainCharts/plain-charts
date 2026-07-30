// @ts-check
// Order-view VISIBILITY behavior -- SHARED by the app (order dialog) and addons (position-manager), so neither hard-codes
// it. Two parts:
//   VISIBILITY    live per-category show/hide of the on-chart order dots (entry / stop / target). This is just the plan
//                 store's setVis (session-only, synced); every primitive already honours it via the overlay's show()
//                 filter -- so visibility is a behavior of the ORDER-VIEW layer, inherited by every primitive for free,
//                 never coded into each one.
//   HIDE ON ENTRY a GLOBAL, persisted POLICY: which categories auto-hide when a position OPENS. Applied ONCE, at the
//                 fill moment, by the overlay (the single place watching the book) -- so it fires for EVERY entry source
//                 (dialog, addon, or an order placed on the broker's own platform). Reset to all-shown when flat.
// The policy lives in app-prefs (settings.json, key below) and syncs live across windows over a BroadcastChannel, so a
// toggle in the dialog moves the addon's checkboxes and reaches the chart overlay without a reload.
import { setVis } from './plan-store.js';
import { getSetting, setSetting } from '../../settings/settings.js';

const KEY = 'orderHideOnEntry'; // app-prefs key: { entry, stop, target } booleans -- true = hide that category on entry
const ch = new BroadcastChannel('order-visibility');

/** @typedef {{ entry: boolean, stop: boolean, target: boolean }} VisPolicy */
/** @param {any} v @returns {VisPolicy} */
const norm = (v) => ({ entry: !!(v && v.entry), stop: !!(v && v.stop), target: !!(v && v.target) });

/** @type {VisPolicy|null} */
let policy = null; // lazily seeded from prefs on first read (settings are loaded by the time any UI/overlay reads this)
/** @type {Set<() => void>} */
const subs = new Set();
const notify = () =>
  subs.forEach((f) => {
    try {
      f();
    } catch (_) {}
  });
const P = () => policy || (policy = norm(getSetting(KEY)));

ch.onmessage = (/** @type {MessageEvent} */ e) => {
  const m = e.data;
  if (m && m.op === 'policy') {
    policy = norm(m.policy);
    notify();
  }
};

/** the global HIDE-ON-ENTRY policy (which categories hide when a position opens). @returns {VisPolicy} */
export function hideOnEntry() {
  return { ...P() };
}
/** merge a hide-on-entry patch; persists (app-prefs) + syncs to every window. @param {Partial<VisPolicy>} patch */
export function setHideOnEntry(patch) {
  const cur = P();
  policy = {
    entry: patch.entry != null ? !!patch.entry : cur.entry,
    stop: patch.stop != null ? !!patch.stop : cur.stop,
    target: patch.target != null ? !!patch.target : cur.target,
  };
  setSetting(KEY, { ...policy });
  try {
    ch.postMessage({ op: 'policy', policy: { ...policy } });
  } catch (_) {}
  notify();
}
/** subscribe to policy changes (the editor UIs re-sync their checkboxes). @param {() => void} fn @returns {() => void} */
export function onHideOnEntryChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** APPLY the hide-on-entry policy at the flat -> open transition: hide the checked categories, show the rest.
 *  @param {string} broker @param {string} symbol */
export function applyEntryVisibility(broker, symbol) {
  const p = P();
  setVis(broker, symbol, { entry: !p.entry, stop: !p.stop, target: !p.target });
}
/** RESET visibility to all-shown at the open -> flat transition. @param {string} broker @param {string} symbol */
export function resetEntryVisibility(broker, symbol) {
  setVis(broker, symbol, { entry: true, stop: true, target: true });
}
