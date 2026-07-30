// @ts-check
// Study compute worker -- a GENERIC engine runtime that runs a study's pure calc() off the render thread and
// posts the pure result back. It hardcodes NO study. Like the main thread, whoever drives it supplies the
// study CODE: the host sends each study's URL, and the worker dynamic-imports it -- the study self-registers
// via Studies.register(), exactly as on the main thread -- then runs its calc. A study never touches the
// canvas (it returns render channels as DATA), which is what makes it safe here.
//
// This is the SAME registry + Studies surface the main thread uses (the app re-exports kapelka's), so a study
// registered here is byte-identical to the one on the main thread. The worker is just another importer of the
// engine, in its own realm -- like example.html or the app, it imports the engine plus whatever studies it's
// pointed at.
import { getStudy, Studies } from './registry.js';
import { createResident, applyResident } from './resident.js';
import { sharedFromBars } from './step-engine.js';
import { createStepSession, stepFull, stepForming, stepAppend } from './incremental.js';
import { bucketIntrabar } from './channels.js';

const scope = /** @type {any} */ (self);   // DedicatedWorkerGlobalScope (typed as Window under the DOM lib)
scope.Studies = Studies;   // the authoring-surface global study files call as a bare `Studies.register/priceOf`

/** @type {Set<string>} study URLs already imported into this realm (import() is cached; this skips the await) */
const loaded = new Set();

// The data this worker OWNS: bars + intrabar sub-bars, kept current by the host's mutation messages. An exec
// computes against THIS, so no bars/sub-bars ride on the per-study message -- the whole point of the redesign.
const resident = createResident();

// The ONE shared read window (column arrays) -- built once per data change and reused by every step study that
// execs this tick. `dataVersion` bumps on each mutation; the window rebuilds lazily on the next read.
let dataVersion = 0;
/** @type {import('./step-engine.js').Shared | null} */
let cachedShared = null;
let cachedVersion = -1;
function sharedWindow() {
  if (cachedVersion !== dataVersion) { cachedShared = sharedFromBars(resident.bars); cachedVersion = dataVersion; }
  return /** @type {import('./step-engine.js').Shared} */ (cachedShared);
}

// Per-study-instance streaming sessions, keyed by the host's stable `sid`. Each holds a step study's resident
// state + the checkpoint before the forming bar, so a live tick advances one bar instead of re-traversing.
/** @type {Map<any, import('./incremental.js').StepSession & { paramsKey?: string }>} */
const sessions = new Map();

scope.onmessage = async (/** @type {MessageEvent} */ e) => {
  const msg = e.data || {};

  // Data mutations (fire-and-forget, no reply). One small sync per data-change: full set-bars, a single forming
  // candle, an appended bar, or an intrabar delta. `reset` (symbol/timeframe change) also drops all sessions.
  if (msg.type === 'set-bars' || msg.type === 'update-forming-bar' || msg.type === 'append-bar' || msg.type === 'append-intrabar' || msg.type === 'reset') {
    try { applyResident(resident, msg); dataVersion++; if (msg.type === 'reset') sessions.clear(); }
    catch (err) { try { console.error('[study-worker]', (err && /** @type {any} */ (err).message) || err); } catch (_) {} }
    return;
  }

  if (msg.type !== 'exec-batch') { scope.postMessage({ id: msg.id, error: 'study worker: unknown message ' + msg.type }); return; }

  // ONE exec-batch per host recompute. The shared window builds once; each intrabar timeframe buckets once and
  // is shared. A step study on a data tick (mode forming/append) advances from its checkpoint and returns just
  // the changed tail -- including the tail points of any `fills` plots, which the host re-pairs into the band;
  // on a full run (first exec, symbol change, settings) it traverses and returns full plots. calc studies (the
  // whole-array geometry form) always run full over the resident bars.
  const { id, entries } = msg;
  const baseSh = sharedWindow();
  /** @type {any[]} */
  const results = [];
  /** @type {Record<string, any>} */
  const subShCache = {};
  const subShFor = (/** @type {string} */ tf, /** @type {number} */ chartSec) => {
    if (!subShCache[tf]) subShCache[tf] = Object.assign({}, baseSh, { sub: bucketIntrabar(resident.bars, resident.sub[tf] || [], chartSec) });
    return subShCache[tf];
  };
  for (const en of entries || []) {
    try {
      if (en.studyUrl && !loaded.has(en.studyUrl)) { await import(/* @vite-ignore */ en.studyUrl); loaded.add(en.studyUrl); }
      const study = getStudy(en.studyId);
      if (!study) throw new Error('no worker study: ' + en.studyId);
      const ctx = buildCtx(en.params, en.meta);
      const intra = en.meta.lowerTimeframe !== undefined;
      if (typeof study.step !== 'function') {
        // calc (whole-array) studies bucket their own ctx.intrabar and always recompute fully.
        if (typeof study.calc !== 'function') throw new Error('no worker study: ' + en.studyId);
        if (intra) ctx.intrabar = bucketIntrabar(resident.bars, resident.sub[en.meta.lowerTimeframe] || [], en.meta.chartSec);
        results.push({ eid: en.eid, out: await study.calc(/** @type {any} */ (resident.bars), en.params, ctx) });
        continue;
      }
      // step study: run against its resident session + checkpoint
      const sh = intra ? subShFor(en.meta.lowerTimeframe, en.meta.chartSec) : baseSh;
      const paramsKey = JSON.stringify(en.params);
      let sess = sessions.get(en.sid);
      if (!sess || sess.paramsKey !== paramsKey) { sess = createStepSession(study, en.params, ctx); sess.paramsKey = paramsKey; sessions.set(en.sid, sess); }
      else { sess.ctx = ctx; sess.study = study; }   // refresh ctx (decimals/candle) + study ref (a relink swaps it)
      const mode = en.mode || 'full';
      const canForming = mode === 'forming' && sess.metas.length > 0 && sess.n === sh.n && sh.n >= 1;
      const canAppend = mode === 'append' && sess.metas.length > 0 && sess.n === sh.n - 1 && sh.n >= 2;
      if (canForming) results.push({ eid: en.eid, tail: stepForming(sess, sh).tail });
      else if (canAppend) results.push({ eid: en.eid, tail: stepAppend(sess, sh).tail });
      else results.push({ eid: en.eid, out: stepFull(sess, sh) });
    } catch (err) { results.push({ eid: en.eid, error: (err && /** @type {any} */ (err).message) || String(err) }); }
  }
  scope.postMessage({ id, results });
};

// The ctx subset the host used to send, rebuilt worker-side (plus a worker-local fetch). The bucketed intrabar
// is NOT set here -- calc (shim) studies bucket their own; step studies read the shared window's `sub`.
/** @param {any} params @param {any} meta @returns {Record<string, any>} */
function buildCtx(params, meta) {
  /** @type {Record<string, any>} */
  const ctx = {
    params, decimals: meta.decimals, tickSize: meta.tickSize, candle: meta.candle,
    visibleRange: meta.visibleRange,
    fetch: (/** @type {any} */ url) => fetch(url).then((r) => r.json()),
  };
  if (meta.lowerTimeframe !== undefined) { ctx.lowerTimeframe = meta.lowerTimeframe; ctx.intrabarLoading = !!meta.intrabarLoading; }
  return ctx;
}
