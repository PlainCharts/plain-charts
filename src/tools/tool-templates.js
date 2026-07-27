// @ts-check
// settings/drawing-templates.json — named STYLE/TEXT presets per drawing tool.
// One bucket (array) per tool id: { [toolId]: [{ name, style, textStyle?, text? }] }.
// Templates capture appearance (style + textStyle) and the label text, never the
// geometry, so applying one restyles + relabels a drawing without moving it.
import { createStore } from '../store.js';

/** @typedef {{ name: string, style?: Record<string, any>, textStyle?: Record<string, any>, text?: string }} ToolTemplate */

const store = createStore('/api/drawing-templates', {});

export const loadToolTemplates = () => store.load();
/** @param {string} toolId @returns {ToolTemplate[]} */
export const listToolTemplates = (toolId) => store.get(toolId) || [];
/** @param {string} toolId @param {string} name @returns {ToolTemplate | undefined} */
export const getToolTemplate = (toolId, name) => listToolTemplates(toolId).find((t) => t.name === name);

/** @param {string} toolId @param {string} name @param {Omit<ToolTemplate, 'name'>} preset */
export function saveToolTemplate(toolId, name, preset) {
  const list = listToolTemplates(toolId).filter((t) => t.name !== name);
  list.push({ name, ...preset });
  store.set(toolId, list);
}

/** @param {string} toolId @param {string} name */
export function deleteToolTemplate(toolId, name) {
  store.set(toolId, listToolTemplates(toolId).filter((t) => t.name !== name));
}
