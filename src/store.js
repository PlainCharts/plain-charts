// @ts-check
// A JSON-backed key/value store bound to one server endpoint (= one file under
// settings/). Each domain creates its own store, so files stay separated and
// adding a new one is a one-liner. Saves are debounced.
//
// Saves are PER-KEY MERGES, never whole-document writes. Every window holds its own
// copy of the document, so posting the whole copy meant a window with a STALE copy
// silently reverted every key another window had changed since (last-writer-wins per
// FILE -- found live: the Optimization knobs kept resetting to 0). Instead, set()
// marks the key dirty and the debounced save posts ONLY the dirty keys to
// <endpoint>/merge; the server folds them into the file (line-editor principle:
// touch the lines you changed, preserve the rest). A writer can now only ever
// overwrite keys it actually set. No store deletes keys (empty values are written,
// not removed), so merge-only is complete.
import { getJSON, postJSON } from './api.js';

/**
 * @param {string} endpoint
 * @param {Record<string, any>} defaults
 */
export function createStore(endpoint, defaults) {
  /** @type {Record<string, any>} */
  let data = { ...defaults };
  /** @type {any} */
  let timer = null;
  /** @type {Set<string>} */
  let dirty = new Set();
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      /** @type {Record<string, any>} */
      const patch = {};
      for (const k of dirty) patch[k] = data[k];
      dirty = new Set();
      postJSON(endpoint + '/merge', patch);
    }, 150);
  };
  return {
    async load() {
      data = { ...defaults, ...(await getJSON(endpoint)) };
      return data;
    },
    /** @param {string} key @returns {any} */
    get: (key) => data[key],
    /** @param {string} key @param {any} value */
    set: (key, value) => {
      data[key] = value;
      dirty.add(key);
      save();
    },
  };
}
