// @ts-check
// CHART appearance templates (candles, canvas, status line, lines). Each template is its
// OWN file under settings/chart-templates/ - a folder the user can open, share and import
// from. Separate from the app theme (themes.json). A small in-memory cache keeps the
// list synchronous for the UI; writes go straight to individual files on the server.
import { getJSON, postJSON } from '../api.js';

/**
 * A chart appearance template as stored on disk / cached in memory.
 * @typedef {Object} ChartTemplate
 * @property {string} name
 * @property {string} [description]
 * @property {any} [candles]
 * @property {any} [canvas]
 * @property {any} [statusLine]
 * @property {any} [indicators]
 * @property {any} [lines]
 * @property {number} [tzOffsetMin]
 */

/** @type {ChartTemplate[]} */
let cache = [];

/** @returns {Promise<ChartTemplate[]>} */
export async function loadTemplates() {
  const d = await getJSON('/api/chart-templates');
  cache = Array.isArray(d.templates) ? d.templates.filter((/** @type {any} */ t) => t && t.name) : [];
  return cache;
}
/** @returns {ChartTemplate[]} */
export const listTemplates = () => cache;
/** @param {string} name @returns {ChartTemplate | undefined} */
export const getTemplate = (name) => cache.find((t) => t.name === name);

// upsert one template -> one file
/** @param {string} name @param {Partial<ChartTemplate>} data */
export function saveTemplate(name, data) {
  const prev = cache.find((t) => t.name === name);   // keep the package manager description across an edit
  const description = prev && prev.description;
  const withDesc = description ? { description, ...data } : data;
  cache = [...cache.filter((t) => t.name !== name), { name, ...withDesc }];
  postJSON('/api/chart-templates/save', { name, data: withDesc });
}
/** @param {string} name */
export function deleteTemplate(name) {
  cache = cache.filter((t) => t.name !== name);
  postJSON('/api/chart-templates/delete', { name });
}

// open settings/chart-templates/ in the OS file manager (so the user can grab/drop files)
export function openTemplatesFolder() { postJSON('/api/chart-templates/open', {}); }
