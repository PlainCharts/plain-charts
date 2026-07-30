// @ts-check
// Cross-window glue for the order-ticket QUICK-BUTTON hotkeys. Two jobs, one BroadcastChannel each.
//
//  1. AWARENESS (conflict) -- the app's command + drawing-tool hotkeys live in the CHART window's memory
//     (command defaults are baked into the command modules; there is no on-disk list). The order ticket is
//     a SEPARATE window, so its button-hotkey editor can't read them directly. The chart window SERVES its
//     resolved combos on the 'combo-registry' channel; every window caches them; the editor calls
//     appComboConflict() before accepting a chord, so a button can't shadow a command or a tool.
//
//  2. DISPATCH (global fire) -- a quick-button chord must fire even when the CHART is focused and the order
//     ticket is only pinned. The focused window FORWARDS the chord on the 'order-hotkey-fire' channel; the
//     order-ticket window (sole owner of the button run(), getCtx and the tab's state.fire) executes it.
//     See hotkeys.js (forwarder) and buttons.js (executor).
//
// BroadcastChannel never delivers a message to the context that posted it, so an owner updates its OWN cache
// synchronously (ingest on publish) and peers update via onmessage.

const REG = 'combo-registry';
const FIRE = 'order-hotkey-fire';

// ---- 1. awareness: the app-combo registry ----
const regCh = new BroadcastChannel(REG);
/** @typedef {{ id: string, label: string, kind: string }} ComboOwner */
/** @type {Map<string, ComboOwner>} combo -> occupant (commands + tools), as cached in THIS window */
let appCombos = new Map();
/** @type {Set<() => void>} */
const changeListeners = new Set();
/** owner-side live getter (chart window); null in a consumer window. @type {(() => Array<{ combo: string } & ComboOwner>) | null} */
let sourceGetter = null;

/** @param {Array<{ combo: string } & ComboOwner>} entries */
function ingest(entries) {
  const m = new Map();
  for (const e of entries || []) if (e && e.combo) m.set(e.combo, { id: e.id, label: e.label, kind: e.kind });
  appCombos = m;
  changeListeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {}
  });
}
regCh.onmessage = (/** @type {MessageEvent} */ ev) => {
  const d = ev.data || {};
  if (d.req) {
    if (sourceGetter) regCh.postMessage({ entries: sourceGetter() });
    return;
  } // a consumer asked -> re-serve fresh
  if (d.entries) ingest(d.entries);
};

/** OWNER (chart window): register a live getter and push the current combos to windows already open. @param {() => Array<{ combo: string } & ComboOwner>} getEntries */
export function serveAppCombos(getEntries) {
  sourceGetter = getEntries;
  regCh.postMessage({ entries: getEntries() });
}
/** OWNER: re-publish after a command rebind (or any change to the served set). */
export function publishAppCombos() {
  if (sourceGetter) regCh.postMessage({ entries: sourceGetter() });
}
/** CONSUMER (order ticket): ask owners to (re)serve; the cache updates via onmessage. Call before showing the editor. */
export function requestAppCombos() {
  regCh.postMessage({ req: true });
}
/** CONSUMER: the command/tool occupying `combo`, or null. @param {string} combo @returns {ComboOwner | null} */
export function appComboConflict(combo) {
  return appCombos.get(combo) || null;
}
/** @param {() => void} fn */
export function onAppCombosChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

// ---- 2. dispatch: fire a quick button by combo, from any window ----
const fireCh = new BroadcastChannel(FIRE);
/** FORWARDER (focused non-order-ticket window): route an unclaimed modifier chord to the order ticket. @param {string} combo */
export function forwardQuickButton(combo) {
  fireCh.postMessage({ combo });
}
/** EXECUTOR (order-ticket window): run cb(combo) for every forwarded chord. Returns an unsubscribe fn. @param {(combo: string) => void} cb */
export function onQuickButtonForward(cb) {
  const h = (/** @type {MessageEvent} */ ev) => {
    const c = ev.data && ev.data.combo;
    if (c) cb(c);
  };
  fireCh.addEventListener('message', h);
  return () => fireCh.removeEventListener('message', h);
}
