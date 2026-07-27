// @ts-check
// Performance Monitor -- the app's internal resource manager, a diagnostic addon in the Data
// Interceptor mold. Keep it docked and watch the whole multi-window app live:
//
//   Windows      one row per window (chart / data-host / order-host / addon-host / order-ticket):
//                OS cpu + rss (joined by pid), JS heap, event-loop lag, long tasks, chart redraws/s
//   Processes    Electron processes with no window (main / gpu / network) + the app total
//   Buses        cross-window traffic rates: broker-bus in/out, quote ticks, order commands,
//                per-store sync messages, console messages
//   Latency      captured round-trips, measured PASSIVELY off the buses (no engine hooks):
//                rpc:<method>  proxy -> data-host -> broker reply (wire + broker latency)
//                cmd:<type>    surface -> order worker ack (execution command latency)
//   Captures     the last few order-related round-trips with their timings
//   Connections  per broker: connected, active, server-clock skew
//
// Three sources, none of which touch the engine:
//   - every window self-samples 1 Hz into the platform `perf` store (src/perf/sampler.js)
//   - ui() taps the BroadcastChannels read-only (counting + callId correlation)
//   - start() (Node, addon-host) samples /proc for per-process CPU/RSS and publishes `os:` rows
/** @typedef {{ n: number, last: number, avg: number, max: number }} LatStat */

// order-related methods whose round-trips land in the Captures list
const EXEC_METHODS = /** @type {Record<string, 1>} */ ({ placeOrder: 1, modifyOrder: 1, cancelOrder: 1, closePosition: 1, closeLot: 1, closeLotPartial: 1 });

module.exports = {
  name: 'Performance Monitor',
  description: 'Live resource monitor for the whole app — CPU, memory, buses, and latency per window.',
  icon: 'icon.png',

  // ---------------------------------------------------------------- Node side: OS process sampler
  // Runs in the addon-host (full Node). Walks the app's process tree via /proc (Linux), computes
  // per-process CPU%/RSS every 2s and publishes them into the perf store as `os:<pid>` rows.
  // NOTE: publishes over the store's documented BroadcastChannel wire (platform:store:perf,
  // StoreSync shape) instead of importing the platform module -- dynamic import() from a
  // Node-require'd module deadlocks the Electron renderer (Node ESM loader), proven live.
  /** @param {any} ctx */
  start(ctx) {
    const g = /** @type {any} */ (globalThis);
    const req = g.require;
    if (!req || !g.process || g.process.platform !== 'linux') { ctx.log('OS sampler off (needs Electron + Linux /proc)'); return; }
    const fs = req('fs');
    const myPid = g.process.pid;
    const perfCh = new BroadcastChannel('platform:store:perf');
    /** @param {string} key @param {any} value */
    const publish = (key, value) => { try { perfCh.postMessage({ set: { key, value } }); } catch (_) {} };
    /** @param {string} key */
    const unpublish = (key) => { try { perfCh.postMessage({ remove: { key } }); } catch (_) {} };

    /** @param {number} pid @returns {{ ppid: number, ticks: number } | null} */
    const readStat = (pid) => {
      try {
        const s = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
        const rp = s.lastIndexOf(')');                       // comm may contain spaces -- parse after it
        const f = s.slice(rp + 2).split(' ');                // f[0] = state, f[1] = ppid, f[11]/f[12] = utime/stime
        return { ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]) };
      } catch (_) { return null; }
    };
    /** @param {number} pid @returns {string} */
    const readCmd = (pid) => { try { return fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0').join(' '); } catch (_) { return ''; } };
    /** @param {number} pid @returns {number} */
    const readRssMb = (pid) => {
      try { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync('/proc/' + pid + '/status', 'utf8')); return m ? Math.round(Number(m[1]) / 1024) : 0; }
      catch (_) { return 0; }
    };
    // PSS (proportional set size): private pages + each process's SHARE of shared pages. Unlike RSS -- which
    // counts the whole ~120MB Electron framework in EVERY process -- PSS charges shared memory once across its
    // sharers, so summing PSS gives the app's true unique footprint (summing RSS triple-counts the framework).
    /** @param {number} pid @returns {number} */
    const readPssMb = (pid) => {
      try { const m = /Pss:\s+(\d+)/.exec(fs.readFileSync('/proc/' + pid + '/smaps_rollup', 'utf8')); return m ? Math.round(Number(m[1]) / 1024) : 0; }
      catch (_) { return 0; }
    };
    /** @param {number} pid @param {number} mainPid @returns {string} */
    const kindOf = (pid, mainPid) => {
      if (pid === mainPid) return 'main';
      const c = readCmd(pid);
      if (c.includes('--type=renderer')) return 'renderer';
      if (c.includes('--type=gpu')) return 'gpu';
      if (c.includes('network.mojom.NetworkService')) return 'network';
      if (c.includes('--type=utility')) return 'utility';
      if (c.includes('--type=zygote')) return 'zygote';
      if (c.includes('server.js')) return 'server';
      return 'other';
    };

    const me = readStat(myPid);
    const mainPid = me ? me.ppid : 0;                        // renderers are direct children of the Electron main
    /** @type {Map<number, number>} */
    let prevTicks = new Map();
    let prevT = Date.now();
    /** @type {Set<string>} */
    let prevKeys = new Set();

    const timer = setInterval(() => {
      if (!mainPid) return;
      const now = Date.now();
      const dtSec = (now - prevT) / 1000; prevT = now;
      // whole DESCENDANT tree of the Electron main, not just direct children -- the gpu process
      // hangs off a zygote helper and a one-level walk missed it (found live: no gpu row)
      /** @type {Map<number, number>} */
      const ppids = new Map();
      try { for (const d of fs.readdirSync('/proc')) { const p = Number(d); if (p > 0) { const st = readStat(p); if (st) ppids.set(p, st.ppid); } } } catch (_) {}
      /** @type {Set<number>} */
      const tree = new Set([mainPid]);
      let grew = true;
      while (grew) { grew = false; for (const [p, pp] of ppids) if (tree.has(pp) && !tree.has(p)) { tree.add(p); grew = true; } }
      const pids = [...tree].filter((p) => ppids.has(p));
      /** @type {Map<number, number>} */
      const ticksNow = new Map();
      /** @type {Set<string>} */
      const keys = new Set();
      for (const pid of pids) {
        const st = readStat(pid); if (!st) continue;
        ticksNow.set(pid, st.ticks);
        const prev = prevTicks.get(pid);
        const cpu = prev != null && dtSec > 0 ? Math.round(((st.ticks - prev) / 100) / dtSec * 100) : 0;   // USER_HZ = 100
        const key = 'os:' + pid;
        keys.add(key);
        publish(key, { os: true, pid, kind: kindOf(pid, mainPid), cpu, rssMb: readRssMb(pid), pssMb: readPssMb(pid), ts: now });
      }
      for (const k of prevKeys) if (!keys.has(k)) unpublish(k);   // process gone -> drop its row
      prevTicks = ticksNow; prevKeys = keys;
    }, 2000);
    /** @type {any} */ (this)._osTimer = timer;
    /** @type {any} */ (this)._osCh = perfCh;
    ctx.log('OS sampler up (main pid ' + mainPid + ')');
  },

  stop() {
    const t = /** @type {any} */ (this)._osTimer; if (t) clearInterval(t);
    const c = /** @type {any} */ (this)._osCh; if (c) { try { c.close(); } catch (_) {} }
  },

  // ---------------------------------------------------------------- UI: the live panel
  /** @param {HTMLElement} root @param {import('../../src/panels/addons.js').AddonApi} api */
  ui(root, api) {
    const t = api.t;   // vocabulary lookup — addons translate through the same runtime as the app
    /** @type {any} */
    let platform = null;
    import('/data_engine/index.js').then((m) => { platform = m.platform; });

    // ---- passive bus taps: counters + callId->latency correlation ----
    const counters = { bbOut: 0, bbIn: 0, quotes: 0, cmds: 0 };
    /** @type {Record<string, number>} */
    const storeMsgs = { orders: 0, fills: 0, positions: 0, positionLots: 0, accounts: 0, perf: 0, console: 0 };
    /** @type {Map<string, { t: number, key: string }>} */
    const pending = new Map();                                // rpc callId / cmd win:callId -> { t, latency key }
    /** @type {Map<string, LatStat>} */
    const lat = new Map();
    /** @type {{ t: number, key: string, ms: number }[]} */
    const captures = [];                                      // recent order-related round-trips
    /** @param {string} key @param {number} ms */
    const record = (key, ms) => {
      let s = lat.get(key);
      if (!s) { s = { n: 0, last: 0, avg: 0, max: 0 }; lat.set(key, s); }
      s.n++; s.last = ms; s.avg += (ms - s.avg) / s.n; if (ms > s.max) s.max = ms;
    };

    const bb = new BroadcastChannel('broker-bus');
    bb.onmessage = (e) => {
      const m = e.data; if (!m) return;
      if (m.dir === 'out') {
        counters.bbOut++;
        if (m.callId != null && m.method) pending.set('r' + m.callId, { t: performance.now(), key: 'rpc:' + m.method });
      } else if (m.dir === 'in') {
        counters.bbIn++;
        const p0 = m.payload && m.payload[0];
        if (p0 && (p0.bid != null || p0.ask != null)) counters.quotes++;
        if (m.callId != null) {
          const p = pending.get('r' + m.callId);
          if (p) {                                            // first reply only: getBars = first chunk, subs = ack
            pending.delete('r' + m.callId);
            const ms = performance.now() - p.t;
            record(p.key, ms);
            const method = p.key.slice(4);
            if (EXEC_METHODS[method]) { captures.unshift({ t: Date.now(), key: p.key, ms }); if (captures.length > 8) captures.pop(); }
          }
        }
      }
    };
    const ob = new BroadcastChannel('order-bus');
    ob.onmessage = (e) => {
      const m = e.data; if (!m) return;
      if (m.dir === 'cmd') { counters.cmds++; pending.set('c' + m.win + ':' + m.callId, { t: performance.now(), key: 'cmd:' + (m.cmd && m.cmd.type) }); }
      else if (m.dir === 'ack') {
        const p = pending.get('c' + m.to + ':' + m.callId);
        if (p) { pending.delete('c' + m.to + ':' + m.callId); const ms = performance.now() - p.t; record(p.key, ms); captures.unshift({ t: Date.now(), key: p.key, ms }); if (captures.length > 8) captures.pop(); }
      }
    };
    /** @type {BroadcastChannel[]} */
    const storeTaps = [];
    for (const nm of ['orders', 'fills', 'positions', 'positionLots', 'accounts', 'perf']) {
      const ch = new BroadcastChannel('platform:store:' + nm);
      ch.onmessage = () => { storeMsgs[nm]++; };
      storeTaps.push(ch);
    }
    const conCh = new BroadcastChannel('platform:ch:console');
    conCh.onmessage = () => { storeMsgs.console++; };

    // drop stale correlations so an unanswered call can't grow the map forever
    const gc = setInterval(() => { const cut = performance.now() - 60000; for (const [k, v] of pending) if (v.t < cut) pending.delete(k); }, 30000);

    // ---- UI ----
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;font:11px/1.5 ui-monospace,monospace;';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 0;';
    const status = document.createElement('span'); status.style.cssText = 'color:var(--tx-dim);margin-right:auto;';
    const reset = document.createElement('button'); reset.textContent = t('Reset stats');
    reset.style.cssText = 'background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit;';
    reset.onclick = () => { lat.clear(); captures.length = 0; };
    bar.append(status, reset);
    const body = document.createElement('div'); body.style.cssText = 'overflow:auto;flex:1;';
    root.append(bar, body);

    /** @param {any} s */
    const esc = (s) => String(s).replace(/[&<>]/g, (/** @type {string} */ c) => (/** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }))[c]);
    /** @param {string} txt */
    const head = (txt) => '<div style="padding:6px 2px 2px;color:#5aa9e6;font-weight:bold">' + txt + '</div>';
    /** @param {string[]} cells @param {string} cols @param {boolean} [dim] */
    const row = (cells, cols, dim) => '<div style="display:grid;grid-template-columns:' + cols + ';gap:4px;padding:1px 2px;' + (dim ? 'opacity:.45;' : '') + '">'
      + cells.map((c) => '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + c + '</span>').join('') + '</div>';
    /** @param {number} v @param {number} warn @param {number} bad */
    const grade = (v, warn, bad) => v >= bad ? '<span style="color:var(--neg,#e66)">' + v + '</span>' : v >= warn ? '<span style="color:#cc0">' + v + '</span>' : String(v);
    /** @param {number} ms */
    const fmtMs = (ms) => ms >= 100 ? String(Math.round(ms)) : (Math.round(ms * 10) / 10).toFixed(1);

    /** @type {Record<string, number>} */
    let prevCounts = {};
    let prevT = performance.now();
    /** @param {string} k @param {number} cur @param {number} dt */
    const rate = (k, cur, dt) => { const r = (cur - (prevCounts[k] || 0)) / dt; prevCounts[k] = cur; return r >= 10 ? String(Math.round(r)) : (Math.round(r * 10) / 10).toFixed(1); };

    function render() {
      const now = performance.now();
      const dt = Math.max(0.2, (now - prevT) / 1000); prevT = now;
      /** @type {any[]} */
      const all = (platform && platform.perf) ? platform.perf.all() : [];
      const wins = all.filter((r) => r && !r.os).sort((/** @type {any} */ a, /** @type {any} */ b) => String(a.page).localeCompare(String(b.page)) || String(a.win).localeCompare(String(b.win)));
      const procs = all.filter((r) => r && r.os);
      /** @type {Map<number, any>} */
      const osByPid = new Map(procs.map((/** @type {any} */ r) => [r.pid, r]));
      const winPids = new Set(wins.map((/** @type {any} */ r) => r.pid));
      const stale = (/** @type {any} */ r) => Date.now() - r.ts > 3500;

      let html = '';

      // Windows
      html += head(t('Windows'));
      const wcols = '86px 34px 34px 40px 36px 34px 40px';
      html += row([t('window'), t('cpu%'), t('pss'), t('heap'), t('lag'), t('task'), t('draw/s')].map((h) => '<span style="color:var(--tx-dim)">' + h + '</span>'), wcols);
      for (const r of wins) {
        const os = osByPid.get(r.pid);
        html += row([
          esc(r.page === 'chart' ? 'chart ' + r.win : r.page),
          os ? grade(os.cpu, 25, 60) : '',
          os ? (os.pssMb != null ? os.pssMb : os.rssMb) + 'M' : '',
          r.heapMb != null ? r.heapMb + 'M' : '',
          grade(r.loopLagMs, 50, 200),
          r.longTasks ? grade(r.longTasks, 1, 5) : '0',
          String(r.paints),
        ], wcols, stale(r));
      }

      // Processes without a window + the app total
      const rest = procs.filter((/** @type {any} */ r) => !winPids.has(r.pid));
      if (procs.length) {
        html += head(t('Processes'));
        const pcols = '86px 34px 34px 1fr';
        for (const r of rest.sort((/** @type {any} */ a, /** @type {any} */ b) => b.cpu - a.cpu)) html += row([esc(r.kind), grade(r.cpu, 25, 60), (r.pssMb != null ? r.pssMb : r.rssMb) + 'M', String(r.pid)], pcols);
        const tCpu = procs.reduce((/** @type {number} */ s, /** @type {any} */ r) => s + r.cpu, 0);
        // Every memory figure here is PSS (proportional set size), not RSS: RSS counts the shared ~120MB Electron
        // framework in EVERY process, so per-process rows overstate and their sum triple-counts it. PSS charges
        // shared pages proportionally, so each row is the window's true cost and the rows sum to the real total.
        const tPss = procs.reduce((/** @type {number} */ s, /** @type {any} */ r) => s + (r.pssMb != null ? r.pssMb : r.rssMb), 0);
        html += row(['<b>' + t('app total') + '</b>', '<b>' + tCpu + '</b>', '<b>' + tPss + 'M</b>', ''], pcols);
      }

      // Buses
      html += head(t('Buses (msgs/s)'));
      const bcols = '110px 56px 110px 56px';
      html += row([t('broker-bus out'), rate('bbOut', counters.bbOut, dt), t('broker-bus in'), rate('bbIn', counters.bbIn, dt)], bcols);
      html += row([t('quote ticks'), rate('quotes', counters.quotes, dt), t('order cmds'), rate('cmds', counters.cmds, dt)], bcols);
      html += row([t('sync orders'), rate('s.o', storeMsgs.orders, dt), t('sync fills'), rate('s.f', storeMsgs.fills, dt)], bcols);
      html += row([t('sync positions'), rate('s.p', storeMsgs.positions + storeMsgs.positionLots, dt), t('console'), rate('s.c', storeMsgs.console, dt)], bcols);

      // Latency
      const keys = [...lat.keys()].sort();
      html += head(t('Latency (ms)'));
      if (keys.length) {
        const lcols = '1fr 34px 44px 44px 44px';
        html += row([t('round-trip'), t('n'), t('last'), t('avg'), t('max')].map((h) => '<span style="color:var(--tx-dim)">' + h + '</span>'), lcols);
        for (const k of keys) {
          const s = /** @type {LatStat} */ (lat.get(k));
          html += row([esc(k), String(s.n), fmtMs(s.last), fmtMs(s.avg), fmtMs(s.max)], lcols);
        }
      } else {
        html += '<div style="color:var(--tx-dim);padding:1px 2px">' + t('waiting for activity (RPCs / order commands are captured as they happen)') + '</div>';
      }

      // Captures (recent order round-trips)
      if (captures.length) {
        html += head(t('Captures'));
        const ccols = '54px 1fr 52px';
        for (const c of captures) html += row([new Date(c.t).toTimeString().slice(0, 8), esc(c.key), fmtMs(c.ms) + 'ms'], ccols);
      }

      // Connections
      const conns = /** @type {any[]} */ (api.data.connections() || []);
      if (conns.length) {
        html += head(t('Connections'));
        const ncols = '12px 1fr 60px 56px';
        for (const c of conns) {
          const a = /** @type {any} */ (api.data.for(c.id));
          const sn = a && a.serverNow ? a.serverNow() : null;
          const skew = sn != null ? t('skew') + ' ' + Math.round(sn - Date.now()) + 'ms' : '';   // hidden when the broker has no server clock
          html += row(['<span style="color:' + (c.connected ? 'var(--pos,#6c6)' : 'var(--tx-dim)') + '">●</span>', esc(c.name || c.label || c.id), c.active ? t('active') : '', skew], ncols);
        }
      }

      body.innerHTML = html;
      status.textContent = wins.length + ' ' + t('windows') + ' · ' + procs.length + ' ' + t('processes');
    }

    const timer = setInterval(render, 1000);
    render();
    api.onClose(() => {
      clearInterval(timer); clearInterval(gc);
      bb.close(); ob.close(); conCh.close(); storeTaps.forEach((c) => c.close());
    });
  },
};
