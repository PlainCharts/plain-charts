// @ts-check
// Data Interceptor — a diagnostic addon (see .temp/DATA.md). A detector + streamer for the RAW
// broker feed: it DISCOVERS each broker's field schema from the live stream (registers the SET of
// field paths a broker sends -- the constants) and shows each path's latest value flowing (the
// data). No precoded field lists -- it learns them. Download the discovered schema as JSON.
//
// Browser-only addon: ui() subscribes to api.onRaw (the broker feed tap wired in the adapters).
// No Node side. Register the schema, not the data.
module.exports = {
  /** @param {HTMLElement} root @param {import('../../src/panels/addons.js').AddonApi} api */
  ui(root, api) {
    const t = api.t;   // vocabulary lookup — addons translate through the same runtime as the app
    if (typeof api.onRaw !== 'function') {
      root.textContent = t('Data Interceptor needs api.onRaw (the raw feed tap). Update the app.');
      return;
    }

    // registry: "broker/channel" -> Map<path, { type, value, count }>. Paths are the schema
    // (constants); value is the latest sample; count is how many values that path has carried.
    /** @typedef {{ type: string, value: any, count: number }} FieldInfo */
    /** @type {Map<string, Map<string, FieldInfo>>} */
    const reg = new Map();
    const ARR_CAP = 300;   // cap array walking so a huge bar batch can't stall the walk
    let dirty = false;

    // flatten any message into (path, value) leaves; union across array elements so fields that
    // appear on only some elements (e.g. open_interest on daily bars) are still discovered.
    /** @param {any} obj @param {string} prefix @param {(path: string, value: any) => void} emit */
    function walk(obj, prefix, emit) {
      if (obj === null || typeof obj !== 'object') { emit(prefix, obj); return; }
      if (Array.isArray(obj)) {
        if (!obj.length) { emit(prefix + '[]', '(empty)'); return; }
        const n = Math.min(obj.length, ARR_CAP);
        for (let i = 0; i < n; i++) walk(obj[i], prefix + '[]', emit);
        return;
      }
      const keys = Object.keys(obj);
      if (!keys.length) { emit(prefix, '{}'); return; }
      for (const k of keys) walk(obj[k], prefix ? prefix + '.' + k : k, emit);
    }

    /** @param {string} broker @param {string} channel @param {any} msg */
    function ingest(broker, channel, msg) {
      const key = broker + '/' + channel;
      let m = reg.get(key); if (!m) { m = new Map(); reg.set(key, m); }
      walk(msg, '', (path, value) => {
        if (!path) return;
        const prev = m.get(path);
        m.set(path, { type: value === null ? 'null' : typeof value, value, count: (prev ? prev.count : 0) + 1 });
      });
      dirty = true;
    }

    /** @param {any} v */
    const fmt = (v) => v === undefined ? '' : typeof v === 'string' ? (v.length > 30 ? v.slice(0, 30) + '…' : v)
      : typeof v === 'object' ? (Array.isArray(v) ? '[…]' : '{…}') : String(v);
    /** @param {any} s */
    const esc = (s) => String(s).replace(/[&<>]/g, (/** @type {string} */ c) => (/** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }))[c]);

    // ---- UI (built into the addon's docked panel root) ----
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;font:11px/1.5 ui-monospace,monospace;';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 0;';
    const count = document.createElement('span'); count.style.cssText = 'color:var(--tx-dim);margin-right:auto;';
    const dl = document.createElement('button'); dl.textContent = t('Download JSON');
    const clr = document.createElement('button'); clr.textContent = t('Clear');
    [dl, clr].forEach((b) => { b.style.cssText = 'background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit;'; });
    bar.append(count, dl, clr);
    const body = document.createElement('div'); body.style.cssText = 'overflow:auto;flex:1;';
    root.append(bar, body);

    function render() {
      const keys = [...reg.keys()].sort();
      let html = '', total = 0;
      for (const key of keys) {
        const m = /** @type {Map<string, FieldInfo>} */ (reg.get(key)); total += m.size;
        html += '<div style="padding:5px 2px 2px;color:#5aa9e6;font-weight:bold">' + esc(key)
          + ' <span style="color:var(--tx-dim);font-weight:normal">(' + m.size + ')</span></div>';
        for (const path of [...m.keys()].sort()) {
          const info = /** @type {FieldInfo} */ (m.get(path));
          html += '<div style="display:grid;grid-template-columns:1fr 44px 88px 38px;gap:4px;padding:1px 2px">'
            + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(path) + '">' + esc(path) + '</span>'
            + '<span style="color:var(--tx-dim)">' + info.type + '</span>'
            + '<span style="color:#26a69a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(fmt(info.value)) + '">' + esc(fmt(info.value)) + '</span>'
            + '<span style="color:var(--tx-dim);text-align:right">' + info.count + '</span></div>';
        }
      }
      body.innerHTML = html || '<div style="color:var(--tx-dim);padding:8px">' + t('Waiting for feed… load a symbol / go live.') + '</div>';
      count.textContent = total + ' ' + t('fields') + ' · ' + keys.length + ' ' + t('channels');
    }

    clr.onclick = () => { reg.clear(); render(); };
    dl.onclick = () => {
      /** @type {Record<string, Record<string, string>>} */
      const out = {};
      for (const [key, m] of reg) { out[key] = {}; for (const [path, info] of m) out[key][path] = info.type; }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'broker-schema.json'; a.click();
      URL.revokeObjectURL(a.href);
    };

    const offRaw = api.onRaw(ingest);
    const timer = setInterval(() => { if (dirty) { dirty = false; render(); } }, 250);
    api.onClose(() => { if (offRaw) offRaw(); clearInterval(timer); });
    render();
  },
};
