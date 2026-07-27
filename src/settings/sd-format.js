// @ts-check
// Pure formatters + small constants for the chart settings dialog. No DOM, no module state --
// just data -> string helpers, safe to import anywhere. (Tier 1 of the chart-dialog de-monolith.)

export const DAY_MS = 86400000;

// timezone offset (minutes east of UTC) for an IANA zone name, evaluated right now
/** @param {string} tz @returns {number} */
export function ianaOffsetMin(tz) {
  try {
    const now = Date.now();
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(now)).reduce((a, x) => { a[x.type] = x.value; return a; }, /** @type {Record<string, string>} */ ({}));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - now) / 60000);
  } catch (_) { return 0; }
}

// offset minutes -> "UTC+5" / "UTC-4:30"
/** @param {number} min */
export const fmtOff = (min) => { const s = min < 0 ? '-' : '+'; const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60; return `UTC${s}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`; };

// ms epoch + offset -> "HH:MM:SS" wall clock in that offset
/** @param {number} ms @param {number} offMin */
export const fmtClock = (ms, offMin) => { const d = new Date(ms + offMin * 60000); const p = (/** @type {number} */ n) => String(n).padStart(2, '0'); return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };

// byte count -> "0 B" / "512 B" / "3 KB" / "1.4 MB"
/** @param {number} n */
export const fmtBytes = (n) => !n ? '0 B' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

// unix seconds -> "Nov 16, 2023" (UTC), or an em dash when null
/** @param {number | null | undefined} sec */
export const fmtCovDate = (sec) => sec == null ? '—' : new Date(sec * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// ms epoch <-> a <input type=date> value ("YYYY-MM-DD", interpreted as UTC midnight)
/** @param {number} ms */
export const msToDateInput = (ms) => { try { return new Date(ms).toISOString().slice(0, 10); } catch (_) { return ''; } };
/** @param {string} v */
export const dateInputToMs = (v) => { const t = Date.parse(v + 'T00:00:00Z'); return isNaN(t) ? 0 : t; };

// a stable signature for a layout definition (to detect the active one)
/** @param {{ areas?: string, colFr?: number[], rowFr?: number[] } | null | undefined} d */
export const layoutSig = (d) => (d && d.areas ? d.areas + '|' + (d.colFr || []).join(',') + '|' + (d.rowFr || []).join(',') : '');
