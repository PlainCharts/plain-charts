// @ts-check
// Reusable color picker — our own (no native <input type=color>). The main panel is a PALETTE grid
// (palette-panel.js: the user's palettes + modes + the colour creator), a Recent strip that fills as
// colours are used, opacity, and optional extra sections (thickness / line style / text size / text
// style) the stroke/text swatches request. colorSwatch(value, onChange) returns a swatch that opens the
// picker. Values are '#rrggbb' (opaque) or 'rgba(...)'. Pure conversions live in color-math.js; the
// creator popup in color-creator.js.
import { customColors, addColor, removeColor } from './colors-store.js';
import { clamp, normHex, parseColor, composeColor, normLS } from './color-math.js';
import { closeCreator, creatorContains } from './color-creator.js';
import { buildPalettePanel } from './palette-panel.js';

/**
 * One editable value in the picker's extra sections (thickness / line style / text size / bold / italic).
 * @template T
 * @typedef {{ value: T, onChange: (v: T) => void }} ExtraField
 */
/**
 * Optional extra sections shown below the colour panel.
 * @typedef {Object} ColorExtras
 * @property {ExtraField<number>} [width]
 * @property {ExtraField<any>} [lineStyle]
 * @property {ExtraField<number>} [size]
 * @property {ExtraField<any>} [bold]
 * @property {ExtraField<any>} [italic]
 */
/**
 * A get/set accessor pair.
 * @typedef {{ get: () => any, set: (v: any) => void }} Accessor
 */
/**
 * strokeSwatch api: colour is required; width/lineStyle optional (callers may pass null).
 * @typedef {Object} StrokeApi
 * @property {Accessor} color
 * @property {Accessor|null} [width]
 * @property {Accessor|null} [lineStyle]
 */
/**
 * textSwatch api: colour is required; size/bold/italic optional (callers may pass null).
 * @typedef {Object} TextApi
 * @property {Accessor} color
 * @property {Accessor|null} [size]
 * @property {Accessor|null} [bold]
 * @property {Accessor|null} [italic]
 */

/** @param {string} t @returns {HTMLLabelElement} */
const lbl = (t) => {
  const l = document.createElement('label');
  l.textContent = t;
  return l;
};
/** @param {string} tag @param {string|null} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/** @type {any} */
let pop = null;
/** @returns {void} */
export function closeColorPicker() {
  closeCreator();
  if (!pop) return;
  if (pop._menuCleanup) pop._menuCleanup();
  document.removeEventListener('pointerdown', pop._out, true);
  pop.remove();
  pop = null;
}

/**
 * @param {HTMLElement} anchor
 * @param {string} value
 * @param {(v: string) => void} onChange
 * @param {ColorExtras} [extras]
 * @returns {void}
 */
export function openColorPicker(anchor, value, onChange, extras) {
  closeColorPicker();
  let { hex, alpha } = parseColor(value);
  pop = document.createElement('div');
  pop.className = 'cp-pop';
  const emit = () => onChange(composeColor(hex, alpha));

  // Draggable dialog: a title bar the user can grab to move the picker (so a tall palette never stays
  // stuck hidden under the chart edge -- drag it into view instead of reopening). All the content lives in
  // a scrollable body below the bar, so an over-tall picker also scrolls rather than overflowing off-screen.
  const titleBar = document.createElement('div');
  titleBar.className = 'cp-title';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cp-title-x';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  closeBtn.onclick = () => closeColorPicker();
  titleBar.append(el('span', 'cp-title-t', 'Color'), closeBtn);
  const body = document.createElement('div');
  body.className = 'cp-body';
  pop.append(titleBar, body);
  makeDraggable(pop, titleBar);

  // pick a colour: set the hue only (keep the current opacity), remember it in Recent, apply and close.
  /** @param {string} col */
  const pickHex = (col) => {
    const nv = normHex(col);
    if (!nv) return;
    hex = nv;
    addColor(nv);
    emit();
    closeColorPicker();
  };

  // ---- Palettes (top): the palette manager panel (selector menu + grid + modes + creator) ----
  const palette = buildPalettePanel(body, { pickHex, currentHex: () => hex });
  pop._menuCleanup = palette.closeMenu;

  // ---- Recent colours (fills as colours are used) ----
  const recentRow = document.createElement('div');
  recentRow.className = 'cp-recent';
  const renderRecent = () => {
    recentRow.innerHTML = '';
    recentRow.appendChild(el('div', 'cp-seclabel', 'Recent'));
    const strip = el('div', 'cp-recentstrip');
    customColors().forEach((col) => {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'cp-csw';
      s.title = col + '  (right-click to remove)';
      const cc = document.createElement('span');
      cc.className = 'cp-csw-c';
      cc.style.background = col;
      s.appendChild(cc);
      s.onclick = () => pickHex(col);
      s.oncontextmenu = (e) => {
        e.preventDefault();
        removeColor(col);
        renderRecent();
      };
      strip.appendChild(s);
    });
    if (!customColors().length) strip.appendChild(el('span', 'cp-empty', 'None yet'));
    recentRow.appendChild(strip);
  };
  renderRecent();
  body.appendChild(recentRow);

  // opacity
  const op = document.createElement('input');
  op.type = 'range';
  op.min = /** @type {any} */ (0);
  op.max = /** @type {any} */ (100);
  op.value = /** @type {any} */ (Math.round(alpha * 100));
  op.className = 'cp-opacity';
  const opNum = document.createElement('input');
  opNum.className = 'cp-opnum';
  opNum.value = Math.round(alpha * 100) + '%';
  /** @param {number} a */
  const setA = (a) => {
    alpha = clamp(a, 0, 1);
    op.value = /** @type {any} */ (Math.round(alpha * 100));
    opNum.value = Math.round(alpha * 100) + '%';
    emit();
  };
  const opRow = document.createElement('div');
  opRow.className = 'cp-oprow';
  op.oninput = () => setA(/** @type {any} */ (op.value) / 100);
  opNum.onchange = () => {
    const v = parseInt(opNum.value, 10);
    if (!Number.isNaN(v)) setA(v / 100);
  };
  const opControls = document.createElement('div');
  opControls.className = 'cp-row-controls';
  opControls.append(op, opNum);
  opRow.append(lbl('Opacity'), opControls);
  body.appendChild(opRow);

  appendExtraSections(body, extras);

  palette.refreshSel();
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = clamp(r.left, 8, window.innerWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = clamp(r.bottom + 6, 8, window.innerHeight - pop.offsetHeight - 8) + 'px';
  pop._out = (/** @type {PointerEvent} */ e) => {
    if (
      pop &&
      !pop.contains(e.target) &&
      e.target !== anchor &&
      !anchor.contains(/** @type {Node} */ (e.target)) &&
      !creatorContains(e.target)
    )
      closeColorPicker();
  };
  setTimeout(() => document.addEventListener('pointerdown', pop._out, true), 0);
}

// ---- the optional extra sections (each one named builder; a swatch requests only what it edits) ----
/** @param {HTMLElement} body @param {ColorExtras} [extras] */
function appendExtraSections(body, extras) {
  if (!extras) return;
  if (extras.width) body.appendChild(sectionThickness(extras.width));
  if (extras.lineStyle) body.appendChild(sectionLineStyle(extras.lineStyle));
  if (extras.size) body.appendChild(sectionTextSize(extras.size));
  if (extras.bold || extras.italic) body.appendChild(sectionTextStyle(extras.bold, extras.italic));
}
/** line thickness: four preset widths @param {ExtraField<number>} field */
function sectionThickness(field) {
  const sec = el('div', 'cp-section');
  sec.appendChild(el('div', 'cp-seclabel', 'Thickness'));
  const wrap = el('div', 'cp-thick');
  let wv = field.value || 1;
  [1, 2, 3, 4].forEach((w) => {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'cp-thbtn' + (w === wv ? ' sel' : '')));
    b.type = 'button';
    const line = el('span', 'cp-thline');
    line.style.borderTopWidth = w + 'px';
    b.appendChild(line);
    b.onclick = () => {
      wv = w;
      field.onChange(w);
      wrap.querySelectorAll('.cp-thbtn').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
    };
    wrap.appendChild(b);
  });
  sec.appendChild(wrap);
  return sec;
}
/** solid / dashed / dotted @param {ExtraField<any>} field */
function sectionLineStyle(field) {
  const sec = el('div', 'cp-section');
  sec.appendChild(el('div', 'cp-seclabel', 'Line style'));
  const wrap = el('div', 'cp-lsrow');
  let lv = /** @type {string} */ (normLS(field.value));
  ['solid', 'dashed', 'dotted'].forEach((sName) => {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'cp-lsbtn' + (sName === lv ? ' sel' : '')));
    b.type = 'button';
    b.appendChild(el('span', 'ls-prev ' + sName));
    b.onclick = () => {
      lv = sName;
      field.onChange(sName);
      wrap.querySelectorAll('.cp-lsbtn').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
    };
    wrap.appendChild(b);
  });
  sec.appendChild(wrap);
  return sec;
}
/** font size dropdown @param {ExtraField<number>} field */
function sectionTextSize(field) {
  const sec = el('div', 'cp-section');
  sec.appendChild(el('div', 'cp-seclabel', 'Text size'));
  const sel = /** @type {HTMLSelectElement} */ (el('select', 'cp-textsize'));
  [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40].forEach((s) => {
    const o = /** @type {HTMLOptionElement} */ (el('option', null, String(s)));
    o.value = /** @type {any} */ (s);
    sel.appendChild(o);
  });
  sel.value = String(field.value || 14);
  sel.onchange = () => field.onChange(parseInt(sel.value, 10));
  sec.appendChild(sel);
  return sec;
}
/** Bold / Italic toggles @param {ExtraField<any>} [bold] @param {ExtraField<any>} [italic] */
function sectionTextStyle(bold, italic) {
  const sec = el('div', 'cp-section');
  sec.appendChild(el('div', 'cp-seclabel', 'Text style'));
  const wrap = el('div', 'cp-tstyle');
  if (bold) {
    let bv = !!bold.value;
    const b = /** @type {HTMLButtonElement} */ (el('button', 'cp-tsbtn' + (bv ? ' sel' : '')));
    b.type = 'button';
    b.textContent = 'B';
    b.style.fontWeight = '700';
    b.onclick = () => {
      bv = !bv;
      bold.onChange(bv);
      b.classList.toggle('sel', bv);
    };
    wrap.appendChild(b);
  }
  if (italic) {
    let iv = !!italic.value;
    const i = /** @type {HTMLButtonElement} */ (el('button', 'cp-tsbtn' + (iv ? ' sel' : '')));
    i.type = 'button';
    i.textContent = 'I';
    i.style.fontStyle = 'italic';
    i.onclick = () => {
      iv = !iv;
      italic.onChange(iv);
      i.classList.toggle('sel', iv);
    };
    wrap.appendChild(i);
  }
  sec.appendChild(wrap);
  return sec;
}

// Make a fixed-position dialog draggable by a handle. Grabbing the handle moves the whole popup and
// clamps it to the viewport, so it can always be pulled back into view. Ignores clicks on the close button.
/** @param {HTMLElement} win @param {HTMLElement} handle @returns {void} */
function makeDraggable(win, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('.cp-title-x')) return;
    e.preventDefault();
    const r = win.getBoundingClientRect();
    const ox = e.clientX - r.left,
      oy = e.clientY - r.top;
    win.style.left = r.left + 'px';
    win.style.top = r.top + 'px';
    const mv = (/** @type {PointerEvent} */ ev) => {
      win.style.left = clamp(ev.clientX - ox, 4, window.innerWidth - win.offsetWidth - 4) + 'px';
      win.style.top = clamp(ev.clientY - oy, 4, window.innerHeight - win.offsetHeight - 4) + 'px';
    };
    const up = () => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  });
}

// A stroke control: shows a color swatch + a live line preview (the actual color,
// width and style), and opens the picker (with thickness/line-style sections).
// api = { color:{get,set}, width:{get,set}|null, lineStyle:{get,set}|null }
/** @param {StrokeApi} api @returns {HTMLButtonElement} */
export function strokeSwatch(api) {
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'cp-stroke'));
  btn.type = 'button';
  const sw = el('span', 'cp-stroke-sw');
  const swc = el('span');
  sw.appendChild(swc);
  const line = el('span', 'cp-stroke-line');
  btn.append(sw, line);
  const refresh = () => {
    const c = api.color.get();
    swc.style.background = c;
    line.style.borderBottomColor = c;
    line.style.borderBottomWidth = (api.width ? api.width.get() || 1 : 2) + 'px';
    line.style.borderBottomStyle = api.lineStyle ? normLS(api.lineStyle.get()) : 'solid';
  };
  refresh();
  btn.onclick = () => {
    /** @type {ColorExtras} */
    const extras = {};
    if (api.width)
      extras.width = {
        value: api.width.get(),
        onChange: (w) => {
          /** @type {Accessor} */ (api.width).set(w);
          refresh();
        },
      };
    if (api.lineStyle)
      extras.lineStyle = {
        value: api.lineStyle.get(),
        onChange: (v) => {
          /** @type {Accessor} */ (api.lineStyle).set(v);
          refresh();
        },
      };
    openColorPicker(
      btn,
      api.color.get(),
      (v) => {
        api.color.set(v);
        refresh();
      },
      extras,
    );
  };
  return btn;
}

// A text control: the twin of strokeSwatch. Shows a colour swatch + a live "Text" sample (its colour,
// bold, italic), and opens the picker with the text sections (size / bold / italic).
// api = { color:{get,set}, size:{get,set}|null, bold:{get,set}|null, italic:{get,set}|null }
/** @param {TextApi} api @returns {HTMLButtonElement} */
export function textSwatch(api) {
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'cp-stroke cp-text'));
  btn.type = 'button';
  const sw = el('span', 'cp-stroke-sw');
  const swc = el('span');
  sw.appendChild(swc);
  const sample = el('span', 'cp-text-sample', 'Text');
  btn.append(sw, sample);
  const refresh = () => {
    const c = api.color.get();
    swc.style.background = c;
    sample.style.color = c;
    sample.style.fontWeight = api.bold && api.bold.get() ? '700' : '400';
    sample.style.fontStyle = api.italic && api.italic.get() ? 'italic' : 'normal';
  };
  refresh();
  btn.onclick = () => {
    /** @type {ColorExtras} */
    const extras = {};
    if (api.size)
      extras.size = {
        value: api.size.get(),
        onChange: (v) => {
          /** @type {Accessor} */ (api.size).set(v);
          refresh();
        },
      };
    if (api.bold)
      extras.bold = {
        value: api.bold.get(),
        onChange: (v) => {
          /** @type {Accessor} */ (api.bold).set(v);
          refresh();
        },
      };
    if (api.italic)
      extras.italic = {
        value: api.italic.get(),
        onChange: (v) => {
          /** @type {Accessor} */ (api.italic).set(v);
          refresh();
        },
      };
    openColorPicker(
      btn,
      api.color.get(),
      (v) => {
        api.color.set(v);
        refresh();
      },
      extras,
    );
  };
  return btn;
}

/** @param {string|undefined} value @param {(v: string) => void} onChange @param {ColorExtras} [extras] @returns {HTMLButtonElement} */
export function colorSwatch(value, onChange, extras) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cp-swatch';
  const inner = document.createElement('span');
  inner.className = 'cp-swatch-c';
  btn.appendChild(inner);
  /** @type {any} */ (btn)._value = value || '#2962ff';
  inner.style.background = /** @type {any} */ (btn)._value;
  btn.onclick = () =>
    openColorPicker(
      btn,
      /** @type {any} */ (btn)._value,
      (v) => {
        /** @type {any} */ (btn)._value = v;
        inner.style.background = v;
        onChange(v);
      },
      extras,
    );
  return btn;
}
