// ---- crash / diagnostics instrumentation ---------------------------------------------------------
// A forensic pipeline (capture -> enrich -> persist -> report) that logs OUT OF PROCESS, so a crash that kills
// the renderer/GPU before DevTools can read it still lands on disk. Everything is written as STRUCTURED JSON
// lines to logs/app.log (SYNC, survives the crash) AND stderr (visible under `electron .`). Every line carries
// a per-run id so main + renderer + host lines correlate. crashReporter catches NATIVE (C++ segfault) minidumps
// that JS handlers never see. Milestones pin down which init step failed; window/memory/version enrichment on
// fatals gives forensic context; a memory heartbeat surfaces OOM growth.
// Required FIRST by main.js (handlers + the boot line register at require time); main calls setOrigin()
// once the server origin is known so window URLs log short.
const { app, BrowserWindow, ipcMain, crashReporter } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

Error.stackTraceLimit = 100;
const RUN_ID = (() => { try { return crypto.randomUUID(); } catch (_) { return process.pid + '-' + Date.now(); } })();
const LOG_DIR = path.join(__dirname, '..', 'logs');
const APP_LOG = path.join(LOG_DIR, 'app.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
try { const st = fs.statSync(APP_LOG); if (st.size > 5 * 1024 * 1024) fs.renameSync(APP_LOG, APP_LOG + '.1'); } catch (_) {}   // rotate at 5MB
/** structured line: {ts, run, proc, level, sub, msg, meta?}. @param {string} level @param {string} sub @param {string} msg @param {any} [meta] */
function log(level, sub, msg, meta) {
  const rec = { ts: new Date().toISOString(), run: RUN_ID, proc: 'main', level, sub, msg };
  if (meta !== undefined) rec.meta = meta;
  let line; try { line = JSON.stringify(rec); } catch (_) { line = JSON.stringify({ ts: rec.ts, run: RUN_ID, level, sub, msg: String(msg) }); }
  line += '\n';
  try { fs.appendFileSync(APP_LOG, line); } catch (_) {}   // SYNC -> flushed before a fatal exit
  try { process.stderr.write(line); } catch (_) {}
}
const milestone = (/** @type {string} */ m, /** @type {any} */ meta) => log('info', 'lifecycle', m, meta);
// the server origin, set by main once known, so window URLs log short ('' until then = full URL)
let ORIGIN = '';
const setOrigin = (o) => { ORIGIN = o || ''; };
const shortURL = (/** @type {any} */ wc) => { try { return (wc.getURL() || '').replace(ORIGIN, '') || 'main'; } catch (_) { return '?'; } };
// forensic snapshot of every live window (URL/title/loading/visibility/devtools/crashed) — invaluable with many windows
function dumpWindows() {
  const out = [];
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try { out.push({ id: w.id, url: shortURL(w.webContents), title: w.getTitle(), visible: w.isVisible(), loading: w.webContents.isLoading(), devtools: w.webContents.isDevToolsOpened(), crashed: w.webContents.isCrashed() }); } catch (_) {}
    }
  } catch (_) {}
  return out;
}
// Node diagnostic report (stacks, native modules, libs, heap) on a fatal — written before exit
function writeNodeReport(reason) {
  try { if (process.report && process.report.writeReport) { const f = process.report.writeReport(path.join(LOG_DIR, 'report-' + Date.now() + '.json')); log('error', 'report', 'node-report-written', { file: f, reason }); } }
  catch (e) { log('error', 'report', 'node-report-failed', String(e)); }
}
try { crashReporter.start({ submitURL: '', uploadToServer: false }); } catch (e) { log('error', 'crashReporter', 'start-failed', String(e)); }
log('info', 'proc', 'boot', { pid: process.pid, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8, os: os.type() + ' ' + os.release(), arch: process.arch, argv: process.argv.slice(1), logFile: APP_LOG });

process.on('uncaughtException', (e) => { log('fatal', 'main', 'uncaughtException', { stack: (e && e.stack) || String(e), windows: dumpWindows(), mem: process.memoryUsage() }); writeNodeReport('uncaughtException'); });
process.on('unhandledRejection', (e) => log('error', 'main', 'unhandledRejection', { stack: (e && /** @type {any} */ (e).stack) || String(e) }));
process.on('warning', (w) => log('warn', 'main', 'process-warning', { name: w.name, message: w.message, stack: w.stack }));
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => { try { process.on(sig, () => { log('warn', 'signal', sig, { windows: dumpWindows() }); process.exit(0); }); } catch (_) {} });

// renderer / GPU / utility process death — fires in MAIN (survives) with the reason + exit code + window dump
app.on('render-process-gone', (_e, wc, d) => log('fatal', 'process', 'render-process-gone', { url: shortURL(wc), reason: d.reason, exitCode: d.exitCode, windows: dumpWindows(), mem: process.memoryUsage() }));
app.on('child-process-gone', (_e, d) => log('fatal', 'process', 'child-process-gone', { type: d.type, reason: d.reason, exitCode: d.exitCode, name: d.name, service: d.serviceName }));

// attach to EVERY window's webContents centrally: hangs, renderer console (warn/error), navigation, preload errors
app.on('web-contents-created', (_e, wc) => {
  wc.on('unresponsive', () => log('error', 'window', 'unresponsive', shortURL(wc)));
  wc.on('responsive', () => log('info', 'window', 'responsive', shortURL(wc)));
  wc.on('console-message', (_ev, level, message, ln, src) => { if (level >= 2) log(level >= 3 ? 'error' : 'warn', 'renderer-console', message, { url: shortURL(wc), at: (src || '') + ':' + ln }); });
  wc.on('did-fail-load', (_ev, code, desc, url) => log('error', 'nav', 'did-fail-load', { code, desc, url }));
  wc.on('did-fail-provisional-load', (_ev, code, desc, url) => log('error', 'nav', 'did-fail-provisional-load', { code, desc, url }));
  wc.on('did-finish-load', () => milestone('page-loaded', { url: shortURL(wc) }));
  wc.on('preload-error', (_ev, p, err) => log('fatal', 'preload', 'preload-error', { preload: p, stack: (err && err.stack) || String(err) }));
});

// renderer-forwarded errors (preload installs window.onerror / onunhandledrejection and sends them here)
ipcMain.on('diag:renderer-error', (e, payload) => {
  let url = '?'; try { const w = BrowserWindow.fromWebContents(e.sender); url = w ? shortURL(w.webContents) : '?'; } catch (_) {}
  log('error', 'renderer', (payload && payload.type) || 'error', Object.assign({ url }, payload || {}));
});

// memory heartbeat (OOM early-warning). unref so it never keeps the app alive.
const _memBeat = setInterval(() => { try { const m = process.memoryUsage(); log('debug', 'mem', 'heartbeat', { rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576) }); } catch (_) {} }, 60000);
if (_memBeat.unref) _memBeat.unref();

module.exports = { setOrigin, log, milestone };
