// @ts-check
// Trade Desk configuration -- desk-wide settings shared by ALL its tabs (Console / Orders / Positions /
// History / Accounts), deliberately separate from chart/window settings (a chart's timezone is per window;
// this is one value for the whole desk). Persisted under the 'tradeDesk' key in app prefs. The timezone here
// is the DISPLAY offset (minutes east of UTC) applied to every time column the desk shows.
import { getSetting, setSetting } from '../settings/settings.js';

const KEY = 'tradeDesk';
/** @returns {{ tzOffsetMin?: number, beThreshold?: number, stats?: { enabled?: boolean, items?: { key: string, on: boolean }[] }, colors?: Record<string, string> }} */
const cfg = () => getSetting(KEY) || {};

/** @type {Set<() => void>} */
const listeners = new Set();
/** Subscribe to desk-config changes (surfaces re-render on these). @param {() => void} fn */
export function onDeskConfigChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {}
  });
}

// Display offset (minutes east of UTC) for every desk time column. Default: the local timezone (same default
// the chart uses), until the user picks one in the Configure dialog.
export function getDeskOffsetMin() {
  const c = cfg();
  return typeof c.tzOffsetMin === 'number' ? c.tzOffsetMin : -new Date().getTimezoneOffset();
}
/** @param {number} m */
export function setDeskOffsetMin(m) {
  setSetting(KEY, Object.assign({}, cfg(), { tzOffsetMin: m }));
  notify();
}

// ---- Breakeven threshold: a dollar amount away from 0 that defines the BE zone. A closed trade whose net P&L
// lands within +/- this of zero is a BREAKEVEN (scratch); above it is a hit, below it a miss. Drives the Trades
// (H/BE/M) breakdown and, later, per-trade Status -- so we can classify outcomes without needing a TP/SL.
/** @returns {number} */
export function getDeskBeThreshold() {
  const c = cfg();
  return typeof c.beThreshold === 'number' && c.beThreshold >= 0 ? c.beThreshold : 0;
}
/** @param {number} v */
export function setDeskBeThreshold(v) {
  const n = Number(v);
  setSetting(KEY, Object.assign({}, cfg(), { beThreshold: Number.isFinite(n) && n > 0 ? n : 0 }));
  notify();
}

// ---- Stats bar config (History): which stats show, in what order, and whether the bar is on. One desk-wide
// config (like the timezone). The Trade Desk > Configure > Stats UI edits it; rendering the bar is wired later.
// The catalog is the source of truth for available stats + their default on/off + default order.
/** @type {{ key: string, label: string, on: boolean }[]} */
export const STATS_CATALOG = [
  { key: 'netProfit', label: 'Net Profit', on: true },
  { key: 'trades', label: 'Trades', on: true },
  { key: 'hitRate', label: 'Hit Rate', on: true },
  { key: 'profitFactor', label: 'Profit Factor', on: true },
  { key: 'balance', label: 'Balance', on: true },
  { key: 'points', label: 'Points', on: false },
  { key: 'commission', label: 'Commission', on: false },
];
const STAT_KEYS = new Set(STATS_CATALOG.map((s) => s.key));

// merged stats config: the saved order + on-state reconciled against the catalog (new stats appended in catalog
// order, removed keys dropped). `enabled` defaults on.
/** @returns {{ enabled: boolean, items: { key: string, label: string, on: boolean }[] }} */
export function getDeskStats() {
  const s = cfg().stats || {};
  const saved = Array.isArray(s.items) ? s.items.filter((i) => i && STAT_KEYS.has(i.key)) : [];
  const order = saved.map((i) => i.key);
  STATS_CATALOG.forEach((c) => {
    if (!order.includes(c.key)) order.push(c.key);
  });
  const onMap = new Map(saved.map((i) => [i.key, !!i.on]));
  const items = order.map((k) => {
    const c = /** @type {any} */ (STATS_CATALOG.find((x) => x.key === k));
    return { key: k, label: c.label, on: onMap.has(k) ? !!onMap.get(k) : c.on };
  });
  return { enabled: s.enabled !== false, items };
}
/** @param {{ enabled: boolean, items: { key: string, on: boolean }[] }} v */
export function setDeskStats(v) {
  setSetting(
    KEY,
    Object.assign({}, cfg(), {
      stats: { enabled: !!v.enabled, items: (v.items || []).map((i) => ({ key: i.key, on: !!i.on })) },
    }),
  );
  notify();
}

// ---- Desk colours: the Console DIRECTION tints (OUT = app -> broker requests, IN = broker -> app replies)
// plus the Money Man zone/ladder colours. All user-themeable from Trade Desk > Colors, stored in this same
// config, and pushed onto :root as CSS vars so the surfaces (console rows; the Money Man grid + ladder) read
// them live. Defaults match the shipped palette.
/** @type {Record<string, string>} */
export const DESK_COLOR_DEFAULTS = {
  out: '#e79457',
  in: '#4fb6c9',
  // Money Man -- zone bands
  mmShot: '#a371f7',
  mmBase: '#2ea043',
  mmFloor: '#d29922',
  mmStop: '#f85149',
  // Money Man -- ladder levels (default to the matching zone hues)
  mmMax: '#2ea043',
  mmMid: '#d29922',
  mmMin: '#f85149',
};
// color key -> the CSS custom property the surfaces read
/** @type {Record<string, string>} */
const COLOR_VAR = {
  out: '--dir-out',
  in: '--dir-in',
  mmShot: '--mm-shot',
  mmBase: '--mm-base',
  mmFloor: '--mm-floor',
  mmStop: '--mm-stop',
  mmMax: '--mm-max',
  mmMid: '--mm-mid',
  mmMin: '--mm-min',
};
/** @returns {Record<string, string>} */
export function getDeskColors() {
  const c = cfg().colors || {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const k in DESK_COLOR_DEFAULTS) out[k] = typeof c[k] === 'string' ? c[k] : DESK_COLOR_DEFAULTS[k];
  return out;
}
/** @param {Record<string, string>} v */
export function setDeskColors(v) {
  setSetting(KEY, Object.assign({}, cfg(), { colors: Object.assign({}, getDeskColors(), v) }));
  notify();
}
/** Push every desk colour onto :root as a CSS var, so the surfaces read them live. */
export function applyDeskColors() {
  const c = getDeskColors();
  const root = document.documentElement.style;
  for (const k in COLOR_VAR) root.setProperty(COLOR_VAR[k], c[k]);
}
onDeskConfigChange(applyDeskColors);
applyDeskColors();

/** @param {number} n */
const pad = (n) => (n < 10 ? '0' + n : '' + n);

// UTC epoch ms -> 'MM-DD HH:MM:SS' in the desk's display timezone. Shift by the offset, then read with
// getUTC* so the offset is applied exactly once (the fmtClock pattern used elsewhere in the app).
/** @param {*} ms @returns {string} */
export function fmtDeskTime(ms) {
  if (ms == null || ms === '') return '—';
  const d = new Date(Number(ms) + getDeskOffsetMin() * 60000);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    pad(d.getUTCMonth() + 1) +
    '-' +
    pad(d.getUTCDate()) +
    ' ' +
    pad(d.getUTCHours()) +
    ':' +
    pad(d.getUTCMinutes()) +
    ':' +
    pad(d.getUTCSeconds())
  );
}

// UTC epoch ms -> 'HH:MM:SS' in the desk's display timezone (the Console clock column).
/** @param {*} ms @returns {string} */
export function fmtDeskClock(ms) {
  const d = new Date(Number(ms) + getDeskOffsetMin() * 60000);
  if (Number.isNaN(d.getTime())) return '—';
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}

// UTC epoch ms -> 'MMDDYYYY-HHMM' position tag in the desk's display timezone (matches the Opened column).
/** @param {*} ms @returns {string} */
export function fmtDeskTag(ms) {
  if (ms == null || ms === '') return '—';
  const d = new Date(Number(ms) + getDeskOffsetMin() * 60000);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    d.getUTCFullYear() +
    '-' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}

// 'UTC+HH:MM' label for the current desk offset (for the Configure dialog / any tz indicator).
/** @param {number} [m] @returns {string} */
export function fmtDeskOffsetLabel(m) {
  const off = typeof m === 'number' ? m : getDeskOffsetMin();
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return 'UTC' + sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}
