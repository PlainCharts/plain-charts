// @ts-check
// Settings -> App -> General -> TIME: how the APP displays dates and times -- its date format, 24/12h clock,
// and timezone. This is the IN-APP time display (the alerts panel, the Log, time-alert schedules), deliberately
// separate from the chart time SCALE (Chart > Time) and the Trade Desk tz, so there's no confusion
// about which setting drives what. Backed by src/alerts/alert-display.js -- its accessors are the ONE interface
// every app surface formats through: price alerts and time alerts both follow these values.
import { alertDateFmt, alertHours24, alertTzSetting, setAlertDisplay } from '../../alerts/alert-display.js';
import { dateFmtHelp } from '../sd-controls.js';   // the shared "!" strftime popover (same widget as Scales)
import { DATE_FMT_EXAMPLES } from '../../chart/pane-format.js';
import { ianaOffsetMin, fmtOff } from '../sd-format.js';
import { t } from '../../i18n/i18n.js';

// a compact zone list (Local is prepended); each maps to a fixed UTC offset via ianaOffsetMin.
const TZ_CITIES = [
  ['UTC', 'UTC'], ['America/New_York', 'New York'], ['America/Chicago', 'Chicago'],
  ['America/Los_Angeles', 'Los Angeles'], ['Europe/London', 'London'], ['Europe/Berlin', 'Frankfurt'],
  ['Europe/Moscow', 'Moscow'], ['Asia/Dubai', 'Dubai'], ['Asia/Singapore', 'Singapore'],
  ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney'],
];

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section, row } = ctx;
  section('IN-APP TIME');
  // All three controls share one column: box-sizing border-box + a fixed width, and the two selects carry a
  // right margin equal to the Date-format row's "!" button (20px) + the row gap (10px) -- so the selects' right
  // edge meets the input's and every left edge lines up.
  const COL_W = '150px', SEL_MR = '30px';
  // Date format -- strftime. The "!" help popover is the SAME widget the Scales tab uses; its example-click
  // writes the pattern back here.
  const dateInp = document.createElement('input');
  dateInp.type = 'text'; dateInp.className = 'sd-text'; dateInp.placeholder = '%b %-d'; dateInp.value = alertDateFmt();
  dateInp.style.boxSizing = 'border-box';   // sd-text is width:150 content-box; border-box makes its outer width match the selects
  dateInp.oninput = () => setAlertDisplay({ dateFmt: dateInp.value });
  const help = dateFmtHelp((p) => { dateInp.value = p; setAlertDisplay({ dateFmt: p }); }, DATE_FMT_EXAMPLES);
  content.appendChild(row('Date format', dateInp, help));

  // Time hours format -- 24h or 12h (am/pm).
  const hSel = document.createElement('select');
  hSel.style.boxSizing = 'border-box'; hSel.style.width = COL_W; hSel.style.marginRight = SEL_MR;
  /** @type {[boolean, string][]} */
  ([[true, '24-hours'], [false, '12-hours']]).forEach(([v, label]) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t(label); hSel.appendChild(o); });
  hSel.value = String(alertHours24());
  hSel.onchange = () => setAlertDisplay({ hours24: hSel.value === 'true' });
  content.appendChild(row('Time hours format', hSel));

  // Timezone -- Local (null) or a fixed-offset city.
  const tzSel = document.createElement('select');
  tzSel.style.boxSizing = 'border-box'; tzSel.style.width = COL_W; tzSel.style.marginRight = SEL_MR;
  const local = -new Date().getTimezoneOffset();
  /** @param {string} label @param {number|null} off */
  const mkOpt = (label, off) => {
    const o = document.createElement('option');
    o.value = off == null ? '' : String(off);
    o.textContent = `(${fmtOff(off == null ? local : off)}) ${label}`;
    tzSel.appendChild(o);
  };
  mkOpt(t('Local'), null);
  TZ_CITIES.forEach(([tz, city]) => mkOpt(city, ianaOffsetMin(tz)));
  const cur = alertTzSetting();
  tzSel.value = cur == null ? '' : String(cur);
  tzSel.onchange = () => setAlertDisplay({ tzOffsetMin: tzSel.value === '' ? null : parseInt(tzSel.value, 10) });
  content.appendChild(row('Timezone', tzSel));
}
