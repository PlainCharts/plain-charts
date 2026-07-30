'use strict';
/**
 * Addon host (MANAGEMENT plane). Addons are folders in addons/<id>/index.js. The actual
 * EXECUTION runs in the Node-enabled addon-host renderer (src/addons/runtime.js), where addons
 * get full broker DATA (the existing bridge) AND full Node (require) — no sandbox.
 *
 * This module is just the control surface the Addons panel talks to: discover folders, track
 * enabled state (settings/addons.json, with a _rev map to trigger reloads), save/read/remove
 * source, and surface running status + logs the runtime writes to settings/addons-status.json.
 * No execution here — so the server process never runs (data-less) addon code.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ADDONS_DIR = path.join(ROOT, 'addons');
const STATE_FILE = path.join(ROOT, 'settings', 'addons', 'addons.json');
const STATUS_FILE = path.join(ROOT, 'settings', 'addons', 'addons-status.json');

const sanitizeId = (n) =>
  String(n || '')
    .replace(/\.js$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 60);

// Addon metadata (name/description/icon) comes from the package's meta.json -- never scraped from
// index.js. Returns {} when absent/invalid.
function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ADDONS_DIR, id, 'meta.json'), 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (_) {}
}
function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}
function bumpRev(s, id) {
  s._rev = s._rev || {};
  s._rev[id] = (s._rev[id] || 0) + 1;
} // tells the runtime to reload this addon

function listIds() {
  let entries = [];
  try {
    entries = fs.readdirSync(ADDONS_DIR, { withFileTypes: true });
  } catch (_) {}
  return entries
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ADDONS_DIR, d.name, 'index.js')))
    .map((d) => d.name);
}

// Read an addon's own translations: addons/<id>/locales/<lang>.json (flat string-as-key, like the app's
// /locales). Returns { <code>: { key: word } } — the client picks the active language and registers it.
// en.json is the source template (identity map); it's included so English keys are known but adds nothing.
function readAddonLocales(dir) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  let files = [];
  try {
    files = fs.readdirSync(path.join(dir, 'locales')).filter((f) => f.endsWith('.json'));
  } catch (_) {
    return null;
  }
  for (const f of files) {
    try {
      const w = JSON.parse(fs.readFileSync(path.join(dir, 'locales', f), 'utf8'));
      if (w && typeof w === 'object' && !Array.isArray(w)) out[f.slice(0, -5)] = w;
    } catch (_) {
      /* skip a malformed file */
    }
  }
  return Object.keys(out).length ? out : null;
}

module.exports = {
  init() {
    /* execution lives in the renderer runtime — nothing to start here */
  },

  list() {
    const state = readState(),
      status = readStatus();
    return listIds().map((id) => {
      const st = status[id] || {};
      // folder-package extras: a shipped icon (served at /addons/<id>/icon.png) and the addon's OWN
      // translations. An addon ships a locales/ folder (en.json source + <lang>.json per language, the
      // same flat string-as-key shape as the app's /locales); the client picks the active-language file
      // and registers it. Self-contained: the words live with the addon, never in the app catalog.
      const dir = path.join(ADDONS_DIR, id);
      const hasIcon = fs.existsSync(path.join(dir, 'icon.png'));
      const locales = readAddonLocales(dir);
      const meta = readMeta(id);
      return {
        id,
        name: meta.name || '',
        description: meta.description || '',
        enabled: state[id] === true,
        running: !!st.running,
        error: st.error || null,
        logs: (st.logs || []).slice(-200),
        inputs: st.inputs || [],
        config: st.config || {},
        hasIcon,
        locales,
      };
    });
  },
  toggle(id, enabled) {
    const s = readState();
    s[id] = !!enabled;
    writeState(s);
    return { ok: true };
  },
  // save the addon's setup (config.json) and reload it with the new values
  config(id, cfg) {
    const sid = sanitizeId(id);
    try {
      const dir = path.join(ADDONS_DIR, sid);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg || {}, null, 2));
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
    const s = readState();
    bumpRev(s, sid);
    writeState(s);
    return { ok: true };
  },
  reload(id) {
    const s = readState();
    bumpRev(s, sanitizeId(id));
    writeState(s);
    return { ok: true };
  },

  save(name, code) {
    const id = sanitizeId(name);
    if (!id) return { error: 'invalid name' };
    if (typeof code !== 'string') return { error: 'no code' };
    try {
      new Function('module', 'exports', 'require', '__dirname', '__filename', code);
    } catch (e) {
      return { error: 'Syntax: ' + ((e && e.message) || e) };
    }
    try {
      const dir = path.join(ADDONS_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.js'), code);
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
    const s = readState();
    bumpRev(s, id);
    writeState(s); // runtime reloads if it's enabled
    return { ok: true, id };
  },
  // install a whole addon FOLDER (index.js + config.json + locales/ + assets), tree intact
  installPackage(id, files) {
    const sid = sanitizeId(id);
    if (!sid) return { error: 'invalid id' };
    if (!Array.isArray(files) || !files.length) return { error: 'no files' };
    const base = path.join(ADDONS_DIR, sid);
    try {
      for (const f of files) {
        const rel = String((f && f.path) || '').replace(/\\/g, '/');
        if (!rel || rel.split('/')[0] !== sid) continue; // every file must live under the package folder
        const dest = path.join(ADDONS_DIR, rel);
        if (dest !== base && !dest.startsWith(base + path.sep)) continue; // no traversal outside the package
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (typeof f.b64 === 'string') fs.writeFileSync(dest, Buffer.from(f.b64, 'base64'));
        else fs.writeFileSync(dest, String(f.text || ''));
      }
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
    const s = readState();
    bumpRev(s, sid);
    writeState(s); // runtime reloads if it's enabled
    return { ok: true, id: sid };
  },
  read(id) {
    const sid = sanitizeId(id);
    try {
      return { code: fs.readFileSync(path.join(ADDONS_DIR, sid, 'index.js'), 'utf8') };
    } catch (_) {
      return { error: 'not found' };
    }
  },
  // Save an uploaded icon as the addon package's icon.png (addons/<id>/icon.png) — the same convention as
  // tools. It travels with the package folder and the package manager sees it; no data URL in a settings blob.
  setIcon(id, dataUrl) {
    const sid = sanitizeId(id);
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
    if (!sid) return { error: 'invalid id' };
    if (!m) return { error: 'expected a PNG data URL' };
    try {
      const dir = path.join(ADDONS_DIR, sid);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'icon.png'), Buffer.from(m[1], 'base64'));
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
    return { ok: true, path: '/addons/' + sid + '/icon.png' };
  },
  removeIcon(id) {
    // revert to the letter badge
    const sid = sanitizeId(id);
    if (sid) {
      try {
        fs.unlinkSync(path.join(ADDONS_DIR, sid, 'icon.png'));
      } catch (_) {}
    }
    return { ok: true };
  },
  remove(id) {
    const sid = sanitizeId(id);
    const s = readState();
    delete s[sid];
    if (s._rev) delete s._rev[sid];
    writeState(s);
    try {
      fs.rmSync(path.join(ADDONS_DIR, sid), { recursive: true, force: true });
    } catch (_) {}
    return { ok: true };
  },
};
