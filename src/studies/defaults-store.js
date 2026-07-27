// @ts-check
// settings/study-defaults.json — the user's saved default settings per STUDY (indicator), the
// "Save as default" feature. When you add a study, if you've saved defaults for it they
// seed the new instance (params + per-plot style); otherwise the study's built-in defaults apply.
// Keyed by study id. The twin of tool-defaults.js (per-tool drawing defaults).
import { createStore } from '../store.js';

/** @typedef {{ params?: Record<string, any>, style?: Record<string, any> }} StudyDefault */

const store = createStore('/api/study-defaults', {});

export const loadStudyDefaults = () => store.load();
/** @param {string} id @returns {StudyDefault | null} */
export const getStudyDefaults = (id) => store.get(id) || null;

// snapshot the current instance's params + per-plot style overrides as the default for this study
/**
 * @param {string} id
 * @param {Record<string, any> | null | undefined} params
 * @param {Record<string, any> | null | undefined} style
 */
export function saveStudyDefaults(id, params, style) {
  /** @type {StudyDefault} */
  const v = {};
  if (params) v.params = { ...params };
  if (style && Object.keys(style).length) v.style = JSON.parse(JSON.stringify(style));
  store.set(id, v);
}

// forget the saved default (fall back to the study's built-in defaults on the next add)
/** @param {string} id */
export function clearStudyDefaults(id) { store.set(id, undefined); }
