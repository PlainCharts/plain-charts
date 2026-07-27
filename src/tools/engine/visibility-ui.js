// Reusable Visibility panel: per-timeframe show/hide rows (an enable checkbox + a min..max range with a
// custom dual-handle slider) over the bar count for each unit. Shared by the drawing settings dialog and
// the Trading (executions) settings. Renders into a `visibility` object
//   { minutes:{on,min,max}, hours:{…}, days:{…}, weeks:{…}, months:{…} }
// (see visibility.js for the semantics + visibleOnTf). onChange() fires on any edit so the caller previews.
// @ts-check
import { VIS_CATEGORIES } from './visibility.js';

/** @typedef {import('./visibility.js').VisCat} VisCat */
/** @typedef {import('./visibility.js').VisCategory} VisCategory */
/** @typedef {import('./visibility.js').Visibility} Visibility */
// A fully-populated rule row: buildVisibilityRows seeds on/min/max before any row is built.
/** @typedef {{ on: boolean, min: number, max: number }} VisRule */

/** @param {string} tag @param {string|null} [cls] @param {string|null} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

/**
 * @param {VisRule} c    the category's rule object (mutated in place as the user edits)
 * @param {VisCategory} cat   the row descriptor (name + full min/max range)
 * @param {() => void} onChange
 * @returns {HTMLElement}
 */
export function buildVisRow(c, cat, onChange) {
  const r = el('div', 'set-vis-row');

  const head = el('div', 'set-vis-head');
  const chk = /** @type {HTMLInputElement} */ (el('input')); chk.type = 'checkbox'; chk.checked = c.on !== false;
  const ctrls = el('div', 'set-vis-ctrls');
  const sync = () => { ctrls.style.opacity = chk.checked ? '1' : '.4'; ctrls.style.pointerEvents = chk.checked ? '' : 'none'; };
  chk.onchange = () => { c.on = chk.checked; onChange(); sync(); };
  head.append(chk, el('label', null, cat.name));
  r.appendChild(head);

  // Custom dual-handle slider: plain divs positioned inside the track (a native range thumb overflows).
  const slider = el('div', 'set-vis-slider');
  const track = el('div', 'set-vis-track');
  const fill = el('div', 'set-vis-fill');
  const loH = el('div', 'set-vis-handle');
  const hiH = el('div', 'set-vis-handle');
  track.append(fill, loH, hiH);
  slider.appendChild(track);

  const minIn = /** @type {HTMLInputElement} */ (el('input', 'set-vis-num')); minIn.type = 'number'; minIn.min = /** @type {any} */ (cat.min); minIn.max = /** @type {any} */ (cat.max);
  const maxIn = /** @type {HTMLInputElement} */ (el('input', 'set-vis-num')); maxIn.type = 'number'; maxIn.min = /** @type {any} */ (cat.min); maxIn.max = /** @type {any} */ (cat.max);

  const span = (cat.max - cat.min) || 1;
  /** @param {number} v @returns {number} */
  const pct = (v) => ((v - cat.min) / span) * 100;
  const paint = () => {
    const a = pct(c.min), b = pct(c.max);
    fill.style.left = a + '%'; fill.style.right = (100 - b) + '%';
    loH.style.left = a + '%'; hiH.style.left = b + '%';
    minIn.value = /** @type {any} */ (c.min); maxIn.value = /** @type {any} */ (c.max);
  };
  /** @param {number} n @returns {number} */
  const clamp = (n) => Math.max(cat.min, Math.min(cat.max, n));

  /** @param {HTMLElement} handle @param {boolean} isMin */
  const drag = (handle, isMin) => {
    handle.onpointerdown = (e) => {
      e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add('on');
      handle.onpointermove = (ev) => {
        const rect = track.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        let v = Math.round(cat.min + f * span);
        if (isMin) { if (v > c.max) v = c.max; c.min = v; } else { if (v < c.min) v = c.min; c.max = v; }
        paint(); onChange();
      };
      handle.onpointerup = () => { handle.classList.remove('on'); handle.onpointermove = null; handle.onpointerup = null; };
    };
  };
  drag(loH, true); drag(hiH, false);

  minIn.onchange = () => { let n = clamp(parseInt(minIn.value, 10)); if (Number.isNaN(n)) n = c.min; if (n > c.max) n = c.max; c.min = n; paint(); onChange(); };
  maxIn.onchange = () => { let n = clamp(parseInt(maxIn.value, 10)); if (Number.isNaN(n)) n = c.max; if (n < c.min) n = c.min; c.max = n; paint(); onChange(); };

  ctrls.append(minIn, slider, maxIn);
  r.appendChild(ctrls);
  paint();
  setTimeout(sync, 0);
  return r;
}

// Ensure every category exists (full-on default), then return [hint, ...rows] for a container to append.
/** @param {Visibility} visibility @param {() => void} onChange @param {string} [hintText] @returns {HTMLElement[]} */
export function buildVisibilityRows(visibility, onChange, hintText) {
  VIS_CATEGORIES.forEach((cat) => { if (!visibility[cat.key]) visibility[cat.key] = { on: true, min: cat.min, max: cat.max }; });
  const out = [el('div', 'set-vis-hint', hintText || 'Show only on the selected timeframes.')];
  VIS_CATEGORIES.forEach((cat) => out.push(buildVisRow(/** @type {VisRule} */ (visibility[cat.key]), cat, onChange)));
  return out;
}
