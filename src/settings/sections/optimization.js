// @ts-check
// Settings -> App -> Optimization: GLOBAL performance knobs -- one setting for the whole app, never per chart.
//   Study recompute  how often live-bar study math re-runs (trailing-edge throttle; the newest bars always
//                    compute at the window's end, so studies trail the tape by at most the interval).
//   Paint rate       minimum ms between chart canvas repaints (the engine's conflate option) -- ticks that
//                    land inside the window batch into one paint. Same pixels, fewer paint passes.
// Stored in the global settings store; applied LIVE to every pane in EVERY window on change: the dialog's
// window applies directly, then broadcasts on the ui-bus; every other chart window (initOptimizationSync,
// wired in main.js) re-reads settings from the server and applies. Found live: without the broadcast the
// knobs only ever throttled the dialog's own window -- a busy chart in another window kept painting
// every tick and the "optimization" did nothing there.
import { getSetting, setSetting, loadSettings } from '../settings.js';
import { getAllPanes } from '../../chart/layout.js';
import { IPC } from '../../ipc-contract.js';
import { t } from '../../i18n/i18n.js';   // vocabulary lookup

/** the global study recompute throttle in ms (0 = every tick). @returns {number} */
export function studyRecomputeMs() { const v = Number(getSetting('optStudyRecomputeMs')); return Number.isFinite(v) && v > 0 ? v : 0; }
/** the global paint conflation in ms (0 = paint every data change). @returns {number} */
export function paintConflateMs() { const v = Number(getSetting('optPaintConflateMs')); return Number.isFinite(v) && v > 0 ? v : 0; }

/** push the current global values onto every live pane in this window */
export function applyOptimization() {
  for (const p of /** @type {any[]} */ (getAllPanes())) {
    if (!p || p.destroyed) continue;
    try { if (p.studies && p.studies.setThrottle) p.studies.setThrottle(studyRecomputeMs()); } catch (_) {}
    try { if (p.chart && p.chart.configure) p.chart.configure({ conflate: paintConflateMs() }); } catch (_) {}
  }
}

/** @type {BroadcastChannel | null} */
let uiBus = null;
const bus = () => { if (!uiBus) uiBus = new BroadcastChannel(IPC.UI_BUS); return uiBus; };

/** tell every other window the knobs changed (they re-read settings and apply) */
function broadcastOptimization() { try { bus().postMessage({ type: 'optimization' }); } catch (_) {} }

/** Cross-window live apply: on an 'optimization' broadcast, re-read the settings store from the server
 * (this window's copy is stale -- settings don't sync) and push the fresh values onto this window's
 * panes. Called once per chart window at boot (main.js). */
export function initOptimizationSync() {
  bus().addEventListener('message', (/** @type {MessageEvent} */ e) => {
    const m = e.data;
    if (m && m.type === 'optimization') loadSettings().then(applyOptimization);
  });
}

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section } = ctx;
  /** @param {string} label @param {string} key @param {[number, string][]} options @param {string} [hint] */
  const selRow = (label, key, options, hint) => {
    const r = document.createElement('div'); r.className = 'sd-row';
    const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(label);
    const sel = document.createElement('select');
    options.forEach(([v, lbl]) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t(lbl); sel.appendChild(o); });
    const cur = Number(getSetting(key)); sel.value = String(Number.isFinite(cur) && cur > 0 ? cur : 0);
    sel.onchange = () => { setSetting(key, Number(sel.value)); applyOptimization(); broadcastOptimization(); };
    if (hint) sel.title = t(hint);
    r.append(l, sel);
    content.appendChild(r);
  };
  section('OPTIMIZATION');
  selRow('Studies recompute', 'optStudyRecomputeMs',
    [[0, 'Every tick'], [100, '100 ms'], [250, '250 ms'], [500, '500 ms'], [1000, '1 s'], [2000, '2 s']],
    'How often live-bar study math re-runs. Trailing-edge: the last tick always computes.');
  selRow('Paint rate', 'optPaintConflateMs',
    [[0, 'Every tick'], [50, '20 per second'], [100, '10 per second'], [250, '4 per second']],
    'Minimum time between canvas repaints. Ticks inside the window batch into one paint.');
}
