// @ts-check
// Control-builder framework for the chart settings dialog (Tier 2 of the de-monolith). Two groups:
//   - pure DOM factories (row / labeled / unit / ...) -- no state, imported directly.
//   - appearance controls (colorPicker / checkControl / ...) -- bound to a live-preview callback via
//     makeAppearanceControls(preview); the shell destructures them back into the same names, so every
//     call site stays unchanged. Each control edits obj[key] in place and calls preview() after.
import { colorSwatch, strokeSwatch, textSwatch } from '../ui/colorpicker.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup -- these shared factories translate every section's labels

/**
 * The shared context object chart-dialog.js hands to each settings section's render(). It bundles the
 * live content container + per-open state (pane/draft) with the full control-builder vocabulary
 * (pure factories + appearance controls + live-pane controls). Sections destructure what they use.
 * `pane` and `draft` are out-of-subsystem shapes, treated as opaque here.
 * @typedef {Object} SettingsCtx
 * @property {HTMLElement} content              the section content container (cleared each render)
 * @property {any} pane                         the active Pane
 * @property {any} draft                        the appearance draft { candles, canvas, statusLine?, indicators? }
 * @property {string} activeCat                 the current category name
 * @property {(t: string) => void} section
 * @property {() => void} preview
 * @property {() => void} renderContent
 * @property {(label: string, ...controls: (string | Node)[]) => HTMLElement} row
 * @property {(...controls: (string | Node)[]) => HTMLElement} inlineRow
 * @property {(text: string, control: Node) => HTMLElement} labeled
 * @property {(text: string) => HTMLElement} unit
 * @property {(text: string) => HTMLElement} helpDot
 * @property {(obj: Record<string, any>, key: string) => HTMLElement} colorPicker
 * @property {(obj: Record<string, any>, colorKey: string, sizeKey: string) => HTMLElement} textPicker
 * @property {(obj: Record<string, any>, key: string, label: string) => HTMLElement} checkControl
 * @property {(obj: Record<string, any>, key: string, opts: [any, string][], numeric?: boolean) => HTMLElement} selectControl
 * @property {(obj: Record<string, any>, key: string, min: number, max: number, title?: string) => HTMLElement} numberControl
 * @property {(obj: Record<string, any>, key: string) => HTMLElement} opacitySlider
 * @property {(obj: Record<string, any>, label: string, key: string, ...trailing: (string | Node)[]) => HTMLElement} checkRow
 * @property {(obj: Record<string, any>, label: string, visKey: string, upKey: string, downKey: string) => HTMLElement} visColorRow
 * @property {(label: string, key: string, trailing?: HTMLElement) => HTMLElement} liveCheck
 * @property {(prefix: string) => HTMLElement} lineStroke
 * @property {(key: string) => HTMLElement} liveColor
 * @property {(key: string, placeholder?: string) => HTMLElement} liveText
 * @property {(key: string, placeholder?: string) => HTMLElement} liveNum
 * @property {(key: string, opts: [any, string][], coerce?: (v: string) => any) => HTMLElement} liveSelect
 * @property {() => HTMLElement} dateFmtHelp
 */

// ---- pure DOM factories (no state) ----
/** @param {string} label @param {...(string | Node)} controls */
export function row(label, ...controls) {
  const r = document.createElement('div'); r.className = 'sd-row';
  const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(label);
  r.append(l, ...controls); return r;
}
/** @param {...(string | Node)} controls */
export function inlineRow(...controls) {
  const r = document.createElement('div'); r.className = 'sd-inline';
  r.append(...controls); return r;
}
/** @param {string} text @param {Node} control */
export function labeled(text, control) {
  const f = document.createElement('label'); f.className = 'sd-field';
  const s = document.createElement('span'); s.textContent = t(text);
  f.append(s, control); return f;
}
/** @param {string} text */
export function unit(text) { const s = document.createElement('span'); s.className = 'sd-unit'; s.textContent = t(text); return s; }
/** @param {string} text */
export function helpDot(text) {
  const s = document.createElement('span');
  s.className = 'sd-help-dot'; s.textContent = '?'; s.title = t(text);
  return s;
}

// The "!" strftime help popover (a button + a popover of format codes and clickable example patterns). Pure
// DOM + a callback: onPick(pattern) fires when an example is clicked, so any field can reuse the SAME widget
// (the chart time-scale wires it to the pane's tsDateFmt; the Alerts section wires it to its own date format).
/** @param {(pattern: string) => void} onPick @param {{ p: string, ex: string }[]} [examples] */
export function dateFmtHelp(onPick, examples) {
  const wrap = document.createElement('span'); wrap.className = 'sd-help';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sd-help-btn'; btn.textContent = '!';
  btn.title = t('Date format codes');
  const pop = document.createElement('div'); pop.className = 'sd-help-pop';
  const codes = [
    ['%Y / %y', 'year  2026 / 26'], ['%m / %-m', 'month  09 / 9'],
    ['%b / %B', 'month name  Sep / September'], ['%d / %-d / %e', 'day  09 / 9 / " 9"'],
    ['%a / %A', 'weekday  Mon / Monday'],
  ];
  const h = document.createElement('div'); h.className = 'sd-help-h'; h.textContent = t('strftime codes ( %- drops leading zero )');
  pop.appendChild(h);
  codes.forEach(([c, d]) => {
    const r = document.createElement('div'); r.className = 'sd-help-row';
    const a = document.createElement('code'); a.textContent = c;
    const b = document.createElement('span'); b.textContent = d;
    r.append(a, b); pop.appendChild(r);
  });
  const eh = document.createElement('div'); eh.className = 'sd-help-h'; eh.textContent = t('examples (click to use)');
  pop.appendChild(eh);
  (examples || []).forEach((e) => {
    const r = document.createElement('div'); r.className = 'sd-help-row sd-help-ex';
    const a = document.createElement('code'); a.textContent = e.p;
    const b = document.createElement('span'); b.textContent = e.ex;
    r.append(a, b);
    r.onclick = () => onPick(e.p);
    pop.appendChild(r);
  });
  btn.onclick = (ev) => { ev.stopPropagation(); pop.classList.toggle('open'); };
  document.addEventListener('click', () => pop.classList.remove('open'));
  pop.onclick = (ev) => ev.stopPropagation();
  wrap.append(btn, pop);
  return wrap;
}

// ---- appearance controls, bound to a live-preview callback ----
/** @param {() => void} preview */
export function makeAppearanceControls(preview) {
  /** @param {Record<string, any>} obj @param {string} key */
  const colorPicker = (obj, key) => {
    const cur = (typeof obj[key] === 'string' && (obj[key][0] === '#' || obj[key].startsWith('rgb'))) ? obj[key] : '#888888';
    return colorSwatch(cur, (/** @type {string} */ v) => { obj[key] = v; preview(); });
  };
  // color + TEXT SIZE in one swatch (our rich picker, #34) -- no bold/italic. Used where a text element has
  // both a colour and a font size (e.g. the status-line text).
  /** @param {Record<string, any>} obj @param {string} colorKey @param {string} sizeKey */
  const textPicker = (obj, colorKey, sizeKey) => textSwatch({
    color: { get: () => obj[colorKey], set: (/** @type {string} */ v) => { obj[colorKey] = v; preview(); } },
    size: { get: () => obj[sizeKey], set: (/** @type {number} */ v) => { obj[sizeKey] = v; preview(); } },
    bold: null, italic: null,
  });
  /** @param {Record<string, any>} obj @param {string} key @param {string} label */
  const checkControl = (obj, key, label) => {
    const f = document.createElement('label'); f.className = 'sd-field';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = obj[key] !== false;
    chk.onchange = () => { obj[key] = chk.checked; preview(); };
    const s = document.createElement('span'); s.textContent = t(label);
    f.append(chk, s); return f;
  };
  /** @param {Record<string, any>} obj @param {string} key @param {[any, string][]} opts @param {boolean} [numeric] */
  const selectControl = (obj, key, opts, numeric) => {
    const s = document.createElement('select');
    opts.forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = t(label); s.appendChild(o); });
    s.value = obj[key];
    s.onchange = () => { obj[key] = numeric ? parseInt(s.value, 10) : s.value; preview(); }; return s;
  };
  /** @param {Record<string, any>} obj @param {string} key @param {number} min @param {number} max @param {string} [title] */
  const numberControl = (obj, key, min, max, title) => {
    const i = document.createElement('input'); i.type = 'number'; i.min = /** @type {any} */ (min); i.max = /** @type {any} */ (max); i.value = obj[key];
    i.title = title ? t(title) : ''; i.style.width = '54px';
    i.oninput = () => { const v = parseInt(i.value, 10); if (!isNaN(v)) { obj[key] = Math.max(min, Math.min(max, v)); preview(); } };
    return i;
  };
  // 0-100 opacity slider (live preview). Value stored as a percentage on obj[key].
  /** @param {Record<string, any>} obj @param {string} key */
  const opacitySlider = (obj, key) => {
    const r = document.createElement('input'); r.type = 'range'; r.min = '0'; r.max = '100';
    r.value = obj[key] != null ? obj[key] : 60; r.style.width = '130px'; r.style.marginLeft = '10px';
    r.oninput = () => { obj[key] = parseInt(r.value, 10); preview(); };
    return r;
  };
  /** @param {Record<string, any>} obj @param {string} label @param {string} key @param {...(string | Node)} trailing */
  const checkRow = (obj, label, key, ...trailing) => {
    const r = document.createElement('div'); r.className = 'sd-row';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!obj[key];
    chk.onchange = () => { obj[key] = chk.checked; preview(); };
    const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(label);
    r.append(chk, l, ...trailing); return r;
  };
  /** @param {Record<string, any>} obj @param {string} label @param {string} visKey @param {string} upKey @param {string} downKey */
  const visColorRow = (obj, label, visKey, upKey, downKey) => {
    const r = document.createElement('div'); r.className = 'sd-row';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!obj[visKey];
    chk.onchange = () => { obj[visKey] = chk.checked; preview(); };
    const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(label);
    r.append(chk, l, colorPicker(obj, upKey), colorPicker(obj, downKey)); return r;
  };
  return { colorPicker, textPicker, checkControl, selectControl, numberControl, opacitySlider, checkRow, visColorRow };
}

// ---- live-settings controls, bound to the active pane (read via getPane, since it changes per open) ----
// Each edits pane.settings via pane.setLineSetting immediately (no draft/preview). dateFmtHelp also
// re-renders on example pick (renderContent) and lists dateFmtExamples.
/** @param {{ getPane: () => any, renderContent: () => void, dateFmtExamples: { p: string, ex: string }[] }} deps */
export function makeLiveControls({ getPane, renderContent, dateFmtExamples }) {
  /** @param {string} label @param {string} key @param {HTMLElement} [trailing] */
  const liveCheck = (label, key, trailing) => {
    const p = getPane();
    const r = document.createElement('div'); r.className = 'sd-row';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!(p && p.settings[key]);
    chk.onchange = () => { const pp = getPane(); if (pp) pp.setLineSetting(key, chk.checked); };
    const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(label);
    r.append(chk, l);
    if (trailing) { trailing.style.marginLeft = 'auto'; r.appendChild(trailing); }
    return r;
  };
  /** @param {string} prefix */
  const lineStroke = (prefix) => strokeSwatch({
    color: { get: () => getPane().settings[prefix + 'Color'], set: (/** @type {any} */ v) => getPane().setLineSetting(prefix + 'Color', v) },
    width: { get: () => getPane().settings[prefix + 'Width'], set: (/** @type {any} */ v) => getPane().setLineSetting(prefix + 'Width', v) },
    lineStyle: { get: () => getPane().settings[prefix + 'Dash'], set: (/** @type {any} */ v) => getPane().setLineSetting(prefix + 'Dash', v) },
  });
  /** @param {string} key */
  const liveColor = (key) => {
    const p = getPane();
    const cur = (p && typeof p.settings[key] === 'string') ? p.settings[key] : '#888888';
    return colorSwatch(cur, (/** @type {string} */ v) => { const pp = getPane(); if (pp) pp.setLineSetting(key, v); });
  };
  /** @param {string} key @param {string} [placeholder] */
  const liveText = (key, placeholder) => {
    const p = getPane();
    const i = document.createElement('input');
    i.type = 'text'; i.className = 'sd-text'; i.placeholder = placeholder || '';
    if (p) i.value = p.settings[key] || '';
    i.oninput = () => { const pp = getPane(); if (pp) pp.setLineSetting(key, i.value); };
    return i;
  };
  /** @param {string} key @param {string} [placeholder] */
  const liveNum = (key, placeholder) => {
    const p = getPane();
    const i = document.createElement('input');
    i.type = 'number'; i.step = 'any'; i.className = 'sd-text'; i.placeholder = placeholder || '';
    if (p && p.settings[key] != null) i.value = p.settings[key];
    i.oninput = () => { const pp = getPane(); if (pp) pp.setLineSetting(key, i.value === '' ? 0 : parseFloat(i.value)); };
    return i;
  };
  /** @param {string} key @param {[any, string][]} opts @param {(v: string) => any} [coerce] */
  const liveSelect = (key, opts, coerce) => {
    const p = getPane();
    const sel = document.createElement('select');
    opts.forEach(([v, label]) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t(label); sel.appendChild(o); });
    if (p) sel.value = String(p.settings[key]);
    sel.onchange = () => { const pp = getPane(); if (pp) pp.setLineSetting(key, coerce ? coerce(sel.value) : sel.value); };
    return sel;
  };
  // "[!]" strftime help popover, wired to the pane's tsDateFmt (reuses the shared dateFmtHelp widget).
  const liveDateFmtHelp = () => dateFmtHelp((p) => { const pane = getPane(); if (pane) { pane.setLineSetting('tsDateFmt', p); renderContent(); } }, dateFmtExamples);
  return { liveCheck, lineStroke, liveColor, liveText, liveNum, liveSelect, dateFmtHelp: liveDateFmtHelp };
}
