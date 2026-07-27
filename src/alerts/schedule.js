// @ts-check
// Pure schedule math for TIME alerts -- the time-domain analogue of eval.js (which is the price domain).
// No DOM, no store, no engine. A time alert carries a `schedule`; nextFire computes the next epoch-ms instant
// it should fire at (or null when it never will again -- a one-shot already in the past). Clock times are
// wall-clock in the ALERT timezone, passed in as a fixed offset (minutes east of UTC) -- the same offset
// alert-display.js formats timestamps with, so the schedule and the Log agree on "what time it is".

const DAY = 86400000;

/** parse "HH:MM" -> [h, m], or null if malformed / out of range. @param {*} s @returns {[number, number] | null} */
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s));
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return [h, min];
}

/** @typedef {{ kind:'once', at:number } | { kind:'daily', time:string } | { kind:'weekly', days:number[], time:string }} Schedule */

/** Is this a well-formed schedule we can arm? @param {*} sch @returns {boolean} */
export function scheduleValid(sch) {
  if (!sch || typeof sch !== 'object') return false;
  if (sch.kind === 'once') return typeof sch.at === 'number' && isFinite(sch.at);
  if (sch.kind === 'daily') return !!parseHM(sch.time);
  if (sch.kind === 'weekly') return !!parseHM(sch.time) && Array.isArray(sch.days) && sch.days.length > 0;
  return false;
}

/**
 * The next instant (epoch ms) this schedule should fire at, at or after `now`; null if it never will again.
 *   - once   -> its instant while still ahead of `now`, else null (fired, done).
 *   - daily  -> today's clock time if still ahead, else tomorrow's.
 *   - weekly -> the next of its weekdays (0=Sun..6=Sat) at the clock time.
 * @param {*} sch @param {number} now epoch ms @param {number} [tzOffsetMin] minutes east of UTC (the alert tz)
 * @returns {number|null}
 */
export function nextFire(sch, now, tzOffsetMin = 0) {
  if (!scheduleValid(sch)) return null;
  if (sch.kind === 'once') return sch.at > now ? sch.at : null;
  const hm = parseHM(sch.time); if (!hm) return null;
  const shift = tzOffsetMin * 60000;
  const s = now + shift;                       // shifted "wall clock" epoch (read back with UTC getters)
  const d = new Date(s);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hm[0], hm[1], 0, 0);
  if (sch.kind === 'daily') {
    let cand = base; if (cand <= s) cand += DAY;   // passed (or exactly) now -> tomorrow
    return cand - shift;
  }
  // weekly: walk forward to the next configured weekday whose clock time is still ahead.
  const want = new Set(sch.days.map(Number));
  for (let i = 0; i < 8; i++) {
    const cand = base + i * DAY;
    if (cand <= s) continue;
    if (want.has(new Date(cand).getUTCDay())) return cand - shift;
  }
  return null;
}
