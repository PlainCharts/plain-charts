// @ts-check
// Console surface — a log viewer that fills a tab. Two lenses over the shared log stream:
//   Journal — app + broker/server events         Addons — addon activity
// Live-tails the log (auto-scroll when pinned to the bottom), with a filter and a Clear button.
import { platform } from '../../data_engine/index.js';
import { fmtDeskClock, onDeskConfigChange, getDeskColors } from './desk-config.js';
import { t } from '../i18n/i18n.js'; // vocabulary lookup (log message text stays runtime data)

/** @typedef {import('../../data_engine/index.js').ConsoleEntry} ConsoleEntry */

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};
// timestamps render in the desk's display timezone (Configure -> Timezone)
const hhmmss = fmtDeskClock;
/** @type {[string, string][]} */
const FILTERS = [
  ['all', 'All'],
  ['journal', 'Journal'],
  ['addon', 'Addons'],
];
/** @param {ConsoleEntry} e @param {string} f */
const passes = (e, f) => f === 'all' || (f === 'addon' ? e.cat === 'addon' : e.cat !== 'addon');

/** @param {HTMLElement} root @param {{ filter?: string }} [cfg] */
export function mountConsole(root, cfg = {}) {
  root.innerHTML = '';
  const wrap = el('surface console');
  let filter = /** @type {string} */ (FILTERS.some(([k]) => k === cfg.filter) ? cfg.filter : 'all');

  // --- header: filter tabs + spacer + Clear ---
  const head = el('console-head');
  /** @type {Record<string, HTMLButtonElement>} */
  const tabs = {};
  FILTERS.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'console-tab';
    b.textContent = t(label);
    b.onclick = () => {
      filter = k;
      syncTabs();
      renderAll();
    };
    tabs[k] = b;
    head.appendChild(b);
  });
  const spacer = el('console-spacer');
  head.appendChild(spacer);
  const clearBtn = document.createElement('button');
  clearBtn.className = 'console-clear';
  clearBtn.textContent = t('Clear');
  clearBtn.onclick = () => platform.console.clear();
  head.appendChild(clearBtn);
  const syncTabs = () => FILTERS.forEach(([k]) => tabs[k].classList.toggle('active', k === filter));
  syncTabs();

  // --- scrolling table --- a TABLE (not a grid of divs) so a row copies as ONE line (cells are tab-separated
  // on copy, rows newline-separated) while columns still align and the message wraps within its own column.
  const list = el('console-list'); // scroll container
  const table = document.createElement('table');
  table.className = 'console-table';
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  list.appendChild(table);
  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  /** @param {string} cls @param {string} [txt] */
  const td = (cls, txt) => {
    const d = document.createElement('td');
    d.className = cls;
    if (txt != null) d.textContent = txt;
    return d;
  };
  /** @param {ConsoleEntry} e */
  const rowFor = (e) => {
    // DIRECTION: 'out' = app -> broker (we sent it), 'in' = broker -> app (their reply). Colours the whole row so the
    // two streams separate at a glance; level (error/warn) still overrides the tint (a reject stays red).
    const dir = e.dir === 'out' || e.dir === 'in' ? e.dir : '';
    const tr = document.createElement('tr');
    tr.className =
      'console-row ' +
      (dir ? 'dir-' + dir + ' ' : '') +
      (e.level === 'error' ? 'lvl-error' : e.level === 'warn' ? 'lvl-warn' : '');
    const cat = e.cat === 'addon' ? 'addon' : 'journal';
    const dirTd = td('console-dir');
    if (dir) dirTd.appendChild(el('dir-chip dir-' + dir, dir === 'out' ? t('OUT') : t('IN')));
    const catTd = td('console-cat');
    const chip = el('cat-chip cat-' + cat, t(cat));
    catTd.appendChild(chip);
    tr.append(td('console-time', hhmmss(e.t)), dirTd, catTd, td('console-src', e.src || ''), td('console-msg', e.msg));
    return tr;
  };
  /** @param {ConsoleEntry} e */
  const append = (e) => {
    const stick = atBottom();
    tbody.appendChild(rowFor(e));
    while (tbody.childElementCount > 2000) tbody.removeChild(/** @type {Node} */ (tbody.firstChild));
    if (stick) list.scrollTop = list.scrollHeight;
  };
  const renderAll = () => {
    tbody.innerHTML = '';
    platform.console.history().forEach((e) => {
      if (passes(e, filter)) tbody.appendChild(rowFor(e));
    });
    list.scrollTop = list.scrollHeight;
  };

  // push the user's OUT/IN direction colours to CSS vars the console rows read (Trade Desk > Colors edits them).
  const applyColors = () => {
    const c = getDeskColors();
    const s = document.documentElement.style;
    s.setProperty('--dir-out', c.out);
    s.setProperty('--dir-in', c.in);
  };

  wrap.append(head, list);
  root.appendChild(wrap);
  applyColors();
  renderAll();

  const off = platform.console.subscribe((e) => {
    if (passes(e, filter)) append(e);
  }, renderAll);
  const offTz = onDeskConfigChange(() => {
    applyColors();
    renderAll();
  }); // desk config changed -> re-apply colours + re-render timestamps

  return {
    destroy() {
      try {
        off();
      } catch (_) {}
      try {
        offTz();
      } catch (_) {}
      root.innerHTML = '';
    },
    state() {
      return { filter };
    }, // round-trips in the tab's workspace
  };
}
