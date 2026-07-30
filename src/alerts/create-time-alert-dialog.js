// @ts-check
// The CREATE / EDIT TIME-ALERT dialog -- a deliberately small sibling of the price-alert dialog. A time alert
// has no symbol/tf/conditions; it fires on a SCHEDULE. So the form is just: When (a clock time + Daily, or a
// one-shot date) · Message · Actions. It reuses the shared actionsControl (so a time alert can play a sound /
// show a popup / send email, same as a price alert) and funnels a `source:'time'` draft to the alert-host (the
// only writer). Clock times are wall-clock in the ALERT timezone -- the same tz the host schedules and the Log show.
import { t } from '../i18n/i18n.js';
import { el, field, actionsControl } from './dialog-controls.js';
import { alertCommand } from './funnel.js';
import { alertTzOffsetMin, alertHours24 } from './alert-display.js';
import { openDateTimePicker } from '../ui/datetime-picker.js'; // our themed calendar (date-only here)
import { segTime } from '../tools/engine/coord-inputs.js'; // themed segmented HH:MM field (type it, no native spinner)

/** @type {HTMLElement | null} */
let panel = null;

export function closeCreateTimeAlertDialog() {
  if (panel) {
    panel.remove();
    panel = null;
  }
}

/**
 * Open the small time-alert dialog. Pass an existing time alert to EDIT it (prefilled, saves an update);
 * pass nothing to CREATE a new one. A time alert is self-contained -- no chart, no symbol.
 * @param {any} [existing]
 */
export function openCreateTimeAlertDialog(existing) {
  closeCreateTimeAlertDialog();
  const editing = !!(existing && existing.id);
  const tzOff = alertTzOffsetMin();
  const p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const wall = (/** @type {number} */ ms) => new Date(ms + tzOff * 60000); // alert-tz wall clock (read with UTC getters)
  const hhmm = (/** @type {Date} */ d) => p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  const ymd = (/** @type {Date} */ d) => d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  const nowTz = wall(Date.now());
  // Prefill from the existing schedule when editing; sensible defaults (daily, now) when creating.
  const sch = editing ? existing.schedule || {} : {};
  const onceAt = sch.kind === 'once' && typeof sch.at === 'number' ? wall(sch.at) : null;
  const initTime = sch.time ? sch.time : onceAt ? hhmm(onceAt) : hhmm(nowTz);
  const initDate = onceAt ? ymd(onceAt) : ymd(nowTz);
  const initFreq = editing ? (sch.kind === 'once' ? 'once' : sch.kind === 'weekly' ? 'weekly' : 'daily') : 'daily';

  const dlg = el('div', 'dialog alert-dlg alert-dlg-time');
  panel = dlg;
  dlg.style.zIndex = '72';

  // ---- header
  const head = el('div', 'aldlg-head');
  head.append(el('div', 'aldlg-title', t(editing ? 'Edit time alert' : 'Create time alert')));
  const x = el('span', 'lib-x', '✕');
  x.onclick = closeCreateTimeAlertDialog;
  head.appendChild(x);
  dlg.appendChild(head);

  // ---- When: a clock time + a date. Time is our segmented HH:MM field (typed, no native spinner), in the
  // in-app 24/12h format; the date field is a read-only box that opens OUR themed calendar (date-only) on click.
  // The Freq. row below drives whether the date matters.
  const [ih, imi] = initTime.split(':').map(Number);
  const cur = { h: ih || 0, mi: imi || 0 };
  const timeWidget = segTime(
    alertHours24(),
    (p) => {
      cur.h = p.h;
      cur.mi = p.mi;
    },
    { seconds: false },
  );
  timeWidget.el.classList.add('aldlg-in-time'); // sizing marker; the field frame comes from .aldlg-when .seg-time
  timeWidget.set({ h: cur.h, mi: cur.mi, s: 0 });
  // 1-minute roller: up/down arrows inside the time box. Minutes roll continuously -- 59↑ carries into the hour
  // (and 23:59 → 00:00), 00↓ borrows back. This stepper is scoped to this dialog, not the shared segTime.
  const roll = (/** @type {number} */ d) => {
    let m = cur.mi + d,
      h = cur.h;
    if (m > 59) {
      m = 0;
      h = (h + 1) % 24;
    } else if (m < 0) {
      m = 59;
      h = (h + 23) % 24;
    }
    cur.mi = m;
    cur.h = h;
    timeWidget.set({ h, mi: m, s: 0 });
  };
  const spin = el('span', 'aldlg-time-spin');
  const spinBtn = (/** @type {string} */ glyph, /** @type {number} */ d) => {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'aldlg-spin', glyph));
    b.type = 'button';
    b.onclick = () => roll(d);
    return b;
  };
  spin.append(spinBtn('▲', 1), spinBtn('▼', -1));
  timeWidget.el.appendChild(spin);
  const dateIn = /** @type {HTMLInputElement} */ (el('input', 'aldlg-in aldlg-in-date'));
  dateIn.type = 'text';
  dateIn.readOnly = true;
  dateIn.value = initDate;
  dateIn.style.cursor = 'pointer';
  dateIn.onclick = () => {
    if (dateIn.disabled) return;
    const [y, m, d] = (dateIn.value || initDate).split('-').map(Number);
    openDateTimePicker({
      time: false,
      title: t('Pick your date'),
      value: new Date(y, (m || 1) - 1, d || 1).getTime(),
      onSet: (ms) => {
        const dt = new Date(ms);
        dateIn.value = dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate());
      },
    });
  };
  const whenRow = el('div', 'aldlg-when');
  whenRow.append(timeWidget.el, dateIn);

  // ---- Freq.: Once (one-shot on the date) | Daily (every day) | Weekly (every week on the date's weekday).
  // Daily has no fixed date, so the date field is disabled then; Once/Weekly use the date.
  const freqSel = /** @type {HTMLSelectElement} */ (el('select', 'aldlg-sel aldlg-freq'));
  /** @type {[string, string][]} */
  ([
    ['once', 'Once'],
    ['daily', 'Daily'],
    ['weekly', 'Weekly'],
  ]).forEach(([v, label]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t(label);
    freqSel.appendChild(o);
  });
  freqSel.value = initFreq;
  const syncDateEnabled = () => {
    dateIn.disabled = freqSel.value === 'daily';
  };
  freqSel.onchange = syncDateEnabled;
  syncDateEnabled();

  // ---- Message (plain reminder text -- no price/symbol placeholders; a time alert has none)
  const msgIn = /** @type {HTMLTextAreaElement} */ (el('textarea', 'aldlg-in aldlg-msg-short'));
  msgIn.rows = 3;
  msgIn.spellcheck = false;
  msgIn.placeholder = t('Reminder message…');
  msgIn.value = editing ? existing.message || '' : '';

  // ---- Actions (the same table price alerts use: toast / popup / sound / email / telegram / …)
  const actions = actionsControl(editing ? existing.actions : undefined);

  const body = el('div', 'aldlg-body');
  // Actions has no label -- the widget spans the full dialog width (its own "Action" header carries the name).
  body.append(field(t('When'), whenRow), field(t('Freq.'), freqSel), field(t('Message'), msgIn), actions.el);
  dlg.appendChild(body);

  // ---- footer: Cancel · Create/Save
  const foot = el('div', 'aldlg-foot');
  const cancel = el('button', null, t('Cancel'));
  cancel.onclick = closeCreateTimeAlertDialog;
  const submit = el('button', 'primary', t(editing ? 'Save' : 'Create'));
  submit.onclick = () => {
    const time = p2(cur.h) + ':' + p2(cur.mi); // segmented field -> "HH:MM" (24h) for the schedule
    const freq = freqSel.value;
    /** @type {any} */ let schedule;
    let label;
    if (freq === 'daily') {
      schedule = { kind: 'daily', time };
      label = t('Daily') + ' ' + time;
    } else if (freq === 'weekly') {
      const [Y, M, D] = (dateIn.value || initDate).split('-').map(Number);
      const wd = new Date(Y, (M || 1) - 1, D || 1).getDay(); // 0=Sun..6=Sat, the weekday of the chosen date
      schedule = { kind: 'weekly', days: [wd], time };
      label = t('Weekly') + ' ' + time;
    } else {
      const [Y, M, D] = (dateIn.value || initDate).split('-').map(Number);
      const [H, Mi] = time.split(':').map(Number);
      const at = Date.UTC(Y, (M || 1) - 1, D || 1, H || 0, Mi || 0) - tzOff * 60000; // the instant, in the alert tz
      schedule = { kind: 'once', at };
      label = (dateIn.value || initDate) + ' ' + time;
    }
    const message = msgIn.value.trim();
    const fields = { source: 'time', name: message || label, schedule, message, actions: actions.get() };
    if (editing) {
      // UPDATE: patch the record and reset the fired latch (rt) so the new schedule re-arms cleanly. `enabled`
      // is left untouched (the merge preserves it) -- the row's play/pause owns that.
      alertCommand('update', { id: existing.id, patch: { ...fields, rt: {} } }).catch((err) =>
        console.error('[alert] update time alert failed', err),
      );
    } else {
      alertCommand('create', { ...fields, enabled: true }).catch((err) =>
        console.error('[alert] create time alert failed', err),
      );
    }
    closeCreateTimeAlertDialog();
  };
  foot.append(cancel, submit);
  dlg.appendChild(foot);

  document.body.appendChild(dlg);

  // float + drag by the header (same gesture as the price-alert dialog)
  dlg.style.position = 'fixed';
  dlg.style.margin = '0';
  dlg.style.left = Math.max(8, (window.innerWidth - dlg.offsetWidth) / 2) + 'px';
  dlg.style.top = Math.max(8, (window.innerHeight - dlg.offsetHeight) / 3) + 'px';
  /** @type {{ dx: number, dy: number } | null} */
  let drag = null;
  head.style.cursor = 'move';
  head.addEventListener('pointerdown', (e) => {
    if (/** @type {Element} */ (e.target).closest('.lib-x')) return;
    drag = { dx: e.clientX - dlg.offsetLeft, dy: e.clientY - dlg.offsetTop };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dlg.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx)) + 'px';
    dlg.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy)) + 'px';
  });
  head.addEventListener('pointerup', () => {
    drag = null;
  });

  const firstSeg = /** @type {HTMLInputElement|null} */ (timeWidget.el.querySelector('input'));
  if (firstSeg) firstSeg.focus();
}
