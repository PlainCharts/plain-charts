'use strict';
// Shared server plumbing: paths, JSON responses/bodies, settings-file IO, folder
// opening, name sanitizers and the raw HTTPS helper.
// Zero npm dependencies (Node built-ins only).
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SETTINGS_DIR = path.join(ROOT, 'settings');

function readSettingsFile(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SETTINGS_DIR, name), 'utf-8'));
  } catch (_) {
    return {};   // missing/invalid -> empty; client applies its own defaults
  }
}

function writeSettingsFile(name, data) {
  const full = path.join(SETTINGS_DIR, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });   // name may include a subfolder (e.g. brokers/accounts.json)
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
                        'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, cb) {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => { let d; try { d = JSON.parse(raw); } catch (_) { d = {}; } cb(d); });
}

// open a folder in the OS file manager (cross-platform; the local server does it so it
// works the same in any browser or the Electron wrapper)
function openFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try { require('child_process').spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
}

const fileSlug = (n) => String(n || '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '-').trim() || 'item';
// Names sanitized to [a-z0-9_-] (no traversal).
const sanitizeModName = (n) => String(n || '').replace(/\.js$/i, '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);

// minimal promise wrapper over https.request -> { status, body:string }
function httpsRequest(method, urlStr, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      { method, hostname: u.hostname, port: 443, path: u.pathname + u.search, headers },
      (r) => {
        // Collect RAW bytes (not string concat) and decompress by content-encoding. Some
        // OAuth token endpoints return gzip even when we don't ask for it (ignoring
        // Accept-Encoding: identity); reading the body as a string corrupted those bytes, so
        // JSON.parse failed and every token refresh/exchange looked like an error.
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => {
          let buf = Buffer.concat(chunks);
          const enc = String(r.headers['content-encoding'] || '').toLowerCase();
          try {
            if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
            else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
            else if (enc.includes('br')) buf = zlib.brotliDecompressSync(buf);
          } catch (_) { /* leave raw bytes if decode fails */ }
          resolve({ status: r.statusCode, body: buf.toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = { ROOT, SETTINGS_DIR, readSettingsFile, writeSettingsFile, sendJson, readBody, openFolder, fileSlug, sanitizeModName, httpsRequest };
