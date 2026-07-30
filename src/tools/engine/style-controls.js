// @ts-check
// The style control factory for the drawing settings dialog: turns a tool's declarative settings row
// ({ name, toggle?, fields?, controls:[{key,type,...}] }) into live DOM controls bound to d.style,
// each edit calling the dialog's preview(). Combined swatches (stroke / text), the generic control
// set (color / range / linestyle / text / bool / select / number), the multi-select dropdown (one
// open at a time), and the Fib level grid all live here. The dialog builds rows; this file builds
// what's inside them.
import { colorSwatch, strokeSwatch, textSwatch } from '../../ui/colorpicker.js';
import { lineStyleControl } from '../../ui/linestyle.js';

/** One drawing object, as the factory reads/writes it. `style` is an open bag of appearance keys. */
/** @typedef {{ id: string, tool: string, points: any[], style: Record<string, any>, text?: string, textStyle?: any, hidden?: boolean, visibility?: any }} Drawing */
/** The dialog's repaint callback (liveUpdate on the edited drawing). */
/** @typedef {() => void} Preview */

/**
 * @param {string} tag @param {string | null} [cls] @param {string} [txt]
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/** @type {HTMLElement | null} */
let multiMenu = null;
/** @type {HTMLElement | null} */
let multiBtn = null; // multi-select (Stats) dropdown

export function closeMultiMenu() {
  if (multiMenu) {
    multiMenu.remove();
    multiMenu = null;
    multiBtn = null;
    document.removeEventListener('pointerdown', multiAway, true);
  }
}
/** @param {PointerEvent} e */
function multiAway(e) {
  const t = /** @type {Node | null} */ (e.target);
  if (multiMenu && !multiMenu.contains(t) && !(multiBtn && multiBtn.contains(t))) closeMultiMenu();
}

// The Fib level grid: two columns of [enable · value · color · remove] rows + Add.
// Operates on d.style.levels; clones into an own copy first so the tool's shared
// defaultStyle.levels is never mutated.
/** @param {Drawing} d @param {Preview} preview @returns {HTMLElement} */
function fibLevelsControl(d, preview) {
  d.style.levels = (d.style.levels || []).map((/** @type {any} */ l) => ({ ...l }));
  const sdef = d.style || {}; // global Levels-line width/style act as the per-level default
  const wrap = el('div', 'fib-levels');
  const grid = el('div', 'fib-levels-grid');
  const render = () => {
    grid.innerHTML = '';
    d.style.levels.forEach((/** @type {any} */ lv, /** @type {number} */ i) => {
      const rowc = el('div', 'fib-lv');
      const chk = /** @type {HTMLInputElement} */ (el('input'));
      chk.type = 'checkbox';
      chk.checked = lv.on !== false;
      chk.onchange = () => {
        lv.on = chk.checked;
        preview();
      };
      const val = /** @type {HTMLInputElement} */ (el('input', 'fib-lv-val'));
      val.type = 'number';
      val.step = 'any';
      val.value = lv.value;
      val.onchange = () => {
        const v = parseFloat(val.value);
        if (!Number.isNaN(v)) {
          lv.value = v;
          preview();
        }
      };
      // per-level stroke: colour + width + line style (overrides the global Levels line)
      const acc = (/** @type {string} */ k, /** @type {any} */ dflt) => ({
        get: () => (lv[k] != null ? lv[k] : dflt),
        set: (/** @type {any} */ v) => {
          lv[k] = v;
          preview();
        },
      });
      const sw = strokeSwatch({
        color: acc('color', '#787b86'),
        width: acc('width', sdef.lineWidth || 1),
        lineStyle: acc('lineStyle', sdef.lineStyle || 'solid'),
      });
      const del = el('span', 'fib-lv-del', '✕');
      del.title = 'Remove level';
      del.onclick = () => {
        d.style.levels.splice(i, 1);
        render();
        preview();
      };
      rowc.append(chk, val, sw, del);
      grid.appendChild(rowc);
    });
  };
  render();
  const add = /** @type {HTMLButtonElement} */ (el('button', 'fib-lv-add'));
  add.type = 'button';
  add.textContent = '+ Add level';
  add.onclick = () => {
    d.style.levels.push({ value: 0, on: true, color: '#787b86' });
    render();
    preview();
  };
  wrap.append(grid, add);
  return wrap;
}

// Build the widget for one control spec, bound to d.style: a combined stroke swatch (color+width+style),
// a text swatch (color+size+bold+italic), or a generic control.
// `ctrl`/`row` are open, author-declared tool-settings shapes → typed `any`.
/** @param {Drawing} d @param {any} ctrl @param {Preview} preview */
function controlWidget(d, ctrl, preview) {
  const acc = (/** @type {string} */ key) => ({
    get: () => d.style[key],
    set: (/** @type {any} */ v) => {
      d.style[key] = v;
      preview();
    },
  });
  if (ctrl.type === 'color' && (ctrl.width || ctrl.lineStyle)) {
    return strokeSwatch({
      color: acc(ctrl.key),
      width: ctrl.width ? acc(ctrl.width) : null,
      lineStyle: ctrl.lineStyle ? acc(ctrl.lineStyle) : null,
    });
  }
  if (ctrl.type === 'color' && (ctrl.size || ctrl.bold || ctrl.italic)) {
    return textSwatch({
      color: acc(ctrl.key),
      size: ctrl.size ? acc(ctrl.size) : null,
      bold: ctrl.bold ? acc(ctrl.bold) : null,
      italic: ctrl.italic ? acc(ctrl.italic) : null,
    });
  }
  return buildControl(
    ctrl,
    () => d.style[ctrl.key],
    (v) => {
      d.style[ctrl.key] = v;
      preview();
    },
  );
}

/** @param {Drawing} d @param {any} row @param {Preview} preview */
export function buildRow(d, row, preview) {
  // several labelled fields on ONE row (each: optional toggle + label + control), e.g. Label + Background.
  if (row.fields) {
    const r = el('div', 'set-row set-fields');
    row.fields.forEach((/** @type {any} */ f) => {
      const cell = el('div', 'set-field');
      const w = controlWidget(d, f, preview);
      if (f.toggle) {
        const chk = /** @type {HTMLInputElement} */ (el('input'));
        chk.type = 'checkbox';
        chk.checked = f.toggleDefault === true ? d.style[f.toggle] !== false : !!d.style[f.toggle];
        const sync = () => {
          w.style.opacity = chk.checked ? '1' : '.4';
          w.style.pointerEvents = chk.checked ? '' : 'none';
        };
        chk.onchange = () => {
          d.style[f.toggle] = chk.checked;
          preview();
          sync();
        };
        cell.appendChild(chk);
        setTimeout(sync, 0);
      }
      if (f.name) cell.appendChild(el('label', null, f.name));
      cell.appendChild(w);
      r.appendChild(cell);
    });
    return r;
  }
  // full-width custom block (e.g. the Fib level grid) — label on its own line, control below
  if (row.controls && row.controls.length === 1 && row.controls[0].type === 'fiblevels') {
    const block = el('div', 'set-row set-row-block');
    if (row.name) block.appendChild(el('div', 'set-block-label', row.name));
    block.appendChild(fibLevelsControl(d, preview));
    return block;
  }
  const r = el('div', 'set-row');
  const left = el('div', 'set-row-left');
  const controls = el('div', 'set-controls');

  if (row.toggle) {
    const chk = /** @type {HTMLInputElement} */ (el('input'));
    chk.type = 'checkbox';
    chk.checked = row.toggleDefault === true ? d.style[row.toggle] !== false : !!d.style[row.toggle];
    const sync = () => {
      controls.style.opacity = chk.checked ? '1' : '.4';
      controls.style.pointerEvents = chk.checked ? '' : 'none';
    };
    chk.onchange = () => {
      d.style[row.toggle] = chk.checked;
      preview();
      sync();
    };
    left.appendChild(chk);
    setTimeout(sync, 0);
  }
  left.appendChild(el('label', null, row.name));
  r.appendChild(left);

  (row.controls || []).forEach((/** @type {any} */ ctrl) => controls.appendChild(controlWidget(d, ctrl, preview)));
  r.appendChild(controls);
  return r;
}

// A dropdown of checkboxes (multi-select). Bound to an
// array value via get()/set(). The menu is appended to <body> so it isn't clipped by the
// dialog; one menu open at a time (closeMultiMenu).
/** @param {any} ctrl @param {() => any} get @param {(v: any) => void} set @returns {HTMLElement} */
function multiSelectControl(ctrl, get, set) {
  const options = ctrl.options || [];
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'set-multi'));
  btn.type = 'button';
  const lbl = el('span');
  const car = el('span', null, '⌄');
  car.style.color = 'var(--tx-dim)';
  btn.append(lbl, car);
  const summary = () => {
    const sel = get() || [];
    const names = options.filter((/** @type {any} */ o) => sel.includes(o.key)).map((/** @type {any} */ o) => o.name);
    lbl.textContent = names.length === 0 ? 'None' : names.length === 1 ? names[0] : names[0] + ', …';
  };
  summary();
  btn.onclick = () => {
    if (multiMenu) {
      closeMultiMenu();
      return;
    }
    const menu = el('div', 'dwg-menu');
    multiMenu = menu;
    multiBtn = btn;
    options.forEach((/** @type {any} */ o) => {
      const row = el('div', 'dwg-item');
      const ck = el('span', 'dwg-check');
      const paint = () => {
        ck.textContent = (get() || []).includes(o.key) ? '✓' : '';
      };
      row.append(ck, document.createTextNode(o.name));
      row.onclick = () => {
        const has = (get() || []).includes(o.key);
        const next = has ? (get() || []).filter((/** @type {any} */ k) => k !== o.key) : [...(get() || []), o.key];
        set(options.filter((/** @type {any} */ op) => next.includes(op.key)).map((/** @type {any} */ op) => op.key)); // keep option order
        paint();
        summary();
      };
      paint();
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    menu.style.minWidth = r.width + 'px';
    setTimeout(() => document.addEventListener('pointerdown', multiAway, true), 0);
  };
  return btn;
}

// generic control bound to get()/set(); a color control may carry width/lineStyle extras
/** @param {any} ctrl @param {() => any} get @param {(v: any) => void} set @param {any} [extras] @returns {HTMLElement} */
function buildControl(ctrl, get, set, extras) {
  if (ctrl.type === 'color') return colorSwatch(get(), (/** @type {any} */ v) => set(v), extras);
  if (ctrl.type === 'multiselect') return multiSelectControl(ctrl, get, set);
  if (ctrl.type === 'range') {
    const i = /** @type {HTMLInputElement} */ (el('input'));
    i.type = 'range';
    i.min = ctrl.min != null ? ctrl.min : 0;
    i.max = ctrl.max != null ? ctrl.max : 1;
    i.step = ctrl.step != null ? ctrl.step : 0.05;
    i.value = get() != null ? get() : i.max;
    i.oninput = () => set(parseFloat(i.value));
    return i;
  }
  if (ctrl.type === 'linestyle') return lineStyleControl(get(), (/** @type {any} */ v) => set(v));
  if (ctrl.type === 'text') {
    const i = /** @type {HTMLInputElement} */ (el('input'));
    i.type = 'text';
    i.value = get() || '';
    if (ctrl.placeholder) i.placeholder = ctrl.placeholder;
    i.oninput = () => set(i.value);
    return i;
  }
  if (ctrl.type === 'bool') {
    const i = /** @type {HTMLInputElement} */ (el('input'));
    i.type = 'checkbox';
    i.checked = !!get();
    i.onchange = () => set(i.checked);
    return i;
  }
  if (ctrl.type === 'select') {
    const s = /** @type {HTMLSelectElement} */ (el('select'));
    (ctrl.options || []).forEach((/** @type {any} */ o) => {
      const op = /** @type {HTMLOptionElement} */ (el('option', null, o.name));
      op.value = o.key;
      s.appendChild(op);
    });
    s.value = get();
    s.onchange = () => set(s.value);
    return s;
  }
  const i = /** @type {HTMLInputElement} */ (el('input'));
  i.type = 'number';
  if (ctrl.min != null) i.min = ctrl.min;
  if (ctrl.max != null) i.max = ctrl.max;
  i.value = get();
  i.oninput = () => {
    const v = parseFloat(i.value);
    if (!Number.isNaN(v)) set(v);
  };
  return i;
}
