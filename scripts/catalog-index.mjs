#!/usr/bin/env node
// catalog-index.mjs — regenerate the root index.json the package manager fetches to browse the catalog.
//
// raw.githubusercontent.com serves a file by its full path but never lists a folder, so a client
// can't discover what's in the repo on its own. This index IS that listing: it walks every content
// class across its real location, pulls each package's essential metadata (name, description, icon)
// WITHOUT executing the code — a tolerant regex scrape for code packages, a JSON read for the
// single-file ones — and writes one file the client reads in a single request. Browsing the catalog
// is then one fetch; a package's own files are downloaded only when it's installed.
//
// The index is GENERATED, never hand-edited. Run it after adding or changing a package:
//   node scripts/catalog-index.mjs [targetRepoDir]
// The target is the repo to index AND where index.json is written. Defaults to this app repo (the
// catalog is served from its own source); during testing, pass the catalog checkout, e.g.:
//   node scripts/catalog-index.mjs .temp/pacman-src
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(HERE, '..');

// Optional long-form page a folder package may carry. When present the index records it so the package
// manager can link to its rendered GitHub page (github.com/.../<path>/info.md); absent -> no link. It's the
// "more info" companion to the one-line `description` scraped from the code — a full write-up GitHub renders.
const INFO_FILE = 'info.md';

// Scrape a single-line string field (`key: '...'` or "..."), anchored after `anchor` so a nested
// field above the registration (a study input's own `name:`, an adapter form field's `label:`) isn't
// picked up. Mirrors the app's server-side scraper, so the catalog shows the same metadata a local
// install would. Returns '' when absent.
function scrape(src, key, anchor) {
  let s = src;
  const i = anchor ? s.indexOf(anchor) : -1;
  if (i >= 0) s = s.slice(i);
  const m = new RegExp('\\b' + key + "\\s*:\\s*(['\"])(.*?)\\1").exec(s);
  return m ? m[2] : '';
}

// Every content class -> where it lives (relative to repo root) and how to read a package's metadata.
//   folder classes: <root>/<id>/<runtime>; the code self-registers, so scrape name/description/icon.
//   file classes:   <root>/<name>.json; the JSON carries name (+ description); no icon.
// Vocabulary is intentionally omitted: its files are Weblate-owned / local-only, handled separately.
const CLASSES = {
  studies:           { root: 'packages/studies',        kind: 'folder', runtime: (id) => id + '.js', anchor: '.register(' },
  tools:             { root: 'packages/tools',          kind: 'folder', runtime: (id) => id + '.js', anchor: '.register(' },
  addons:            { root: 'addons',                  kind: 'folder', runtime: () => 'index.js',    anchor: 'module.exports' },
  adapters:          { root: 'data_engine/adapters',    kind: 'folder', runtime: () => 'index.js',    anchor: 'const adapter' },
  primitives:        { root: 'packages/primitives',     kind: 'folder', runtime: () => 'index.js',    anchor: 'registerPrimitive(' },
  themes:            { root: 'packages/themes',         kind: 'file' },
  'chart-themes':      { root: 'packages/chart-themes',  kind: 'file' },
};

/** @type {any[]} */
const packages = [];

for (const [cls, cfg] of Object.entries(CLASSES)) {
  const dir = path.join(ROOT, cfg.root);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }   // class absent -> skip

  if (cfg.kind === 'file') {
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      let name = e.name.slice(0, -5), description = '';
      try { const obj = JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8')); if (obj && obj.name) name = obj.name; if (obj && obj.description) description = obj.description; } catch { /* keep filename */ }
      packages.push({ class: cls, id: name, name, description, icon: '', path: cfg.root, runtime: e.name });
    }
    continue;
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const id = e.name;
    const runtime = cfg.runtime(id);
    const file = path.join(dir, id, runtime);
    if (!fs.existsSync(file)) continue;   // not a package (reference dir, icon-only folder, ...)
    const src = fs.readFileSync(file, 'utf8');
    packages.push({
      class: cls,
      id,
      name: scrape(src, 'name', cfg.anchor) || id,
      description: scrape(src, 'description', cfg.anchor),
      icon: scrape(src, 'icon', cfg.anchor),
      info: fs.existsSync(path.join(dir, id, INFO_FILE)) ? INFO_FILE : '',
      path: cfg.root + '/' + id,
      runtime,
    });
  }
}

// Vocabulary — Weblate-owned <code>.json packs in static/locale/. The files are code-named word maps with no
// metadata, and the package manager names the language itself (from its bundled languages.csv), so the index
// only records that a locale file EXISTS — id = the code, no name/description. A stem that names no language
// (a FreeTube-style activeLocales.json) throws the Intl check and is skipped.
const VOCAB_DIR = 'static/locale';
try {
  const dir = path.join(ROOT, VOCAB_DIR);
  const dn = new Intl.DisplayNames(['en'], { type: 'language' });
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const code = e.name.slice(0, -5);
    try { dn.of(code); } catch { continue; }   // not a language tag -> skip junk
    packages.push({ class: 'vocab', id: code, name: '', description: '', icon: '', path: VOCAB_DIR, runtime: e.name });
  }
} catch { /* no static/locale -> no vocabulary */ }

packages.sort((a, b) => a.class.localeCompare(b.class) || a.id.localeCompare(b.id));
const out = { packages };
fs.writeFileSync(path.join(ROOT, 'index.json'), JSON.stringify(out, null, 2) + '\n');
console.log('index.json written:', packages.length, 'packages');
for (const c of [...Object.keys(CLASSES), 'vocab']) {
  const n = packages.filter((p) => p.class === c).length;
  if (n) console.log('  ' + c + ': ' + n);
}
