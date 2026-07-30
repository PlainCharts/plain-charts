// @ts-check
// Quick-button TEMPLATES for the order ticket. A template is a NAMED set of quick buttons
// ({ id, name, buttons: ButtonDef[] }); the user keeps several and switches between them from the
// editor's dropdown, and the ACTIVE template's buttons are the ones shown on the ticket. Same shape
// and autosave model as the colour palettes (palettes-store.js): every mutation writes through the
// store immediately. Persisted to settings/trading/order-buttons.json (/api/order-buttons).
//
// Unlike palettes, this starts EMPTY -- there is no seeded/default template. The user creates their
// own from the dropdown ("New template…"); until then the ticket simply shows no quick buttons.
import { createStore } from '../store.js';

/** @typedef {{ id: string, label: string, script: string, hotkey?: string }} ButtonDef */
/** @typedef {{ id: string, name: string, buttons: ButtonDef[] }} ButtonTemplate */
/**
 * @typedef {Object} TemplatesData
 * @property {ButtonTemplate[]} templates
 * @property {string|null} activeId
 */

let seq = 0;
/** @param {string} p @returns {string} */
export const newId = (p) => p + '_' + Date.now().toString(36) + (seq++).toString(36);

const store = createStore('/api/order-buttons', { templates: [], activeId: null });
/** @type {TemplatesData} */
const data = { templates: [], activeId: null };

/** @param {any} b @returns {ButtonDef|null} */
function normBtn(b) {
  if (!b || typeof b.script !== 'string' || !b.script) return null;
  return {
    id: b.id || newId('b'),
    label: b.label || b.script,
    script: b.script,
    hotkey: typeof b.hotkey === 'string' ? b.hotkey : '',
  };
}
/** @param {any} tpl @returns {ButtonTemplate} */
const normTpl = (tpl) => ({
  id: tpl.id || newId('tpl'),
  name: tpl.name || 'Template',
  buttons: Array.isArray(tpl.buttons) ? /** @type {ButtonDef[]} */ (tpl.buttons.map(normBtn).filter(Boolean)) : [],
});

/** @returns {Promise<TemplatesData>} */
export async function loadTemplates() {
  const d = await store.load();
  data.templates = Array.isArray(d.templates)
    ? d.templates.filter((/** @type {any} */ t) => t && (t.id || t.name)).map(normTpl)
    : [];
  data.activeId =
    d.activeId && data.templates.some((t) => t.id === d.activeId)
      ? d.activeId
      : data.templates[0]
        ? data.templates[0].id
        : null;
  return data;
}
const save = () => {
  store.set('templates', data.templates);
  store.set('activeId', data.activeId);
};

/** @returns {ButtonTemplate[]} */
export const templateList = () => data.templates;
/** @returns {string|null} */
export const activeTemplateId = () => data.activeId;
/** @param {string|null} id @returns {ButtonTemplate|null} */
export const getTemplate = (id) => data.templates.find((t) => t.id === id) || null;
/** @param {string|null} id @returns {ButtonDef[]} */
export const templateButtons = (id) => {
  const t = getTemplate(id);
  return t ? t.buttons : [];
};
/** @param {string|null} id */
export function setActiveTemplate(id) {
  if (getTemplate(id)) {
    data.activeId = id;
    save();
  }
}

/** @param {string} [name] @returns {ButtonTemplate} */
export function createTemplate(name) {
  const tpl = { id: newId('tpl'), name: name || 'Template ' + (data.templates.length + 1), buttons: [] };
  data.templates.push(tpl);
  data.activeId = tpl.id;
  save();
  return tpl;
}
/** @param {string} id @param {string} name */
export function renameTemplate(id, name) {
  const t = getTemplate(id);
  if (t && name) {
    t.name = name;
    save();
  }
}
/** @param {string} id */
export function removeTemplate(id) {
  data.templates = data.templates.filter((t) => t.id !== id);
  if (data.activeId === id) data.activeId = data.templates[0] ? data.templates[0].id : null;
  save();
}
/** Replace a template's buttons (the editor commit). @param {string} id @param {ButtonDef[]} buttons */
export function setTemplateButtons(id, buttons) {
  const t = getTemplate(id);
  if (t) {
    t.buttons = buttons.map((b) => ({ ...b }));
    save();
  }
}
