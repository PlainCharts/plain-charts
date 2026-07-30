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

// Read a folder package's meta.json (name/description/icon) -- the single source of package metadata,
// never scraped from the code. Returns {} when absent/invalid.
function readMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) || {};
  } catch {
    return {};
  }
}

// Every content class -> where it lives (relative to repo root) and how to read a package's metadata.
//   folder classes: <root>/<id>/<runtime> (proves it's a package); metadata from <id>/meta.json.
//   file classes:   <root>/<name>.json; the JSON carries name (+ description); no icon.
// Vocabulary is intentionally omitted: its files are Weblate-owned / local-only, handled separately.
const CLASSES = {
  studies: { root: 'packages/studies', kind: 'folder', runtime: (id) => id + '.js' },
  tools: { root: 'packages/tools', kind: 'folder', runtime: (id) => id + '.js' },
  addons: { root: 'addons', kind: 'folder', runtime: () => 'index.js' },
  adapters: { root: 'data_engine/adapters', kind: 'folder', runtime: () => 'index.js' },
  primitives: { root: 'packages/primitives', kind: 'folder', runtime: () => 'index.js' },
  themes: { root: 'packages/themes', kind: 'file' },
  'chart-themes': { root: 'packages/chart-themes', kind: 'file' },
};

// A folder package's file manifest, relative to the package folder, forward-slashed and sorted. raw
// can't list a folder, so the catalog carries the list -- the client fetches each file on install.
function listFilesRel(root) {
  const out = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + '/');
      else out.push(prefix + e.name);
    }
  };
  walk(root, '');
  return out.sort();
}

/** @type {any[]} */
const packages = [];

for (const [cls, cfg] of Object.entries(CLASSES)) {
  const dir = path.join(ROOT, cfg.root);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    continue;
  } // class absent -> skip

  if (cfg.kind === 'file') {
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      let name = e.name.slice(0, -5),
        description = '';
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8'));
        if (obj && obj.name) name = obj.name;
        if (obj && obj.description) description = obj.description;
      } catch {
        /* keep filename */
      }
      packages.push({ class: cls, id: name, name, description, icon: '', path: cfg.root, runtime: e.name });
    }
    continue;
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const id = e.name;
    const runtime = cfg.runtime(id);
    const file = path.join(dir, id, runtime);
    if (!fs.existsSync(file)) continue; // not a package (reference dir, icon-only folder, ...)
    const meta = readMeta(path.join(dir, id));
    packages.push({
      class: cls,
      id,
      name: meta.name || '',
      description: meta.description || '',
      icon: meta.icon || '',
      info: fs.existsSync(path.join(dir, id, INFO_FILE)) ? INFO_FILE : '',
      path: cfg.root + '/' + id,
      runtime,
      files: listFilesRel(path.join(dir, id)),
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
    try {
      dn.of(code);
    } catch {
      continue;
    } // not a language tag -> skip junk
    packages.push({ class: 'vocab', id: code, name: '', description: '', icon: '', path: VOCAB_DIR, runtime: e.name });
  }
} catch {
  /* no static/locale -> no vocabulary */
}

packages.sort((a, b) => a.class.localeCompare(b.class) || a.id.localeCompare(b.id));
const out = { packages };
fs.writeFileSync(path.join(ROOT, 'index.json'), JSON.stringify(out, null, 2) + '\n');
console.log('index.json written:', packages.length, 'packages');
for (const c of [...Object.keys(CLASSES), 'vocab']) {
  const n = packages.filter((p) => p.class === c).length;
  if (n) console.log('  ' + c + ': ' + n);
}
