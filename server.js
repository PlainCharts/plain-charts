#!/usr/bin/env node
/**
 * Local static server + accounts settings API for the chart app.
 *
 * Serves the app files from this directory and persists broker accounts
 * to settings/accounts.json. Zero npm dependencies (Node built-ins only),
 * so it bundles cleanly into an Electron/Tauri build later.
 *
 * The API domains live in server/ as focused modules: util (shared plumbing),
 * settings-api (settings files + folder libraries + workspaces + tabs), cache
 * (historical-bar cache), user-modules (user studies / tool packages / tool
 * icons) and adapter-hooks (the generic mount for adapter-owned server code:
 * an adapter folder may ship a server.js — e.g. the Schwab OAuth proxy and the
 * OANDA CORS proxy live in adapters/<id>/server.js, not here). This file is the
 * router + static file serving + the addon/adapter control surface.
 *
 * Run:  node server.js      then open  http://localhost:8011/
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const addonHost = require('./addon-host.js');
const { sendJson, readBody, openFolder, sanitizeModName } = require('./server/util.js');
const { handleSettings } = require('./server/settings-api.js');
const { mountAdapterHooks, handleAdapterHooks } = require('./server/adapter-hooks.js');
const { handleCache } = require('./server/cache.js');
const { handleUserStudies, handleUserTools, handleToolIcon, scrapeField } = require('./server/user-modules.js');

// Addons run unrestricted Node code — keep the server alive if one misbehaves.
// (Per-addon child-process isolation is the next hardening step.)
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

const ROOT = __dirname;
const PORT = process.env.PORT || 8011;
// Bind host: localhost-only by default (safe). Set HOST=0.0.0.0 to expose on the LAN — e.g. to open
// the app from a phone/tablet on the same wifi (http://<your-LAN-IP>:PORT). Only do this on a
// trusted network: it exposes the account/broker APIs to every device on the LAN.
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.proto': 'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3':  'audio/mpeg',
};

function serveStatic(req, res) {
  // strip query string, prevent path traversal, default to /index.html
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath.startsWith('/api/user-studies')) {
    return handleUserStudies(req, res, urlPath, new URL(req.url, 'http://localhost').searchParams);
  }
  if (urlPath.startsWith('/api/user-tools')) {
    return handleUserTools(req, res, urlPath, new URL(req.url, 'http://localhost').searchParams);
  }
  if (urlPath === '/api/tool-icon' && req.method === 'POST') return handleToolIcon(req, res);
  // addon host control surface
  if (urlPath === '/api/addons' && req.method === 'GET') return sendJson(res, 200, { addons: addonHost.list() });
  if (urlPath === '/api/addons/toggle' && req.method === 'POST') return readBody(req, (d) => sendJson(res, 200, addonHost.toggle(d.id, d.enabled)));
  if (urlPath === '/api/addons/reload' && req.method === 'POST') return readBody(req, (d) => sendJson(res, 200, addonHost.reload(d.id)));
  if (urlPath === '/api/addons/save' && req.method === 'POST') return readBody(req, (d) => sendJson(res, 200, addonHost.save(d.name, d.code)));
  if (urlPath === '/api/addons/delete' && req.method === 'POST') return readBody(req, (d) => sendJson(res, 200, addonHost.remove(d.id)));
  if (urlPath === '/api/addons/package' && req.method === 'POST') return readBody(req, (d) => sendJson(res, 200, addonHost.installPackage(d.id, d.files)));
  if (urlPath === '/api/addons/open' && req.method === 'POST') { openFolder(path.join(ROOT, 'addons')); return sendJson(res, 200, { ok: true }); }
  if (urlPath === '/api/addons/config' && req.method === 'POST') return readBody(req, (d) => sendJson(res, 200, addonHost.config(d.id, d.config)));
  if (urlPath === '/api/addons/file' && req.method === 'GET') return sendJson(res, 200, addonHost.read(new URL(req.url, 'http://localhost').searchParams.get('id')));
  if (urlPath === '/api/addon-icon' && req.method === 'POST') return readBody(req, (d) => sendJson(res, 200, addonHost.setIcon(d.id, d.dataUrl)));
  if (urlPath === '/api/addon-icon' && req.method === 'DELETE') return sendJson(res, 200, addonHost.removeIcon(new URL(req.url, 'http://localhost').searchParams.get('id')));
  // Broker ADAPTERS — ALL adapters live in the ENGINE's data_engine/adapters/ folder (the ones we ship
  // are just examples, no built-in tier). The data-host dynamically imports each by its url. Drop or
  // write one in and it loads.
  if (urlPath === '/api/adapters' && req.method === 'GET') {
    const dir = path.join(ROOT, 'data_engine', 'adapters'); const adapters = [];
    try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'index.js'))) { const f = path.join(dir, e.name, 'index.js'); adapters.push({ id: e.name, name: scrapeField(f, 'name', 'const adapter') || e.name, description: scrapeField(f, 'description', 'const adapter'), url: '/data_engine/adapters/' + e.name + '/index.js', icon: fs.existsSync(path.join(dir, e.name, 'icon.png')) ? '/data_engine/adapters/' + e.name + '/icon.png' : '' }); } } } catch (_) {}
    return sendJson(res, 200, { adapters });
  }
  if (urlPath === '/api/adapters/open' && req.method === 'POST') { openFolder(path.join(ROOT, 'data_engine', 'adapters')); return sendJson(res, 200, { ok: true }); }
  if (urlPath === '/api/adapters/package' && req.method === 'POST') return readBody(req, (d) => {   // install a whole adapter FOLDER, tree intact
    const id = sanitizeModName(d.id);
    if (!id) return sendJson(res, 400, { error: 'invalid id' });
    if (!Array.isArray(d.files) || !d.files.length) return sendJson(res, 400, { error: 'no files' });
    const dir = path.join(ROOT, 'data_engine', 'adapters'); const base = path.join(dir, id);
    try {
      for (const f of d.files) {
        const rel = String((f && f.path) || '').replace(/\\/g, '/');
        if (!rel || rel.split('/')[0] !== id) continue;                 // every file must live under the package folder
        const dest = path.join(dir, rel);
        if (dest !== base && !dest.startsWith(base + path.sep)) continue;   // no traversal outside the package
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (typeof f.b64 === 'string') fs.writeFileSync(dest, Buffer.from(f.b64, 'base64'));
        else fs.writeFileSync(dest, String(f.text || ''));
      }
    } catch (e) { return sendJson(res, 500, { error: String((e && e.message) || e) }); }
    return sendJson(res, 200, { ok: true, id });
  });
  if (urlPath === '/api/adapters/delete' && req.method === 'POST') return readBody(req, (d) => {
    const id = sanitizeModName(d.id);
    if (!id) return sendJson(res, 400, { error: 'invalid id' });
    try { fs.rmSync(path.join(ROOT, 'data_engine', 'adapters', id), { recursive: true, force: true }); } catch (_) {}
    return sendJson(res, 200, { ok: true });
  });
  // Order PRIMITIVES — loadable on-chart order renderers (string-beads, ...). The shipped default (pill) is
  // built in; extra ones are installable content under packages/primitives/<id>/index.js, discovered the same
  // way as adapters. Drop or write one in and it loads; absent = the chart falls back to pill.
  if (urlPath === '/api/user-order-primitives' && req.method === 'GET') {
    const dir = path.join(ROOT, 'packages', 'primitives'); const primitives = [];
    try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'index.js'))) { const f = path.join(dir, e.name, 'index.js'); primitives.push({ id: e.name, name: scrapeField(f, 'name', 'registerPrimitive(') || e.name, description: scrapeField(f, 'description', 'registerPrimitive('), url: '/packages/primitives/' + e.name + '/index.js', icon: fs.existsSync(path.join(dir, e.name, 'icon.png')) ? '/packages/primitives/' + e.name + '/icon.png' : '' }); } } } catch (_) {}
    return sendJson(res, 200, { primitives });
  }
  if (urlPath === '/api/user-order-primitives/open' && req.method === 'POST') { openFolder(path.join(ROOT, 'packages', 'primitives')); return sendJson(res, 200, { ok: true }); }
  if (urlPath === '/api/user-order-primitives/package' && req.method === 'POST') return readBody(req, (d) => {   // install a whole primitive FOLDER, tree intact
    const id = sanitizeModName(d.id);
    if (!id) return sendJson(res, 400, { error: 'invalid id' });
    if (!Array.isArray(d.files) || !d.files.length) return sendJson(res, 400, { error: 'no files' });
    const dir = path.join(ROOT, 'packages', 'primitives'); const base = path.join(dir, id);
    try {
      for (const f of d.files) {
        const rel = String((f && f.path) || '').replace(/\\/g, '/');
        if (!rel || rel.split('/')[0] !== id) continue;                 // every file must live under the package folder
        const dest = path.join(dir, rel);
        if (dest !== base && !dest.startsWith(base + path.sep)) continue;   // no traversal outside the package
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (typeof f.b64 === 'string') fs.writeFileSync(dest, Buffer.from(f.b64, 'base64'));
        else fs.writeFileSync(dest, String(f.text || ''));
      }
    } catch (e) { return sendJson(res, 500, { error: String((e && e.message) || e) }); }
    return sendJson(res, 200, { ok: true, id });
  });
  if (urlPath === '/api/user-order-primitives/delete' && req.method === 'POST') return readBody(req, (d) => {
    const id = sanitizeModName(d.id);
    if (!id) return sendJson(res, 400, { error: 'invalid id' });
    try { fs.rmSync(path.join(ROOT, 'packages', 'primitives', id), { recursive: true, force: true }); } catch (_) {}
    return sendJson(res, 200, { ok: true });
  });
  if (handleAdapterHooks(req, res)) return;   // adapter-owned server code (adapters/<id>/server.js)
  if (req.url.startsWith('/api/cache/')) {
    try { handleCache(req, res); } catch (e) { sendJson(res, 500, { error: String((e && e.message) || e) }); }
    return;
  }
  if (handleSettings(req, res)) return;   // tabs, folder libraries, workspaces, API_FILES documents
  serveStatic(req, res);
});

mountAdapterHooks();   // discover adapters/<id>/server.js and mount their API prefixes

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT}`);
  console.log(`  http://localhost:${PORT}/   (accounts API at /api/accounts)`);
  if (HOST === '0.0.0.0') console.log(`  LAN: http://<your-LAN-IP>:${PORT}/   (reachable from phones/tablets on this wifi)`);
  addonHost.init();   // discover + start enabled addons
});
