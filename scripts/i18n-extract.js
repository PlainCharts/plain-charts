'use strict';
// i18n catalog extractor -- READ-ONLY on source. It scans code for translation calls and collects the
// string literals into SOURCE TEMPLATES (identity-map en.json files). It NEVER edits your code: it only
// reads .js files and writes en.json files, and only ever ADDS keys (existing entries are preserved).
// en.json is not read by the app -- t() falls back to the literal -- so these files are purely a
// convenience for Weblate/translators. Run: node scripts/i18n-extract.js
//
// TWO CATALOGS, because addons are self-contained packages the user may not even have installed:
//   - the APP catalog  -> packages/vocab/en.json          (scanned from src/)
//   - each ADDON's own  -> addons/<id>/locales/en.json    (scanned from that addon's folder)
// An addon's words live WITH the addon (its locales/ folder travels with it and is loaded per active
// language), never in the app catalog. A word shared with the app may appear in both -- that is fine:
// the addon stays self-contained, and at runtime the app pack resolves shared words first anyway.
//
// Matched calls: t('...') and tr('...') (the app's vocabulary lookup, sometimes aliased to tr where a
// local `t` exists; addons alias `const t = api.t`). Only PLAIN string literals are captured; template
// strings with ${...} are skipped (a dynamic key can't be pre-translated). Add alias names to FN_NAMES.
//
// GOTCHA: t('A' + 'B') passes the FULL 'AB' to t() at runtime, but this scanner only captures the FIRST
// literal 'A' -- so the recorded key would never match the runtime lookup. ALWAYS pass a SINGLE string
// literal to t()/tr(): write t('A B C') on one line, never t('A ' + 'B ' + 'C'). Same for a ternary:
// write `cond ? t('a') : t('b')`, never `t(cond ? 'a' : 'b')` (no literal sits right after `t(`).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const ADDONS_DIR = path.join(ROOT, 'addons');
const FN_NAMES = ['t', 'tr'];

// walk a dir for .js files (skips node_modules just in case)
function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_) { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

// match  <fn>( '...' | "..." | `...` )  and capture the literal body. The quote is backreferenced so
// the body ends at the matching quote; escapes inside are consumed. Template literals are captured too
// but filtered out below if they interpolate.
const NAMES = FN_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const CALL = new RegExp('\\b(?:' + NAMES + ')\\(\\s*([\'"`])((?:\\\\.|(?!\\1).)*)\\1', 'g');

// unescape the common sequences so the KEY matches what t() receives at runtime (t gets the decoded
// string). We keep it minimal: \\ \' \" \` \n \t.
function unescape(s) {
  return s.replace(/\\(["'`\\nt])/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

// collect the keyed strings from a set of files into a Set
function collectKeys(files) {
  const keys = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf-8');
    let m;
    CALL.lastIndex = 0;
    while ((m = CALL.exec(text))) {
      const raw = m[2];
      if (raw.indexOf('${') !== -1) continue;   // interpolated -> not a static key
      const key = unescape(raw);
      if (key.trim()) keys.add(key);
    }
  }
  return keys;
}

// collect data-i18n / -title / -ph attribute keys (the app's static-HTML keys the t()-scan can't see)
function attrKeys(files) {
  const keys = new Set();
  const RE = /data-i18n(?:-title|-ph)?=["']([^"']+)["']/g;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf-8');
    let m; RE.lastIndex = 0;
    while ((m = RE.exec(text))) keys.add(m[1]);
  }
  return keys;
}

// merge keys into an en.json (add-only, identity map, sorted), optionally PRUNING a set of keys first.
// Returns { added, pruned, total }.
function writeCatalog(enFile, keys, prune) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(enFile, 'utf-8')); } catch (_) {}
  let pruned = 0;
  if (prune) for (const k of prune) if (Object.prototype.hasOwnProperty.call(existing, k)) { delete existing[k]; pruned++; }
  let added = 0;
  for (const k of keys) if (!Object.prototype.hasOwnProperty.call(existing, k)) { existing[k] = k; added++; }
  const sorted = {};
  for (const k of Object.keys(existing).sort()) sorted[k] = existing[k];
  fs.mkdirSync(path.dirname(enFile), { recursive: true });
  fs.writeFileSync(enFile, JSON.stringify(sorted, null, 2) + '\n');
  return { added, pruned, total: Object.keys(sorted).length };
}

// ---- addon catalogs: scan each addons/<id> into its OWN locales/en.json ----
// Do these first so we know every addon-owned key, then keep those out of the app catalog.
let addonDirs = [];
try { addonDirs = fs.readdirSync(ADDONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(ADDONS_DIR, d.name, 'index.js'))).map((d) => d.name); } catch (_) {}
const addonUnion = new Set();
const addonReports = [];
for (const id of addonDirs) {
  const files = walk(path.join(ADDONS_DIR, id), []);
  const keys = collectKeys(files);
  if (!keys.size) continue;   // an addon with no keyed strings gets no locales folder
  keys.forEach((k) => addonUnion.add(k));
  const r = writeCatalog(path.join(ADDONS_DIR, id, 'locales', 'en.json'), keys);
  addonReports.push('i18n-extract: addon   -> addons/' + id + '/locales/en.json  (' + keys.size + ' keyed, +' + r.added + ' new, ' + r.total + ' total)');
}

// ---- app catalog: scan src/ ----
// The app catalog holds ONLY what the app itself uses. An addon may be uninstalled, so its words must
// never live here. Prune any addon-owned key the app doesn't itself reference (via t()/tr() OR a
// data-i18n* attribute); a word shared by both (e.g. Clear, Connections) is in appAll, so it stays.
const appFiles = walk(SRC_DIR, []);
const appKeys = collectKeys(appFiles);
const appAll = new Set([...appKeys, ...attrKeys([...appFiles, path.join(ROOT, 'index.html')])]);
const pruneFromApp = [...addonUnion].filter((k) => !appAll.has(k));
const app = writeCatalog(path.join(ROOT, 'packages', 'vocab', 'en.json'), appKeys, pruneFromApp);
console.log('i18n-extract: app     -> packages/vocab/en.json  (' + appFiles.length + ' files, ' + appKeys.size + ' keyed, +' + app.added + ' new, -' + app.pruned + ' addon-owned, ' + app.total + ' total)');
addonReports.forEach((line) => console.log(line));
