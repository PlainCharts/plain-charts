// @ts-check
// Shared dwg-menu ROW builders for the alerts panel's dropdowns (the ⋯ More menu and the Log ⋯ menu). Each
// builder appends one styled row to the menu element and wires its click; the two menus differ only in their
// render/rebuild callbacks, so they pass those in. DOM-only — no panel state lives here.
import { t } from '../i18n/i18n.js';
import { setAlertDisplay } from './alert-display.js';

/** @param {string} tag @param {string} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

/**
 * The row helpers bound to one menu element.
 * @param {HTMLElement} m the menu the rows are appended to
 * @param {{ render: () => void, rerender: () => void, close: () => void }} ctx
 *   render = re-render the alerts list; rerender = rebuild THIS menu; close = dismiss the menu.
 */
export function menuRows(m, { render, rerender, close }) {
  /** an action row (glyph + label); disabled when `on` is false. @param {string} glyph @param {string} label @param {boolean} on @param {() => void} run */
  const item = (glyph, label, on, run) => {
    const it = el('div', 'dwg-item' + (on ? '' : ' disabled'));
    it.append(el('span', 'dwg-check', glyph), el('span', 'dwg-label', t(label)));
    if (on) it.onclick = () => { close(); run(); };
    m.appendChild(it);
  };
  /** a checkbox filter row (☑/☐). @param {boolean} on @param {string} label @param {() => void} toggle */
  const check = (on, label, toggle) => {
    const it = el('div', 'dwg-item');
    it.append(el('span', 'dwg-check', on ? '☑' : '☐'), el('span', 'dwg-label', t(label)));
    it.onclick = () => { toggle(); render(); rerender(); };
    m.appendChild(it);
  };
  /** a combobox row: label + the current value (or "Any") + caret; click toggles its inline picker.
   * @param {string} label @param {string} value @param {boolean} open @param {() => void} toggle */
  const combo = (label, value, open, toggle) => {
    const it = el('div', 'dwg-item');
    it.append(el('span', 'dwg-label', t(label)), el('span', 'dwg-arrow', (value || t('Any')) + '  ' + (open ? '▴' : '▾')));
    it.onclick = toggle;
    m.appendChild(it);
    return it;
  };
  /** an indented option row inside a picker (appended to `parent`, default the menu).
   * @param {string} text @param {boolean} sel @param {() => void} pick @param {HTMLElement} [parent] */
  const opt = (text, sel, pick, parent) => {
    const it = el('div', 'dwg-item dwg-opt' + (sel ? ' sel' : ''));
    it.append(el('span', 'dwg-check', sel ? '✓' : ''), el('span', 'dwg-label', text));
    it.onclick = pick;
    (parent || m).appendChild(it);
  };
  /** a persisted display-pref toggle (☑/☐): setAlertDisplay fires the bus so the list re-renders.
   * @param {string} label @param {() => boolean} get @param {string} key */
  const pref = (label, get, key) => {
    const it = el('div', 'dwg-item');
    it.append(el('span', 'dwg-check', get() ? '☑' : '☐'), el('span', 'dwg-label', t(label)));
    it.onclick = () => { setAlertDisplay({ [key]: !get() }); rerender(); };
    m.appendChild(it);
  };
  return { item, check, combo, opt, pref };
}
