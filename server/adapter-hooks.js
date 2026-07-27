'use strict';
// Adapter SERVER HOOKS -- the generic mount point that keeps broker-specific server code
// inside the adapter's own folder (the adapter folder stays the single portable unit,
// exactly like tool packages and addons). An adapter may optionally ship a `server.js`:
//
//   // adapters/<id>/server.js  (CommonJS -- runs in the app's local server process)
//   module.exports = (api) => ({ prefix: '/api/<id>/', handle: async (req, res) => { ... } });
//
// The factory receives an injected toolkit (dependency injection, like the addon api):
// { sendJson, readBody, readSettingsFile, writeSettingsFile, httpsRequest }. The router
// tries each mounted hook by URL prefix; a hook owns everything under its prefix. A
// broken hook is logged and skipped -- it never takes the server down. Discovery runs
// once at startup; a new adapter's hook loads on the next app restart (same rule as the
// data-host side of an adapter).
const fs = require('fs');
const path = require('path');
const { ROOT, sendJson, readBody, readSettingsFile, writeSettingsFile, httpsRequest } = require('./util.js');

const ADAPTERS_DIR = path.join(ROOT, 'data_engine', 'adapters');
const api = { sendJson, readBody, readSettingsFile, writeSettingsFile, httpsRequest };

/** @type {{ id: string, prefix: string, handle: (req: any, res: any) => any }[]} */
const hooks = [];

function mountAdapterHooks() {
  hooks.length = 0;
  let dirs = [];
  try { dirs = fs.readdirSync(ADAPTERS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch (_) {}
  for (const e of dirs) {
    const file = path.join(ADAPTERS_DIR, e.name, 'server.js');
    if (!fs.existsSync(file)) continue;
    try {
      const make = require(file);
      const hook = typeof make === 'function' ? make(api) : null;
      if (hook && typeof hook.prefix === 'string' && hook.prefix.startsWith('/api/') && typeof hook.handle === 'function') {
        hooks.push({ id: e.name, prefix: hook.prefix, handle: hook.handle });
        console.log('[adapter-hook] mounted ' + e.name + ' at ' + hook.prefix);
      } else {
        console.error('[adapter-hook] ' + e.name + '/server.js must export (api) => ({ prefix: "/api/...", handle }) — skipped');
      }
    } catch (err) {
      console.error('[adapter-hook] failed to load ' + e.name + '/server.js: ' + String((err && err.message) || err));
    }
  }
  return hooks.map((h) => h.id + ':' + h.prefix);
}

// returns true once a mounted hook owns the URL (async handlers are caught -> 500)
function handleAdapterHooks(req, res) {
  for (const h of hooks) {
    if (req.url.startsWith(h.prefix)) {
      Promise.resolve(h.handle(req, res)).catch((e) => sendJson(res, 500, { error: String((e && e.message) || e) }));
      return true;
    }
  }
  return false;
}

module.exports = { mountAdapterHooks, handleAdapterHooks };
