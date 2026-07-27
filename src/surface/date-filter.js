// @ts-check
// Date-range filter dropdown (Today / This week / This month / All time / Custom) shared by the Trade Desk tabs
// that need it: History filters round-trips by their EXIT time, Orders filters by order time. Boundaries are
// computed in the desk display timezone so "today" matches the shown times. The choice is PER TAB (its own
// settings key), like the account filter. The tab applies `matches(tMs)` to whichever timestamp it filters on.
import { getSetting, setSetting } from '../settings/settings.js';
import { getDeskOffsetMin } from './desk-config.js';
import { t as tr } from '../i18n/i18n.js';   // imported as tr -- local `t` vars (parsed dates / timestamps) below

const DAY_MS = 86400000;
/** @typedef {{ mode: 'day'|'week'|'month'|'all'|'custom', from?: string, to?: string }} DateRange */

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => { const d = document.createElement('div'); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

/** @param {DateRange} range @returns {{ fromMs: number|null, toMs: number|null }} */
export function rangeBounds(range) {
  const off = getDeskOffsetMin() * 60000;
  const now = Date.now();
  /** @param {number} t */
  const dayStart = (t) => { const d = new Date(t + off); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - off; };
  /** @param {string} [s] */
  const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - off : null; };
  switch (range && range.mode) {
    case 'day': return { fromMs: dayStart(now), toMs: null };
    case 'week': { const back = (new Date(now + off).getUTCDay() + 6) % 7; return { fromMs: dayStart(now) - back * DAY_MS, toMs: null }; }   // Monday-start
    case 'month': { const d = new Date(now + off); return { fromMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - off, toMs: null }; }
    case 'custom': { const f = parse(range.from), t = parse(range.to); return { fromMs: f, toMs: t != null ? t + DAY_MS : null }; }   // inclusive end day
    default: return { fromMs: null, toMs: null };   // 'all'
  }
}
/** @param {DateRange} range @returns {string} */
export function rangeLabel(range) {
  switch (range && range.mode) {
    case 'day': return tr('Today');
    case 'week': return tr('This week');
    case 'month': return tr('This month');
    case 'custom': return (range.from || '?') + ' – ' + (range.to || '?');
    default: return tr('All time');
  }
}

// Build a per-tab date-range dropdown. `settingsKey` persists the choice; `onChange` re-renders the tab.
/** @param {string} settingsKey @param {() => void} onChange @returns {{ btn: HTMLElement, matches: (tMs: any) => boolean, mode: () => string, label: () => string, destroy: () => void }} */
export function createDateFilter(settingsKey, onChange) {
  /** @type {DateRange} */
  let range = getSetting(settingsKey) || { mode: 'all' };
  const btn = el('desk-filt date-filt'); btn.title = tr('Filter by date range');
  const lbl = el('desk-filt-t', rangeLabel(range));
  btn.append(lbl, el('desk-filt-caret', '▾'));

  /** @type {HTMLElement | null} */
  let menu = null;
  const close = () => { if (menu) { try { menu.remove(); } catch (_) {} menu = null; document.removeEventListener('pointerdown', away, true); } };
  /** @param {PointerEvent} e */
  const away = (e) => { const t = /** @type {Node} */ (e.target); if (menu && !menu.contains(t) && !btn.contains(t)) close(); };
  /** @param {DateRange} r */
  const apply = (r) => { range = r; setSetting(settingsKey, range); lbl.textContent = rangeLabel(range); close(); try { onChange(); } catch (_) {} };
  const open = () => {
    close();
    const m = el('wl-listmenu desk-filt-menu'); menu = m;
    /** @type {[DateRange['mode'], string][]} */
    const presets = [['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']];
    presets.forEach(([mode, lab]) => { const row = el('wl-listmenu-row' + (range.mode === mode ? ' sel' : ''), tr(lab)); row.onclick = () => apply({ mode }); m.appendChild(row); });
    const cust = el('desk-filt-custom');
    const isoNow = new Date(Date.now() + getDeskOffsetMin() * 60000).toISOString().slice(0, 10);
    /** @param {string} v */
    const dateIn = (v) => { const i = document.createElement('input'); i.type = 'date'; i.className = 'desk-filt-date'; i.value = v; return i; };
    const fromIn = dateIn((range.mode === 'custom' && range.from) || isoNow);
    const toIn = dateIn((range.mode === 'custom' && range.to) || isoNow);
    const applyB = document.createElement('button'); applyB.className = 'desk-filt-apply'; applyB.textContent = tr('Apply range');
    applyB.onclick = () => { if (fromIn.value && toIn.value) apply({ mode: 'custom', from: fromIn.value, to: toIn.value }); };
    cust.append(el('desk-filt-lbl', tr('From')), fromIn, el('desk-filt-lbl', tr('To')), toIn, applyB);
    m.appendChild(cust);
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 236)) + 'px';
    m.style.top = (r.bottom + 4) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  };
  btn.onclick = () => (menu ? close() : open());

  /** @param {any} tMs */
  const matches = (tMs) => { const { fromMs, toMs } = rangeBounds(range); const t = Number(tMs); return (fromMs == null || t >= fromMs) && (toMs == null || t < toMs); };
  return { btn, matches, mode: () => range.mode, label: () => rangeLabel(range), destroy: close };
}
