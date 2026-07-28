// @ts-check
// The REAL broker facade — runs where the data layer lives: the browser page (solo) or
// the Electron headless data host. Connections are GLOBAL and independent of tabs/windows:
// more than one broker can be connected at once (one connection per protocol — the adapters
// are singletons). The core asks the registry for an adapter by id.
//
// Adapters are DISCOVERED, not hardcoded. The server enumerates the adapters/<id>/ folder (GET /api/adapters)
// and we dynamically import each module for its self-registration side effect. Adding a broker = drop a
// folder in; no code change here. The top-level `await` gates every importer of this module until the
// adapters are registered, so listBrokers()/getBroker() are populated by the time anything reads them.
//
// UI windows do NOT use this directly; they use a thin proxy (broker-bridge.js) that forwards
// to the host. See broker.js for the role switch.
import { getBroker, listBrokers } from './registry.js';
import { bus } from '../bus.js';

/** @typedef {import('./adapter-contract.js').BrokerAdapter} BrokerAdapter */

async function loadAdapters() {
  /** @type {any[]} */
  let list = [];
  try { const d = await fetch('/api/adapters').then((r) => r.json()); list = (d && d.adapters) || []; } catch (e) { console.error('[adapters] discovery failed', e); }
  await Promise.all(list.map(async (a) => {
    try { await import(a.url); } catch (e) { console.error('[adapters] load failed:', a.id, e); return; }   // each at /data_engine/adapters/<id>/index.js
    // name/description come ONLY from the package's meta.json (carried on the discovery list) -- never the
    // code. Merge them onto the registered adapter so labels/pickers show the real name.
    const reg = /** @type {any} */ (getBroker(a.id));
    if (reg) { reg.name = a.name || ''; reg.description = a.description || ''; }
  }));
}

/** @type {Map<string, any>} */
const conns = new Map();   // protocol id -> the account used to connect it
/** @type {Set<string>} */
const connecting = new Set();   // protocol ids with a connect in flight (idempotency guard against the startup race)
/** @type {any} */
let active = null;         // current primary adapter for pane data calls (any: forwards `...args`; boundary reads are cast to BrokerAdapter)

/** @param {string} [id] @returns {BrokerAdapter | null} */
const adapterFor = (id) => listBrokers().find((b) => b.id === id) || null;
/** @returns {BrokerAdapter | null} */
function pickActive() {
  for (const id of conns.keys()) { const a = adapterFor(id); if (a && a.isConnected && a.isConnected()) return a; }
  return null;
}

export const broker = {
  // ---- lifecycle (multi-connection) ----
  /** @param {any} account */
  async connect(account) {
    const a = getBroker(account.protocol);
    if (!a) return null;
    // Idempotent: if this protocol is already connected or a connect is in flight, don't reconnect. At startup
    // every window fires auto-connect near-simultaneously, before any has finished -- without this the single
    // host socket would churn (open/close/open) 3x. Just adopt it as active and return.
    if (connecting.has(a.id) || (a.isConnected && a.isConnected())) { active = a; bus.emit('connections:changed'); return a; }
    connecting.add(a.id);
    conns.set(a.id, account);
    active = a;
    bus.emit('connections:changed');
    // Hold the guard until the connection actually RESOLVES (logged on) or a safety timeout -- adapters return
    // from connect() before logon finishes, so releasing on return would reopen the dedup gap for the race.
    let done = false;
    const release = () => { if (done) return; done = true; clearTimeout(timer); off(); connecting.delete(a.id); bus.emit('connections:changed'); };
    const off = bus.on('logon', () => { if (a.isConnected && a.isConnected()) release(); });   // 'logon' carries no id -> gate on this adapter
    const timer = setTimeout(release, 15000);   // connect never resolved (failed/hung) -> free the guard anyway
    try { await a.connect(account); } catch (e) { release(); throw e; }
    return a;
  },
  // disconnect a specific broker by id, or the active one if omitted
  /** @param {string} [id] */
  disconnect(id) {
    const a = id ? adapterFor(id) : active;
    if (a && a.disconnect) { try { a.disconnect(); } catch (_) {} }
    if (a) conns.delete(a.id);
    if (!active || (a && a.id === active.id)) active = pickActive();
    bus.emit('connections:changed');
  },
  /** @param {string} [id] */
  isConnected(id) {
    if (id) { const a = adapterFor(id); return !!(a && a.isConnected && a.isConnected()); }
    return !!active && active.isConnected();
  },
  serverNow() { return active ? active.serverNow() : null; },
  active: () => /** @type {BrokerAdapter | null} */ (active),
  /** @param {string} id */
  setActive(id) { const a = adapterFor(id); if (a) { active = a; bus.emit('connections:changed'); } },

  // the adapter a pane should use: its own broker by id, else the active one
  // (legacy panes with no broker set). Returns null if nothing is connected.
  /** @param {string} [id] @returns {BrokerAdapter | null} */
  for(id) { return adapterFor(id) || /** @type {BrokerAdapter | null} */ (active); },
  /** @param {string} [id] */
  labelOf(id) { const a = adapterFor(id) || active; return (a && a.name) || ''; },

  // status of every account we've been asked to connect (for the Connection Manager
  // and the top-bar status chips). `name` is the account name used to connect.
  connections() {
    return [...conns.entries()].map(([id, account]) => {
      const a = adapterFor(id);
      return { id, name: (account && account.name) || (a && a.name) || id, label: (a && a.name) || id,
        accountType: (account && account.accountType) || 'netting',   // netting | hedging (gates features)
        startingBalance: (account && account.startingBalance),        // stats origin (per account)
        historyDays: (account && account.historyDays),               // seed pull depth (days) -- the trade feed reads this
        connected: !!(a && a.isConnected && a.isConnected()), active: !!(active && active.id === id) };
    });
  },

  // ---- data (normalized) — see the adapter contract in data/adapter-contract.js ----
  /** @param {...any} a */
  resolveSymbol(...a) { return active && active.resolveSymbol(...a); },
  /** @param {...any} a */
  subscribeBars(...a) { return active && active.subscribeBars(...a); },
  /** @param {...any} a */
  getBars(...a) { return active && active.getBars(...a); },
  /** @param {...any} a */
  drop(...a) { return active && active.drop(...a); },
  /** @param {...any} a */
  subscribeQuotes(...a) { return active && active.subscribeQuotes(...a); },
  /** @param {...any} a */
  unsubscribeQuotes(...a) { return active && active.unsubscribeQuotes(...a); },
  /** @param {...any} a */
  subscribeDepth(...a) { return active && active.subscribeDepth && active.subscribeDepth(...a); },
  /** @param {...any} a */
  unsubscribeDepth(...a) { return active && active.unsubscribeDepth && active.unsubscribeDepth(...a); },

  // ---- trading (optional per adapter) ----
  /** @param {...any} a */
  placeOrder(...a) { return active && active.placeOrder && active.placeOrder(...a); },
  /** @param {...any} a */
  cancelOrder(...a) { return active && active.cancelOrder && active.cancelOrder(...a); },
  /** @param {...any} a */
  modifyOrder(...a) { return active && active.modifyOrder && active.modifyOrder(...a); },
  /** @param {...any} a */
  closePosition(...a) { return active && active.closePosition && active.closePosition(...a); },
  /** @param {...any} a */
  getOrders(...a) { return active && active.getOrders && active.getOrders(...a); },
  /** @param {...any} a */
  getPositions(...a) { return active && active.getPositions && active.getPositions(...a); },
  /** @param {...any} a */
  getAccount(...a) { return active && active.getAccount && active.getAccount(...a); },
  /** @param {...any} a */
  getHistory(...a) { return active && active.getHistory && active.getHistory(...a); },
  /** @param {...any} a */
  subscribeTrade(...a) { return active && active.subscribeTrade && active.subscribeTrade(...a); },
  /** @param {...any} a */
  unsubscribeTrade(...a) { return active && active.unsubscribeTrade && active.unsubscribeTrade(...a); },
};

export { listBrokers };

// discover + register all adapters before any importer proceeds (top-level await gates the module graph)
await loadAdapters();
