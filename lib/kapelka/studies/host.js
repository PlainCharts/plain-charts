// @ts-check
// StudyHost — drives a set of studies on one chart: feeds them bars, runs calc(), and turns the
// returned channels (plots / fills / shapes / markers / segments / scale / stack) into engine
// series + primitives. Framework-free and DOM-free: it owns the SERIES lifecycle, not any UI.
//
//   import { mountChart, Candles } from 'kapelka';
//   import { StudyHost, Studies } from 'kapelka/studies';
//   const host = new StudyHost(chart, { getBars: () => bars });
//   host.add('rsi');                 // registered study id
//   host.setData(newBars);           // recomputes everything
//
// opts (all optional except getBars):
//   getBars()        -> the current bar array [{time,open,high,low,close,volume}, ...]   (required)
//   priceDecimals    -> number passed to calc() as ctx.decimals
//   mainSeries()     -> the price pane's series (overlay shapes/fills anchor; else the 1st plot)
//   barTimes()       -> bar times for the primitives' time->x (else derived from getBars)
//   isHidden()       -> a global "indicators hidden" flag
//   persist(list)    -> called with serialize() after mutations
//   intrabar(tf, fromMs, toMs) -> Promise<subBars[]>  data provider for intrabar studies
//   resolveLowerTf(study)      -> a timeframe id string for that study's sub-bars
//
// Subclass it to add a skin (legend, controls, persistence): override the hooks
//   _onAdded(a) / _onComputed(a) / _onRemoved(a).
import { getStudy } from './registry.js';
import { StudyWorker } from './study-worker.js';
import { defaultsFor, effectiveStyle, styleToOptions, bucketIntrabar } from './channels.js';
import { paneIndexOf, applyPaneMode, applyPreserve, reindexPanes } from './pane-layout.js';
import { IntrabarFeed } from './intrabar-feed.js';
import { applyResult, applyIncremental, detachStudy } from './apply-result.js';

/**
 * One study attachment: the dynamic per-study bag (params, series maps, primitives, marks, pane state,
 * animation scratch). Heavily open/dynamic -- treated as `any`.
 * @typedef {Record<string, any>} Attachment
 */
/**
 * The StudyHost options bag. All optional except getBars. Open (a skin/app adds more). @typedef {{
 *   getBars?: () => import('../core/types.js').Bar[], priceDecimals?: number, tickSize?: number,
 *   candleStyle?: () => any, mainSeries?: () => any, barTimes?: () => number[], isHidden?: () => boolean,
 *   persist?: (list: any[]) => void, intrabarMaxBars?: number,
 *   intrabar?: (tf: string, fromMs: number, toMs: number) => any, subscribeIntrabar?: Function,
 *   dropIntrabar?: (id: any) => void, resolveLowerTf?: (study: any) => string, worker?: boolean,
 *   studyUrl?: (id: string) => (string | null), [k: string]: any }} HostOpts
 */
export class StudyHost {
  /** @param {any} chart @param {HostOpts} [opts] */
  constructor(chart, opts = {}) {
    this.chart = chart;
    this.opts = opts;
    /** @type {Attachment[]} */
    this.attached = [];
    this.bars = (opts.getBars && opts.getBars()) || [];
    // the intrabar (lower-TF) sub-bar feed: cache + fetch-once + live push live in intrabar-feed.js.
    // Its two outward seams: worker mutations funnel through toWorker (a no-op until the worker spawns),
    // and fresh sub-bars recompute every intrabar study (the ONE home for that reaction).
    this._intrabarFeed = new IntrabarFeed(opts, {
      toWorker: (/** @type {any} */ msg) => { if (this._worker) this._worker.send(msg); },
      onData: () => this.attached.forEach((a) => { if (a.study && (a.study.intrabar || a.study.lowerTimeframe)) this.recompute(a); }),
    });
    /** @type {Record<string, Function[]>} */
    this._listeners = {};  // lifecycle events a skin (kapelka/skin) subscribes to
    /** @type {StudyWorker | null} */
    this._worker = null;   // off-thread study compute, spawned lazily when opts.worker + an eligible study run
    /** @type {{ eid: number, a: Attachment, seq: number, entry: any }[]} */
    this._pending = [];    // eligible studies queued this tick -> flushed as ONE exec-batch (one traversal)
    this._eidSeq = 0;
    this._flushScheduled = false;
    this._sidSeq = 0;      // stable per-attachment id -> the worker keeps a streaming session per sid
    /** @type {import('../core/types.js').Bar[] | null} */
    this._syncBars = null; // the bars last synced to the worker (to diff a tick: forming / append / full)
    this._tickMode = 'full'; // how the CURRENT recompute reached the worker: 'full' | 'forming' | 'append'
  }

  // subscribe to lifecycle events: 'added' | 'computed' | 'removed' | 'error' (each gets the
  // attachment `a`). Lets an external skin render chrome without subclassing the host.
  /** @param {string} ev @param {Function} fn */
  on(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); return this; }
  /** @param {string} ev @param {...any} args */
  _emit(ev, ...args) { (this._listeners[ev] || []).forEach((fn) => { try { fn(...args); } catch (_) {} }); }

  // ---- consumer feeds data ----
  // A data change is classified against the last-synced bars: a forming-bar tick (last bar changed in place),
  // a single bar close (one bar appended, the prior last finalized), or anything else -> a full sync. The
  // matching mutation goes to the worker (a single candle, not the whole array), and `_tickMode` tells the
  // ensuing recompute how each step study should advance (checkpoint) vs recompute fully.
  /** @param {import('../core/types.js').Bar[]} bars */
  setData(bars) {
    const kind = this._diffBars(this._syncBars, bars);
    this.bars = bars;
    if (this._worker) {
      if (kind === 'forming') this._worker.send({ type: 'update-forming-bar', bar: bars[bars.length - 1] });
      else if (kind === 'append') { this._worker.send({ type: 'update-forming-bar', bar: bars[bars.length - 2] }); this._worker.send({ type: 'append-bar', bar: bars[bars.length - 1] }); }
      else this._worker.send({ type: 'set-bars', bars });
    }
    this._syncBars = bars;
    this._tickMode = kind;
    this.attached.forEach((a) => this.recompute(a));   // recompute reads _tickMode synchronously into each queued entry
    this._tickMode = 'full';   // any recompute NOT driven by setData (settings, add, visibility) is a full run
  }

  // Classify next vs prev bars: 'forming' (same length, only the last bar changed, same time), 'append' (exactly
  // one bar appended, all prior bars identical, the old last still the old last), else 'full'. Conservative --
  // any ambiguity (backfill prepend, multi-bar jump, symbol change) falls back to a safe full recompute.
  /** @param {import('../core/types.js').Bar[] | null} prev @param {import('../core/types.js').Bar[]} next @returns {'forming'|'append'|'full'} */
  _diffBars(prev, next) {
    if (!prev || !prev.length || !next || !next.length) return 'full';
    const pn = prev.length, nn = next.length;
    /** @param {any} a @param {any} b */
    const same = (a, b) => a && b && a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume && a.openInterest === b.openInterest;
    if (nn !== pn && nn !== pn + 1) return 'full';
    for (let i = 0; i < pn - 1; i++) if (!same(prev[i], next[i])) return 'full';   // every closed bar must be untouched
    if (next[pn - 1].time !== prev[pn - 1].time) return 'full';                    // the old last must still be the old last
    return nn === pn ? 'forming' : 'append';
  }
  // The pane reports the visible time window on pan/zoom; studies that opt in (study.viewport = true)
  // recompute against it (ctx.visibleRange), so they can analyse just what's on screen -- a viewport-
  // reactive study (e.g. visible-range volume profile, the "live" momentum terrain). Others are untouched,
  // so a moving chart doesn't recompute every study. Caller should throttle (this fires on every frame of a
  // drag). No-op unless something is actually viewport-reactive.
  /** @param {any} range */
  setVisibleRange(range) {
    this._visibleRange = range || null;
    if (!range) return;
    this.attached.forEach((a) => { if (a.study && a.study.viewport) this.recompute(a); });
  }
  // drop the sub-bar cache AND its live subscriptions (call on symbol change / teardown) so nothing leaks
  resetIntrabar() {
    this._intrabarFeed.reset();
    // Symbol/timeframe change: clear the worker's resident sub-bars (stale for the new instrument), then
    // re-sync the current bars so an exec before the next setData still has them. `reset` also drops the
    // worker's step sessions; the next exec rebuilds them fully.
    if (this._worker) { this._worker.send({ type: 'reset' }); this._worker.send({ type: 'set-bars', bars: this.bars }); this._syncBars = this.bars; }
  }

  // Drop live intrabar subscriptions that NO VISIBLE study needs any more (e.g. after hiding one). They
  // are re-created by _ensureIntrabar when a study using that lower-TF becomes visible again.
  _reconcileIntrabar() {
    const needed = new Set();
    for (const a of this.attached) if (this._show(a) && a.study && (a.study.intrabar || a.study.lowerTimeframe)) needed.add(this._resolveLowerTf(a.study));
    this._intrabarFeed.reconcile(needed);
  }
  // Visibility changed (eye / collapse / global indicators toggle): drop now-unneeded intrabar subscriptions
  // and recompute any study that just became visible (it was skipped while hidden, so its data is stale).
  refreshVisibility() {
    this._reconcileIntrabar();
    this.attached.forEach((a) => { if (this._show(a) && a._stale) this.recompute(a); });
  }

  // ---- queries ----
  list() { return this.attached.map((a, i) => ({ i, id: a.study.id, name: a.study.name, hidden: !!a.hidden, error: a.error || null, overlay: a.overlay })); }
  count() { return this.attached.length; }
  /** @param {number} i */
  studyAt(i) { return this.attached[i]; }
  /** @param {number} i */
  plotMetaOf(i) { const a = this.attached[i]; return a ? (a.plotMeta || []) : []; }
  /** @param {number} i @param {string} key */
  styleOf(i, key) {
    const a = this.attached[i]; if (!a) return {};
    const pm = (a.plotMeta || []).find((/** @type {any} */ p) => p.key === key) || { key };
    return effectiveStyle(a.style, pm);
  }

  // ---- lifecycle ----
  /** @param {string} id @param {Record<string, any>} [params] @param {{ hidden?: boolean, style?: any, [k: string]: any }} [opts] @returns {any} */
  add(id, params, opts = {}) {
    const study = getStudy(id);
    if (!study) return;
    /** @type {Attachment} */
    const a = {
      study, params: { ...defaultsFor(study), ...(params || {}) },
      hidden: !!opts.hidden, collapsed: false, overlay: study.overlay !== false,
      plots: new Map(), seriesType: new Map(), paneIndex: null, stretched: false,
      style: opts.style || {}, plotMeta: [],
      shapes: [], shapesPrim: null, shapesSeries: null,
      mainShapesPrim: null, mainShapesSeries: null,   // sub-pane study's `overlay:true` shapes, on the price pane
      fillBands: [], fillPrim: null, fillSeries: null,
      markers: [], _scalePane: null, error: null, errLogged: null,
    };
    this.attached.push(a);
    this._onAdded(a, opts);
    this._persist();
    return this.recompute(a);
  }
  /** @param {number} i */
  remove(i) {
    const a = this.attached[i]; if (!a) return;
    const series = a.plots.values().next().value;
    const ci = (!a.overlay && series) ? this._paneIndexOf(series) : -1;
    this._onRemoved(a);
    this._detachStudy(a);
    a.plots.forEach((/** @type {any} */ s) => { try { this.chart.removePlot(s); } catch (_) {} });
    if (ci >= 0) { try { const ps = this.chart.panes(); if (ps[ci] && ps[ci].getSeries().length === 0) this.chart.removePane(ci); } catch (_) {} }
    this.attached.splice(i, 1);
    // worker lifecycle: terminate the compute worker once the pane has no worker studies left, so a removed
    // study doesn't leave an idle worker lingering.
    if (this._worker && this._workerEligible(a) && !this.attached.some((x) => this._workerEligible(x))) this.disposeStudyWorker();
    this._persist();
  }
  clearAll() {
    [...this.attached].forEach((_, i) => this.remove(this.attached.length - 1 - i));
    this.attached = [];
    this._persist();
  }
  /** @param {number} i @param {string} key @param {any} value */
  setParam(i, key, value) {
    const a = this.attached[i]; if (!a) return;
    a.params[key] = value; this._persist(); this.recompute(a);
  }
  /** @param {number} i @param {string} key @param {Record<string, any>} patch */
  setStyle(i, key, patch) {
    const a = this.attached[i]; if (!a) return;
    a.style = a.style || {}; a.style[key] = { ...(a.style[key] || {}), ...patch };
    this._persist();
    if ('type' in patch) return this.recompute(a);
    this._restyle(a);
  }
  // reset an attached study to its declared (built-in) defaults: params back to defaultsFor(study),
  // all per-plot style overrides cleared. Recompute rebuilds the series with the default appearance.
  /** @param {number} i */
  resetDefaults(i) {
    const a = this.attached[i]; if (!a) return;
    a.params = { ...defaultsFor(a.study) };
    a.style = {};
    this._persist();
    return this.recompute(a);
  }
  // re-link to the latest registered study (after a live edit) and recompute
  relink() { this.attached.forEach((a) => { const f = getStudy(a.study.id); if (f) a.study = f; a.errLogged = null; this.recompute(a); }); }
  // snapshot for templates
  serialize() { return this.attached.map((a) => ({ id: a.study.id, params: { ...a.params }, hidden: !!a.hidden, style: a.style && Object.keys(a.style).length ? a.style : undefined })); }
  /** @param {any[]} studies */
  applyTemplate(studies) { this.clearAll(); (studies || []).forEach((/** @type {any} */ s) => this.add(s.id, s.params, { hidden: s.hidden, style: s.style })); }

  // ---- visibility ----
  /** @param {Attachment} a */
  _show(a) { return !a.hidden && !a.collapsed && !this._isHidden(); }
  /** @param {number} i */
  toggleHidden(i) { const a = this.attached[i]; if (!a) return; a.hidden = !a.hidden; this._restyle(a); if (a.shapesPrim) a.shapesPrim.repaint(); if (a.mainShapesPrim) a.mainShapesPrim.repaint(); if (a.fillPrim) a.fillPrim.repaint(); this.refreshVisibility(); this._persist(); }
  /** @param {Attachment} a */
  _restyle(a) {
    (a.plotMeta || []).forEach((/** @type {any} */ pm) => {
      const s = a.plots.get(pm.key);
      if (s) { try { s.configure(styleToOptions(effectiveStyle(a.style, pm), this._show(a))); } catch (_) {} }
    });
  }

  // ---- the render core ----
  /** @param {Attachment} a */
  async recompute(a) {
    // Hidden / collapsed / indicators-off: do NOT compute or fetch. The output is already invisible, so
    // running calc + holding an intrabar subscription every tick was pure waste (a hidden study on a deep
    // chart still cost full CPU and kept downloading). Mark it stale -> refreshed once on un-hide.
    if (!this._show(a)) { a._stale = true; return; }
    a._stale = false;
    // Every study computes over the full loaded bars -- one window, no per-study cap and no higher-timeframe.
    // (Those two knobs fought the shared-window model, so they're removed here and rebuilt on top of it later.)
    const bars = this.bars;
    /** @type {Record<string, any>} */
    const ctx = {
      params: a.params,
      chart: this.chart,
      decimals: this._priceDecimals(),
      tickSize: this._tickSize(),   // instrument min price increment (for tick/pip units); null if unknown
      candle: this._candleStyle(),   // { up, down } chart candle colors, for studies that want to match them
      // the visible time window {from,to} (seconds), for viewport-reactive studies (study.viewport=true).
      // Set via setVisibleRange() on pan/zoom; null until the pane reports a range.
      visibleRange: this._visibleRange || null,
      fetch: (/** @type {any} */ url) => fetch(url).then((r) => r.json()),
      // per-attachment persistent scratch (survives recomputes) -- retained state for animation/tweening
      self: (a.self = a.self || {}),
      // drive per-frame tweening of THIS study's own shapes on the chart's frame clock (the "breath").
      // step(tMs) -> a new shapes array to draw (assigned to a.shapes, prims repainted), or null to stop.
      requestFrames: (/** @type {any} */ step) => this._runFrames(a, step),
    };
    // Intrabar (lower-TF sub-bars) is not combined with the higher-TF rollup in v1 -- they pull in opposite
    // directions and the sub-bars bucket against chart bars, so skip it while a higher TF is active.
    // Worker offload: a study's pure calc runs on a BACKGROUND thread, so heavy per-bar math never blocks the
    // render thread. Enabled per host (opts.worker) with an id->URL resolver (opts.studyUrl); the worker holds
    // the bars + sub-bars RESIDENT and computes against them, so no data crosses per study. When enabled, an
    // eligible study is worker-ONLY -- NO inline fallback (a fallback would silently render it and mask a broken
    // worker). Only frame-clock (requestFrames) studies and explicit `worker:false` opt-outs run inline. A
    // per-attachment seq drops a slow worker result a newer recompute already superseded (stale on live ticks).
    const eligible = this._workerEligible(a);
    if (a.study.intrabar || a.study.lowerTimeframe) {
      const lowerTfId = this._resolveLowerTf(a.study);
      const e = this._ensureIntrabar(lowerTfId);   // starts the fetch + live subscription (feeds the worker's resident sub-bars)
      ctx.lowerTimeframe = lowerTfId;
      ctx.intrabarLoading = !!e.loading;
      // Bucketing is EXPENSIVE and is exactly what used to be cloned per study every tick. The worker now
      // buckets from its OWN resident sub-bars, so only build it here for the inline (non-worker) path.
      if (!eligible) ctx.intrabar = bucketIntrabar(bars, e.subBars, this._chartSec());
    }
    const seq = (a._calcSeq = (a._calcSeq || 0) + 1);
    if (eligible) {
      const url = this.opts.studyUrl && this.opts.studyUrl(a.study.id);
      if (!url) { a.error = 'study worker: no URL for ' + a.study.id; this._onError(a, a.error); return; }
      // meta ONLY -- scalars, no bars/sub-bars. Queue it: every eligible study recomputed this tick flushes as
      // ONE exec-batch, so the worker builds the shared window once and advances them all in a single traversal.
      /** @type {Record<string, any>} */
      const meta = { decimals: ctx.decimals, tickSize: ctx.tickSize, candle: ctx.candle, visibleRange: ctx.visibleRange, chartSec: this._chartSec() };
      if (ctx.lowerTimeframe !== undefined) { meta.lowerTimeframe = ctx.lowerTimeframe; meta.intrabarLoading = ctx.intrabarLoading; }
      this._queueExec(a, a.study.id, url, a.params, meta, seq);
      return;
    }
    let out;   // inline (non-worker) path: frame-clock / worker:false studies
    try { out = await a.study.calc(bars, a.params, ctx); }
    catch (e) { a.error = (e && /** @type {any} */ (e).message) || String(e); this._onError(a, a.error); return; }
    this._applyResult(a, out, seq);
  }

  // Batched worker dispatch: recompute QUEUES each eligible study; a microtask flush sends ONE exec-batch for
  // everything recomputed this tick, so the worker walks the bars once for all of them. Each result routes back
  // through _applyResult with its own seq guard (a stale result whose study recomputed again is dropped).
  /** @param {Attachment} a @param {string} studyId @param {string} url @param {any} params @param {any} meta @param {number} seq */
  _queueExec(a, studyId, url, params, meta, seq) {
    const eid = ++this._eidSeq;
    a._sid = a._sid || (++this._sidSeq);   // stable id: the worker keeps this study's streaming session under it
    this._pending.push({ eid, a, seq, entry: { eid, studyId, studyUrl: url, params, meta, sid: a._sid, mode: this._tickMode } });
    if (!this._flushScheduled) { this._flushScheduled = true; Promise.resolve().then(() => this._flushExec()); }
  }
  async _flushExec() {
    this._flushScheduled = false;
    const batch = this._pending;
    this._pending = [];
    if (!batch.length) return;
    let results;
    try { results = await this._studyWorker().execBatch(batch.map((b) => b.entry)); }
    catch (e) { const msg = (e && /** @type {any} */ (e).message) || String(e); batch.forEach((b) => { if (b.a._calcSeq === b.seq) { b.a.error = msg; this._onError(b.a, msg); } }); return; }
    const byEid = new Map(batch.map((b) => [b.eid, b]));
    for (const r of results || []) {
      const b = byEid.get(r.eid);
      if (!b) continue;
      if (r.error) { if (b.a._calcSeq === b.seq) { b.a.error = r.error; this._onError(b.a, r.error); } continue; }
      if (r.tail) this._applyIncremental(b.a, r.tail, b.seq);   // a checkpoint tick: only the changed last point(s)
      else this._applyResult(b.a, r.out, b.seq);
    }
  }

  // The render sink (applyResult / applyIncremental / feedPoint / applyMarkers / applyScale /
  // detachStudy) lives in ./apply-result.js; these thin delegates keep the internal call sites and the
  // app-subclass seam (its destroy calls _detachStudy).
  /** @param {Attachment} a @param {{ key: string, points: any[] }[]} tail @param {number} seq */
  _applyIncremental(a, tail, seq) { applyIncremental(this, a, tail, seq); }
  /** @param {Attachment} a @param {any} out @param {number} seq */
  _applyResult(a, out, seq) { applyResult(this, a, out, seq); }

  // ---- animation: a study drives per-frame tweening of its own shapes (the retained "breath") ----
  // A study calls ctx.requestFrames(step). Each animation frame we call step(tMs); if it returns a shapes
  // array we assign it to a.shapes and repaint the study's mark primitives, then schedule the next frame;
  // if it returns null the tween has settled and the loop stops. ONE loop per attachment -- a fresh step
  // from a later recompute is swapped in (a._animStep) without stacking rAF loops. The retained tween state
  // lives on ctx.self, so display can ease from where it was toward each new target across recomputes.
  /** @param {Attachment} a @param {Function} step */
  _runFrames(a, step) {
    a._animStep = step || null;
    if (!a._animStep || a._animRunning) return;
    if (typeof requestAnimationFrame !== 'function') return;   // no frame clock (headless) -> caller's snap stands
    a._animRunning = true;
    const tick = (/** @type {number} */ t) => {
      const s = a._animStep;
      if (!s) { a._animRunning = false; return; }
      let out; try { out = s(t || 0); } catch (_) { a._animStep = null; a._animRunning = false; return; }
      if (out) {
        a.shapes = out;
        if (a.shapesPrim) a.shapesPrim.repaint();
        if (a.mainShapesPrim) a.mainShapesPrim.repaint();
        requestAnimationFrame(tick);
      } else { a._animStep = null; a._animRunning = false; }
    };
    requestAnimationFrame(tick);
  }

  /** @param {Attachment} a */
  _detachStudy(a) { detachStudy(this, a); }

  // ---- sub-pane management (mechanics; a skin renders the buttons that call these) ----
  // move a study's pane up/down, swapping with the adjacent pane
  /** @param {Attachment} a @param {number} dir */
  movePane(a, dir) {
    let ps; try { ps = this.chart.panes(); } catch (_) { return; }
    const series = a.plots.values().next().value;
    const idx = series ? this._paneIndexOf(series) : a.paneIndex;
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= ps.length) return;
    try { ps[idx].moveTo(target); } catch (_) { return; }
    this._reindexPanes();
    this._emit('moved', a);
  }
  // pane height mode: 'normal' | 'max' (squish others) | 'collapsed' (thin bar). State (snap /
  // collapsedPx) is kept on the attachment so it restores cleanly.
  /** @param {Attachment} a @param {string} mode */
  setPaneMode(a, mode) {
    const series = a.plots.values().next().value; if (!series) return;
    this._applyPaneMode(series, mode, a);
    a.collapsed = mode === 'collapsed'; a.mode = mode;
    this._restyle(a);          // collapsed -> plots go invisible (via _show)
    this._applyPreserve(a);    // keep the collapsed pane alive as an empty bar
    if (a.shapesPrim) a.shapesPrim.repaint();
    if (a.fillPrim) a.fillPrim.repaint();
    this.refreshVisibility();   // collapsed -> drop its intrabar sub / skip compute; expanded -> refresh
    this._emit('panemode', a, mode);
  }
  // The pane-geometry mechanics (height modes, preserve-empty, reindex, series->pane lookup) live in
  // ./pane-layout.js as pure functions over the engine handles; these thin delegates keep the API.
  /** @param {any} series @param {string} mode @param {Attachment} state */
  _applyPaneMode(series, mode, state) { applyPaneMode(this.chart, this._mainSeries(), series, mode, state); }
  /** @param {Attachment} a */
  _applyPreserve(a) { applyPreserve(this.chart, a, this._isHidden()); }
  // re-derive each sub-pane study's paneIndex from where its series actually lives (after a move)
  _reindexPanes() { reindexPanes(this.chart, this.attached); }

  // ---- intrabar (lower-timeframe) sub-bars ----
  /** @param {any} study @returns {string} */
  _resolveLowerTf(study) {
    const want = study.lowerTimeframe;
    if (want && want !== 'auto') return want;
    if (this.opts.resolveLowerTf) return this.opts.resolveLowerTf(study);
    const sec = this._chartSec();
    if (sec < 86400) return '1m';       // intraday
    if (sec < 7 * 86400) return '5m';   // daily
    return '1h';                        // higher
  }
  // Intrabar data (cache + fetch-once + live push) lives in ./intrabar-feed.js; this thin delegate
  // keeps the subclass seam (the app host overrides it to reset on a contract change).
  /** @param {string} lowerTfId @returns {any} */
  _ensureIntrabar(lowerTfId) { return this._intrabarFeed.ensure(lowerTfId, this.bars, this._chartSec()); }
  // average bar spacing in seconds (for the last bar's open-ended bucket window + the lower-tf heuristic)
  _chartSec() { const b = this.bars; if (b.length < 2) return 60; return (/** @type {number} */ (b[b.length - 1].time) - /** @type {number} */ (b[0].time)) / (b.length - 1) || 60; }

  // ---- context accessors (override or feed via opts) ----
  _priceDecimals() { return this.opts.priceDecimals != null ? this.opts.priceDecimals : 2; }
  // instrument tick size (min price increment, e.g. 0.25 for ES) -> ctx.tickSize for tick/pip-aware
  // studies; null when unknown. Note it is NOT 10^-decimals (ES is 2 decimals but ticks 0.25).
  _tickSize() { return this.opts.tickSize != null ? this.opts.tickSize : null; }
  // chart candle up/down colors -> ctx.candle for studies that opt to match them (else null)
  _candleStyle() { return this.opts.candleStyle ? this.opts.candleStyle() : null; }
  _isHidden() { return this.opts.isHidden ? this.opts.isHidden() : false; }
  _mainSeries() { return this.opts.mainSeries ? this.opts.mainSeries() : null; }
  /** @returns {number[]} */
  _barTimes() { return this.opts.barTimes ? this.opts.barTimes() : /** @type {number[]} */ (this.bars.map((b) => b.time)); }
  /** @param {any} series */
  _paneIndexOf(series) { return paneIndexOf(this.chart, series); }
  _persist() { if (this.opts.persist) try { this.opts.persist(this.serialize()); } catch (_) {} }

  // is this attachment's study eligible to run off the render thread? (host enabled + not opted out + not a
  // frame-clock study). requestFrames studies drive per-frame tweening on the main thread, so they stay inline.
  /** @param {Attachment} a */
  _workerEligible(a) { return !!(this.opts.worker && a && a.study && a.study.worker !== false && !a.study.requestFrames); }
  // lazily spawn the off-thread study compute worker (only when opts.worker + an eligible study first run)
  _studyWorker() {
    if (!this._worker) {
      this._worker = new StudyWorker();
      // Prime the fresh worker with the data resident on the host RIGHT NOW, so its first exec has bars +
      // whatever sub-bars are already cached. Subsequent changes arrive as mutations (set-bars / append-intrabar).
      this._worker.send({ type: 'set-bars', bars: this.bars });
      for (const k in this._intrabarFeed.cache) { const sb = this._intrabarFeed.cache[k].subBars; if (sb && sb.length) this._worker.send({ type: 'append-intrabar', tf: k, sub: sb }); }
    }
    return this._worker;
  }
  // terminate the compute worker (on host teardown, or when no worker study remains); inline still works without it
  disposeStudyWorker() { if (this._worker) { this._worker.destroy(); this._worker = null; } }

  // ---- skin hooks: emit lifecycle events (and overridable by a subclass) ----
  /** @param {Attachment} a @param {any} opts */
  _onAdded(a, opts) { this._emit('added', a, opts); }
  /** @param {Attachment} a */
  _onComputed(a) { this._emit('computed', a); }
  /** @param {Attachment} a */
  _onRemoved(a) { this._emit('removed', a); }
  /** @param {Attachment} a @param {string} msg */
  _onError(a, msg) { this._emit('error', a, msg); }
}
