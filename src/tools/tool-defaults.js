// @ts-check
// settings/tool-defaults.json — the last-used appearance per drawing tool, so a new
// drawing starts with the style/text settings you last applied.
// APPEARANCE ONLY: style (colour/width/lineStyle/bg/border/wrap...) + textStyle
// (colour/size/bold/italic/alignment). Never geometry (points) or per-drawing visibility.
import { createStore } from '../store.js';
import { getTool } from './registry.js';

/** @typedef {{ style?: Record<string, any>, textStyle?: Record<string, any> }} ToolDefaults */

const store = createStore('/api/tool-defaults', {});

export const loadToolDefaults = () => store.load();
/** @param {string} toolId @returns {ToolDefaults | null} */
export const getToolDefaults = (toolId) => store.get(toolId) || null;

/** @param {string} toolId @param {Record<string, any> | null | undefined} style @param {Record<string, any> | null | undefined} [textStyle] */
export function saveToolDefaults(toolId, style, textStyle) {
  /** @type {ToolDefaults} */
  const v = {};
  if (style) {
    v.style = { ...style };
    // never persist a tool's IDENTITY keys (e.g. trend-line `extend`: none/right/both) —
    // they define which tool this is, not its appearance. See mergeToolStyle().
    const identity = (getTool(toolId) || /** @type {Record<string, any>} */ ({})).identityStyle;
    if (identity) for (const k of identity) delete v.style[k];
  }
  if (textStyle) v.textStyle = { ...textStyle };
  store.set(toolId, v);
}
