// @ts-check
// User's organization of indicators — favorites and self-made categories. This
// is USER DATA, kept separate from the study modules themselves (which are code).
// Persisted to settings/study-library.json.
import { createStore } from '../store.js';

/** A user-created list of indicators. `items` holds study ids. @typedef {{ id: string, name: string, items: string[] }} StudyCategory */
/** @typedef {{ favorites: string[], categories: StudyCategory[] }} Library */

const store = createStore('/api/study-library', { favorites: [], categories: [] });
/** @type {Library} */
let data = { favorites: [], categories: [] };

export async function loadLibrary() {
  const d = await store.load();
  data.favorites = Array.isArray(d.favorites) ? d.favorites : [];
  data.categories = Array.isArray(d.categories) ? d.categories : [];
  data.categories.forEach((/** @type {StudyCategory} */ c, i) => { if (!c.id) c.id = 'c' + (i + 1); if (!Array.isArray(c.items)) c.items = []; });
  return data;
}
const save = () => { store.set('favorites', data.favorites); store.set('categories', data.categories); };

// favorites
export const favorites = () => data.favorites;
/** @param {string} id */
export const isFav = (id) => data.favorites.includes(id);
/** @param {string} id */
export function toggleFav(id) {
  data.favorites = isFav(id) ? data.favorites.filter((x) => x !== id) : [...data.favorites, id];
  save();
}

// categories (user-created lists)
export const categories = () => data.categories;
/** @param {string} name @returns {string} */
export function addCategory(name) {
  const id = 'c' + Date.now().toString(36);
  data.categories.push({ id, name, items: [] });
  save();
  return id;
}
/** @param {string} id @param {string} name */
export function renameCategory(id, name) { const c = data.categories.find((c) => c.id === id); if (c) { c.name = name; save(); } }
/** @param {string} id */
export function deleteCategory(id) { data.categories = data.categories.filter((c) => c.id !== id); save(); }
/** @param {string} catId @param {string} id */
export const inCategory = (catId, id) => { const c = data.categories.find((c) => c.id === catId); return !!c && c.items.includes(id); };
/** @param {string} catId @param {string} id */
export function toggleMember(catId, id) {
  const c = data.categories.find((c) => c.id === catId);
  if (!c) return;
  c.items = c.items.includes(id) ? c.items.filter((x) => x !== id) : [...c.items, id];
  save();
}
