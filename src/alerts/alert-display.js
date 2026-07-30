// @ts-check
// Alert TIMESTAMP display preferences -- how the Alerts panel renders an alert's Created / Last-triggered
// times. Deliberately independent of the chart time-scale format and the Trade Desk display timezone (alerts
// are their own surface), so there's no confusion about which setting drives them. Persisted as one app
// setting under 'alertsDisplay'; changing it broadcasts 'alerts:display-changed' so an open panel re-renders.
// Formatting reuses the chart's pure strftime / time helpers (UTC parts + an offset shift, the fmtClock rule).
import { getSetting, setSetting } from '../settings/settings.js';
import { bus } from '../bus.js';
import { strftime, fmtTime, DATE_FMT_DEFAULT } from '../chart/pane-format.js';

const KEY = 'alertsDisplay';
/** @returns {{ dateFmt?: string, hours24?: boolean, tzOffsetMin?: number|null, showName?: boolean, showMessage?: boolean, showLastTriggered?: boolean, logShowName?: boolean, logShowMessage?: boolean, logTypePrice?: boolean, logTypeTime?: boolean, logTypeWatchlist?: boolean }} */
const cfg = () => getSetting(KEY) || {};
/** local offset (minutes east of UTC) -- the default when the user hasn't picked a zone. */
const localOff = () => -new Date().getTimezoneOffset();

export const alertDateFmt = () => {
  const d = cfg().dateFmt;
  return d != null ? d : DATE_FMT_DEFAULT;
};
export const alertHours24 = () => {
  const h = cfg().hours24;
  return h == null ? true : !!h;
};
/** resolved offset used for formatting (null setting = Local -> the live local offset). */
export const alertTzOffsetMin = () => {
  const o = cfg().tzOffsetMin;
  return typeof o === 'number' ? o : localOff();
};
/** the raw stored tz (null = Local) -- for the settings select's current value. */
export const alertTzSetting = () => {
  const o = cfg().tzOffsetMin;
  return typeof o === 'number' ? o : null;
};

// The user-picked notification sound. The user chooses any mp3 anywhere on the system; we store only its
// absolute PATH (+ display name) and read the file in place when it plays — nothing is copied.
const SOUND_KEY = 'alertSound';
/** the picked sound's display name ('' = none picked). */
export const alertSoundName = () => {
  const c = getSetting(SOUND_KEY);
  return (c && c.name) || '';
};
/** the picked sound's absolute path on disk ('' = none picked). */
export const alertSoundPath = () => {
  const c = getSetting(SOUND_KEY);
  return (c && c.path) || '';
};
/** @param {string} path @param {string} name */
export function setAlertSound(path, name) {
  setSetting(SOUND_KEY, { path, name });
  bus.emit('alerts:display-changed');
}
export function clearAlertSoundName() {
  setSetting(SOUND_KEY, {});
  bus.emit('alerts:display-changed');
}

// Read a sound file from disk into a playable object-URL (desktop only — uses Node fs; the renderers run
// with full Node, contextIsolation off). Returns '' if there's no path or Node isn't available (browser).
/** @param {string} p @returns {string} */
export function soundObjectUrl(p) {
  if (!p) return '';
  try {
    const req = /** @type {any} */ (globalThis).require;
    return URL.createObjectURL(new Blob([req('fs').readFileSync(p)], { type: 'audio/mpeg' }));
  } catch (_) {
    return '';
  }
}

// Which columns the Alerts panel row shows (the "Customize list" toggles). All default ON.
export const alertShowName = () => {
  const v = cfg().showName;
  return v == null ? true : !!v;
};
export const alertShowMessage = () => {
  const v = cfg().showMessage;
  return v == null ? true : !!v;
};
export const alertShowLastTriggered = () => {
  const v = cfg().showLastTriggered;
  return v == null ? true : !!v;
};

// Which columns the Log tab row shows (its own "Customize list" toggles, independent of the alerts list).
export const logShowName = () => {
  const v = cfg().logShowName;
  return v == null ? true : !!v;
};
export const logShowMessage = () => {
  const v = cfg().logShowMessage;
  return v == null ? true : !!v;
};

// Which producer TYPES the Log tab shows (the "Show events by type" section). All default ON -- unchecking one
// hides that type's entries. Matched against each entry's linked alert via alertType() (alert-record.js).
export const logTypePrice = () => {
  const v = cfg().logTypePrice;
  return v == null ? true : !!v;
};
export const logTypeTime = () => {
  const v = cfg().logTypeTime;
  return v == null ? true : !!v;
};
export const logTypeWatchlist = () => {
  const v = cfg().logTypeWatchlist;
  return v == null ? true : !!v;
};

/** @param {Partial<{ dateFmt: string, hours24: boolean, tzOffsetMin: number|null, showName: boolean, showMessage: boolean, showLastTriggered: boolean, logShowName: boolean, logShowMessage: boolean, logTypePrice: boolean, logTypeTime: boolean, logTypeWatchlist: boolean }>} patch */
export function setAlertDisplay(patch) {
  setSetting(KEY, Object.assign({}, cfg(), patch));
  bus.emit('alerts:display-changed');
}

// UTC epoch ms -> "<date> <time>" in the alert display timezone, 24h/12h per preference. Minute precision --
// alerts are minute-level (a time alert schedules to the minute; a fire's second is noise), so no seconds.
/** @param {*} ms @returns {string} */
export function fmtAlertTime(ms) {
  if (ms == null || ms === '') return '';
  const d = new Date(Number(ms) + alertTzOffsetMin() * 60000);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = alertDateFmt();
  const date = fmt ? strftime(d, fmt) : '';
  const time = fmtTime(d, alertHours24(), false);
  return (date ? date + ' ' : '') + time;
}
