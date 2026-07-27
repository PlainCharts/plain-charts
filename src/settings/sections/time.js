// @ts-check
// Settings -> Time section (Tier 3 of the chart-dialog de-monolith). The ACTIVE chart's display
// timezone (per-pane; data stays UTC) plus a live readout of broker / UTC / chart / local time. Edits
// the appearance draft and previews live, committing on Ok like the other per-chart settings. Owns the
// 1s clock interval: render() starts it, stop() clears it -- the shell calls stop() on every nav change
// (and dialog close). Imports its own domain deps directly.
import { broker } from '../../../data_engine/index.js';
import { ianaOffsetMin, fmtOff, fmtClock } from '../sd-format.js';
import { t } from '../../i18n/i18n.js';   // vocabulary lookup

const TZ_CITIES = [
  ['UTC', 'UTC'], ['America/New_York', 'New York'], ['America/Chicago', 'Chicago'],
  ['America/Denver', 'Denver'], ['America/Los_Angeles', 'Los Angeles'], ['America/Sao_Paulo', 'Sao Paulo'],
  ['Europe/London', 'London'], ['Europe/Berlin', 'Frankfurt'], ['Europe/Moscow', 'Moscow'],
  ['Asia/Dubai', 'Dubai'], ['Asia/Kolkata', 'Mumbai'], ['Asia/Singapore', 'Singapore'],
  ['Asia/Hong_Kong', 'Hong Kong'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney'],
];

/** @type {ReturnType<typeof setInterval> | null} */
let timeTimer = null;

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section, row, draft, pane, preview } = ctx;
  // the active pane's effective offset: its own tzOffsetMin when set, else the inherited global default
  const cur = () => (draft.tzOffsetMin != null ? draft.tzOffsetMin : pane.tzOffset());
  section('TIMEZONE');
  const sel = document.createElement('select');
  const localOff = -new Date().getTimezoneOffset();
  const zones = [[t('Local'), localOff], ...TZ_CITIES.map(([tz, city]) => [city, ianaOffsetMin(tz)])];
  zones.forEach(([city, off]) => { const o = document.createElement('option'); o.value = String(off); o.textContent = `(${fmtOff(/** @type {number} */ (off))}) ${city}`; sel.appendChild(o); });
  sel.value = String(cur());
  if (sel.selectedIndex < 0) {   // a custom offset that matches no city
    const o = document.createElement('option'); o.value = String(cur()); o.textContent = `(${fmtOff(cur())}) ${t('Custom')}`; sel.insertBefore(o, sel.firstChild); sel.value = String(cur());
  }
  sel.onchange = () => { draft.tzOffsetMin = parseInt(sel.value, 10); preview(); };   // per-pane; previews live, commits on Ok
  content.appendChild(row('Timezone', sel));

  section('CLOCKS');
  const clk = (/** @type {string} */ label) => { const d = document.createElement('div'); d.className = 'time-clock'; const l = document.createElement('span'); l.className = 'tc-label'; l.textContent = t(label); const v = document.createElement('span'); v.className = 'tc-val'; d.append(l, v); content.appendChild(d); return v; };
  const vUtc = clk('UTC time'), vBroker = clk('Broker time'), vChart = clk('Chart time'), vLocal = clk('Local time');
  const tick = () => {
    const now = Date.now();
    const bn = broker.serverNow ? broker.serverNow() : null;
    // pure broker time exactly as it arrives, plus its offset from UTC (broker clock - UTC)
    vBroker.textContent = bn != null ? fmtClock(bn, 0) + '  ·  ' + fmtOff(Math.round((bn - now) / 60000)) : t('not reported');
    vUtc.textContent = fmtClock(now, 0);
    vChart.textContent = fmtClock(now, cur()) + '  ·  ' + fmtOff(cur());
    vLocal.textContent = fmtClock(now, localOff) + '  ·  ' + fmtOff(localOff);
  };
  tick();
  if (timeTimer) clearInterval(timeTimer);
  timeTimer = setInterval(tick, 1000);
}

// leaving any category (or closing the dialog) clears the live clock interval
export function stop() { if (timeTimer) { clearInterval(timeTimer); timeTimer = null; } }
