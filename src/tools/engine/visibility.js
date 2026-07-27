// @ts-check
// Per-drawing timeframe visibility (the settings dialog's "Visibility" tab).
// A drawing can be limited to show only on certain timeframe units
// and within a numeric range of each unit (e.g. Minutes 1–15, Days 1–366).
//
// Model: d.visibility = { minutes:{on,min,max}, hours:{…}, days:{…}, weeks:{…}, months:{…} }
//   - d.visibility undefined  -> visible on every timeframe (the default).
//   - a category absent        -> that unit is visible (treated as on, full range).
//   - category.on === false    -> hidden on that unit entirely.
//   - else visible only when the unit's bar count n is within [min, max].
//
// We only expose the bar units the app actually has (m/h/D/W/M); Ticks/Seconds/Ranges
// are omitted, since our data model doesn't produce them.

// One timeframe unit's rule: on/off, plus the [min,max] bar-count band it shows within.
/** @typedef {{ on?: boolean, min?: number, max?: number }} VisCat */
// The per-drawing visibility object (each key optional; absent = visible on that unit).
/** @typedef {{ minutes?: VisCat, hours?: VisCat, days?: VisCat, weeks?: VisCat, months?: VisCat }} Visibility */
// A timeframe descriptor: bar unit (m/h/D/W/M) and its multiplier n.
/** @typedef {{ unit: string, n?: number }} Tf */
// A drawing (only the fields this module reads).
/** @typedef {{ visibility?: Visibility }} Drawing */
// A Visibility-tab row descriptor.
/** @typedef {{ key: keyof Visibility, name: string, unit: string, min: number, max: number }} VisCategory */

// app bar unit -> visibility category key
/** @type {Record<string, keyof Visibility>} */
const UNIT_KEY = { m: 'minutes', h: 'hours', D: 'days', W: 'weeks', M: 'months' };

// rows rendered in the Visibility tab, in order, with their full ranges
/** @type {VisCategory[]} */
export const VIS_CATEGORIES = [
  { key: 'minutes', name: 'Minutes', unit: 'm', min: 1, max: 1440 },
  { key: 'hours', name: 'Hours', unit: 'h', min: 1, max: 24 },
  { key: 'days', name: 'Days', unit: 'D', min: 1, max: 366 },
  { key: 'weeks', name: 'Weeks', unit: 'W', min: 1, max: 52 },
  { key: 'months', name: 'Months', unit: 'M', min: 1, max: 12 },
];

// Build a d.visibility object for a quick interval preset relative to timeframe tf
// ({ unit, n }). Categories are ordered smallest→largest, so "above" = larger
// intervals, "below" = smaller. Returns null for 'all' (meaning: clear visibility
// = visible on every interval).
//   'above' — current interval and all larger ones
//   'below' — current interval and all smaller ones
//   'only'  — only the current interval
//   'all'   — every interval (null)
/** @param {Tf|null|undefined} tf @param {string} mode @returns {Visibility|null} */
export function intervalPreset(tf, mode) {
  if (mode === 'all' || !tf) return null;
  const key = UNIT_KEY[tf.unit];
  if (!key) return null;
  const n = tf.n || 1;
  const idx = VIS_CATEGORIES.findIndex((c) => c.key === key);
  /** @type {Visibility} */
  const v = {};
  VIS_CATEGORIES.forEach((c, i) => {
    let on = true, min = c.min, max = c.max;
    if (mode === 'only') { on = i === idx; if (on) { min = n; max = n; } }
    else if (mode === 'above') { if (i < idx) on = false; else if (i === idx) min = n; }
    else if (mode === 'below') { if (i > idx) on = false; else if (i === idx) max = n; }
    v[c.key] = { on, min, max };
  });
  return v;
}

// Does visibility object v equal the given preset for timeframe tf? (used to tick
// the active item in the menu; tolerant of missing categories = full-on default.)
/** @param {Visibility|null|undefined} v @param {Tf|null|undefined} tf @param {string} mode @returns {boolean} */
export function matchesPreset(v, tf, mode) {
  const target = intervalPreset(tf, mode);
  /** @param {VisCat|null|undefined} a @param {VisCat|null|undefined} b @param {VisCategory} c @returns {boolean} */
  const catEq = (a, b, c) => {
    const x = a || { on: true, min: c.min, max: c.max };
    const y = b || { on: true, min: c.min, max: c.max };
    const xmin = x.min == null ? c.min : x.min, xmax = x.max == null ? c.max : x.max;
    const ymin = y.min == null ? c.min : y.min, ymax = y.max == null ? c.max : y.max;
    return (x.on !== false) === (y.on !== false) && xmin === ymin && xmax === ymax;
  };
  if (!target) return !v || VIS_CATEGORIES.every((c) => catEq(v[c.key], null, c));   // 'all'
  if (!v) return false;
  return VIS_CATEGORIES.every((c) => catEq(v[c.key], target[c.key], c));
}

// Should drawing d be drawn on timeframe tf ({ unit, n })?
/** @param {Drawing|null|undefined} d @param {Tf|null|undefined} tf @returns {boolean} */
export function visibleOnTf(d, tf) {
  const v = d && d.visibility;
  if (!v || !tf) return true;
  const key = UNIT_KEY[tf.unit];
  if (!key) return true;
  const c = v[key];
  if (!c) return true;
  if (c.on === false) return false;
  const n = tf.n || 1;
  if (c.min != null && n < c.min) return false;
  if (c.max != null && n > c.max) return false;
  return true;
}
