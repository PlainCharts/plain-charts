// @ts-check
// Chart-type dialog: pick how something draws price - Candles (OHLC) or Line. It is
// driven by a "target" so the same dialog serves the main pane AND a compare overlay:
//
//   target = {
//     title,                       // dialog header text
//     getType()/setType(t),        // 'candles' | 'line'
//     getSource()/setSource(s),    // price source key (see pane PRICE_SOURCE_OPTIONS)
//     line: { color:{get,set}, width:{get,set}, lineStyle:{get,set} },  // strokeSwatch api
//   }
//
// The main pane opens it via the toolbar button; the compare overlay opens it by emitting
// 'charttype:open' on the bus with its own target. Changes apply live (the target's setters
// persist via the workspace).
import { $ } from '../dom.js';
import { bus } from '../bus.js';
import { getActivePane } from '../chart/layout.js';
import { strokeSwatch, colorSwatch } from '../ui/colorpicker.js';
import { PRICE_SOURCE_OPTIONS } from '../chart/pane.js';
import { t } from '../i18n/i18n.js';

/**
 * A get/set accessor pair over one value.
 * @typedef {{ get: () => any, set: (v: any) => void }} Accessor
 */
/**
 * The dialog "target": the same dialog serves the main pane and a compare overlay,
 * so all state is reached through the target's accessors.
 * @typedef {Object} ChartTypeTarget
 * @property {string} [title]                       dialog header text
 * @property {() => string} getType                 'candles' | 'line'
 * @property {(t: string) => void} setType
 * @property {() => string} getSource               price source key
 * @property {(s: string) => void} setSource
 * @property {{ color: Accessor, width?: Accessor, lineStyle?: Accessor }} line   strokeSwatch api
 * @property {{ high: Accessor, low: Accessor }} [hl]   optional High/Low quick-toggle colours
 */

/**
 * @param {string} tag
 * @param {string|null} [cls]
 * @param {string|null} [txt]
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

/** @type {HTMLElement|null} */
let overlay = null;
/** @type {HTMLElement|null} */
let titleEl = null;
/** @type {HTMLSelectElement|null} */
let typeSel = null;
/** @type {HTMLElement|null} */
let lineWrap = null;
/** @type {HTMLSelectElement|null} */
let srcSel = null;
/** @type {HTMLElement|null} */
let strokeHost = null;
/** @type {HTMLElement|null} */
let hlHost = null;
/** @type {HTMLElement|null} */
let hlRow = null;
/** @type {((e: KeyboardEvent) => void)|null} */
let onKey = null;
/** @type {ChartTypeTarget|null} */
let target = null;

function build() {
  if (overlay) return;
  overlay = el('div', 'modal');
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  const dlg = el('div', 'dialog ct-dialog');

  const head = el('div', 'conn-head');
  titleEl = el('span', null, t('Chart type'));
  const x = el('span', 'lib-x', '✕'); x.onclick = close;
  head.append(titleEl, x);

  const body = el('div', 'ct-body');

  const typeRow = el('div', 'ct-row'); typeRow.append(el('label', null, t('Type')));
  typeSel = /** @type {HTMLSelectElement} */ (el('select', 'ct-select'));
  [['candles', 'Candles (OHLC)'], ['line', 'Line']].forEach(([v, l]) => { const o = /** @type {HTMLOptionElement} */ (el('option', null, t(l))); o.value = v; /** @type {HTMLSelectElement} */ (typeSel).appendChild(o); });
  typeSel.onchange = () => { const sel = /** @type {HTMLSelectElement} */ (typeSel); if (target) target.setType(sel.value); syncVisibility(); };
  typeRow.append(typeSel);

  lineWrap = el('div', 'ct-line');
  lineWrap.append(el('div', 'ct-sec', t('LINE')));
  const srcRow = el('div', 'ct-row'); srcRow.append(el('label', null, t('Price source')));
  srcSel = /** @type {HTMLSelectElement} */ (el('select', 'ct-select'));
  PRICE_SOURCE_OPTIONS.forEach((/** @type {[string, string]} */ [v, l]) => { const o = /** @type {HTMLOptionElement} */ (el('option', null, t(l))); o.value = v; /** @type {HTMLSelectElement} */ (srcSel).appendChild(o); });
  srcSel.onchange = () => { const sel = /** @type {HTMLSelectElement} */ (srcSel); if (target) target.setSource(sel.value); };
  srcRow.append(srcSel); lineWrap.append(srcRow);

  const lineRow = el('div', 'ct-row'); lineRow.append(el('label', null, t('Line')));
  strokeHost = el('span', 'ct-stroke-host'); lineRow.append(strokeHost); lineWrap.append(lineRow);

  // High/Low quick-toggle colours (only shown when the target supports them -- compare panes)
  hlRow = el('div', 'ct-row ct-hl'); hlRow.append(el('label', null, t('High / Low')));
  hlHost = el('span', 'ct-hl-host'); hlRow.append(hlHost); lineWrap.append(hlRow);

  body.append(typeRow, lineWrap);
  dlg.append(head, body);
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);

  makeDraggable(dlg, head);
}

// the stroke control binds to the current target, so rebuild it each open
function buildStroke() {
  const sHost = /** @type {HTMLElement} */ (strokeHost);
  const hHost = /** @type {HTMLElement} */ (hlHost);
  const hRow = /** @type {HTMLElement} */ (hlRow);
  sHost.innerHTML = '';
  if (!target) return;
  sHost.appendChild(strokeSwatch(target.line));
  // High/Low toggle colours -- only when the target provides them (compare panes)
  hHost.innerHTML = '';
  if (target.hl) {
    const hl = target.hl;
    hHost.append(
      el('span', 'ct-hl-lbl', t('H')), colorSwatch(hl.high.get(), (/** @type {any} */ v) => hl.high.set(v)),
      el('span', 'ct-hl-lbl', t('L')), colorSwatch(hl.low.get(), (/** @type {any} */ v) => hl.low.set(v)),
    );
    hRow.style.display = '';
  } else {
    hRow.style.display = 'none';
  }
}

function syncVisibility() { /** @type {HTMLElement} */ (lineWrap).style.display = (target && target.getType() === 'line') ? 'block' : 'none'; }

/** @param {ChartTypeTarget} tg */
export function openChartTypeDialog(tg) {
  if (!tg) return;
  build();
  target = tg;
  /** @type {HTMLElement} */ (titleEl).textContent = tg.title || t('Chart type');
  /** @type {HTMLSelectElement} */ (typeSel).value = tg.getType();
  /** @type {HTMLSelectElement} */ (srcSel).value = tg.getSource();
  buildStroke();
  syncVisibility();
  /** @type {HTMLElement} */ (overlay).classList.add('open');
  onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}

function close() {
  if (overlay) overlay.classList.remove('open');
  if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
}

// drag the dialog by its header. Seeds left/top from the current (centered) position on
// grab so it doesn't jump, then follows the pointer (clamped to the viewport).
/** @param {HTMLElement} box @param {HTMLElement} handle */
function makeDraggable(box, handle) {
  handle.style.cursor = 'move';
  /** @type {{ dx: number, dy: number }|null} */
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    const et = /** @type {HTMLElement} */ (e.target);
    if (et.closest('.lib-x')) return;   // let the close button work
    const r = box.getBoundingClientRect();
    box.style.position = 'fixed'; box.style.margin = '0';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    box.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx)) + 'px';
    box.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy)) + 'px';
  });
  handle.addEventListener('pointerup', () => { drag = null; });
}

export function initChartType() {
  const btn = $('btnCandles');
  if (btn) btn.onclick = () => { const p = getActivePane(); if (p) openChartTypeDialog(p.chartTypeTarget()); };
  // compare overlay (and anything else) opens the same dialog with its own target
  bus.on('charttype:open', (/** @type {ChartTypeTarget} */ tg) => openChartTypeDialog(tg));
}
