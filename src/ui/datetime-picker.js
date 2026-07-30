// @ts-check
// Universal date + time picker — a small modal with a YYYY-MM-DD field, an HH:MM segmented time
// field, a month calendar grid (Monday-first, prev/next nav, click a day to select), and a
// "Set <date>" confirm button. Theme-driven, self-contained, reusable anywhere.
//
// It works in plain LOCAL wall-clock time (no chart-timezone coupling): `value` in and the
// value passed to onSet() are epoch milliseconds interpreted with the browser's local time, so a
// caller that needs another zone converts on its side. Reuses the segmented time input and the
// date-string helpers from the drawing coord-inputs (all pure).
//
//   openDateTimePicker({ value, h24, title, onSet, onCancel })
//
import { segTime, fmtDateField, parseDateField } from '../tools/engine/coord-inputs.js';
import { t } from '../i18n/i18n.js';

/** @param {string} tag @param {string | null} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

const SVG_CAL =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6h12M5 2v2M11 2v2"/></svg>';
const SVG_CLOCK =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.4"/></svg>';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

// Long human label for a timestamp, e.g. "August 18, 2026 at 23:48" (localized month + "at").
/** @param {number} ms  epoch ms (local) @param {boolean} [h24] @returns {string} */
export function formatDateTime(ms, h24 = true) {
  const d = new Date(ms);
  let time;
  if (h24) time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  else {
    const h = d.getHours();
    time = (h % 12 || 12) + ':' + pad2(d.getMinutes()) + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  return t(MONTHS[d.getMonth()]) + ' ' + d.getDate() + ', ' + d.getFullYear() + ' ' + t('at') + ' ' + time;
}

/** @param {number} y @param {number} mo @returns {number} days in a 0-based month */
const daysInMonth = (y, mo) => new Date(y, mo + 1, 0).getDate();
/** @param {number} y @param {number} mo @returns {number} Monday-first index (0=Mon..6=Sun) of the 1st */
const firstDowMon = (y, mo) => (new Date(y, mo, 1).getDay() + 6) % 7;

/** @type {HTMLElement | null} */
let overlay = null;

export function closeDateTimePicker() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

/**
 * @typedef {Object} DateTimePickerOpts
 * @property {number} [value]      initial time, epoch ms (local). Defaults to now.
 * @property {boolean} [h24]       24-hour time field (default true).
 * @property {boolean} [time]      show the segmented time field (default true). false = date-only picker.
 * @property {string} [title]      header title (default "Set custom date").
 * @property {(ms: number) => void} onSet    called with the chosen epoch ms (local) on confirm.
 * @property {() => void} [onCancel]         called when dismissed without confirming.
 */

/**
 * Open the date+time picker.
 * @param {DateTimePickerOpts} opts
 */
export function openDateTimePicker(opts) {
  closeDateTimePicker();
  const init = new Date(opts.value != null ? opts.value : Date.now());
  const h24 = opts.h24 !== false;
  const showTime = opts.time !== false; // date-only when false (the caller has its own time field)
  // selected date (y/mo/d) + time (h/mi) + the month currently shown in the grid
  const sel = { y: init.getFullYear(), mo: init.getMonth(), d: init.getDate() };
  const time = { h: init.getHours(), mi: init.getMinutes(), s: 0 };
  const view = { y: sel.y, mo: sel.mo };

  overlay = el('div', 'modal open');
  overlay.style.zIndex = '90';
  const cancel = () => {
    closeDateTimePicker();
    if (opts.onCancel) opts.onCancel();
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) cancel();
  };
  const dlg = el('div', 'dialog dtp-dlg');

  // ---- header: ‹ back + title
  const head = el('div', 'dtp-head');
  const back = el('span', 'dtp-back', '‹');
  back.onclick = cancel;
  head.append(back, el('span', 'dtp-title', opts.title || t('Set custom date')));
  dlg.appendChild(head);

  // ---- inputs row: date field + time field
  const io = el('div', 'dtp-io');
  const dateIn = /** @type {HTMLInputElement} */ (el('input', 'dtp-in'));
  dateIn.type = 'text';
  dateIn.spellcheck = false;
  const dateField = el('div', 'dtp-field');
  dateField.append(
    dateIn,
    (() => {
      const s = el('span', 'dtp-ico');
      s.innerHTML = SVG_CAL;
      return s;
    })(),
  );
  const timeWidget = segTime(
    h24,
    (p) => {
      time.h = p.h;
      time.mi = p.mi;
      time.s = 0;
    },
    { seconds: false },
  );
  const timeField = el('div', 'dtp-field dtp-time');
  timeField.append(
    timeWidget.el,
    (() => {
      const s = el('span', 'dtp-ico');
      s.innerHTML = SVG_CLOCK;
      return s;
    })(),
  );
  io.append(dateField);
  if (showTime) io.append(timeField); // date-only pickers omit the time field
  dlg.appendChild(io);

  // ---- calendar
  const cal = el('div', 'dtp-cal');
  const calHead = el('div', 'dtp-cal-head');
  const prev = el('span', 'dtp-nav', '‹');
  const monthLbl = el('span', 'dtp-month');
  const next = el('span', 'dtp-nav', '›');
  calHead.append(prev, monthLbl, next);
  const grid = el('div', 'dtp-grid');
  cal.append(calHead, grid);
  dlg.appendChild(cal);

  // ---- footer: Set <date>
  const foot = el('div', 'dtp-foot');
  const setBtn = /** @type {HTMLButtonElement} */ (el('button', 'primary dtp-set'));
  setBtn.onclick = () => {
    const ms = new Date(sel.y, sel.mo, sel.d, time.h, time.mi, 0, 0).getTime();
    closeDateTimePicker();
    opts.onSet(ms);
  };
  foot.appendChild(setBtn);
  dlg.appendChild(foot);

  const syncDateField = () => {
    dateIn.value = fmtDateField(sel);
    setBtn.textContent = t('Set') + ' ' + fmtDateField(sel);
  };

  const renderGrid = () => {
    monthLbl.textContent = t(MONTHS[view.mo]) + ' ' + view.y;
    grid.innerHTML = '';
    WEEKDAYS.forEach((w) => grid.appendChild(el('div', 'dtp-wd', t(w))));
    const lead = firstDowMon(view.y, view.mo);
    for (let i = 0; i < lead; i++) grid.appendChild(el('div', 'dtp-day blank'));
    const n = daysInMonth(view.y, view.mo);
    for (let day = 1; day <= n; day++) {
      const isSel = view.y === sel.y && view.mo === sel.mo && day === sel.d;
      const c = el('div', 'dtp-day' + (isSel ? ' sel' : ''), String(day));
      c.onclick = () => {
        sel.y = view.y;
        sel.mo = view.mo;
        sel.d = day;
        syncDateField();
        renderGrid();
      };
      grid.appendChild(c);
    }
  };

  /** @param {number} delta */
  const stepMonth = (delta) => {
    const m = view.mo + delta;
    view.y += Math.floor(m / 12);
    view.mo = ((m % 12) + 12) % 12;
    renderGrid();
  };
  prev.onclick = () => stepMonth(-1);
  next.onclick = () => stepMonth(1);

  // typing a valid date jumps the selection + visible month
  dateIn.onchange = () => {
    const p = parseDateField(dateIn.value);
    if (!p) {
      syncDateField();
      return;
    }
    sel.y = p.y;
    sel.mo = p.mo;
    sel.d = Math.min(p.d, daysInMonth(p.y, p.mo));
    view.y = sel.y;
    view.mo = sel.mo;
    syncDateField();
    renderGrid();
  };
  dateIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') dateIn.blur();
  });

  if (showTime) timeWidget.set(time);
  syncDateField();
  renderGrid();

  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
}
