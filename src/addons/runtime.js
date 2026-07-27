// @ts-check
// Addon runtime — runs inside the Node-enabled addon-host renderer. It loads addons from the
// addons/ folder directly off disk (Node require) and runs them with a rich ctx:
//
//   ctx = { id, name, dir, config, log, data }
//     data  — the broker API (subscribe quotes/bars, resolve symbols, and — once added —
//             place/cancel orders). Full INTERNAL data access via the existing proxy bridge.
//     plus full Node: addons require('fs'|'net'|'child_process'|…) anything, no sandbox.
//
// Management (enable/disable/save) is owned by the server addon-host (the Addons panel writes
// settings/addons.json). This runtime watches that file and starts/stops to match; it writes
// settings/addons-status.json (running/error/logs) back for the panel to display. No channels.
import { broker } from '../../data_engine/index.js';

/**
 * @typedef {{ key: string, default?: any }} AddonInput
 * @typedef {{ inputs?: AddonInput[], start?: Function, stop?: Function }} AddonModule
 * @typedef {{ mod: any, logs: string[], error: string|null, rev: number, inputs: AddonInput[], config: Record<string, any> }} AddonRec
 */

const win = /** @type {any} */ (typeof window !== 'undefined' ? window : null);
/** @type {any} */
const req = (win && win.require) ? win.require : null;
if (req) start();

function start() {
  const fs = req('fs'), path = req('path');
  const Q = new URLSearchParams(location.search);
  const ROOT = decodeURIComponent(Q.get('root') || '');
  if (!ROOT) { console.error('[addon-runtime] no root'); return; }
  const ADDONS_DIR = path.join(ROOT, 'addons');
  const STATE_FILE = path.join(ROOT, 'settings', 'addons', 'addons.json');
  const STATUS_FILE = path.join(ROOT, 'settings', 'addons', 'addons-status.json');

  /** @type {Map<string, AddonRec>} */
  const running = new Map();   // id -> { mod, logs:[], error, rev }
  /** @returns {Record<string, any>} */
  const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; } };
  /** @param {Record<string, any>} st @param {string} id @returns {number} */
  const revOf = (st, id) => (st && st._rev && st._rev[id]) || 0;

  function writeStatus() {
    /** @type {Record<string, any>} */
    const s = {};
    running.forEach((r, id) => { s[id] = { running: !r.error, error: r.error, logs: r.logs.slice(-200), inputs: r.inputs, config: r.config }; });
    try { fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true }); fs.writeFileSync(STATUS_FILE, JSON.stringify(s)); } catch (_) {}
  }

  // resolve the addon's effective config = its inputs' defaults, overridden by config.json
  /** @param {string} dir @param {AddonInput[]} inputs @returns {Record<string, any>} */
  function resolveConfig(dir, inputs) {
    /** @type {Record<string, any>} */
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch (_) {}
    /** @type {Record<string, any>} */
    const cfg = {};
    (inputs || []).forEach((i) => { cfg[i.key] = (saved && i.key in saved) ? saved[i.key] : i.default; });
    Object.keys(saved || {}).forEach((k) => { if (!(k in cfg)) cfg[k] = saved[k]; });   // keep extra keys
    return cfg;
  }

  /** @param {string} id @param {string} dir @param {AddonRec} rec */
  function ctxFor(id, dir, rec) {
    return {
      id, name: id, dir, config: rec.config,
      data: broker,   // full internal data access (the broker API, over the existing bridge)
      /** @param {...any} a */
      log: (...a) => {
        const line = new Date().toISOString().slice(11, 19) + '  ' + a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (_) { return String(x); } })())).join(' ');
        rec.logs.push(line); if (rec.logs.length > 300) rec.logs.shift();
        console.log('[addon:' + id + ']', ...a); writeStatus();
      },
    };
  }

  /** @param {string} id @param {number} rev */
  function startAddon(id, rev) {
    const dir = path.join(ADDONS_DIR, id), entry = path.join(dir, 'index.js');
    if (!fs.existsSync(entry)) return;
    /** @type {AddonRec} */
    const rec = { mod: null, logs: [], error: null, rev, inputs: [], config: {} };
    running.set(id, rec);
    try {
      delete req.cache[req.resolve(entry)];   // fresh load so Reload/Save re-applies
      const mod = req(entry); rec.mod = mod;
      rec.inputs = Array.isArray(mod.inputs) ? mod.inputs : [];   // the addon's setup schema
      rec.config = resolveConfig(dir, rec.inputs);
      const fn = typeof mod === 'function' ? mod : (mod && mod.start);
      if (typeof fn === 'function') fn.call(mod, ctxFor(id, dir, rec));
      rec.logs.push('(runtime) started');
    } catch (/** @type {any} */ e) { rec.error = (e && e.stack) || String(e); rec.logs.push('(runtime) start failed: ' + ((e && e.message) || e)); }
    writeStatus();
  }
  /** @param {string} id */
  function stopAddon(id) {
    const rec = running.get(id); if (!rec) return;
    try { const s = rec.mod && rec.mod.stop; if (typeof s === 'function') s.call(rec.mod); } catch (e) { console.error('[addon:' + id + '] stop error', e); }
    running.delete(id); writeStatus();
  }

  function sync() {
    const st = readState();
    // start newly-enabled / restart bumped (reload/save); stop disabled
    Object.keys(st).forEach((id) => {
      if (id === '_rev' || st[id] !== true) return;
      const rec = running.get(id), rev = revOf(st, id);
      if (!rec) startAddon(id, rev);
      else if (rec.rev !== rev) { stopAddon(id); startAddon(id, rev); }
    });
    [...running.keys()].forEach((id) => { if (st[id] !== true) stopAddon(id); });
  }

  sync();
  setInterval(sync, 1500);   // poll state (robust; no fs.watch flakiness, no channel)
  console.log('[addon-runtime] up — addons get full data + full Node');
}
