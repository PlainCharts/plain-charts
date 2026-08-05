// @ts-check
// Drawing settings dialog (tabbed). The tab SET is fixed
// (Style · Text · Coordinates · Visibility); the CONTENT of each tab is declared
// by the shape via tool.settings[tab] (a list of rows). A row = { name, toggle?,
// controls:[{key,type,...}] }. Style falls back to the shape's flat styleSchema;
// Coordinates is generated generically from the drawing's points. Edits preview
// live; Cancel reverts to a snapshot, OK persists.
import { getTool } from '../registry.js';
import { closeColorPicker } from '../../ui/colorpicker.js';
import { makeDraggable } from '../../ui/draggable.js';
import { closeLineStyleMenu } from '../../ui/linestyle.js';
import { buildRow, closeMultiMenu } from './style-controls.js';
import { renderTextTab } from './text-tab.js';
import { renderCoordsTab } from './coords-tab.js';
import { openToolTemplateMenu, closeToolTemplateMenu, isToolTemplateMenuOpen } from './settings-template-menu.js';
import { saveToolDefaults } from '../tool-defaults.js';
import { buildVisibilityRows } from './visibility-ui.js';

/** One anchor point of a drawing (may carry a price and/or a time). */
/** @typedef {{ price?: number|null, time?: number|null }} Point */
/** A drawing's text styling (color/size/weight + alignment + orientation). */
/** @typedef {{ color?: string, size?: number, bold?: boolean, italic?: boolean, vAlign?: string, hAlign?: string, orientation?: string }} TextStyle */
/** One drawing object, as this dialog reads/writes it. `style` is an open bag of appearance keys. */
/** @typedef {{ id: string, tool: string, points: Point[], style: Record<string, any>, text?: string, textStyle?: TextStyle, hidden?: boolean, visibility?: any }} Drawing */
/** The live dialog state: the engine, the edited drawing id, a revert snapshot, and the active tab. */
/** @typedef {{ engine: any, id: string, tab: string, snapshot: any }} DialogState */
/** One control spec inside a settings row (declared by the tool). */
/** @typedef {{ key?: string, type?: string, options?: any[], min?: number, max?: number, step?: number, width?: string, lineStyle?: string, size?: string, bold?: string, italic?: string, placeholder?: string }} ControlSpec */

// Style/Coordinates/Visibility are inherent to a drawing (always shown). Inputs and Text are OPT-IN: a tool
// gets them only by declaring `settings.inputs` / `settings.text` (see tabAvailable).
const TABS = ['Inputs', 'Style', 'Text', 'Coordinates', 'Visibility'];

// which tabs a tool actually offers. The three drawing-inherent tabs are always available; Text and Inputs
// are opt-in via the tool's settings (Text also honors the `textEnabled` flag, e.g. range's conventional mode).
/** @param {string} t @param {any} tool @param {Drawing} d @returns {boolean} */
function tabAvailable(t, tool, d) {
  if (t === 'Text') return !!(tool.settings && tool.settings.text) && (!tool.textEnabled || tool.textEnabled(d));
  if (t === 'Inputs') return !!(tool.settings && tool.settings.inputs);
  return true; // Style / Coordinates / Visibility
}

/** @type {HTMLElement | null} */
let overlay = null;
/** @type {DialogState | null} */
let state = null; // { engine, id, snapshot, tab }

export function closeSettingsDialog() {
  closeColorPicker();
  closeLineStyleMenu();
  closeToolTemplateMenu();
  closeMultiMenu();
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  state = null;
}

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

// repaint after an edit — broadcasts so a synced drawing updates on every pane,
// a local one only on its own pane.
function preview() {
  if (!state) return;
  state.engine.liveUpdate(state.engine.get(state.id));
}

/**
 * @param {any} engine   the pane's DrawingEngine (opaque handle; not typed here)
 * @param {string} id
 * @param {string} [startTab]
 */
export function openSettingsDialog(engine, id, startTab) {
  closeSettingsDialog();
  const d = /** @type {Drawing | undefined} */ (engine.get(id));
  // tool carries open, author-defined extras (textEnabled, styleSchema, settings, …) beyond the shared ToolDef
  const tool = d && /** @type {any} */ (getTool(d.tool));
  if (!d || !tool) return;
  // open on a requested tab (e.g. double-click the text → 'Text'), but only if it's
  // valid and — for Text — the tool actually supports it.
  // open on the requested tab only if it exists AND the tool offers it; otherwise Style (always available)
  let tab =
    TABS.includes(/** @type {string} */ (startTab)) && tabAvailable(/** @type {string} */ (startTab), tool, d)
      ? /** @type {string} */ (startTab)
      : 'Style';
  state = {
    engine,
    id,
    tab,
    snapshot: JSON.parse(
      JSON.stringify({
        points: d.points,
        style: d.style,
        hidden: d.hidden,
        text: d.text,
        textStyle: d.textStyle,
        visibility: d.visibility,
      }),
    ),
  };

  overlay = el('div', 'modal open');
  overlay.style.zIndex = '70';
  overlay.style.background = 'transparent';
  overlay.onclick = (e) => {
    if (e.target === overlay) ok();
  }; // click away onto the canvas → save (not cancel)
  const dlg = el('div', 'dialog set-dlg');

  const head = el('div', 'set-head');
  head.append(
    el('span', 'set-title', tool.name),
    (() => {
      const x = el('span', 'lib-x', '✕');
      x.onclick = cancel;
      x.onpointerdown = (e) => e.stopPropagation();
      return x;
    })(),
  ); // the ✕ is not a drag handle
  dlg.appendChild(head);

  const tabbar = el('div', 'set-tabs');
  TABS.forEach((t) => {
    if (!tabAvailable(t, tool, d)) return; // opt-in tabs (Text/Inputs) only when the tool declares them
    const b = el('div', 'set-tab' + (t === /** @type {DialogState} */ (state).tab ? ' active' : ''), t);
    b.onclick = () => {
      /** @type {DialogState} */ (state).tab = t;
      renderTabs();
      renderBody();
    };
    tabbar.appendChild(b);
  });
  dlg.appendChild(tabbar);

  const body = el('div', 'set-body');
  dlg.appendChild(body);

  const foot = el('div', 'dlg-actions');
  const tplBtn = el('button', 'set-tpl-btn', 'Template ▾');
  tplBtn.onclick = () => {
    if (isToolTemplateMenuOpen()) {
      closeToolTemplateMenu();
      return;
    }
    const st = /** @type {DialogState} */ (state);
    openToolTemplateMenu(tplBtn, {
      engine: st.engine,
      id: st.id,
      afterApply: () => {
        preview();
        renderBody();
      },
    });
  };
  const cancelBtn = el('button', null, 'Cancel');
  cancelBtn.onclick = cancel;
  const okBtn = el('button', 'primary', 'Ok');
  okBtn.onclick = ok;
  foot.append(tplBtn, cancelBtn, okBtn);
  dlg.appendChild(foot);

  overlay.appendChild(dlg);
  document.body.appendChild(overlay);

  // float + drag by the header (so it doesn't sit on top of the drawing) -- the shared makeDraggable
  dlg.style.position = 'fixed';
  dlg.style.margin = '0';
  dlg.style.left = Math.max(8, (window.innerWidth - dlg.offsetWidth) / 2) + 'px';
  dlg.style.top = Math.max(8, (window.innerHeight - dlg.offsetHeight) / 3) + 'px';
  makeDraggable(dlg, head);

  const renderTabs = () =>
    tabbar
      .querySelectorAll('.set-tab')
      .forEach((b) => b.classList.toggle('active', b.textContent === /** @type {DialogState} */ (state).tab));
  const renderBody = () => {
    body.innerHTML = '';
    const st = /** @type {DialogState} */ (state);
    if (st.tab === 'Inputs') renderInputs(body);
    else if (st.tab === 'Style') renderStyle(body);
    else if (st.tab === 'Text') renderTextTab(body, /** @type {Drawing} */ (st.engine.get(st.id)), preview);
    else if (st.tab === 'Coordinates')
      renderCoordsTab(body, /** @type {Drawing} */ (st.engine.get(st.id)), st.engine.pane, preview);
    else if (st.tab === 'Visibility') renderVisibility(body);
    else body.appendChild(el('div', 'set-soon', st.tab + ' options — coming soon.'));
  };
  renderBody();
  // focus the text box when opened straight on the Text tab (add/edit text flow)
  if (/** @type {DialogState} */ (state).tab === 'Text') {
    const ta = /** @type {HTMLTextAreaElement | null} */ (body.querySelector('.set-text-area'));
    if (ta) {
      ta.focus();
      ta.select();
    }
  }
}

function cancel() {
  if (state) {
    const d = state.engine.get(state.id);
    if (d) {
      d.points = state.snapshot.points;
      d.style = state.snapshot.style;
      d.hidden = state.snapshot.hidden;
      d.text = state.snapshot.text;
      d.textStyle = state.snapshot.textStyle;
      d.visibility = state.snapshot.visibility;
      state.engine.persist();
      preview();
    }
  }
  closeSettingsDialog();
}
function ok() {
  if (state) {
    state.engine.persist();
    // remember this tool's appearance (style + textStyle) as the default for new drawings
    const d = state.engine.get(state.id);
    if (d) saveToolDefaults(d.tool, d.style, d.textStyle);
  }
  closeSettingsDialog();
}

// ---- Inputs tab (opt-in via tool.settings.inputs) -- the tool's own parameters. `settings.inputs` is either
// a FUNCTION (the tool renders its own panel -- e.g. levels bound to d.points) called with (body, d, ctx), or
// an array of Style-style rows (buildRow). Blank when empty. ----
/** @param {HTMLElement} body */
function renderInputs(body) {
  const st = /** @type {DialogState} */ (state);
  const d = /** @type {Drawing} */ (st.engine.get(st.id));
  const tool = /** @type {any} */ (getTool(d.tool));
  const inputs = tool.settings && tool.settings.inputs;
  if (typeof inputs === 'function') {
    inputs(body, d, { preview, tickSize: st.engine.pane.tickSize, priceDecimals: st.engine.pane.priceDecimals });
    return;
  }
  const rows = inputs || [];
  rows.forEach((/** @type {any} */ row) => body.appendChild(buildRow(d, row, preview)));
  if (!rows.length) body.appendChild(el('div', 'set-soon', 'No inputs yet.'));
}

// ---- Style tab (from tool.settings.style or the flat styleSchema) ----
/** @param {HTMLElement} body */
function renderStyle(body) {
  const st = /** @type {DialogState} */ (state);
  const d = /** @type {Drawing} */ (st.engine.get(st.id));
  const tool = /** @type {any} */ (getTool(d.tool));
  const rows =
    (tool.settings && tool.settings.style) ||
    (tool.styleSchema || []).map((/** @type {any} */ f) => ({
      name: f.name,
      controls: [{ key: f.key, type: f.type, options: f.options, min: f.min, max: f.max }],
    }));
  rows.forEach((/** @type {any} */ row) => body.appendChild(buildRow(d, row, preview)));
  if (!rows.length) body.appendChild(el('div', 'set-soon', 'No style options.'));
}

// The control widgets themselves (stroke/text swatches, the generic control set, the multi-select
// dropdown, the Fib level grid) live in ./style-controls.js — buildRow builds everything in a row.

// ---- Visibility tab (per-timeframe show/hide) ----
// Each row: an enable checkbox + a min..max range (two number inputs around a
// dual-handle slider) over the bar count for that unit. d.visibility is created
// lazily, full structure, so OK persists it and Cancel reverts via the snapshot.
/** @param {HTMLElement} body */
function renderVisibility(body) {
  const st = /** @type {DialogState} */ (state);
  const d = /** @type {Drawing} */ (st.engine.get(st.id));
  if (!d.visibility) d.visibility = {};
  buildVisibilityRows(d.visibility, preview, 'Show this drawing only on the selected timeframes.').forEach(
    (/** @type {HTMLElement} */ e) => body.appendChild(e),
  );
}
