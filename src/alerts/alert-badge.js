// @ts-check
// The unseen-fires BADGE state -- the count on the alert rail icon is DERIVED from the Log, not a separate store.
// Two pieces live here: a single GLOBAL "last seen the Log" timestamp (one mailbox for the whole app, per the
// plan -- an app setting, not per-window) and a PURE count of fires newer than it. The panel reads the Log
// mirror, calls unseenCount(), and paints the badge; opening the Log tab calls markLogSeen() to clear it.
import { getSetting, setSetting } from '../settings/settings.js';
import { bus } from '../bus.js';

const KEY = 'lastSeenLogAt';

/** epoch ms of the last Log visit (0 = never opened, so every entry counts as unseen). @returns {number} */
export function lastSeenLogAt() { const v = Number(getSetting(KEY)); return Number.isFinite(v) ? v : 0; }

/** stamp the Log as seen (default = now) and broadcast 'alerts:log-seen' so an open badge re-derives to 0.
 * @param {number} [ms] */
export function markLogSeen(ms) { setSetting(KEY, ms == null ? Date.now() : ms); bus.emit('alerts:log-seen'); }

/** PURE: how many log entries fired strictly after `since`. @param {{at?:number}[]} entries @param {number} since @returns {number} */
export function unseenCount(entries, since) {
  let n = 0;
  for (const e of (entries || [])) { if (Number(e && e.at) > since) n++; }
  return n;
}
