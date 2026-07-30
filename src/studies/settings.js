// @ts-check
// Per-indicator settings dialog. Declaration-driven and flat: it renders ONE panel from the
// study's declared `inputs` -- no built-in Style tab, no forced layout. A study
// controls exactly what appears; appearance is just another input (a `stroke` swatch, a `level`
// row), so a plain guide line shows a plain guide line's controls and nothing else. Edits apply
// live (recompute + persist). Group inputs with `group:`; richer control types keep it compact:
//   number | source | select | bool | color | text | stroke | level
// stroke -> a color+width+lineStyle swatch bound to an object param {color,width,style}
// level  -> a one-row guide line: [x show] Name  [value]  [stroke swatch], object param
//           {value, show, color, width, style}. Rendered by the study as a self-styled hline shape.
import { SOURCES } from './util.js';
import { makeDraggable } from '../ui/draggable.js';
import { strokeSwatch, colorSwatch, textSwatch, closeColorPicker } from '../ui/colorpicker.js';
import { saveStudyDefaults } from './defaults-store.js';
import { t as tr } from '../i18n/i18n.js'; // vocabulary lookup (aliased -- `t` is a tab name here; study/input names fall back to English)

/**
 * The owning pane (host object): `pane.studies` is the app StudyHost, `pane.tickSize` etc. Opaque here.
 * @typedef {any} Pane
 */
/** The settings overlay div, carrying the Escape-key handler it installed on document. */
/** @typedef {HTMLElement & { _onKey?: (e: KeyboardEvent) => void }} SettingsOverlay */
/** The tabbed panel body, remembering which tab is active across rerenders. */
/** @typedef {HTMLElement & { _activeTab?: string }} PanelBody */

/** @type {SettingsOverlay | null} */
let overlay = null;

export function closeStudySettings() {
  closeColorPicker();
  if (overlay) {
    if (overlay._onKey) document.removeEventListener('keydown', overlay._onKey);
    overlay.remove();
    overlay = null;
  }
}

/** @param {Pane} pane @param {number} index */
export function openStudySettings(pane, index) {
  closeStudySettings();
  const a = pane.studies.studyAt(index);
  if (!a) return;

  overlay = document.createElement('div');
  overlay.className = 'modal open';
  overlay.style.zIndex = '60';
  // Don't dim or block the chart: a transparent, click-THROUGH backdrop so you can watch the study
  // update live AND still pan/zoom/scroll the chart while adjusting settings. Only the dialog is
  // interactive; close via the Close button or Escape (outside-click no longer closes -- those clicks
  // now reach the chart).
  overlay.style.background = 'transparent';
  overlay.style.pointerEvents = 'none';

  const dlg = document.createElement('div');
  // per-study class (std-<id>) so a specific study can widen/tweak its own settings dialog in CSS
  dlg.className = 'dialog set-dlg std-dlg' + (a.study && a.study.id ? ' std-' + a.study.id : '');
  dlg.style.pointerEvents = 'auto';

  const head = document.createElement('div');
  head.className = 'set-head';
  const title = document.createElement('div');
  title.className = 'set-title';
  title.textContent = tr(a.study.name);
  head.appendChild(title);
  dlg.appendChild(head);
  makeDraggable(dlg, head); // drag the dialog by its header

  const body = document.createElement('div');
  body.className = 'set-body';
  const rerender = () => renderInputs(pane, index, body);
  dlg.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'dlg-actions';

  // "Defaults" dropdown: reset this instance to the study's built-in defaults, or save the
  // current settings as YOUR default for this study id (reloaded on every add).
  actions.appendChild(buildDefaultsMenu(pane, index, rerender));

  const closeBtn = document.createElement('button');
  closeBtn.className = 'primary';
  closeBtn.textContent = tr('Close');
  closeBtn.onclick = closeStudySettings;
  actions.appendChild(closeBtn);
  dlg.appendChild(actions);

  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  overlay._onKey = (e) => {
    if (e.key === 'Escape') closeStudySettings();
  }; // outside-click no longer closes
  document.addEventListener('keydown', overlay._onKey);
  rerender();
}

// ---- the panel: flat, or tabbed when any input declares a `tab` ----
// Tabs are ordered by first appearance; inputs without a `tab` fall under a default "Inputs" tab.
// If no input declares a tab, there's no tab bar -- just the flat panel.
/** @param {Pane} pane @param {number} index @param {PanelBody} body */
function renderInputs(pane, index, body) {
  body.innerHTML = '';
  const a = pane.studies.studyAt(index);
  // escape hatch: a study may render a fully custom settings body (full JS/HTML/CSS control) and still
  // get the dialog shell (header, Defaults, Close). Everything below is the declarative path.
  if (a && a.study && typeof a.study.settingsView === 'function') {
    a.study.settingsView({
      pane,
      index,
      container: body,
      params: () => pane.studies.studyAt(index).params,
      setParam: (/** @type {string} */ k, /** @type {any} */ v) => pane.studies.setParam(index, k, v),
      rerender: () => renderInputs(pane, index, body),
    });
    return;
  }
  /** @type {StudyInput[]} */
  const inputs = (a && a.study.inputs) || [];
  if (!inputs.length) {
    body.appendChild(note(tr('This indicator has no other settings.')));
    return;
  }

  const visible = inputs.filter((i) => !i.hidden); // siblings (hidden) still resolved against `inputs`
  if (!visible.some((i) => i.tab)) {
    const c = document.createElement('div');
    body.appendChild(c);
    renderRows(pane, index, c, visible, inputs);
    return;
  }

  /** @param {StudyInput} i */
  const tabOf = (i) => i.tab || 'Inputs';
  /** @type {string[]} */
  const order = [];
  visible.forEach((/** @type {StudyInput} */ i) => {
    const t = tabOf(i);
    if (!order.includes(t)) order.push(t);
  });

  const bar = document.createElement('div');
  bar.className = 'set-tabs';
  const content = document.createElement('div');
  /** @type {Record<string, HTMLElement>} */
  const tabEls = {};
  /** @param {string} t */
  const show = (t) => {
    body._activeTab = t;
    order.forEach((n) => tabEls[n].classList.toggle('active', n === t));
    renderRows(
      pane,
      index,
      content,
      visible.filter((i) => tabOf(i) === t),
      inputs,
    );
  };
  order.forEach((t) => {
    const el = document.createElement('div');
    el.className = 'set-tab';
    el.textContent = tr(t);
    el.onclick = () => show(t);
    tabEls[t] = el;
    bar.appendChild(el);
  });
  body.append(bar, content);
  show(order.includes(/** @type {string} */ (body._activeTab)) ? /** @type {string} */ (body._activeTab) : order[0]); // keep the tab across rerenders
}

// Render a list of input rows into `container`. Layout capabilities (all opt-in, per input):
//   group:      'Header'                    -> a section header before the row (as the group changes)
//   inline:     'id'                        -> controls sharing an id render on ONE flex row (wraps),
//                                              each a labeled cell; suppress a cell's label with noLabel
//   label:      'Text'                      -> override an inline cell's label (defaults to `name`)
//   width:      px | 'css'                  -> size a control (select/number/text)
//   right:      key | [keys]                -> unlabeled sibling control(s) on a bool row (compact)
//   showWhen:   fn(params)|'key'|{key,value}-> hide the row unless the condition holds (live)
//   enableWhen: fn(params)|'key'|{key,value}-> grey out + disable the row unless the condition holds (live)
// `showWhen`/`enableWhen` re-evaluate on every change via a shared refresh (no rebuild, keeps focus).
/** @param {Pane} pane @param {number} index @param {HTMLElement} container @param {StudyInput[]} rows @param {StudyInput[]} all */
function renderRows(pane, index, container, rows, all) {
  container.innerHTML = '';
  /** @type {{ el: HTMLElement, showWhen: any, enableWhen: any }[]} */
  const registry = []; // { el, showWhen, enableWhen } re-evaluated by refresh() -- row OR inline cell
  /** @param {HTMLElement | null | undefined} el @param {StudyInput} ip */
  const register = (el, ip) => {
    if (el && ip && (ip.showWhen || ip.enableWhen))
      registry.push({ el, showWhen: ip.showWhen, enableWhen: ip.enableWhen });
  };
  const refresh = () => {
    const P = pane.studies.studyAt(index).params;
    for (const r of registry) {
      const vis = !r.showWhen || evalCond(r.showWhen, P);
      r.el.style.display = vis ? '' : 'none';
      if (vis) r.el.classList.toggle('set-disabled', !!r.enableWhen && !evalCond(r.enableWhen, P));
    }
  };
  /** @type {string | null} */
  let group = null;
  /** @type {Set<string>} */
  const done = new Set();
  rows.forEach((inp) => {
    if (done.has(inp.key)) return;
    if (inp.group && inp.group !== group) {
      group = inp.group;
      const h = document.createElement('div');
      h.className = 'std-group';
      h.textContent = inp.group;
      container.appendChild(h);
    }

    let el;
    if (inp.type === 'level') {
      el = buildLevelRow(pane, index, inp, refresh);
      register(el, inp);
    } else if (inp.inline) {
      const members = rows.filter((x) => x.inline === inp.inline);
      members.forEach((m) => done.add(m.key));
      el = buildInlineRow(pane, index, members, refresh, register);
    } // registers each cell
    else {
      el = buildRow(pane, index, inp, all, refresh);
      register(el, inp);
    }

    container.appendChild(el);
  });
  refresh();
}

// a normal single-control row. bool: "[x] Name" (+ optional unlabeled `right` siblings). else: "Name [control]".
/** @param {Pane} pane @param {number} index @param {StudyInput} inp @param {StudyInput[]} all @param {() => void} refresh @returns {HTMLElement} */
function buildRow(pane, index, inp, all, refresh) {
  const a = pane.studies.studyAt(index);
  const row = document.createElement('div');
  row.className = 'set-row std-in';
  const left = document.createElement('div');
  left.className = 'set-row-left';
  const field = buildField(pane, index, inp, a.params[inp.key], refresh);
  if (inp.width && field && field.style) field.style.width = sizePx(inp.width);
  if (inp.type === 'bool') {
    const sp = document.createElement('span');
    sp.textContent = tr(nameOf(inp, a.params));
    left.append(field, sp);
    row.appendChild(left);
    const rights = inp.right == null ? [] : Array.isArray(inp.right) ? inp.right : [inp.right];
    if (rights.length) {
      const ctr = document.createElement('div');
      ctr.className = 'set-controls';
      rights.forEach((k) => {
        const sib = all.find((x) => x.key === k);
        if (sib) {
          const f = buildField(pane, index, sib, a.params[sib.key], refresh);
          if (sib.width && f && f.style) f.style.width = sizePx(sib.width);
          withBadge(ctr, f, sib, pane);
        }
      });
      row.appendChild(ctr);
    }
  } else {
    left.textContent = tr(nameOf(inp, a.params));
    const ctr = document.createElement('div');
    ctr.className = 'set-controls';
    withBadge(ctr, field, inp, pane);
    row.append(left, ctr);
  }
  return row;
}

// a horizontal group: the controls sharing `inline:'id'` on one flex row, each a labeled cell.
// A bool cell reads "[x] Name"; every other cell reads "Name [control]" (label suppressed by noLabel).
/** @param {Pane} pane @param {number} index @param {StudyInput[]} members @param {() => void} refresh @param {(el: HTMLElement | null | undefined, ip: StudyInput) => void} register @returns {HTMLElement} */
function buildInlineRow(pane, index, members, refresh, register) {
  const a = pane.studies.studyAt(index);
  const row = document.createElement('div');
  row.className = 'set-row std-in set-inline';
  members.forEach((inp) => {
    const cell = document.createElement('div');
    cell.className = 'set-inline-cell';
    const field = buildField(pane, index, inp, a.params[inp.key], refresh);
    if (inp.width && field && field.style) field.style.width = sizePx(inp.width);
    const labelText = inp.label != null ? inp.label : nameOf(inp, a.params);
    if (!inp.noLabel && labelText) {
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = labelText;
      if (inp.type === 'bool') cell.append(field, lbl);
      else cell.append(lbl, field);
    } else cell.appendChild(field);
    if (register) register(cell, inp); // per-cell showWhen/enableWhen
    row.appendChild(cell);
  });
  return row;
}

// condition forms: fn(params)->bool | 'key' (truthy) | { key, value } (equals) | { key, in:[...] }
/** @param {any} cond @param {Record<string, any>} params @returns {boolean} */
function evalCond(cond, params) {
  if (typeof cond === 'function') return !!cond(params);
  if (typeof cond === 'string') return !!params[cond];
  if (cond && typeof cond === 'object') {
    if (Array.isArray(cond.in)) return cond.in.includes(params[cond.key]);
    if ('value' in cond) return params[cond.key] === cond.value;
    return !!params[cond.key];
  }
  return true;
}
/** @param {number|string} w @returns {string} */
const sizePx = (w) => (typeof w === 'number' ? w + 'px' : w);
// a control's `name` (label) may be a function of the current params -> a live label, e.g. a
// Session toggle that reads "Session 1: New York". Resolved fresh each time the tab/panel renders.
// `name` is declared as a string on StudyInput, but a study may pass a fn(params)->string for a live label.
/** @param {StudyInput} inp @param {Record<string, any>} params @returns {string} */
const nameOf = (inp, params) =>
  typeof inp.name === 'function' ? /** @type {any} */ (inp.name)(params) : /** @type {string} */ (inp.name);

// one guide-line row (the `level` control)
/** @param {Pane} pane @param {number} index @param {StudyInput} inp @param {() => void} refresh @returns {HTMLElement} */
function buildLevelRow(pane, index, inp, refresh) {
  const params = pane.studies.studyAt(index).params;
  /** @returns {Record<string, any>} */
  const cur = () => params[inp.key] || inp.default || {};
  /** @param {Record<string, any>} patch */
  const set = (patch) => {
    pane.studies.setParam(index, inp.key, { ...cur(), ...patch });
    if (refresh) refresh();
  };

  const row = document.createElement('div');
  row.className = 'set-row std-in';
  const left = document.createElement('div');
  left.className = 'set-row-left';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = cur().show !== false;
  cb.onchange = () => set({ show: cb.checked });
  const sp = document.createElement('span');
  sp.textContent = tr(/** @type {string} */ (inp.name));
  left.append(cb, sp);

  const ctr = document.createElement('div');
  ctr.className = 'set-controls';
  const val = document.createElement('input');
  val.type = 'number';
  val.value = cur().value;
  // DOM min/max/step are string attributes; the study declares them as numbers -- assign as-is (the browser coerces).
  if (inp.min != null) val.min = /** @type {any} */ (inp.min);
  if (inp.max != null) val.max = /** @type {any} */ (inp.max);
  if (inp.step != null) val.step = /** @type {any} */ (inp.step);
  val.oninput = () => {
    const v = parseFloat(val.value);
    if (!Number.isNaN(v)) set({ value: v });
  };
  const sw = strokeSwatch({
    color: { get: () => cur().color, set: (/** @type {any} */ c) => set({ color: c }) },
    width: { get: () => cur().width, set: (/** @type {any} */ w) => set({ width: w }) },
    lineStyle: { get: () => cur().style, set: (/** @type {any} */ s) => set({ style: s }) },
  });
  ctr.append(val, sw);
  row.append(left, ctr);
  return row;
}

/** @param {Pane} pane @param {number} index @param {StudyInput} inp @param {any} current @param {() => void} refresh @returns {HTMLElement} */
function buildField(pane, index, inp, current, refresh) {
  /** @param {any} v */
  const set = (v) => {
    pane.studies.setParam(index, inp.key, v);
    if (refresh) refresh();
  };

  // a color input may carry `stroke: { width, lineStyle }` naming sibling input keys, so
  // colour + thickness + dash render as one stroke swatch (those siblings declare hidden:true).
  if (inp.type === 'color' && inp.stroke) {
    const params = pane.studies.studyAt(index).params;
    /** @param {string} key */
    const bind = (key) => ({
      get: () => params[key],
      set: (/** @type {any} */ v) => {
        pane.studies.setParam(index, key, v);
        if (refresh) refresh();
      },
    });
    return strokeSwatch({
      color: bind(inp.key),
      width: inp.stroke.width ? bind(inp.stroke.width) : null,
      lineStyle: inp.stroke.lineStyle ? bind(inp.stroke.lineStyle) : null,
    });
  }
  // stroke: a color+width+lineStyle swatch backed by a single object param {color,width,style}
  if (inp.type === 'stroke') {
    const params = pane.studies.studyAt(index).params;
    /** @returns {Record<string, any>} */
    const cur = () => params[inp.key] || inp.default || {};
    /** @param {Record<string, any>} patch */
    const setP = (patch) => {
      pane.studies.setParam(index, inp.key, { ...cur(), ...patch });
      if (refresh) refresh();
    };
    return strokeSwatch({
      color: { get: () => cur().color, set: (/** @type {any} */ c) => setP({ color: c }) },
      width: { get: () => cur().width, set: (/** @type {any} */ w) => setP({ width: w }) },
      lineStyle: { get: () => cur().style, set: (/** @type {any} */ s) => setP({ style: s }) },
    });
  }
  // a color input may carry `text: { size, bold, italic }` naming sibling input keys, so colour +
  // text size + bold/italic render as one text swatch (siblings declare hidden:true). Mirrors `stroke`.
  if (inp.type === 'color' && inp.text) {
    const params = pane.studies.studyAt(index).params;
    /** @param {string} key */
    const bind = (key) => ({
      get: () => params[key],
      set: (/** @type {any} */ v) => {
        pane.studies.setParam(index, key, v);
        if (refresh) refresh();
      },
    });
    return textSwatch({
      color: bind(inp.key),
      size: inp.text.size ? bind(inp.text.size) : null,
      bold: inp.text.bold ? bind(inp.text.bold) : null,
      italic: inp.text.italic ? bind(inp.text.italic) : null,
    });
  }
  if (inp.type === 'color') {
    // our picker (supports opacity -> rgba), not the native swatch which is opaque-only
    return colorSwatch(current || inp.default || '#888888', set);
  }
  if (inp.type === 'bool') {
    const f = document.createElement('input');
    f.type = 'checkbox';
    f.checked = !!current;
    f.onchange = () => set(f.checked);
    return f;
  }
  if (inp.type === 'select' || inp.type === 'source') {
    const opts = inp.type === 'source' ? SOURCES : inp.options || [];
    return mkSelect(opts, current != null ? current : inp.default, set);
  }
  if (inp.type === 'text') {
    const f = document.createElement('input');
    f.type = 'text';
    f.value = current != null ? current : inp.default || '';
    if (inp.placeholder) f.placeholder = inp.placeholder;
    f.oninput = () => set(f.value);
    return f;
  }
  // tz: a compact UTC-offset stepper (integer hours, -12..14) -- the app's own timezone control
  // instead of a 25-item legacy dropdown. Stores a NUMBER (hours east of UTC; 0 = UTC).
  if (inp.type === 'tz') {
    const wrap = document.createElement('span');
    wrap.className = 'set-tz';
    // DOM min/max/step/value are string attributes; assign the numbers as-is (the browser coerces).
    const num = document.createElement('input');
    num.type = 'number';
    num.min = /** @type {any} */ (-12);
    num.max = /** @type {any} */ (14);
    num.step = /** @type {any} */ (1);
    // tolerate a legacy 'UTC-4'/'UTC+2'/'UTC' string (older saved params) -> show its numeric hours
    /** @param {any} v @returns {number|null} */
    const coerce = (v) => {
      if (typeof v === 'number') return v;
      const m = /^UTC([+-]\d+)?$/.exec(String(v || '').trim());
      return m ? (m[1] ? parseInt(m[1], 10) : 0) : null;
    };
    const cv = coerce(current);
    num.value = /** @type {any} */ (cv != null ? cv : inp.default != null ? inp.default : 0);
    /** @param {number} v */
    const setH = (v) => {
      const r = Math.round(v);
      const c = Number.isNaN(r) ? 0 : Math.max(-12, Math.min(14, r));
      num.value = /** @type {any} */ (c);
      set(c);
    };
    /** @param {string} t @param {number} d */
    const step = (t, d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'set-tz-step';
      b.textContent = t;
      b.onclick = () => setH((parseInt(num.value, 10) || 0) + d);
      return b;
    };
    num.onchange = () => {
      const v = parseInt(num.value, 10);
      if (!Number.isNaN(v)) setH(v);
    };
    wrap.append(step('-', -1), num, step('+', 1));
    return wrap;
  }
  if (inp.type === 'range') {
    const f = document.createElement('input');
    f.type = 'range';
    f.value = current != null ? current : inp.default;
    if (inp.min != null) f.min = /** @type {any} */ (inp.min);
    if (inp.max != null) f.max = /** @type {any} */ (inp.max);
    if (inp.step != null) f.step = /** @type {any} */ (inp.step);
    f.oninput = () => {
      const v = parseFloat(f.value);
      if (!Number.isNaN(v)) set(v);
    };
    return f;
  }
  // number (default)
  const f = document.createElement('input');
  f.type = 'number';
  f.value = current != null ? current : inp.default;
  if (inp.min != null) f.min = /** @type {any} */ (inp.min);
  if (inp.max != null) f.max = /** @type {any} */ (inp.max);
  if (inp.step != null) f.step = /** @type {any} */ (inp.step);
  f.oninput = () => {
    const v = parseFloat(f.value);
    if (!Number.isNaN(v)) set(v);
  };
  return f;
}

// "Defaults" dropdown for the footer: Reset settings (instance -> built-in defaults) and
// Save as default (persist current settings as the user's default for this study id).
/** @param {Pane} pane @param {number} index @param {() => void} rerender @returns {HTMLElement} */
function buildDefaultsMenu(pane, index, rerender) {
  const wrap = document.createElement('div');
  wrap.style.marginRight = 'auto'; // push it to the LEFT of the footer, Close stays on the right
  wrap.style.position = 'relative';

  const btn = document.createElement('button');
  btn.textContent = tr('Defaults') + ' ▾';

  const menu = document.createElement('div');
  menu.className = 'std-defaults-menu';
  Object.assign(menu.style, {
    position: 'absolute',
    bottom: '100%',
    left: '0',
    marginBottom: '4px',
    minWidth: '180px',
    background: 'var(--panel)',
    border: '1px solid var(--bd)',
    borderRadius: '6px',
    padding: '4px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.3)',
    display: 'none',
    zIndex: '5',
  });
  const close = () => {
    menu.style.display = 'none';
  };

  /** @param {string} label @param {() => void} fn */
  const item = (label, fn) => {
    const d = document.createElement('div');
    d.className = 'menu-action';
    d.textContent = tr(label);
    d.onclick = () => {
      close();
      fn();
    };
    return d;
  };
  menu.appendChild(
    item('Reset settings', () => {
      pane.studies.resetDefaults(index);
      rerender();
    }),
  );
  menu.appendChild(
    item('Save as default', () => {
      const a = pane.studies.studyAt(index);
      if (a) {
        saveStudyDefaults(a.study.id, a.params, a.style);
        btn.textContent = tr('Saved') + ' ✓';
        setTimeout(() => {
          btn.textContent = tr('Defaults') + ' ▾';
        }, 1200);
      }
    }),
  );

  btn.onclick = (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  };
  document.addEventListener('click', (e) => {
    if (!wrap.contains(/** @type {Node | null} */ (e.target))) close();
  });

  wrap.append(btn, menu);
  return wrap;
}

// ---- bar-count -> time read-out (the "TF calculator") ----
// Convert a bar COUNT to the wall-clock window it spans on the CURRENT chart timeframe. Uses the
// SMALLEST gap between recent bars as the true TF (session/overnight gaps are larger, so the minimum
// delta is exactly one bar) -- averaging would be inflated by gaps and read e.g. "6m" for a 5m chart.
/** @param {Pane} pane @returns {number|null} */
function currentBarSeconds(pane) {
  const bars = (pane && pane.studies && pane.studies.bars) || [];
  if (bars.length < 2) return null;
  let min = Infinity;
  for (let i = Math.max(1, bars.length - 60); i < bars.length; i++) {
    const d = bars[i].time - bars[i - 1].time;
    if (d > 0 && d < min) min = d;
  }
  return Number.isFinite(min) ? min : null;
}
/** @param {number} count @param {Pane} pane @returns {string} */
function barsToDuration(count, pane) {
  const sec = currentBarSeconds(pane);
  if (!sec || !count || count < 1) return '';
  let t = Math.round(count * sec);
  const D = 86400,
    H = 3600,
    M = 60;
  const d = Math.floor(t / D);
  t -= d * D;
  const h = Math.floor(t / H);
  t -= h * H;
  const m = Math.floor(t / M);
  /** @type {string[]} */
  const parts = [];
  if (d) parts.push(d + 'D');
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  return '= ' + (parts.join(' ') || '0m');
}
// append a control to `ctr`, plus a live time read-out badge when the input declares showDuration.
/** @param {HTMLElement} ctr @param {any} field @param {StudyInput} inp @param {Pane} pane */
function withBadge(ctr, field, inp, pane) {
  ctr.appendChild(field);
  if (!inp.showDuration) return;
  const badge = document.createElement('span');
  badge.className = 'std-tf-badge';
  badge.style.cssText = 'margin-left:8px;font-size:11px;opacity:0.6;white-space:nowrap';
  const upd = () => {
    badge.textContent = barsToDuration(parseFloat(field.value), pane);
  };
  field.addEventListener('input', upd);
  upd();
  ctr.appendChild(badge);
}

// ---- small DOM helpers ----
/** @param {{ key: string, name: string }[]} opts @param {any} value @param {(v: string) => void} onChange @returns {HTMLSelectElement} */
function mkSelect(opts, value, onChange) {
  const f = document.createElement('select');
  opts.forEach((o) => {
    const op = document.createElement('option');
    op.value = o.key;
    op.textContent = tr(o.name);
    f.appendChild(op);
  });
  f.value = value;
  f.onchange = () => onChange(f.value);
  return f;
}
/** @param {string} text @returns {HTMLElement} */
function note(text) {
  const d = document.createElement('div');
  d.className = 'set-note';
  d.textContent = text;
  return d;
}
