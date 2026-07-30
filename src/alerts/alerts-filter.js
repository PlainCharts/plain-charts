// @ts-check
// The two-axis (symbol / interval) list filter shared by the alerts panel's Price and Log tabs. Each tab owns
// ONE instance: the axis state (track the active chart vs an explicit pick, mutually exclusive per axis), its
// resolution against the active chart (wanted), and the FILTER ALERTS menu rows that edit it (section). The
// tabs differ only in where their values come from (alerts vs linked log alerts) and how a row matches the
// wanted pair -- both stay at the call site.
import { t } from '../i18n/i18n.js';

/** @param {string} tag @param {string} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };
const uniq = (/** @type {any[]} */ arr) => Array.from(new Set(arr.filter(Boolean)));

export function createSymTfFilter() {
  // two ways to set each axis, mutually exclusive: "current" (track the active chart) OR an explicit pick
  let curSym = false, bySym = '';   // symbol axis: active-chart symbol, or a chosen symbol ('' = any)
  let curTf = false, byTf = '';     // interval axis: active-chart tf, or a chosen tf ('' = any)
  let expandSym = false, expandTf = false;   // whether the By-symbol / By-interval picker is open

  return {
    /** resolve the filter against the active chart -> the wanted symbol/tf (null = any)
     * @param {any} active the active pane @returns {{ sym: string|null, tf: string|null }} */
    wanted(active) {
      return {
        sym: curSym ? (active && active.symbol) : (bySym || null),
        tf: curTf ? (active && active.tfId) : (byTf || null),
      };
    },
    /**
     * Render the FILTER ALERTS rows into an open menu.
     * symbol axis: "Current symbol" checkbox + a "By symbol" dropdown (search input + present symbols).
     * interval axis: "Current time interval" checkbox + a "By interval" dropdown of only the tfs present.
     * @param {HTMLElement} m the menu element
     * @param {{ check: Function, combo: Function, opt: Function }} rows the menuRows builders of THIS menu
     * @param {{ symbols: () => string[], tfs: () => string[] }} src values present in the tab's list
     * @param {{ onChange: () => void, rebuild: () => void }} ui onChange re-renders the list; rebuild the menu
     */
    section(m, rows, src, ui) {
      const { check, combo, opt } = rows;
      check(curSym, 'Current symbol', () => { curSym = !curSym; if (curSym) bySym = ''; });
      combo('By symbol', bySym, expandSym, () => { expandSym = !expandSym; if (expandSym) expandTf = false; ui.rebuild(); });
      if (expandSym) {
        const inp = /** @type {HTMLInputElement} */ (el('input', 'dwg-inp')); inp.placeholder = t('Search symbol…');
        inp.onclick = (e) => e.stopPropagation();
        const box = el('div', 'dwg-optbox');
        const renderSyms = () => {
          box.innerHTML = '';
          const q = inp.value.trim().toLowerCase();
          opt(t('Any symbol'), !bySym, () => { bySym = ''; ui.onChange(); ui.rebuild(); }, box);
          uniq(src.symbols()).filter((/** @type {string} */ s) => !q || s.toLowerCase().includes(q)).sort()
            .forEach((/** @type {string} */ s) => opt(s, s === bySym, () => { bySym = s; curSym = false; ui.onChange(); ui.rebuild(); }, box));
        };
        inp.oninput = renderSyms;
        m.append(inp, box); renderSyms();
        setTimeout(() => inp.focus(), 0);
      }
      check(curTf, 'Current time interval', () => { curTf = !curTf; if (curTf) byTf = ''; });
      combo('By interval', byTf, expandTf, () => { expandTf = !expandTf; if (expandTf) expandSym = false; ui.rebuild(); });
      if (expandTf) {
        opt(t('Any interval'), !byTf, () => { byTf = ''; ui.onChange(); ui.rebuild(); });
        uniq(src.tfs()).forEach((/** @type {string} */ tf) => opt(tf, tf === byTf, () => { byTf = tf; curTf = false; ui.onChange(); ui.rebuild(); }));
      }
    },
  };
}
