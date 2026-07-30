// @ts-check
// order-ticket KERNEL -- the shared context object (`ot`) that every module of the addon reads from. It holds the
// stateless DOM/format helpers, the api/cfg-bound helpers, the single-popup infrastructure, a tiny event emitter,
// a dialog registry, and a shared mutable state bag. This is step 1 of the addon refactor: behaviour is identical,
// the pieces are just relocated here so the split can proceed module by module.
//
// Loaded via dynamic import() from index.js because the addon is eval'd with require() shimmed to a no-op (see
// src/panels/addons.js) -- a CommonJS sibling require would not resolve, but an ESM import of the HTTP-served file does.

/** @typedef {import('../../src/panels/addons.js').AddonApi} AddonApi */

/**
 * Build the shared kernel context for one order-ticket panel instance.
 * @param {HTMLElement} root
 * @param {AddonApi} api
 * @param {any} cfg   the panel's persisted config (already defaulted by index.js)
 */
export function createKernel(root, api, cfg) {
  // ---- stateless DOM / format helpers ----
  /** @param {*} v @returns {string} */
  const fmt = (v) =>
    v == null || v === ''
      ? '–'
      : typeof v === 'number'
        ? Number(v.toFixed(Math.abs(v) >= 100 ? 2 : 5)).toLocaleString('en-US')
        : String(v);
  /** @param {string} tag @param {string} [css] @param {string} [txt] @returns {HTMLElement} */
  const el = (tag, css, txt) => {
    const d = document.createElement(tag);
    if (css) d.style.cssText = css;
    if (txt != null) d.textContent = txt;
    return d;
  };
  // shared button/input styles used across the whole panel
  /** @param {string} bg */
  const BTN = (bg) =>
    'flex:1;padding:9px;border:none;border-radius:6px;color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;background:' +
    bg +
    ';';
  const INP = 'padding:5px 7px;background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:5px;';
  // user-configurable BUTTON colors (Buy / Sell / auto-exec) -- persisted in cfg.colors via the gear dialog; falls back
  // to the defaults. colors() is the single reader every button + the recolor listeners use.
  const COLOR_DEFAULTS = { buy: '#26a69a', sell: '#ef5350', auto: '#2962ff' };
  /** @returns {{ buy: string, sell: string, auto: string }} */
  const colors = () => ({ ...COLOR_DEFAULTS, .../** @type {any} */ (cfg.colors || {}) });

  // ---- api / cfg bound helpers ----
  // route messages to the app-wide Console (Experts). clog(msg, isError).
  /** @param {string} m @param {boolean} [err] */
  const clog = (m, err) => {
    try {
      if (api.console) (err ? api.console.error : api.console.info)(m);
    } catch (_) {}
  };
  // the active broker's adapter facade (proxy|core); follows cfg.broker, which the chart-sync updates in place.
  const ad = () => api.data.for(cfg.broker);
  // EXECUTION SEAM -- the SINGLE funnel for every order this addon triggers. WIRED to the app's order WORKER via
  // api.trade.command: the addon never touches a broker; it sends a semantic command and the worker (single owner)
  // executes + journals it. Always resolves { ok, error? } (a transport failure is caught to the same shape) so every
  // call site can `.then` uniformly. cmd = { type, ... } (place/setStop/setTarget/modifyOrder/cancel/closeLot/
  // closePosition/script).
  /** @param {{ type: string, [k: string]: any }} cmd @returns {Promise<{ ok: boolean, error?: string, [k: string]: any }>} */
  const exec = (cmd) =>
    api.trade.command(cmd).catch((/** @type {any} */ e) => ({ ok: false, error: (e && e.message) || String(e) }));
  const save = () => api.save(cfg); // autosave -- every cfg mutation persists immediately (no Save button)
  // bars -> seconds via the chart timeframe (used by the on-chart string placement)
  const tfSeconds = () => {
    const id = String((api.chart.timeframe && api.chart.timeframe()) || '5m');
    const m = id.match(/(\d+)\s*([smhdw])/i);
    const n = m ? Number(m[1]) || 1 : 1;
    const u = m ? m[2].toLowerCase() : 'm';
    return n * (u === 's' ? 1 : u === 'm' ? 60 : u === 'h' ? 3600 : u === 'd' ? 86400 : u === 'w' ? 604800 : 60);
  };

  // ---- shared mutable state bag: fields migrate here as each subsystem is extracted, so sibling modules and
  // index.js see the same values. Instrument/quote state is owned by market-data. Position/order STATE is NOT here:
  // the platform book (api.trade.book) is the single source -- the addon holds no copy of it. ----
  const state = {
    /** @type {number|null} */ lastPx: null, // latest mid (or last-trade fallback) -- feeds pricing + the watcher
    /** @type {number|null} */ domTick: null, // resolved instrument tick size
    /** @type {number|null} */ domDecimals: null, // resolved instrument price decimals
  };

  // ---- price helpers (depend only on the resolved instrument tick/decimals in state + cfg.offset) ----
  /** snap a price to the instrument's tick, as a fixed string @param {number} px @returns {string} */
  const roundTick = (px) => {
    const tk = /** @type {number} */ (state.domTick) > 0 ? /** @type {number} */ (state.domTick) : 0.25,
      dc = state.domDecimals != null ? state.domDecimals : 2;
    return (Math.round(px / tk) * tk).toFixed(dc);
  };
  /** snap a price to the instrument's tick, numeric (null passes through) @param {number|null} px @returns {number|null} */
  const qtick = (px) => {
    if (px == null || !isFinite(px)) return px;
    const tk = /** @type {number} */ (state.domTick) > 0 ? /** @type {number} */ (state.domTick) : 0.25,
      dc = state.domDecimals != null ? state.domDecimals : 2;
    return Number((Math.round(px / tk) * tk).toFixed(dc));
  };
  // UNIVERSAL offset -> a PRICE distance, honoring the unit dropdown. ticks -> x tickSize; points -> x 1. Falls back to 10.
  /** @returns {number} */
  const offsetPrice = () => {
    const n = Math.abs(Number(cfg.offset));
    const off = isFinite(n) && n > 0 ? n : 10;
    const tk = /** @type {number} */ (state.domTick) > 0 ? /** @type {number} */ (state.domTick) : 0.25;
    return cfg.offsetUnit === 'points' ? off : off * tk;
  };

  // (the bead-anchored popup infrastructure + the ot.dialogs registry died with position-exits.js -- the app's own
  //  windows/dialogs are the control surfaces now)

  // ---- tiny event emitter: the seam later modules use to decouple ('position' | 'order' | 'fill' | 'quote' | ...) ----
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  /** @param {string} evt @param {Function} fn @returns {() => void} unsubscribe */
  const on = (evt, fn) => {
    let s = listeners.get(evt);
    if (!s) {
      s = new Set();
      listeners.set(evt, s);
    }
    s.add(fn);
    return () => {
      const set = listeners.get(evt);
      if (set) set.delete(fn);
    };
  };
  /** @param {string} evt @param {...any} args */
  const emit = (evt, ...args) => {
    const s = listeners.get(evt);
    if (!s) return;
    for (const fn of [...s]) {
      try {
        fn(...args);
      } catch (e) {
        clog('handler error (' + evt + '): ' + ((e && /** @type {any} */ (e).message) || e), true);
      }
    }
  };

  return {
    root,
    api,
    cfg,
    state,
    save,
    fmt,
    el,
    BTN,
    INP,
    colors,
    clog,
    ad,
    exec,
    tfSeconds,
    roundTick,
    qtick,
    offsetPrice,
    on,
    emit,
    t: api.t, // vocabulary lookup shared with every module -- the addon ships its OWN locales/ folder
  };
}
