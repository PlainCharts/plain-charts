// @ts-check
// The gated capability surface -- the ONLY view of the app an AI assistant is given. Every operation is
// policy-checked here (via gate.js) before it touches the real internal API, so the MCP server just adapts
// transport/schemas onto these functions and never reaches past them. Runs in the addon-host renderer, where
// the live broker + platform stores + the Assistant settings all are. This first slice covers account reads,
// diagnostics, order execution, and connection control; market data, workspace, and authoring tools follow.
import { broker, platform, command } from '../../data_engine/index.js';
import { requireRule } from './gate.js';
import { runCommand } from './cmd-host.js';
import { IPC } from '../ipc-contract.js';

const win = /** @type {any} */ (typeof window !== 'undefined' ? window : null);
const req = (win && win.require) ? win.require : null;   // Node in the addon-host (for reading/writing persisted state)

// The app root (passed to the addon-host as ?root=), for Node fs paths. '' if unavailable.
function appRoot() { try { return decodeURIComponent(new URLSearchParams(location.search).get('root') || ''); } catch (_) { return ''; } }
// Read a JSON file under the app root. Returns null on any error.
/** @param {string} relPath @returns {any} */
function readJsonFile(relPath) {
  const t = readTextFile(relPath);
  try { return t == null ? null : JSON.parse(t); } catch (_) { return null; }
}
/** @param {string} relPath @returns {string|null} */
function readTextFile(relPath) {
  try { const fs = req('fs'), path = req('path'), ROOT = appRoot(); if (!req || !ROOT) return null; return fs.readFileSync(path.join(ROOT, relPath), 'utf8'); } catch (_) { return null; }
}
/** @param {string} relPath @param {string} text */
function writeTextFile(relPath, text) {
  if (!req) throw new Error('no filesystem'); const fs = req('fs'), path = req('path'), ROOT = appRoot(); if (!ROOT) throw new Error('no app root');
  const full = path.join(ROOT, relPath); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text);
}
/** @param {string} relPath @returns {string[]} */
function listDir(relPath) {
  try { const fs = req('fs'), path = req('path'), ROOT = appRoot(); if (!req || !ROOT) return []; return fs.readdirSync(path.join(ROOT, relPath)); } catch (_) { return []; }
}
// Restrict an author-supplied module name to a safe filename (no path traversal).
/** @param {string} name @returns {(string|null)} */
function safeName(name) { const s = String(name || '').replace(/[^a-zA-Z0-9_-]/g, ''); return s || null; }
// Tell the UI window(s) to (re)load a study file the assistant just wrote, so it applies on charts at once.
/** @type {any} */
const reloadChan = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(IPC.ASSISTANT_RELOAD) : null;
/** @param {string} file */
function signalStudyReload(file) { try { if (reloadChan) reloadChan.postMessage({ file }); } catch (_) {} }

// Route an assistant order THROUGH the order worker -- the single execution + enforcement point. The worker
// re-checks the live policy and runs the per-order confirm before it touches the broker (the trusted boundary the
// AI cannot bypass). `requireRule` above is a fail-closed pre-check only. Throw on failure so the MCP tool layer
// reports it uniformly (the worker returns { ok:false, error } rather than rejecting).
/** @param {string} method @param {any[]} args @returns {Promise<any>} */
async function sendOrder(method, args) {
  const r = await command({ type: 'assistantOrder', method, args });
  if (r && r.ok === false) throw new Error(r.error || (method + ' failed'));
  return (r && r.result != null) ? r.result : { ok: true };
}

// parse an app timeframe id ('5m' / '1h' / 'D') into the adapter's tf spec (adapters key off unit/n, not id)
/** @param {string} id */
function parseTf(id) { const m = /^(\d*)(m|h|D|W|M)$/.exec(String(id || '').trim()); return m ? { id: String(id), unit: m[2], n: m[1] ? +m[1] : 1 } : null; }
/** @param {{ unit: string, n: number }} t bar length in ms (for count -> time-range) */
function tfMs(t) { return t.unit === 'm' ? t.n * 60000 : t.unit === 'h' ? t.n * 3600000 : t.unit === 'D' ? 86400000 : t.unit === 'W' ? 604800000 : 2592000000; }
// resolveSymbol as a promise (needs an active connection; guards against a callback that never fires)
/** @param {string} symbol @returns {Promise<any>} */
function resolveOne(symbol) {
  return new Promise((resolve, reject) => {
    if (!broker.active()) return reject(new Error('no active broker connection'));
    let done = false;
    const guard = setTimeout(() => { if (!done) { done = true; reject(new Error('symbol resolve timed out')); } }, 10000);
    broker.resolveSymbol.bind(broker)(symbol, (/** @type {any} */ inst, /** @type {any} */ err) => { if (done) return; done = true; clearTimeout(guard); err ? reject(new Error(String(err))) : resolve(inst); });
  });
}

// Each method throws AssistantDenied (from requireRule) when its rule is off. All return Promises so the MCP
// tool layer is uniform.
export const surface = {
  // ---- read.account : live account state (platform stores are already broker-synced snapshots) ----
  async positions() { requireRule('read.account'); return platform.positions.all(); },
  async orders() { requireRule('read.account'); return platform.orders.all(); },
  async fills() { requireRule('read.account'); return platform.fills.all(); },
  async accounts() { requireRule('read.account'); return platform.accounts.all(); },
  async connections() { requireRule('read.account'); return broker.connections(); },

  // ---- read.diagnostics : the console/log stream ----
  /** @param {number} [limit] */
  async logs(limit) { requireRule('read.diagnostics'); const h = platform.console.history() || []; return limit ? h.slice(-limit) : h; },

  // ---- read.market : instrument lookup + historical bars (live, from the active broker) ----
  /** @param {string} symbol */
  async resolveSymbol(symbol) { requireRule('read.market'); const inst = await resolveOne(symbol); if (!inst) throw new Error('unknown symbol: ' + symbol); return inst; },
  /** @param {{ symbol: string, tf: string, count?: number, fromMs?: number, toMs?: number }} p */
  async bars(p) {
    requireRule('read.market');
    const t = parseTf(p.tf); if (!t) throw new Error('bad timeframe: ' + p.tf);
    const inst = await resolveOne(p.symbol); if (!inst || inst.id == null) throw new Error('unknown symbol: ' + p.symbol);
    const to = p.toMs || Date.now();
    const from = p.fromMs || (to - Math.max(1, p.count || 300) * tfMs(t));
    return new Promise((resolve, reject) => {
      /** @type {any[]} */
      const acc = [];
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(guard); resolve(acc.sort((a, b) => a.time - b.time)); };
      const guard = setTimeout(finish, 20000);   // the fetch may stream several chunks; cap the wait
      broker.getBars.bind(broker)({ id: inst.id, tf: t, fromMs: from, toMs: to }, (/** @type {any} */ u) => {
        if (done || !u) return;
        if (u.error) { done = true; clearTimeout(guard); return reject(new Error(String(u.error))); }
        if (Array.isArray(u.bars)) acc.push(...u.bars);
        if (u.complete) finish();
      });
    });
  },

  // ---- read.workspace : what's open (from the persisted, autosaved workspace/tabs) ----
  async tabs() { requireRule('read.workspace'); const t = readJsonFile('settings/workspace/tabs.json') || {}; return { tabs: t.tabs || [], active: t.active || null }; },
  /** @param {string} [wsId] defaults to the active tab's workspace */
  async workspace(wsId) {
    requireRule('read.workspace');
    if (!wsId) { const t = readJsonFile('settings/workspace/tabs.json') || {}; const active = (t.tabs || []).find((/** @type {any} */ x) => x.id === t.active); wsId = active && active.wsId; }
    if (!wsId) throw new Error('no active workspace');
    const w = readJsonFile('settings/workspace/workspaces/' + wsId + '.json');
    if (!w) throw new Error('workspace not found: ' + wsId);
    const ws = w.ws || {};
    const panes = (ws.panes || []).map((/** @type {any} */ p, /** @type {number} */ i) => ({
      index: i, symbol: p.symbol, tf: p.tfId || p.tf, broker: p.broker, chartType: p.chartType,
      studies: (p.studies || []).map((/** @type {any} */ s) => ({ id: s.id, name: s.name })),
    }));
    return { id: w.id, name: w.name, layout: ws.layout, panes };
  },

  // ---- author.studies : create/read study modules (plain-JS Studies.register(...) files) ----
  // Listing what exists is read-side; reading/writing source is authoring.
  async listStudies() { requireRule('read.workspace'); return listDir('packages/studies').filter((id) => readTextFile('packages/studies/' + id + '/' + id + '.js') != null); },
  /** @param {string} name */
  async getStudy(name) { requireRule('author.studies'); const s = safeName(name); if (!s) throw new Error('invalid study name'); const code = readTextFile('packages/studies/' + s + '/' + s + '.js'); if (code == null) throw new Error('study not found: ' + name); return { name: s, code }; },
  /** @param {string} name @param {string} code */
  async writeStudy(name, code) {
    requireRule('author.studies');
    const s = safeName(name); if (!s) throw new Error('invalid study name');
    if (typeof code !== 'string' || !code.trim()) throw new Error('no code');
    writeTextFile('packages/studies/' + s + '/' + s + '.js', code);
    signalStudyReload(s);   // folder id -> UI reloads it -> applies on charts
    return { ok: true, file: s };
  },

  // ---- author.workspace : live pane mutations (executed in the UI window via a command) ----
  /** @param {{ paneIndex?: number, studyId: string, params?: any }} p */
  async addStudy(p) { requireRule('author.workspace'); return runCommand('addStudy', { paneIndex: p.paneIndex, studyId: p.studyId, params: p.params }); },
  /** @param {{ paneIndex?: number, symbol: string, broker?: string }} p */
  async setSymbol(p) { requireRule('author.workspace'); return runCommand('setSymbol', { paneIndex: p.paneIndex, symbol: p.symbol, broker: p.broker }); },
  /** @param {{ paneIndex?: number, tf: string }} p */
  async setTimeframe(p) { requireRule('author.workspace'); return runCommand('setTimeframe', { paneIndex: p.paneIndex, tf: p.tf }); },

  // ---- author.alerts : a price-level alert on a pane's symbol ----
  /** @param {{ paneIndex?: number, price: number }} p */
  async addAlert(p) { requireRule('author.alerts'); return runCommand('addAlert', { paneIndex: p.paneIndex, price: p.price }); },

  // ---- read.workspace : what the user is looking at / has selected on the active chart ----
  async getSelection() { requireRule('read.workspace'); return runCommand('getSelection', {}); },

  // ---- author.appearance : list + apply app themes ----
  async listThemes() { requireRule('author.appearance'); return listDir('packages/themes').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')); },
  /** @param {string} name */
  async applyTheme(name) { requireRule('author.appearance'); if (!name) throw new Error('theme name required'); return runCommand('applyTheme', { name }); },

  // ---- author.drawings : add / list / remove drawings on a pane ----
  /** @param {{ paneIndex?: number, tool: string, points: any[], style?: any }} p */
  async addDrawing(p) { requireRule('author.drawings'); if (!p.tool || !Array.isArray(p.points) || !p.points.length) throw new Error('tool and points required'); return runCommand('addDrawing', { paneIndex: p.paneIndex, tool: p.tool, points: p.points, style: p.style }); },
  async listDrawings() { requireRule('read.workspace'); return runCommand('listDrawings', {}); },
  /** @param {string} id */
  async removeDrawing(id) { requireRule('author.drawings'); if (!id) throw new Error('drawing id required'); return runCommand('removeDrawing', { id }); },

  // ---- control.addons : list / enable / reload addons (state file the addon runtime polls) ----
  async listAddons() {
    requireRule('control.addons');
    const state = readJsonFile('settings/addons/addons.json') || {};
    const status = readJsonFile('settings/addons/addons-status.json') || {};
    return listDir('addons').filter((f) => !f.includes('.')).map((id) => ({ id, enabled: state[id] === true, running: !!(status[id] && status[id].running), error: (status[id] && status[id].error) || null }));
  },
  /** @param {string} id @param {boolean} enabled */
  async enableAddon(id, enabled) {
    requireRule('control.addons');
    if (!listDir('addons').includes(id)) throw new Error('unknown addon: ' + id);
    const state = readJsonFile('settings/addons/addons.json') || {};
    state[id] = !!enabled;
    writeTextFile('settings/addons/addons.json', JSON.stringify(state, null, 2));
    return { ok: true, id, enabled: !!enabled };
  },
  /** @param {string} id */
  async reloadAddon(id) {
    requireRule('control.addons');
    if (!listDir('addons').includes(id)) throw new Error('unknown addon: ' + id);
    const state = /** @type {any} */ (readJsonFile('settings/addons/addons.json')) || {};
    state._rev = state._rev || {};
    state._rev[id] = (state._rev[id] || 0) + 1;
    writeTextFile('settings/addons/addons.json', JSON.stringify(state, null, 2));
    return { ok: true, id };
  },

  // ---- execute.orders : routed THROUGH the order worker, which owns execution AND enforcement (fresh policy
  //      re-check + per-order confirm) before the broker is touched. `requireRule` here is a fail-closed pre-check;
  //      the worker is the authoritative boundary the AI cannot bypass (a separate process, reachable only via the
  //      gated command). ----
  /** @param {any} order */
  async placeOrder(order) { requireRule('execute.orders'); return sendOrder('placeOrder', [order]); },
  /** @param {any} mod */
  async modifyOrder(mod) { requireRule('execute.orders'); return sendOrder('modifyOrder', [mod]); },
  /** @param {any} orderId */
  async cancelOrder(orderId) { requireRule('execute.orders'); return sendOrder('cancelOrder', [orderId]); },
  /** @param {any} symbol */
  async closePosition(symbol) { requireRule('execute.orders'); return sendOrder('closePosition', [symbol]); },

  // ---- control.connections : operational, sensitive (default off) ----
  /** @param {any} account */
  async connect(account) { requireRule('control.connections'); return broker.connect(account); },
  /** @param {any} id */
  async disconnect(id) { requireRule('control.connections'); return broker.disconnect(id); },
  /** @param {any} id */
  async setActive(id) { requireRule('control.connections'); return broker.setActive(id); },
};
