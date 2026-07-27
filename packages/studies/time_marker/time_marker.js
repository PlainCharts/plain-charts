// @ts-check
// Time marker.
// Draws vertical lines (and optional shaded bands) at session windows and at single
// clock times, for past trading days and projected future days. Uses the study `shapes`
// channel (vline / band) rather than price plots; the host renders them full-height and
// extends the time scale so future projections are reachable.
//
// All bar times are UTC seconds. Each marker carries its own UTC offset (DST-naive, like
// the original) so a "09:30 in UTC-4" session lands at the right wall-clock time.

const TZS = [
  'UTC-12', 'UTC-11', 'UTC-10', 'UTC-9', 'UTC-8', 'UTC-7', 'UTC-6', 'UTC-5',
  'UTC-4', 'UTC-3', 'UTC-2', 'UTC-1', 'UTC',
  'UTC+1', 'UTC+2', 'UTC+3', 'UTC+4', 'UTC+5', 'UTC+6', 'UTC+7', 'UTC+8',
  'UTC+9', 'UTC+10', 'UTC+11', 'UTC+12',
].map((k) => ({ key: k, name: k }));
const STYLES = [{ key: 'solid', name: 'Solid' }, { key: 'dashed', name: 'Dashed' }, { key: 'dotted', name: 'Dotted' }];

// --- defaults mirroring the Pine inputs ---
const RANGE = [
  { color: '#ff9800', band: 'rgba(255,152,0,0.15)', style: 'solid', session: '0800-1700', tz: 'UTC-4' },
  { color: '#ffeb3b', band: 'rgba(255,235,59,0.15)', style: 'dashed', session: '0930-1600', tz: 'UTC-4' },
  { color: '#00bcd4', band: 'rgba(0,188,212,0.15)', style: 'solid', session: '0930-1600', tz: 'UTC-4' },
  { color: '#9c27b0', band: 'rgba(156,39,176,0.15)', style: 'solid', session: '0930-1600', tz: 'UTC-4' },
];
const SINGLE = [
  { color: '#76ff03', time: '0930', tz: 'UTC-4' },
  { color: '#e040fb', time: '1600', tz: 'UTC-4' },
  { color: '#008080', time: '1200', tz: 'UTC-4' },
  { color: '#800000', time: '1500', tz: 'UTC-4' },
];

/** @type {StudyInput[]} */
const inputs = [
  { key: 'show_past', name: 'Show past days', type: 'bool', default: true, right: 'days_to_show' },
  { key: 'days_to_show', name: 'Days to show', type: 'number', default: 5, min: 1, max: 60, hidden: true },
  { key: 'show_future', name: 'Show future days', type: 'bool', default: true, right: 'future_days' },
  { key: 'future_days', name: 'Days to project', type: 'number', default: 3, min: 1, max: 30, hidden: true },
];
RANGE.forEach((d, i) => {
  const n = i + 1, g = 'Time marker ' + n;
  inputs.push(
    { key: `m${n}_enable`, name: 'Enable', type: 'bool', default: false, right: `m${n}_name`, group: g },
    { key: `m${n}_name`, name: 'Name', type: 'text', default: `Time Marker ${n}`, hidden: true, group: g },
    { key: `m${n}_lines`, name: 'Show lines', type: 'bool', default: true, right: `m${n}_color`, group: g },
    { key: `m${n}_color`, name: 'Line', type: 'color', default: d.color, stroke: { width: `m${n}_width`, lineStyle: `m${n}_style` }, hidden: true, group: g },
    { key: `m${n}_style`, name: 'Line style', type: 'select', options: STYLES, default: d.style, hidden: true, group: g },
    { key: `m${n}_width`, name: 'Line width', type: 'number', default: 2, min: 1, max: 4, hidden: true, group: g },
    { key: `m${n}_band`, name: 'Show band', type: 'bool', default: false, right: `m${n}_band_color`, group: g },
    { key: `m${n}_band_color`, name: 'Band color', type: 'color', default: d.band, hidden: true, group: g },
    { key: `m${n}_session`, name: 'Session (HHMM-HHMM)', type: 'text', default: d.session, placeholder: '0800-1700', group: g },
    { key: `m${n}_tz`, name: 'Timezone', type: 'select', options: TZS, default: d.tz, group: g },
  );
});
SINGLE.forEach((d, i) => {
  const n = i + 1, g = 'Single marker ' + n;
  inputs.push(
    { key: `s${n}_enable`, name: 'Enable', type: 'bool', default: false, right: `s${n}_name`, group: g },
    { key: `s${n}_name`, name: 'Name', type: 'text', default: `Single Marker ${n}`, hidden: true, group: g },
    { key: `s${n}_color`, name: 'Line', type: 'color', default: d.color, stroke: { width: `s${n}_width`, lineStyle: `s${n}_style` }, group: g },
    { key: `s${n}_style`, name: 'Line style', type: 'select', options: STYLES, default: 'solid', hidden: true, group: g },
    { key: `s${n}_width`, name: 'Line width', type: 'number', default: 2, min: 1, max: 4, hidden: true, group: g },
    { key: `s${n}_time`, name: 'Time (HHMM)', type: 'text', default: d.time, placeholder: '0930', group: g },
    { key: `s${n}_tz`, name: 'Timezone', type: 'select', options: TZS, default: d.tz, group: g },
  );
});

// --- helpers ---
/** @param {string} tz */
const tzOff = (tz) => { const m = /^UTC([+-]\d+)?$/.exec(String(tz || 'UTC').trim()); return m && m[1] ? parseInt(m[1], 10) * 3600 : 0; };
/** @param {number} y @param {number} mo @param {number} d @param {number} hh @param {number} mm @param {number} off */
const mkTs = (y, mo, d, hh, mm, off) => Math.floor(Date.UTC(y, mo, d, hh, mm, 0) / 1000) - off;   // UTC seconds for a tz-local wall time
/** @param {string} s */
const parseSession = (s) => { const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(String(s || '').trim()); return m ? { sh: +m[1], sm: +m[2], eh: +m[3], em: +m[4] } : null; };
/** @param {string} s */
const parseHM = (s) => { const m = /^(\d{2})(\d{2})$/.exec(String(s || '').trim()); return m ? { h: +m[1], min: +m[2] } : null; };

// Mon–Fri trading days (in the marker's tz) relative to the reference time: `back` days
// into the past (incl. today) when `past`, and `fwd` days forward when `future`.
/** @param {number} refNow @param {number} off @param {boolean} past @param {number} back @param {boolean} future @param {number} fwd */
function markerDays(refNow, off, past, back, future, fwd) {
  const base = new Date((refNow + off) * 1000);
  const Y = base.getUTCFullYear(), M = base.getUTCMonth(), D = base.getUTCDate();
  /** @type {{ y:number, mo:number, d:number }[]} */
  const out = [];
  /** @param {Date} d */
  const push = (d) => out.push({ y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() });
  if (past) {
    let cnt = 0, delta = 0, g = 0;
    while (cnt <= back && g++ < 600) { const d = new Date(Date.UTC(Y, M, D - delta)); if (d.getUTCDay() % 6 !== 0) { push(d); cnt++; } delta++; }
  }
  if (future) {
    let cnt = 0, delta = 1, g = 0;
    while (cnt < fwd && g++ < 600) { const d = new Date(Date.UTC(Y, M, D + delta)); if (d.getUTCDay() % 6 !== 0) { push(d); cnt++; } delta++; }
  }
  return out;
}

/**
 * A host-rendered marker shape emitted on the study `shapes` channel (not a price plot):
 * a full-height vertical line (`vline`) or a shaded time band (`band`).
 * @typedef {{ type:'vline', time:number, color:string, width:number, lineStyle:string }
 *          | { type:'band', from:number, to:number, color:string }} MarkerShape
 */

Studies.register({
  id: 'time_marker',
  overlay: true,
  inputs,
  calc(bars, p) {
    /** @type {MarkerShape[]} */
    const shapes = [];
    if (!bars || !bars.length) return { plots: [], shapes };
    const now = bars[bars.length - 1].time;
    const past = !!p.show_past, future = !!p.show_future;
    const back = p.days_to_show | 0, fwd = p.future_days | 0;

    // session range markers
    for (let n = 1; n <= 4; n++) {
      if (!p[`m${n}_enable`]) continue;
      const ses = parseSession(p[`m${n}_session`]); if (!ses) continue;
      const off = tzOff(p[`m${n}_tz`]);
      const col = p[`m${n}_color`], style = p[`m${n}_style`], width = (p[`m${n}_width`] | 0) || 2;
      const lines = p[`m${n}_lines`] !== false, band = !!p[`m${n}_band`], fill = p[`m${n}_band_color`];
      markerDays(now, off, past, back, future, fwd).forEach(({ y, mo, d }) => {
        let start = mkTs(y, mo, d, ses.sh, ses.sm, off);
        let end = mkTs(y, mo, d, ses.eh, ses.em, off);
        if (end <= start) end += 86400;
        if (lines) {
          shapes.push({ type: 'vline', time: start, color: col, width, lineStyle: style });
          shapes.push({ type: 'vline', time: end, color: col, width, lineStyle: style });
        }
        if (band) shapes.push({ type: 'band', from: start, to: end, color: fill });
      });
    }

    // single-time markers
    for (let n = 1; n <= 4; n++) {
      if (!p[`s${n}_enable`]) continue;
      const hm = parseHM(p[`s${n}_time`]); if (!hm) continue;
      const off = tzOff(p[`s${n}_tz`]);
      const col = p[`s${n}_color`], style = p[`s${n}_style`], width = (p[`s${n}_width`] | 0) || 2;
      markerDays(now, off, past, back, future, fwd).forEach(({ y, mo, d }) => {
        shapes.push({ type: 'vline', time: mkTs(y, mo, d, hm.h, hm.min, off), color: col, width, lineStyle: style });
      });
    }

    return { plots: [], shapes };
  },
});

// Loaded via dynamic import() (an ES module at runtime); the empty export gives this file its own
// module scope so its top-level const helpers don't collide with sibling study modules' globals.
export {};
