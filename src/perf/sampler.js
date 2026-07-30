// @ts-check
// Per-window PERFORMANCE SAMPLER -- every window samples ITSELF once a second and publishes the
// sample into the platform `perf` store (keyed by window id), where the Performance Monitor addon
// (or anything else) reads the live picture of the whole multi-window app. Imported for its side
// effect by every window entry (main.js, data-host.html, order-host.html, addon-host.html, the
// order-ticket window). Deliberately feather-weight: counting hooks + one tiny store write per
// second -- the monitor must never become the load it measures.
//
// What a sample carries:
//   win/page/pid    identity (pid present under Electron nodeIntegration; null in a plain browser)
//   heapMb          this window's JS heap (performance.memory)
//   loopLagMs       worst event-loop lag seen this second (timer drift -> main-thread stalls)
//   longTasks/longMaxMs   main-thread tasks >50ms this second (PerformanceObserver 'longtask')
//   paints/clears   chart paint PASSES this second (same units as the Paint-rate knob) and raw
//                   layer clears (0 in DOM-only windows)
//   domNodes        document element count
//   book            platform store sizes (orders/fills/positions/lots/accounts) -- same replica
//                   everywhere; the monitor reads the data-host row as the authoritative one
import { platform } from '../../data_engine/index.js';

const Q = new URLSearchParams(location.search);
const WIN = Q.get('win') || 'solo';
// page label from the entry file: index.html (charts) is '/', the hosts carry their own names
const PAGE = (location.pathname.split('/').pop() || 'index.html').replace('.html', '').replace('index', 'chart');
const PROC = /** @type {any} */ (globalThis).process;
const PID = PROC && typeof PROC.pid === 'number' ? PROC.pid : null;

// ---- paint counter: PASSES, not layer clears. One redraw clears several layer canvases in the same
// synchronous batch; a microtask boundary groups them so the metric speaks the same units as the
// Optimization "Paint rate" knob (paints per second). Raw clears ride along for layer-cost analysis.
let paints = 0,
  clears = 0,
  inPass = false;
try {
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.clearRect;
  proto.clearRect = function (
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {number} */ w,
    /** @type {number} */ h,
  ) {
    clears++;
    if (!inPass) {
      paints++;
      inPass = true;
      queueMicrotask(() => {
        inPass = false;
      });
    }
    return orig.call(this, x, y, w, h);
  };
} catch (_) {
  /* no canvas in this context */
}

// ---- event-loop lag: a 100ms heartbeat; any drift beyond the interval is main-thread stall ----
let loopLagMs = 0;
let lastBeat = performance.now();
setInterval(() => {
  const now = performance.now();
  const lag = now - lastBeat - 100;
  if (lag > loopLagMs) loopLagMs = lag;
  lastBeat = now;
}, 100);

// ---- long tasks (main-thread blocks >50ms) ----
let longTasks = 0,
  longMaxMs = 0;
try {
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      longTasks++;
      if (e.duration > longMaxMs) longMaxMs = e.duration;
    }
  });
  po.observe({ entryTypes: ['longtask'] });
} catch (_) {
  /* longtask not supported */
}

// ---- publish 1 Hz ----
const t0 = Date.now();
function publish() {
  /** @type {any} */
  const mem = /** @type {any} */ (performance).memory;
  const sample = {
    win: WIN,
    page: PAGE,
    pid: PID,
    heapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    loopLagMs: Math.round(loopLagMs),
    longTasks,
    longMaxMs: Math.round(longMaxMs),
    paints,
    clears,
    domNodes: document.querySelectorAll('*').length,
    book: {
      orders: platform.orders.size(),
      fills: platform.fills.size(),
      positions: platform.positions.size(),
      lots: platform.positionLots.size(),
      accounts: platform.accounts.size(),
    },
    upSec: Math.round((Date.now() - t0) / 1000),
    ts: Date.now(),
  };
  paints = 0;
  clears = 0;
  loopLagMs = 0;
  longTasks = 0;
  longMaxMs = 0; // window resets each second
  platform.perf.set(WIN, sample);
}
setInterval(publish, 1000);
publish();
