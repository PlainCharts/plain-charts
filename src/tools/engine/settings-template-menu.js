// @ts-check
// The "Template ▾" footer dropdown of the drawing settings dialog: list this tool's saved
// templates (apply live into the OPEN dialog), "Save as…" (searchable name prompt with
// overwrite confirm), and delete a template inline. Distinct from template-menu.js (the
// right-click flyout): that one persists straight to the engine and opens a modal save; this
// one only PREVIEWS and re-renders the dialog's controls (OK persists, Cancel reverts), and
// offers inline delete. The dialog stays decoupled: it passes an afterApply() callback rather
// than exposing its internals.
import { getTool } from '../registry.js';
import { listToolTemplates, saveToolTemplate, deleteToolTemplate } from '../tool-templates.js';
import { namePrompt } from '../../ui/name-prompt.js';

/** What the dialog hands in: the engine + edited drawing id, and a hook to run after an apply. */
/** @typedef {{ engine: any, id: string, afterApply: () => void }} TplMenuCtx */

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

/** @type {HTMLElement | null} */
let tplMenu = null;
/** @type {HTMLElement | null} */
let tplAnchor = null;

export function isToolTemplateMenuOpen() {
  return !!tplMenu;
}
export function closeToolTemplateMenu() {
  if (tplMenu) {
    tplMenu.remove();
    tplMenu = null;
    tplAnchor = null;
    document.removeEventListener('pointerdown', tplAway, true);
  }
}
/** @param {PointerEvent} e */
function tplAway(e) {
  const t = /** @type {Node | null} */ (e.target);
  if (tplMenu && !tplMenu.contains(t) && !(tplAnchor && tplAnchor.contains(t))) closeToolTemplateMenu();
}

// merge a saved preset into the live drawing, then let the dialog preview + re-render its
// controls (nothing is persisted here — the dialog's OK/Cancel owns that).
/** @param {any} d @param {{ style?: Record<string, any>, textStyle?: Record<string, any>, text?: string }} t @param {() => void} afterApply */
function applyTemplate(d, t, afterApply) {
  if (t.style) d.style = { ...d.style, ...clone(t.style) };
  if (t.textStyle) d.textStyle = { ...(d.textStyle || {}), ...clone(t.textStyle) };
  if ('text' in t) d.text = t.text;
  afterApply(); // reflect new values in the controls (OK persists, Cancel reverts)
}

/**
 * @param {HTMLElement} anchor   the footer "Template ▾" button
 * @param {TplMenuCtx} ctx
 */
export function openToolTemplateMenu(anchor, ctx) {
  closeToolTemplateMenu();
  const d = /** @type {any} */ (ctx.engine.get(ctx.id));
  const tl = /** @type {any} */ (getTool(d.tool));
  const menu = el('div', 'tpl-menu');
  tplMenu = menu;
  tplAnchor = anchor;
  const list = listToolTemplates(tl.id);

  // Save as… → the searchable name dialog (autocomplete + overwrite confirmation)
  const saveItem = el('div', 'tpl-item');
  saveItem.appendChild(el('span', 'tpl-name', 'Save as…'));
  saveItem.onclick = async () => {
    closeToolTemplateMenu();
    const name = await namePrompt({
      title: 'Save drawing template',
      label: 'New template name',
      placeholder: 'Template name',
      existing: listToolTemplates(tl.id).map((t) => t.name),
      replaceMessage: (n) => `Drawing template '${n}' already exists. Do you really want to replace it?`,
    });
    if (!name) return;
    /** @type {{ style: Record<string, any>, textStyle?: Record<string, any>, text?: string }} */
    const preset = { style: clone(d.style) };
    if (d.textStyle) preset.textStyle = clone(d.textStyle);
    if (d.text != null) preset.text = d.text;
    saveToolTemplate(tl.id, name, preset);
  };
  menu.appendChild(saveItem);

  menu.appendChild(el('div', 'tpl-sep'));
  if (!list.length) menu.appendChild(el('div', 'tpl-empty', 'No saved templates'));
  list.forEach((t) => {
    const row = el('div', 'tpl-item');
    const nm = el('span', 'tpl-name', t.name);
    nm.onclick = () => {
      applyTemplate(d, t, ctx.afterApply);
      closeToolTemplateMenu();
    };
    const del = el('span', 'tpl-del', '✕');
    del.title = 'Delete';
    del.onclick = (e) => {
      e.stopPropagation();
      deleteToolTemplate(tl.id, t.name);
      openToolTemplateMenu(anchor, ctx);
    };
    row.append(nm, del);
    menu.appendChild(row);
  });

  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = r.left + 'px';
  menu.style.top = r.top - menu.offsetHeight - 6 + 'px'; // above the footer button
  setTimeout(() => {
    document.addEventListener('pointerdown', tplAway, true);
  }, 0);
}
