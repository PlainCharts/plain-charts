// @ts-check
// Template submenu for a drawing's right-click menu (chart + object tree): apply a
// saved per-tool template with one click, "Apply default" to reset to the tool's
// default style, or "Save as…" which opens a name dialog that autocompletes against
// existing templates (picking an existing name overwrites it).
import { getTool } from '../registry.js';
import { listToolTemplates, saveToolTemplate } from '../tool-templates.js';
import { confirmDialog } from '../../ui/confirm.js';

/** A saved per-tool preset: appearance (style/textStyle) + optional label; never geometry. */
/** @typedef {{ name?: string, style?: Record<string, any>, textStyle?: Record<string, any>, text?: string }} Template */
/** One drawing object, as this menu reads/writes it. */
/** @typedef {{ id: string, tool: string, style?: Record<string, any>, textStyle?: Record<string, any>, text?: string }} Drawing */
/** Options for buildTemplateItem. */
/** @typedef {{ onClose?: () => void, flyLeft?: boolean }} TemplateItemOpts */

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
/** @template T @param {T} o @returns {T} */
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- apply ----
/** @param {any} engine @param {string} id @param {Template} t */
function applyTemplate(engine, id, t) {
  const d = /** @type {Drawing | undefined} */ (engine.get(id));
  if (!d) return;
  if (t.style) d.style = { ...d.style, ...clone(t.style) };
  if (t.textStyle) d.textStyle = { ...(d.textStyle || {}), ...clone(t.textStyle) };
  if ('text' in t) d.text = t.text;
  engine.persist();
  engine.liveUpdate(d);
}
/** @param {any} engine @param {string} id */
function applyDefault(engine, id) {
  const d = /** @type {Drawing | undefined} */ (engine.get(id));
  const tool = d && getTool(d.tool);
  if (!d || !tool) return;
  if (tool.defaultStyle) d.style = clone(tool.defaultStyle);
  engine.persist();
  engine.liveUpdate(d);
}

// the snapshot saved as a template (appearance + label, never geometry)
/** @param {Drawing} d @returns {Template} */
function presetOf(d) {
  /** @type {Template} */
  const preset = { style: clone(d.style) };
  if (d.textStyle) preset.textStyle = clone(d.textStyle);
  if (d.text != null) preset.text = d.text;
  return preset;
}

// ---- "Template ▸" item (a dwg-sub flyout) for a menu built from dwg-item rows ----
/**
 * @param {any} engine   the pane's DrawingEngine (opaque handle; not typed here)
 * @param {string} id
 * @param {TemplateItemOpts} [opts]
 * @returns {HTMLElement}
 */
export function buildTemplateItem(engine, id, opts = {}) {
  const d = engine.get(id);
  const tool = d && getTool(d.tool);
  const close = opts.onClose || (() => {});
  const item = el('div', 'dwg-item dwg-sub');
  item.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', 'Template'), el('span', 'dwg-arrow', '▸'));
  const sub = el('div', 'dwg-menu dwg-submenu' + (opts.flyLeft ? ' dwg-submenu-left' : ''));

  /** @param {string} label @param {() => void} fn */
  const row = (label, fn) => {
    const r = el('div', 'dwg-item');
    r.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', label));
    r.onclick = () => {
      close();
      fn();
    };
    return r;
  };
  sub.appendChild(row('Save as…', () => openSaveTemplateDialog(engine, id)));
  sub.appendChild(row('Apply default', () => applyDefault(engine, id)));

  const list = tool ? listToolTemplates(tool.id) : [];
  if (list.length) sub.appendChild(el('div', 'dwg-div'));
  list.forEach((t) => sub.appendChild(row(t.name, () => applyTemplate(engine, id, t))));

  item.appendChild(sub);
  return item;
}

// ---- "Save as…" dialog with autocomplete over existing template names ----
/** @type {HTMLElement | null} */
let saveOverlay = null;
export function closeSaveTemplateDialog() {
  if (saveOverlay) {
    saveOverlay.remove();
    saveOverlay = null;
  }
}

/**
 * @param {any} engine   the pane's DrawingEngine (opaque handle; not typed here)
 * @param {string} id
 */
export function openSaveTemplateDialog(engine, id) {
  closeSaveTemplateDialog();
  const d = /** @type {Drawing | undefined} */ (engine.get(id));
  const tool = d && getTool(d.tool);
  if (!d || !tool) return;
  const preset = presetOf(d);

  const overlay = el('div', 'modal open');
  saveOverlay = overlay;
  overlay.style.zIndex = '100';
  overlay.onclick = (e) => {
    if (e.target === overlay) closeSaveTemplateDialog();
  };
  const dlg = el('div', 'dialog tmpl-save');

  const head = el('div', 'set-head');
  const x = el('span', 'lib-x', '✕');
  x.onclick = closeSaveTemplateDialog;
  head.append(el('span', 'set-title', 'Save drawing template'), x);
  dlg.appendChild(head);

  const body = el('div', 'tmpl-save-body');
  body.appendChild(el('label', 'tmpl-save-lbl', 'New template name'));
  const combo = el('div', 'tmpl-combo');
  const inp = /** @type {HTMLInputElement} */ (el('input', 'tmpl-save-input'));
  inp.type = 'text';
  inp.placeholder = 'Template name';
  const suggest = el('div', 'tmpl-suggest');
  combo.append(inp, suggest);
  body.appendChild(combo);
  dlg.appendChild(body);

  const foot = el('div', 'dlg-actions');
  const doSave = async () => {
    const name = inp.value.trim();
    if (!name) {
      inp.focus();
      return;
    }
    if (listToolTemplates(tool.id).some((t) => t.name === name)) {
      // overwrite → confirm first
      const ok = await confirmDialog({
        message: `Drawing Template '${name}' already exists. Do you really want to replace it?`,
      });
      if (!ok) {
        inp.focus();
        return;
      }
    }
    saveToolTemplate(tool.id, name, preset);
    closeSaveTemplateDialog();
  };
  const cancel = el('button', null, 'Cancel');
  cancel.onclick = closeSaveTemplateDialog;
  const save = el('button', 'primary', 'Save');
  save.onclick = doSave;
  foot.append(cancel, save);
  dlg.appendChild(foot);

  overlay.appendChild(dlg);
  document.body.appendChild(overlay);

  const renderSuggest = () => {
    const q = inp.value.trim().toLowerCase();
    // suggest names that START WITH what's typed but aren't an EXACT match — so the
    // list narrows as you type and disappears once you've typed a full existing name
    // (or anything with no partial match → nothing to suggest → Save creates new).
    const names = !q
      ? []
      : listToolTemplates(tool.id)
          .map((t) => t.name)
          .filter((n) => {
            const nl = n.toLowerCase();
            return nl.startsWith(q) && nl !== q;
          });
    suggest.innerHTML = '';
    names.forEach((n) => {
      const r = el('div', 'tmpl-suggest-row', n);
      r.onmousedown = (e) => {
        e.preventDefault();
        inp.value = n;
        renderSuggest();
        inp.focus();
      }; // pick existing → overwrite on save
      suggest.appendChild(r);
    });
    suggest.style.display = names.length ? 'block' : 'none';
  };
  inp.oninput = renderSuggest;
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSave();
    } else if (e.key === 'Escape') closeSaveTemplateDialog();
  };
  renderSuggest();
  setTimeout(() => inp.focus(), 0);
}
