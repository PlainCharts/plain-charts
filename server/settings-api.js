'use strict';
// Settings persistence APIs: the API-path -> settings-file map, the folder libraries
// (one <name>.json per item: chart templates, themes, vocab), the workspaces folder
// (one <id>.json per workspace, keyed by a STABLE id) and the per-tab tab index.
// handleSettings(req, res) returns true once it has
// handled the request, false to let the router fall through.
const fs = require('fs');
const path = require('path');
const { ROOT, SETTINGS_DIR, readSettingsFile, writeSettingsFile, sendJson, readBody, openFolder, fileSlug } = require('./util.js');

// API path -> settings file. Each is a JSON document persisted to settings/.
// settings/ is organized into logical subfolders. The API path is stable; only the on-disk
// location (the value) is grouped. Folder libraries (themes, chart-templates, workspaces, vocab)
// are handled by folderApi/workspacesApi below with their own dir constants.
const API_FILES = {
  '/api/settings': 'settings.json',                               // app prefs (anchor, root)
  '/api/accounts': 'brokers/accounts.json',
  '/api/tabs': 'workspace/tabs.json',
  '/api/indicator-templates': 'studies/indicator-templates.json',
  '/api/study-library': 'studies/study-library.json',
  '/api/study-defaults': 'studies/study-defaults.json',
  '/api/toolbar': 'drawings/toolbar.json',
  '/api/drawing-templates': 'drawings/drawing-templates.json',
  '/api/tool-defaults': 'drawings/tool-defaults.json',
  '/api/synced-drawings': 'drawings/synced-drawings.json',
  '/api/addons-toolbar': 'addons/addons-toolbar.json',
  '/api/colors': 'appearance/colors.json',
  '/api/palettes': 'appearance/palettes.json',
  '/api/order-buttons': 'trading/order-buttons.json',   // user-authored quick-action buttons for the order ticket
  '/api/order-plan': 'trading/order-plan.json',   // persisted on-chart PLAN state (gray projection etc.) per broker:symbol
  '/api/order-primitives': 'trading/order-primitives.json',   // on-chart order primitives: the GLOBAL active primitive + per-primitive config namespaces
  '/api/watchlist': 'market/watchlist.json',
  '/api/alert-rules': 'market/alert-rules.json',   // the Alert engine's authoritative rule set (owned by the alert-host)
  '/api/alert-log': 'market/alert-log.json',       // the Alert engine's persistent fire LOG (the mailbox) -- a capped ring, owned by the alert-host

  '/api/email-smtp': 'brokers/email-smtp.json',    // alert email SMTP account (host/port/user/PASS/from/to) -- credentials, so it lives under the git-excluded brokers/ dir
  '/api/telegram': 'brokers/telegram.json',        // alert Telegram bot config (enabled/TOKEN/chatId) -- the bot token is a secret, so also under git-excluded brokers/
  '/api/market-hours': 'market/market-hours.json',   // learned session open-rule per broker/symbol (persisted; rarely changes)
};

// ---- folder libraries: one <name>.json file per item ----
// Chart TEMPLATES are PERSONAL: the user's own saved chart setups, stored under the git-excluded
// settings/ dir (runtime state, never shared, starts empty). App THEMES are SHARABLE: installable
// content under packages/, shipped and swappable. Both use one generic handler; only the dir differs.
const TPL_DIR = path.join(SETTINGS_DIR, 'chart-templates');
const THEME_DIR = path.join(ROOT, 'packages', 'themes');
// Chart THEMES: sharable chart-style presets (candles + a canvas-colour subset), the chart-side
// parallel of app themes. Installable content, so they live under packages/ alongside app themes.
const CHART_THEME_DIR = path.join(ROOT, 'packages', 'chart-themes');
// The user's LOCAL vocab packs — the ONLY place the app reads vocabulary from (besides the built-in
// English defaults in code). The Weblate-owned translation files are never read by the running app; a
// language shows up only once its pack is installed here. Remote installs land here (remote -> local).
const VOCABULARY_DIR = path.join(ROOT, 'packages', 'vocabulary');
// workspaces: one file per workspace, keyed by a STABLE id (not the name) so a rename
// never moves the file or breaks a tab's reference. The workspace IS the memory.
const WS_DIR = path.join(SETTINGS_DIR, 'workspace', 'workspaces');

function listFolder(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch (_) { return null; } })
      .filter((t) => t && t.name);
  } catch (_) { return []; }
}
// generic GET (list) / save / delete / open for a folder of <name>.json items.
// returns true once it has handled `p`. `key` is the JSON array field the client expects.
function folderApi(p, req, res, base, dir, key) {
  if (p === base && req.method === 'GET') { sendJson(res, 200, { [key]: listFolder(dir) }); return true; }
  if (p === base + '/save' && req.method === 'POST') {
    readBody(req, (d) => {
      if (!d || !d.name) return sendJson(res, 400, { error: 'name required' });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fileSlug(d.name) + '.json'), JSON.stringify({ name: d.name, ...(d.data || {}) }, null, 2));
      sendJson(res, 200, { ok: true });
    });
    return true;
  }
  if (p === base + '/delete' && req.method === 'POST') {
    readBody(req, (d) => { try { fs.unlinkSync(path.join(dir, fileSlug(d && d.name) + '.json')); } catch (_) {} sendJson(res, 200, { ok: true }); });
    return true;
  }
  if (p === base + '/open' && req.method === 'POST') { openFolder(dir); sendJson(res, 200, { ok: true }); return true; }
  return false;
}

// Workspaces folder API: one <id>.json per workspace. Unlike folderApi (keyed by name-slug),
// this is keyed by a stable `id` so rename doesn't move the file. GET /api/workspaces returns a
// light index (id/name/meta + a summary) for the manager dialog; GET /api/workspaces/<id> returns
// the FULL workspace. Autosave POSTs the whole record to /api/workspaces/save.
function wsSummary(ws) {
  const panes = (ws && Array.isArray(ws.panes)) ? ws.panes : [];
  const p0 = panes[0] || {};
  return panes.length + ' pane' + (panes.length === 1 ? '' : 's') +
         (p0.symbol ? ' · ' + p0.symbol : '') + (p0.tfId ? ' · ' + p0.tfId : '');
}
// study board (chart-less: every pane is a board pane) vs a regular chart layout — for the manager icon
function wsIsBoard(ws) {
  if (ws && ws.type === 'studyboard') return true;
  const panes = (ws && Array.isArray(ws.panes)) ? ws.panes : [];
  return panes.length > 0 && panes.every((p) => p && p.settings && p.settings.board);
}
function workspacesApi(p, req, res) {
  if (p === '/api/workspaces' && req.method === 'GET') {
    let items = [];
    try {
      items = fs.readdirSync(WS_DIR).filter((f) => f.endsWith('.json')).map((f) => {
        try { const j = JSON.parse(fs.readFileSync(path.join(WS_DIR, f), 'utf-8'));
          // surface panels (Trade Desk / AI Workspace) are singleton tools opened via the "Open panel"
          // buttons, not user-curated workspaces -- keep them OUT of the saved-workspace list.
          if (j.ws && j.ws.type === 'surface') return null;
          return { id: j.id, name: j.name, createdMs: j.createdMs, updatedMs: j.updatedMs, summary: wsSummary(j.ws), isBoard: wsIsBoard(j.ws) }; }
        catch (_) { return null; }
      }).filter((x) => x && x.id);
    } catch (_) {}
    sendJson(res, 200, { workspaces: items });
    return true;
  }
  if (p === '/api/workspaces/save' && req.method === 'POST') {
    readBody(req, (d) => {
      if (!d || !d.id) return sendJson(res, 400, { error: 'id required' });
      fs.mkdirSync(WS_DIR, { recursive: true });
      fs.writeFileSync(path.join(WS_DIR, fileSlug(d.id) + '.json'), JSON.stringify(d, null, 2));
      sendJson(res, 200, { ok: true });
    });
    return true;
  }
  if (p === '/api/workspaces/delete' && req.method === 'POST') {
    readBody(req, (d) => { try { fs.unlinkSync(path.join(WS_DIR, fileSlug(d && d.id) + '.json')); } catch (_) {} sendJson(res, 200, { ok: true }); });
    return true;
  }
  if (p === '/api/workspaces/open' && req.method === 'POST') { openFolder(WS_DIR); sendJson(res, 200, { ok: true }); return true; }
  if (p.startsWith('/api/workspaces/') && req.method === 'GET') {   // GET one full workspace by id
    const id = fileSlug(decodeURIComponent(p.slice('/api/workspaces/'.length)));
    try { sendJson(res, 200, JSON.parse(fs.readFileSync(path.join(WS_DIR, id + '.json'), 'utf-8'))); }
    catch (_) { sendJson(res, 404, { error: 'not found' }); }
    return true;
  }
  return false;
}

// the settings switchboard: tabs upsert/remove, the folder libraries, workspaces, and
// the generic API_FILES GET/POST. Returns true once handled.
function handleSettings(req, res) {
  // Per-tab tab persistence: many windows (detached charts) write their own tabs without
  // clobbering each other's. upsert replaces/appends one tab by id; remove drops it.
  if (req.url === '/api/tabs/upsert' && req.method === 'POST') {
    readBody(req, (d) => {
      if (!d || !d.id) return sendJson(res, 400, { error: 'missing id' });
      const cur = readSettingsFile('workspace/tabs.json'); const list = Array.isArray(cur.tabs) ? cur.tabs : [];
      const i = list.findIndex((t) => t && t.id === d.id);
      const tab = { id: d.id, name: d.name || '', wsId: d.wsId };   // thin index; ws lives in the workspace file
      if (i >= 0) list[i] = tab; else list.push(tab);
      if (d.active !== undefined) cur.active = d.active;
      cur.tabs = list; writeSettingsFile('workspace/tabs.json', cur);
      sendJson(res, 200, { ok: true });
    });
    return true;
  }
  if (req.url === '/api/tabs/remove' && req.method === 'POST') {
    readBody(req, (d) => {
      const cur = readSettingsFile('workspace/tabs.json');
      cur.tabs = (Array.isArray(cur.tabs) ? cur.tabs : []).filter((t) => t && t.id !== (d && d.id));
      writeSettingsFile('workspace/tabs.json', cur); sendJson(res, 200, { ok: true });
    });
    return true;
  }
  // folder libraries (individual files): chart templates + app themes
  const fp = (req.url || '').split('?')[0];

  // PATCH-style per-key writes: POST /api/<name>/merge with an object holding ONLY the changed
  // top-level keys; the server folds them into the existing file. This is how every createStore
  // client saves -- a whole-document POST from a window holding a stale copy silently reverted
  // every key other windows had changed (last-writer-wins per FILE; found live: the Optimization
  // knobs kept resetting). Line-editor principle: touch the keys you changed, preserve the rest.
  if (fp.endsWith('/merge') && req.method === 'POST') {
    const file = API_FILES[fp.slice(0, -'/merge'.length)];
    if (file) {
      readBody(req, (patch) => {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return sendJson(res, 400, { error: 'object patch required' });
        writeSettingsFile(file, { ...readSettingsFile(file), ...patch });
        sendJson(res, 200, { ok: true });
      });
      return true;
    }
  }

  if (folderApi(fp, req, res, '/api/chart-templates', TPL_DIR, 'templates')) return true;
  if (folderApi(fp, req, res, '/api/themes', THEME_DIR, 'themes')) return true;
  if (folderApi(fp, req, res, '/api/chart-themes', CHART_THEME_DIR, 'themes')) return true;
  // vocab GET: read every pack in packages/vocabulary. A file is either a user pack {name,words} or a
  // flat word map (the whole file is the words); name falls back to the filename.
  if (fp === '/api/vocab' && req.method === 'GET') {
    let packs = [];
    try {
      packs = fs.readdirSync(VOCABULARY_DIR).filter((f) => f.endsWith('.json')).map((f) => {
        try {
          const obj = JSON.parse(fs.readFileSync(path.join(VOCABULARY_DIR, f), 'utf-8'));
          const words = (obj && obj.words && typeof obj.words === 'object') ? obj.words : obj;
          return { name: (obj && obj.name) || f.slice(0, -5), words };
        } catch (_) { return null; }
      }).filter(Boolean);
    } catch (_) { /* folder absent -> no packs */ }
    sendJson(res, 200, { packs });
    return true;
  }
  if (folderApi(fp, req, res, '/api/vocab', VOCABULARY_DIR, 'packs')) return true;   // save/delete/open the user's LOCAL vocab library
  if (workspacesApi(fp, req, res)) return true;

  const file = API_FILES[req.url];
  if (file) {
    if (req.method === 'GET') { sendJson(res, 200, readSettingsFile(file)); return true; }
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let data;
        try { data = JSON.parse(raw); }
        catch (_) { return sendJson(res, 400, { error: 'invalid json' }); }
        writeSettingsFile(file, data);
        sendJson(res, 200, { ok: true });
      });
      return true;
    }
    res.writeHead(405); res.end('Method not allowed');
    return true;
  }
  return false;
}

module.exports = { handleSettings };
