// @ts-check
// Date/time label formatting for a pane's time axis (pure helpers, lifted out of pane.js). A
// strftime(3)-style formatter over a Date's UTC parts, plus the time + full-date-label builders the
// pane uses for crosshair / axis labels. No pane state -- safe to import anywhere.

// MON / DOW are also used directly by the pane's time-axis tick labels, so they're exported.
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** @param {number} n */
const p2 = (n) => String(n).padStart(2, '0');

// default strftime pattern for the date portion of the time label.
export const DATE_FMT_DEFAULT = '%b %-d';   // -> "Sep 29"
// example patterns shown in the field's help popover.
export const DATE_FMT_EXAMPLES = [
  { p: '%b %-d',       ex: 'Sep 29' },
  { p: '%-d %b',       ex: '29 Sep' },
  { p: '%b %-d, %Y',   ex: 'Sep 29, 2026' },
  { p: '%a %b %-d',    ex: 'Mon Sep 29' },
  { p: '%Y-%m-%d',     ex: '2026-09-29' },
  { p: '%m/%d/%y',     ex: '09/29/26' },
  { p: '%d/%m/%Y',     ex: '29/09/2026' },
];

// strftime(3)-style formatter over a Date's UTC parts. Supports the common
// conversion specifiers plus the GNU '-' flag (%-d etc.) to drop zero-padding.
/** @param {Date} d @param {string} fmt @returns {string} */
export function strftime(d, fmt) {
  const Y = d.getUTCFullYear(), m = d.getUTCMonth(), date = d.getUTCDate(), wd = d.getUTCDay();
  const H = d.getUTCHours(), Min = d.getUTCMinutes(), S = d.getUTCSeconds();
  const h12 = H % 12 === 0 ? 12 : H % 12;
  /** @type {Record<string, string>} */
  const map = {
    Y: String(Y), y: String(Y).slice(2),
    m: p2(m + 1), b: MON[m], h: MON[m], B: MON_FULL[m],
    d: p2(date), e: String(date).padStart(2, ' '),
    a: DOW[wd], A: DOW_FULL[wd],
    H: p2(H), I: p2(h12), M: p2(Min), S: p2(S),
    p: H < 12 ? 'AM' : 'PM', P: H < 12 ? 'am' : 'pm',
    '%': '%',
  };
  return String(fmt).replace(/%(-?)([A-Za-z%])/g, (whole, flag, c) => {
    let v = map[c];
    if (v == null) return whole;                       // leave unknown codes literal
    if (flag === '-') v = v.replace(/^0+(?=\d)/, '');  // GNU %-d: strip leading zeros
    return v;
  });
}
// time portion in 24h or 12h (am/pm); optional seconds.
/** @param {Date} d @param {boolean} [h24] @param {boolean} [secs] @returns {string} */
export function fmtTime(d, h24, secs) {
  const mm = p2(d.getUTCMinutes());
  const sec = secs ? ':' + p2(d.getUTCSeconds()) : '';
  if (h24) return `${p2(d.getUTCHours())}:${mm}${sec}`;
  const h = d.getUTCHours(), ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm}${sec} ${ap}`;
}
// full date label: optional weekday prefix + the user's strftime date pattern.
// blank pattern means blank (no date shown).
/** @param {Date} d @param {{ tsDateFmt?: string, tsDayOfWeek?: boolean }} s @returns {string} */
export function fmtDateLabel(d, s) {
  const date = s.tsDateFmt ? strftime(d, s.tsDateFmt) : '';
  const dow = s.tsDayOfWeek ? DOW[d.getUTCDay()] + ' ' : '';
  return (dow + date).trim();
}
