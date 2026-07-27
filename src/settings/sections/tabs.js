// @ts-check
// Settings -> Tabs section (Tier 3 of the chart-dialog de-monolith). What each tab's title shows
// (Ticker / Last price / Price change %), toggleable + drag-to-reorder, plus the Electron-only
// auto-restore switch. Persisted globally; the tab strip re-renders live. Imports its own deps.
import { getSetting, setSetting } from '../settings.js';
import { bus } from '../../bus.js';
import { t } from '../../i18n/i18n.js';   // vocabulary lookup

/** @type {Record<string, string>} */
const TAB_TITLE_PARTS = { ticker: 'Ticker', last: 'Last price', change: 'Price change %' };

/** @typedef {{ key: string, on?: boolean }} TabTitlePart */

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section } = ctx;
  // Electron only: restore the whole desktop (windows, positions, tab distribution, symbols +
  // intervals) on next launch. Flips desktop.json's autoRestore (owned by the main process).
  const desktop = (typeof window !== 'undefined' && window.desktop && window.desktop.isDesktop) ? window.desktop : null;
  if (desktop) {
    section('ON STARTUP');
    const r = document.createElement('div'); r.className = 'sd-row';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = getSetting('autoRestore') !== false;
    chk.onchange = () => { setSetting('autoRestore', chk.checked); desktop.setAutoRestore(chk.checked); };
    const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t('Auto-restore tickers and intervals');
    r.append(chk, l);
    content.appendChild(r);
  }

  section('TAB TITLE (DRAG TO REORDER)');
  // start from the saved order, then append any missing known parts (default on)
  /** @type {TabTitlePart[]} */
  let cfg = Array.isArray(getSetting('tabTitle')) ? getSetting('tabTitle').slice() : [];
  Object.keys(TAB_TITLE_PARTS).forEach((k) => { if (!cfg.find((c) => c.key === k)) cfg.push({ key: k, on: true }); });
  cfg = cfg.filter((c) => TAB_TITLE_PARTS[c.key]);
  const save = () => { setSetting('tabTitle', cfg); bus.emit('tabs:title'); };

  const wrap = document.createElement('div');
  /** @type {string | null} */
  let dragKey = null;
  const draw = () => {
    wrap.innerHTML = '';
    cfg.forEach((c) => {
      const row = document.createElement('div'); row.className = 'sd-row tt-row'; row.draggable = true;
      const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = c.on !== false;
      chk.onchange = () => { c.on = chk.checked; save(); };
      const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(TAB_TITLE_PARTS[c.key]);
      const grip = document.createElement('span'); grip.className = 'tt-grip'; grip.textContent = '⠿';
      row.append(chk, l, grip);
      row.ondragstart = () => { dragKey = c.key; row.classList.add('tt-drag'); };
      row.ondragend = () => row.classList.remove('tt-drag');
      row.ondragover = (e) => e.preventDefault();
      row.ondrop = (e) => {
        e.preventDefault();
        if (!dragKey || dragKey === c.key) return;
        const from = cfg.findIndex((x) => x.key === dragKey), to = cfg.findIndex((x) => x.key === c.key);
        const [m] = cfg.splice(from, 1); cfg.splice(to, 0, m); dragKey = null; save(); draw();
      };
      wrap.appendChild(row);
    });
  };
  draw();
  content.appendChild(wrap);
}
