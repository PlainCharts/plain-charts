// @ts-check
// settings/indicator-templates.json — named sets of indicators (a global library).
// Each template is { name, studies:[{id, params, hidden}] }. Saving captures
// the current chart's indicators; applying replaces a chart's indicators with the set.
// Most-recently saved/used first, so the menu's "Recently used" list is meaningful.
import { createStore } from '../store.js';

/**
 * A saved indicator template: a name plus the serialized set of studies it captured.
 * `studies` mirrors a pane's `studies.serialize()` output (opaque descriptors here).
 * @typedef {{ name: string, studies: any[] }} StudyTemplate
 */

const store = createStore('/api/indicator-templates', { templates: [] });

export const loadStudyTemplates = () => store.load();
/** @returns {StudyTemplate[]} */
export const listStudyTemplates = () => store.get('templates') || [];

/** @param {string} name @param {any[]} studies */
export function saveStudyTemplate(name, studies) {
  const list = listStudyTemplates().filter((t) => t.name !== name);
  list.unshift({ name, studies }); // newest first
  store.set('templates', list);
}

/** @param {string} name */
export function deleteStudyTemplate(name) {
  store.set(
    'templates',
    listStudyTemplates().filter((t) => t.name !== name),
  );
}

// bump an applied template to the front of the "recently used" list
/** @param {string} name */
export function touchStudyTemplate(name) {
  const list = listStudyTemplates();
  const t = list.find((x) => x.name === name);
  if (!t) return;
  store.set('templates', [t, ...list.filter((x) => x.name !== name)]);
}
