// @ts-check
// Vocabulary runtime — the app's words are not hardcoded; they are looked up.
//
// Model: STRING-AS-KEY with per-key override. t(s) returns the active vocabulary's word for
// `s`, else a word registered by a tool/addon, else the literal `s`. So:
//   - unconverted strings keep working (fall back to the literal),
//   - a vocabulary pack only needs to carry the words it CHANGES (a partial overlay),
//   - tools/addons can ship their own vocab and merge it in (registerVocab).
//
// This is "vocabulary control", not just translation: the words on screen act on the trader,
// so the user owns the lexicon. Packs are individual files under settings/vocab/ (a shareable
// library on the generic server folder handler), and the active pack is app state (settings.json
// currentVocab). Changing it emits 'vocab:changed'.
import { getJSON, postJSON } from '../api.js';
import { getSetting, setSetting } from '../settings/settings.js';
import { bus } from '../bus.js';

// A single vocabulary pack: a name plus its string->word override map. Official locale packs also carry
// a language `locale` code (es, de, …); user custom packs don't.
/** @typedef {{ name: string, words: Record<string, string>, locale?: string }} VocabPack */

/** @type {Record<string, string>} */
let userWords = {};     // active user pack's overrides (string -> word) — win over everything
/** @type {Record<string, string>} */
let addonWords = {};    // the ACTIVE LANGUAGE's addon words (rebuilt per language from each addon's own
                        // locales/ folder) — self-contained, so uninstalling an addon takes its words with it
/** @type {Record<string, string>} */
let moduleWords = {};   // merged tool vocab — language-agnostic base words for module-specific strings
/** @type {VocabPack[]} */
let packs = [];         // available packs: [{ name, words }]
let activeName = '';
let activeLocale = '';  // the active pack's language code ('es', 'de', …), '' for English/custom packs

// the one function the whole app routes user-facing text through
/** @param {string} s @returns {string} */
export function t(s) {
  if (s == null) return s;
  if (Object.prototype.hasOwnProperty.call(userWords, s)) return userWords[s];
  if (Object.prototype.hasOwnProperty.call(addonWords, s)) return addonWords[s];
  if (Object.prototype.hasOwnProperty.call(moduleWords, s)) return moduleWords[s];
  return s;
}
// a tool/addon registers its own vocab (merged as base words; user packs still override)
/** @param {Record<string, string> | null | undefined} words */
export function registerVocab(words) { if (words) Object.assign(moduleWords, words); }

// REPLACE the addon-words layer with the active language's addon words. The addon loader rebuilds this
// on load and on every language switch, merging each enabled addon's own locales/<lang>.json — so an
// addon's translations live with the addon, never in the app catalog, and vanish when it's uninstalled.
/** @param {Record<string, string> | null | undefined} words */
export function setAddonWords(words) { addonWords = words || {}; }
// the active language code, for the addon loader to pick each addon's matching locale file
export const getActiveLocale = () => activeLocale;

// Localize STATIC HTML: t() can't run in markup, so an element carries its source string in a
// data-i18n* attribute (the attribute VALUE is the key). One pass sets textContent/title/placeholder
// from t(). Call after loadVocab(); re-callable on 'vocab:changed'. The static English in the HTML is
// the pre-JS fallback; this overwrites it with the active pack's word.
/** @param {ParentNode} [root] */
export function localizeDom(root) {
  const r = root || document;
  r.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n') || ''); });
  r.querySelectorAll('[data-i18n-title]').forEach((el) => { /** @type {HTMLElement} */ (el).title = t(el.getAttribute('data-i18n-title') || ''); });
  r.querySelectorAll('[data-i18n-ph]').forEach((el) => { /** @type {HTMLInputElement} */ (el).placeholder = t(el.getAttribute('data-i18n-ph') || ''); });
}

export async function loadVocab() {
  /** @type {any} */
  let d = {};
  try { d = await getJSON('/api/vocab'); } catch (_) {}
  packs = Array.isArray(d.packs) ? d.packs.filter((/** @type {any} */ p) => p && p.name) : [];
  activeName = getSetting('currentVocab') || '';
  const ap = packs.find((p) => p.name === activeName) || /** @type {Partial<VocabPack>} */ ({});
  userWords = ap.words || {};
  activeLocale = ap.locale || '';
}

export const listVocabPacks = () => packs.map((p) => p.name);
export const getActiveVocab = () => activeName;

// '' = no pack (every string is its literal). Switching re-resolves on the next render; the
// event lets live UIs refresh.
/** @param {string | null | undefined} name */
export function setActiveVocab(name) {
  activeName = name || '';
  const ap = packs.find((p) => p.name === activeName) || /** @type {Partial<VocabPack>} */ ({});
  userWords = ap.words || {};
  activeLocale = ap.locale || '';
  setSetting('currentVocab', activeName);
  bus.emit('vocab:changed');
}

/** @param {string} name @param {Record<string, string> | null | undefined} words */
export function saveVocabPack(name, words) {
  name = (name || '').trim(); if (!name) return;
  packs = [...packs.filter((p) => p.name !== name), { name, words: words || {} }];
  postJSON('/api/vocab/save', { name, data: { words: words || {} } });
}
/** @param {string} name */
export function deleteVocabPack(name) {
  packs = packs.filter((p) => p.name !== name);
  postJSON('/api/vocab/delete', { name });
  if (activeName === name) setActiveVocab('');
}
export function openVocabFolder() { postJSON('/api/vocab/open', {}); }
/** @param {any} obj @returns {boolean} */
export function importVocabPack(obj) {
  if (!obj || !obj.name || typeof obj.words !== 'object') return false;
  saveVocabPack(obj.name, obj.words);
  return true;
}
