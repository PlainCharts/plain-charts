// @ts-check
// The Trade Desk configuration dialog: desk-wide settings that apply to every tab, organised into TABS
// (General / Stats / Colors). The window is draggable by its header (the shared makeDraggable). Changes
// re-render open tabs live (they subscribe to onDeskConfigChange). Opened by the desk bar's Configure button;
// nothing here touches the desk's own tab state.
import { t } from '../i18n/i18n.js'; // vocabulary lookup
import {
  getDeskOffsetMin,
  setDeskOffsetMin,
  fmtDeskOffsetLabel,
  getDeskBeThreshold,
  setDeskBeThreshold,
  getDeskColors,
  setDeskColors,
  DESK_COLOR_DEFAULTS,
} from './desk-config.js';
import { colorSwatch } from '../ui/colorpicker.js'; // the app's own color picker (not the native swatch)
import { makeDraggable } from '../ui/draggable.js';

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

export function openDeskConfigDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'modal open';
  const dlg = document.createElement('div');
  dlg.className = 'dialog desk-config-dlg';
  const close = () => overlay.remove();
  const head = el('lib-head');
  const x = el('lib-x', '✕');
  x.onclick = close;
  x.onpointerdown = (e) => e.stopPropagation(); // the close button is not a drag handle
  head.append(Object.assign(document.createElement('h3'), { textContent: t('Trade Desk') }), x);
  makeDraggable(dlg, head); // the shared drag-by-header (fixed positioning from the first grab)

  // ---- tab bar + panel switching ----
  const tabsBar = el('desk-config-tabs');
  const panelsWrap = document.createElement('div');
  /** @type {Record<string, HTMLElement>} */ const panels = {};
  /** @type {Record<string, HTMLElement>} */ const tabBtns = {};
  /** @param {string} k */
  const showTab = (k) =>
    Object.keys(panels).forEach((key) => {
      panels[key].classList.toggle('active', key === k);
      tabBtns[key].classList.toggle('active', key === k);
    });
  /** @param {string} key @param {string} label @param {HTMLElement} panel */
  const addTab = (key, label, panel) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'desk-config-tab';
    b.textContent = t(label);
    b.onclick = () => showTab(key);
    tabBtns[key] = b;
    tabsBar.appendChild(b);
    panel.className = 'desk-config-panel';
    panels[key] = panel;
    panelsWrap.appendChild(panel);
  };

  // ===== GENERAL: display timezone + breakeven threshold =====
  const gen = document.createElement('div');
  const row = el('desk-config-row');
  row.appendChild(el('desk-config-label', t('Timezone')));
  const ctl = el('desk-tz-ctl');
  const minus = document.createElement('button');
  minus.className = 'tz-step';
  minus.textContent = '−';
  minus.title = t('-1 hour');
  const val = el('desk-tz-val');
  const plus = document.createElement('button');
  plus.className = 'tz-step';
  plus.textContent = '+';
  plus.title = t('+1 hour');
  const refresh = () => {
    val.textContent = fmtDeskOffsetLabel();
  };
  minus.onclick = () => {
    setDeskOffsetMin(getDeskOffsetMin() - 60);
    refresh();
  };
  plus.onclick = () => {
    setDeskOffsetMin(getDeskOffsetMin() + 60);
    refresh();
  };
  ctl.append(minus, val, plus);
  row.appendChild(ctl);
  gen.appendChild(row);
  refresh();
  // Breakeven threshold: a $ amount away from 0 defining the BE (scratch) zone. Within +/- this = breakeven;
  // above = a hit, below = a miss. Drives the Trades H/BE/M breakdown and (later) per-trade Status.
  const beRow = el('desk-config-row');
  beRow.appendChild(el('desk-config-label', t('Breakeven threshold')));
  const beCtl = el('desk-be-ctl');
  beCtl.appendChild(el('desk-be-prefix', '$'));
  const beIn = document.createElement('input');
  beIn.type = 'number';
  beIn.className = 'desk-be-in';
  beIn.min = '0';
  beIn.step = 'any';
  beIn.placeholder = '0';
  beIn.value = getDeskBeThreshold() ? String(getDeskBeThreshold()) : '';
  beIn.onchange = () => {
    setDeskBeThreshold(Number(beIn.value));
    beIn.value = getDeskBeThreshold() ? String(getDeskBeThreshold()) : '';
  };
  beCtl.appendChild(beIn);
  beRow.appendChild(beCtl);
  gen.appendChild(beRow);
  addTab('general', 'General', gen);

  // ===== COLORS: the Console journal DIRECTION tints -- OUT (app -> broker requests) and IN (broker -> app
  // replies). A native swatch per direction; changes apply live (Console subscribes to onDeskConfigChange). =====
  const colorsPanel = document.createElement('div');
  /** @type {Record<string, HTMLButtonElement>} */ const swatch = {};
  /** @param {string} key @param {string} v @returns {HTMLButtonElement} */
  const mkSwatch = (key, v) => colorSwatch(v, (nv) => setDeskColors({ [key]: nv }));
  /** @param {string} name @param {string} sub @param {string} key */
  const colorRow = (name, sub, key) => {
    const r = el('desk-color-row');
    const meta = el('desk-color-meta');
    meta.append(el('desk-color-name', t(name)), el('desk-color-sub', t(sub)));
    const sw = mkSwatch(key, getDeskColors()[key]);
    swatch[key] = sw;
    r.append(meta, sw);
    return r;
  };
  colorsPanel.append(
    el('desk-color-cat', t('Order flow')),
    colorRow('Outgoing', 'App to broker (our requests)', 'out'),
    colorRow('Incoming', 'Broker to us (their replies)', 'in'),
    el('desk-color-cat', t('Money management')),
    colorRow('Shot zone', 'Shot band', 'mmShot'),
    colorRow('Base zone', 'Base band', 'mmBase'),
    colorRow('Floor zone', 'Below origin', 'mmFloor'),
    colorRow('Stop zone', 'Max drawdown', 'mmStop'),
    colorRow('MAX level', 'Top ladder rung', 'mmMax'),
    colorRow('MID level', 'Middle ladder rung', 'mmMid'),
    colorRow('MIN level', 'Bottom ladder rung', 'mmMin'),
    colorRow('Win trade', 'Console WIN lines', 'mmWin'),
    colorRow('Loss trade', 'Console LOSS lines', 'mmLoss'),
  );
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'desk-color-reset';
  reset.textContent = t('Reset to defaults');
  // colorSwatch has no external setter, so rebuild each swatch to reflect the defaults
  reset.onclick = () => {
    setDeskColors(DESK_COLOR_DEFAULTS);
    Object.keys(DESK_COLOR_DEFAULTS).forEach((key) => {
      if (!swatch[key]) return;
      const fresh = mkSwatch(key, DESK_COLOR_DEFAULTS[key]);
      swatch[key].replaceWith(fresh);
      swatch[key] = fresh;
    });
  };
  colorsPanel.appendChild(reset);
  addTab('colors', 'Colors', colorsPanel);

  showTab('general');

  const body = el('desk-config-body');
  body.appendChild(panelsWrap);
  dlg.append(head, tabsBar, body);
  overlay.appendChild(dlg);
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  document.body.appendChild(overlay);
}
