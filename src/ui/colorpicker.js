// @ts-check
// Reusable color picker — our own (no native <input type=color>). The main panel is a PALETTE grid
// (a dropdown of the user's own colour palettes plus the built-in "Standard" shade grid), a Recent
// strip that fills as colours are used, and opacity. The "+" opens a colour creator (saturation/value
// square + hue slider + hex) with two actions: Pick (apply the colour) and Add (save it to the active
// palette). colorSwatch(value, onChange) returns a swatch that opens the picker.
// Values are '#rrggbb' (opaque) or 'rgba(...)'.
import { customColors, addColor, removeColor } from './colors-store.js';
import { paletteList, activePaletteId, getPalette, paletteRows, paletteFlat, setActivePalette, createPalette, removePalette, addColorToPalette, addRowToPalette, removeColorFromPalette, isFavorite, toggleFavorite } from './palettes-store.js';

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

/** @param {number} n @param {number} a @param {number} b @returns {number} */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
/** @param {string} h @returns {[number, number, number]} */
const hexToRgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
/** @param {number} r @param {number} g @param {number} b @returns {string} */
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');

// HSV (the saturation/value square uses HSV, not HSL)
/** @param {number} h @param {number} s @param {number} v @returns {[number, number, number]} */
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** @param {number} r @param {number} g @param {number} b @returns {[number, number, number]} */
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, max ? d / max : 0, max];
}
/** @param {number} h @param {number} s @param {number} v @returns {string} */
const hsvToHex = (h, s, v) => { const [r, g, b] = hsvToRgb(h, s, v); return rgbToHex(r, g, b); };
/** @param {string} hex @returns {[number, number, number]} */
const hexToHsv = (hex) => { const [r, g, b] = hexToRgb(hex); return rgbToHsv(r, g, b); };

/** @param {string} [s] @returns {string|null} */
function normHex(s) {
  s = (s || '').trim(); if (s[0] !== '#') s = '#' + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}
/** @param {string} a @param {string} b @returns {boolean} */
const sameHex = (a, b) => { const x = normHex(a), y = normHex(b); return !!(x && y && x === y); };

/** @param {string} [value] @returns {{ hex: string, alpha: number }} */
function parse(value) {
  if (!value) return { hex: '#2962ff', alpha: 1 };
  if (value[0] === '#') return { hex: normHex(value) || '#2962ff', alpha: 1 };
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/.exec(value);
  if (m) return { hex: rgbToHex(+m[1], +m[2], +m[3]), alpha: m[4] != null ? parseFloat(m[4]) : 1 };
  return { hex: '#2962ff', alpha: 1 };
}
/** @param {string} hex @param {number} alpha @returns {string} */
function compose(hex, alpha) {
  if (alpha >= 1) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})`;
}
/** @param {string} t @returns {HTMLLabelElement} */
const lbl = (t) => { const l = document.createElement('label'); l.textContent = t; return l; };
/** @param {string} tag @param {string|null} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };
/** @param {string|number} [v] @returns {'solid'|'dashed'|'dotted'} */
const normLS = (v) => (v === 'dashed' || v === 2) ? 'dashed' : (v === 'dotted' || v === 1) ? 'dotted' : 'solid';

/** @type {any} */
let pop = null;
/** @type {any} */
let creator = null;
/** @returns {void} */
export function closeColorPicker() {
  closeCreator();
  if (!pop) return;
  if (pop._menuCleanup) pop._menuCleanup();
  document.removeEventListener('pointerdown', pop._out, true);
  pop.remove(); pop = null;
}
/** @returns {void} */
function closeCreator() {
  if (!creator) return;
  document.removeEventListener('pointerdown', creator._out, true);
  creator.remove(); creator = null;
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
  let { hex, alpha } = parse(value);
  pop = document.createElement('div'); pop.className = 'cp-pop';
  const emit = () => onChange(compose(hex, alpha));

  // Draggable dialog: a title bar the user can grab to move the picker (so a tall palette never stays
  // stuck hidden under the chart edge -- drag it into view instead of reopening). All the content lives in
  // a scrollable body below the bar, so an over-tall picker also scrolls rather than overflowing off-screen.
  const titleBar = document.createElement('div'); titleBar.className = 'cp-title';
  const closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'cp-title-x'; closeBtn.textContent = '×'; closeBtn.title = 'Close';
  closeBtn.onclick = () => closeColorPicker();
  titleBar.append(el('span', 'cp-title-t', 'Color'), closeBtn);
  const body = document.createElement('div'); body.className = 'cp-body';
  pop.append(titleBar, body);
  makeDraggable(pop, titleBar);

  const refreshSel = () => pop.querySelectorAll('.cp-sw').forEach((/** @type {HTMLElement} */ b) => b.classList.toggle('sel', /** @type {boolean} */ (b.dataset.c && sameHex(b.dataset.c, hex))));
  // pick a colour: set the hue only (keep the current opacity), remember it in Recent, apply and close.
  /** @param {string} col */
  const pickHex = (col) => { const nv = normHex(col); if (!nv) return; hex = nv; addColor(nv); emit(); closeColorPicker(); };

  // ---- Palettes (top): everything is a palette (defaults ship as data; see palettes-store) ----
  let activeSel = activePaletteId();
  if (!getPalette(activeSel)) activeSel = (paletteList()[0] && paletteList()[0].id) || null;

  // one-shot remove mode for palette COLOURS (armed by the grid's "x" button, below).
  let removeMode = false;
  // favorite-toggle mode (armed by the star button): clicking swatches stars/unstars them; stays on.
  let favMode = false;
  // the row that added colours land in (a per-row radio selects it); null -> the last row (see renderGrid).
  /** @type {number|null} */
  let activeRow = null;

  // Palette selector: a button showing the current palette. Clicking it opens a menu to switch palette,
  // create a new one (type a name), or remove one (the "x" on each row) -- richer than a native dropdown.
  const head = document.createElement('div'); head.className = 'cp-palhead';
  const palBtn = document.createElement('button'); palBtn.type = 'button'; palBtn.className = 'cp-palbtn';
  const palName = el('span', 'cp-palbtn-t');
  palBtn.append(palName, el('span', 'cp-palbtn-caret', '▾'));
  head.appendChild(palBtn); body.appendChild(head);

  const grid = document.createElement('div'); grid.className = 'cp-grid'; body.appendChild(grid);

  /** @param {string|null} id @returns {string} */
  const nameOf = (id) => (getPalette(id) && /** @type {import('./palettes-store.js').Palette} */ (getPalette(id)).name) || 'No palette';
  const refreshBtn = () => { palName.textContent = nameOf(activeSel); };

  /** @type {any} */
  let menu = null;
  const closeMenu = () => { if (!menu) return; document.removeEventListener('pointerdown', menu._out, true); menu.remove(); menu = null; };
  pop._menuCleanup = closeMenu;
  /** @param {string} id */
  const selectPalette = (id) => { removeMode = false; activeRow = null; activeSel = id; setActivePalette(id); refreshBtn(); renderGrid(); closeMenu(); };
  const openPaletteMenu = () => {
    closeMenu();
    menu = el('div', 'cp-palmenu');
    const rebuild = () => {
      menu.innerHTML = '';
      /** @param {string} id @param {boolean} removable */
      const row = (id, removable) => {
        const r = el('div', 'cp-palmenu-row' + (id === activeSel ? ' sel' : ''));
        const nm = el('span', 'cp-palmenu-name', nameOf(id)); nm.onclick = () => selectPalette(id);
        r.appendChild(nm);
        if (removable) {   // "x" removes the whole palette; falls back to another (or Standard) if it was active
          const x = document.createElement('button'); x.type = 'button'; x.className = 'cp-palmenu-x'; x.textContent = '×'; x.title = 'Remove palette';
          x.onclick = (e) => { e.stopPropagation(); removePalette(id); if (activeSel === id) activeSel = (paletteList()[0] && paletteList()[0].id) || null; refreshBtn(); rebuild(); renderGrid(); };
          r.appendChild(x);
        }
        menu.appendChild(r);
      };
      paletteList().forEach((p) => row(p.id, true));
      const addRow = el('div', 'cp-palmenu-row cp-palmenu-new');
      const inp = /** @type {HTMLInputElement} */ (el('input', 'cp-palmenu-input')); inp.placeholder = 'New palette…';
      inp.onclick = (e) => e.stopPropagation();
      inp.onkeydown = (e) => { if (e.key === 'Enter') { const v = inp.value.trim(); if (v) selectPalette(createPalette(v).id); } };
      addRow.appendChild(inp); menu.appendChild(addRow);
    };
    rebuild();
    pop.appendChild(menu);
    const rc = palBtn.getBoundingClientRect();
    menu.style.left = rc.left + 'px'; menu.style.top = (rc.bottom + 4) + 'px'; menu.style.minWidth = rc.width + 'px';
    menu._out = (/** @type {PointerEvent} */ e) => { if (menu && !menu.contains(e.target) && !palBtn.contains(/** @type {Node} */ (e.target))) closeMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', menu._out, true), 0);
  };
  palBtn.onclick = () => { if (menu) closeMenu(); else openPaletteMenu(); };

  // Add targets the active palette; if none exists (user removed them all), create "My Colors" first.
  const ensureUserPalette = () => {
    if (getPalette(activeSel)) return activeSel;
    const first = paletteList()[0];
    const id = first ? first.id : createPalette('My Colors').id;
    activeSel = id; setActivePalette(id);
    return id;
  };
  /** @param {HTMLElement} btn */
  const openCreator = (btn) => openCustomCreator(btn, hex, {
    onPick: (/** @type {string} */ v) => pickHex(v),
    onAdd: (/** @type {string} */ v) => { const id = ensureUserPalette(); activeRow = addColorToPalette(/** @type {string} */ (id), v, activeRow); refreshBtn(); renderGrid(); },
  });

  /** @param {string} col @param {boolean} removable */
  const swatch = (col, removable) => {
    const s = document.createElement('button'); s.type = 'button'; s.className = 'cp-sw' + (isFavorite(col) ? ' fav' : ''); s.style.background = col; s.dataset.c = col;
    if (removable && removeMode) {
      s.title = 'Click to remove ' + col;
      s.onclick = () => { removeColorFromPalette(/** @type {string} */ (activeSel), col); removeMode = false; renderGrid(); };
    } else if (removable && favMode) {
      s.title = (isFavorite(col) ? 'Click to unfavorite ' : 'Click to favorite ') + col;
      s.onclick = () => { toggleFavorite(col); renderGrid(); };   // stays in favorite mode -- star/unstar several
    } else {
      s.title = col + (removable ? '  (right-click to remove)' : '');
      s.onclick = () => pickHex(col);
      if (removable) s.oncontextmenu = (e) => { e.preventDefault(); removeColorFromPalette(/** @type {string} */ (activeSel), col); renderGrid(); };
    }
    return s;
  };
  function renderGrid() {   // a palette is rows of colours; a controls row holds "+", "new row" and "x"
    grid.innerHTML = '';
    const rows = paletteRows(activeSel);
    const flat = paletteFlat(activeSel);
    if (activeRow == null || activeRow < 0 || activeRow >= rows.length) activeRow = rows.length - 1;   // clamp -> last row
    const wrap = document.createElement('div'); wrap.className = 'cp-palgrid' + (removeMode ? ' cp-removing' : '') + (favMode ? ' cp-favoriting' : '');
    rows.forEach((row, i) => {
      const rEl = document.createElement('div'); rEl.className = 'cp-palrow';
      // radio selects which row added colours land in (only one at a time); shown on every row so the
      // active target is always visible, even with a single row.
      const radio = document.createElement('button'); radio.type = 'button'; radio.className = 'cp-palradio' + (i === activeRow ? ' on' : '');
      radio.title = 'Add new colours to this row';
      radio.onclick = () => { activeRow = i; renderGrid(); };
      rEl.appendChild(radio);
      row.forEach((col) => rEl.appendChild(swatch(col, true)));
      wrap.appendChild(rEl);
    });
    const ctl = document.createElement('div'); ctl.className = 'cp-palctl';
    const add = document.createElement('button'); add.type = 'button'; add.className = 'cp-add'; add.textContent = '+'; add.title = 'Pick a colour (Add saves it to the selected row)';
    add.onclick = () => { removeMode = false; favMode = false; openCreator(add); };
    ctl.appendChild(add);
    if (flat.length) {   // "new row" starts a fresh row and selects it (added colours land there) -- like Enter
      const nl = document.createElement('button'); nl.type = 'button'; nl.className = 'cp-newrow'; nl.textContent = '↵'; nl.title = 'New row (start the next colour on a new line)';
      nl.onclick = () => { removeMode = false; favMode = false; addRowToPalette(/** @type {string} */ (activeSel)); activeRow = paletteRows(activeSel).length - 1; renderGrid(); };
      ctl.appendChild(nl);
      // star arms favorite mode: click swatches to star/unstar them (they get a yellow outline)
      const star = document.createElement('button'); star.type = 'button'; star.className = 'cp-fav' + (favMode ? ' active' : ''); star.textContent = '★';
      star.title = favMode ? 'Done favoriting' : 'Favorite colours (then click the ones to star/unstar)';
      star.onclick = () => { favMode = !favMode; removeMode = false; renderGrid(); };
      ctl.appendChild(star);
      // "x" arms one-shot remove: hover highlights a swatch, click it to delete
      const del = document.createElement('button'); del.type = 'button'; del.className = 'cp-del' + (removeMode ? ' active' : ''); del.textContent = '×';
      del.title = removeMode ? 'Cancel remove' : 'Remove a colour (then click the one to delete)';
      del.onclick = () => { removeMode = !removeMode; favMode = false; renderGrid(); };
      ctl.appendChild(del);
    } else { removeMode = false; favMode = false; }
    wrap.appendChild(ctl);
    grid.appendChild(wrap);
    refreshSel();
  }
  refreshBtn();
  renderGrid();

  // ---- Recent colours (fills as colours are used) ----
  const recentRow = document.createElement('div'); recentRow.className = 'cp-recent';
  const renderRecent = () => {
    recentRow.innerHTML = '';
    recentRow.appendChild(el('div', 'cp-seclabel', 'Recent'));
    const strip = el('div', 'cp-recentstrip');
    customColors().forEach((col) => {
      const s = document.createElement('button'); s.type = 'button'; s.className = 'cp-csw'; s.title = col + '  (right-click to remove)';
      const cc = document.createElement('span'); cc.className = 'cp-csw-c'; cc.style.background = col; s.appendChild(cc);
      s.onclick = () => pickHex(col);
      s.oncontextmenu = (e) => { e.preventDefault(); removeColor(col); renderRecent(); };
      strip.appendChild(s);
    });
    if (!customColors().length) strip.appendChild(el('span', 'cp-empty', 'None yet'));
    recentRow.appendChild(strip);
  };
  renderRecent();
  body.appendChild(recentRow);

  // opacity
  const op = document.createElement('input'); op.type = 'range'; op.min = /** @type {any} */ (0); op.max = /** @type {any} */ (100); op.value = /** @type {any} */ (Math.round(alpha * 100)); op.className = 'cp-opacity';
  const opNum = document.createElement('input'); opNum.className = 'cp-opnum'; opNum.value = Math.round(alpha * 100) + '%';
  /** @param {number} a */
  const setA = (a) => { alpha = clamp(a, 0, 1); op.value = /** @type {any} */ (Math.round(alpha * 100)); opNum.value = Math.round(alpha * 100) + '%'; emit(); };
  const opRow = document.createElement('div'); opRow.className = 'cp-oprow';
  op.oninput = () => setA(/** @type {any} */ (op.value) / 100);
  opNum.onchange = () => { const v = parseInt(opNum.value, 10); if (!Number.isNaN(v)) setA(v / 100); };
  const opControls = document.createElement('div'); opControls.className = 'cp-row-controls'; opControls.append(op, opNum);
  opRow.append(lbl('Opacity'), opControls);
  body.appendChild(opRow);

  // optional Thickness section
  if (extras && extras.width) {
    const sec = el('div', 'cp-section'); sec.appendChild(el('div', 'cp-seclabel', 'Thickness'));
    const wrap = el('div', 'cp-thick'); let wv = extras.width.value || 1;
    [1, 2, 3, 4].forEach((w) => {
      const b = /** @type {HTMLButtonElement} */ (el('button', 'cp-thbtn' + (w === wv ? ' sel' : ''))); b.type = 'button';
      const line = el('span', 'cp-thline'); line.style.borderTopWidth = w + 'px'; b.appendChild(line);
      b.onclick = () => { wv = w; /** @type {any} */ (extras).width.onChange(w); wrap.querySelectorAll('.cp-thbtn').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); };
      wrap.appendChild(b);
    });
    sec.appendChild(wrap); body.appendChild(sec);
  }
  // optional Line style section
  if (extras && extras.lineStyle) {
    const sec = el('div', 'cp-section'); sec.appendChild(el('div', 'cp-seclabel', 'Line style'));
    const wrap = el('div', 'cp-lsrow'); let lv = /** @type {string} */ (normLS(extras.lineStyle.value));
    ['solid', 'dashed', 'dotted'].forEach((sName) => {
      const b = /** @type {HTMLButtonElement} */ (el('button', 'cp-lsbtn' + (sName === lv ? ' sel' : ''))); b.type = 'button';
      b.appendChild(el('span', 'ls-prev ' + sName));
      b.onclick = () => { lv = sName; /** @type {any} */ (extras).lineStyle.onChange(sName); wrap.querySelectorAll('.cp-lsbtn').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); };
      wrap.appendChild(b);
    });
    sec.appendChild(wrap); body.appendChild(sec);
  }
  // optional Text size section (font size dropdown)
  if (extras && extras.size) {
    const sec = el('div', 'cp-section'); sec.appendChild(el('div', 'cp-seclabel', 'Text size'));
    const sel = /** @type {HTMLSelectElement} */ (el('select', 'cp-textsize'));
    [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40].forEach((s) => { const o = /** @type {HTMLOptionElement} */ (el('option', null, String(s))); o.value = /** @type {any} */ (s); sel.appendChild(o); });
    sel.value = String(extras.size.value || 14);
    sel.onchange = () => /** @type {any} */ (extras).size.onChange(parseInt(sel.value, 10));
    sec.appendChild(sel); body.appendChild(sec);
  }
  // optional Text style section (Bold / Italic toggles)
  if (extras && (extras.bold || extras.italic)) {
    const sec = el('div', 'cp-section'); sec.appendChild(el('div', 'cp-seclabel', 'Text style'));
    const wrap = el('div', 'cp-tstyle');
    if (extras.bold) {
      let bv = !!extras.bold.value;
      const b = /** @type {HTMLButtonElement} */ (el('button', 'cp-tsbtn' + (bv ? ' sel' : ''))); b.type = 'button'; b.textContent = 'B'; b.style.fontWeight = '700';
      b.onclick = () => { bv = !bv; /** @type {any} */ (extras).bold.onChange(bv); b.classList.toggle('sel', bv); };
      wrap.appendChild(b);
    }
    if (extras.italic) {
      let iv = !!extras.italic.value;
      const i = /** @type {HTMLButtonElement} */ (el('button', 'cp-tsbtn' + (iv ? ' sel' : ''))); i.type = 'button'; i.textContent = 'I'; i.style.fontStyle = 'italic';
      i.onclick = () => { iv = !iv; /** @type {any} */ (extras).italic.onChange(iv); i.classList.toggle('sel', iv); };
      wrap.appendChild(i);
    }
    sec.appendChild(wrap); body.appendChild(sec);
  }

  refreshSel();
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = clamp(r.left, 8, window.innerWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = clamp(r.bottom + 6, 8, window.innerHeight - pop.offsetHeight - 8) + 'px';
  pop._out = (/** @type {PointerEvent} */ e) => { if (pop && !pop.contains(e.target) && e.target !== anchor && !anchor.contains(/** @type {Node} */ (e.target)) && !(creator && creator.contains(e.target))) closeColorPicker(); };
  setTimeout(() => document.addEventListener('pointerdown', pop._out, true), 0);
}

// Custom colour creator: SV square + hue slider + hex, then Pick (apply the colour) or Add (save it to
// the active palette). handlers = { onPick(hex), onAdd(hex) }.
/** @param {HTMLElement} anchor @param {string} initialHex @param {{ onPick?: (v: string) => void, onAdd?: (v: string) => void }} [handlers] @returns {void} */
function openCustomCreator(anchor, initialHex, handlers) {
  closeCreator();
  const onPick = (handlers && handlers.onPick) || (() => {});
  const onAdd = (handlers && handlers.onAdd) || (() => {});
  let [h, s, v] = hexToHsv(initialHex || '#2962ff');
  creator = document.createElement('div'); creator.className = 'cc-pop';

  // Left = SV square (fills the space) + hue slider. Right column = preview swatch, hex field, then the
  // action buttons: Paste (fills the hex field from the clipboard), Pick (apply) and Add (save to palette).
  const body = document.createElement('div'); body.className = 'cc-body';
  const sv = document.createElement('div'); sv.className = 'cc-sv';
  const svDot = document.createElement('div'); svDot.className = 'cc-dot'; sv.appendChild(svDot);
  const hue = document.createElement('div'); hue.className = 'cc-hue';
  const hueDot = document.createElement('div'); hueDot.className = 'cc-huedot'; hue.appendChild(hueDot);
  const side = document.createElement('div'); side.className = 'cc-side';
  const preview = document.createElement('span'); preview.className = 'cc-preview';
  const hexI = document.createElement('input'); hexI.className = 'cc-hex'; hexI.spellcheck = false;
  const pasteBtn = document.createElement('button'); pasteBtn.type = 'button'; pasteBtn.className = 'cc-paste'; pasteBtn.textContent = 'Paste';
  const pickBtn = document.createElement('button'); pickBtn.type = 'button'; pickBtn.className = 'cc-pick'; pickBtn.textContent = 'Pick';
  const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'cc-add'; addBtn.textContent = 'Add';
  side.append(preview, hexI, pasteBtn, pickBtn, addBtn);
  body.append(sv, hue, side);
  creator.append(body);

  const sync = () => {
    const hx = hsvToHex(h, s, v);
    preview.style.background = hx;
    if (document.activeElement !== hexI) hexI.value = hx;
    sv.style.setProperty('--hue', hsvToHex(h, 1, 1));
    svDot.style.left = (s * 100) + '%';
    svDot.style.top = ((1 - v) * 100) + '%';
    hueDot.style.top = (h / 360 * 100) + '%';
  };
  const applyHexInput = () => { const nv = normHex(hexI.value); if (nv) [h, s, v] = hexToHsv(nv); sync(); };
  hexI.onchange = applyHexInput;
  // Paste: drop the clipboard text into the hex field (and update the picker if it is a valid colour). It
  // only fills the field -- the user then chooses Pick or Add.
  pasteBtn.onclick = async () => { try { const t = await navigator.clipboard.readText(); if (t != null) { hexI.value = t.trim(); applyHexInput(); } } catch (_) {} };
  pickBtn.onclick = () => onPick(hsvToHex(h, s, v));   // apply the colour (this closes the whole picker)
  addBtn.onclick = () => onAdd(hsvToHex(h, s, v));      // save to the palette; creator stays open to add more

  const dragSV = (/** @type {PointerEvent} */ e) => { const r = sv.getBoundingClientRect(); s = clamp((e.clientX - r.left) / r.width, 0, 1); v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); sync(); };
  const dragHue = (/** @type {PointerEvent} */ e) => { const r = hue.getBoundingClientRect(); h = clamp((e.clientY - r.top) / r.height, 0, 1) * 360; sync(); };
  bindDrag(sv, dragSV);
  bindDrag(hue, dragHue);

  document.body.appendChild(creator);
  const r = anchor.getBoundingClientRect();
  creator.style.left = clamp(r.left, 8, window.innerWidth - creator.offsetWidth - 8) + 'px';
  creator.style.top = clamp(r.bottom + 6, 8, window.innerHeight - creator.offsetHeight - 8) + 'px';
  creator._out = (/** @type {PointerEvent} */ e) => { if (creator && !creator.contains(e.target) && e.target !== anchor) closeCreator(); };
  setTimeout(() => document.addEventListener('pointerdown', creator._out, true), 0);
  sync();
}

// Make a fixed-position dialog draggable by a handle. Grabbing the handle moves the whole popup and
// clamps it to the viewport, so it can always be pulled back into view. Ignores clicks on the close button.
/** @param {HTMLElement} win @param {HTMLElement} handle @returns {void} */
function makeDraggable(win, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('.cp-title-x')) return;
    e.preventDefault();
    const r = win.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    win.style.left = r.left + 'px'; win.style.top = r.top + 'px';
    const mv = (/** @type {PointerEvent} */ ev) => {
      win.style.left = clamp(ev.clientX - ox, 4, window.innerWidth - win.offsetWidth - 4) + 'px';
      win.style.top = clamp(ev.clientY - oy, 4, window.innerHeight - win.offsetHeight - 4) + 'px';
    };
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  });
}

/** @param {HTMLElement} el @param {(e: PointerEvent) => void} onMove @returns {void} */
function bindDrag(el, onMove) {
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    onMove(e);
    const mv = (/** @type {PointerEvent} */ ev) => onMove(ev);
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
}

// A stroke control: shows a color swatch + a live line preview (the actual color,
// width and style), and opens the picker (with thickness/line-style sections).
// api = { color:{get,set}, width:{get,set}|null, lineStyle:{get,set}|null }
/** @param {StrokeApi} api @returns {HTMLButtonElement} */
export function strokeSwatch(api) {
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'cp-stroke')); btn.type = 'button';
  const sw = el('span', 'cp-stroke-sw'); const swc = el('span'); sw.appendChild(swc);
  const line = el('span', 'cp-stroke-line');
  btn.append(sw, line);
  const refresh = () => {
    const c = api.color.get();
    swc.style.background = c;
    line.style.borderBottomColor = c;
    line.style.borderBottomWidth = (api.width ? (api.width.get() || 1) : 2) + 'px';
    line.style.borderBottomStyle = api.lineStyle ? normLS(api.lineStyle.get()) : 'solid';
  };
  refresh();
  btn.onclick = () => {
    /** @type {ColorExtras} */
    const extras = {};
    if (api.width) extras.width = { value: api.width.get(), onChange: (w) => { /** @type {Accessor} */ (api.width).set(w); refresh(); } };
    if (api.lineStyle) extras.lineStyle = { value: api.lineStyle.get(), onChange: (v) => { /** @type {Accessor} */ (api.lineStyle).set(v); refresh(); } };
    openColorPicker(btn, api.color.get(), (v) => { api.color.set(v); refresh(); }, extras);
  };
  return btn;
}

// A text control: the twin of strokeSwatch. Shows a colour swatch + a live "Text" sample (its colour,
// bold, italic), and opens the picker with the text sections (size / bold / italic).
// api = { color:{get,set}, size:{get,set}|null, bold:{get,set}|null, italic:{get,set}|null }
/** @param {TextApi} api @returns {HTMLButtonElement} */
export function textSwatch(api) {
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'cp-stroke cp-text')); btn.type = 'button';
  const sw = el('span', 'cp-stroke-sw'); const swc = el('span'); sw.appendChild(swc);
  const sample = el('span', 'cp-text-sample', 'Text');
  btn.append(sw, sample);
  const refresh = () => {
    const c = api.color.get();
    swc.style.background = c;
    sample.style.color = c;
    sample.style.fontWeight = (api.bold && api.bold.get()) ? '700' : '400';
    sample.style.fontStyle = (api.italic && api.italic.get()) ? 'italic' : 'normal';
  };
  refresh();
  btn.onclick = () => {
    /** @type {ColorExtras} */
    const extras = {};
    if (api.size) extras.size = { value: api.size.get(), onChange: (v) => { /** @type {Accessor} */ (api.size).set(v); refresh(); } };
    if (api.bold) extras.bold = { value: api.bold.get(), onChange: (v) => { /** @type {Accessor} */ (api.bold).set(v); refresh(); } };
    if (api.italic) extras.italic = { value: api.italic.get(), onChange: (v) => { /** @type {Accessor} */ (api.italic).set(v); refresh(); } };
    openColorPicker(btn, api.color.get(), (v) => { api.color.set(v); refresh(); }, extras);
  };
  return btn;
}

/** @param {string|undefined} value @param {(v: string) => void} onChange @param {ColorExtras} [extras] @returns {HTMLButtonElement} */
export function colorSwatch(value, onChange, extras) {
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cp-swatch';
  const inner = document.createElement('span'); inner.className = 'cp-swatch-c'; btn.appendChild(inner);
  /** @type {any} */ (btn)._value = value || '#2962ff';
  inner.style.background = /** @type {any} */ (btn)._value;
  btn.onclick = () => openColorPicker(btn, /** @type {any} */ (btn)._value, (v) => { /** @type {any} */ (btn)._value = v; inner.style.background = v; onChange(v); }, extras);
  return btn;
}
