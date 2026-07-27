// @ts-check
// App study host = the library StudyHost (kapelka) + app-specific glue. The library owns the render
// core (calc -> series / fills / shapes / markers / segments / scale / stacking / intrabar) AND the
// display chrome (kapelka/skin: sub-pane legend, controls, overlay legend). This subclass adds only
// what's Pane-specific: drawing surfaces, the future-bar spacer, persistence into pane.settings,
// the broker-backed intrabar provider, and the app's reactions to the skin's pane events.
import { StudyHost as CoreStudyHost } from '../../lib/kapelka/studies/host.js';
import { bus } from '../bus.js';
import { log } from '../dom.js';
import { indicatorsHidden } from '../tools/toolbar-store.js';
import { barMs } from '../workspace/timeframes.js';
import { Line } from '../../lib/kapelka/index.js';
import { tfFromId } from '../../lib/kapelka/studies/channels.js';
import { getStudyDefaults } from './defaults-store.js';
import { studyUrlFor } from './user-loader.js';

export class StudyHost extends CoreStudyHost {
  /** @param {any} pane the owning Pane (host object): chart, api(), contractId, settings, skin, etc. */
  constructor(pane) {
    super(pane.chart, {
      worker: true,             // run pure study calc off the render thread (off-thread StudyHost worker)
      studyUrl: studyUrlFor,    // id -> module URL the worker dynamic-imports (the app owns where studies live)
      getBars: () => [],   // the pane feeds bars via update() once it has data
      // broker-backed intrabar provider: the library host caches + buckets; this just fetches.
      intrabar: (/** @type {string} */ lowerTfId, /** @type {number} */ fromMs, /** @type {number} */ toMs) => new Promise((resolve) => {
        const api = pane.api(), cid = pane.contractId;
        if (!api || !api.getBars || !cid) return resolve([]);
        const tf = tfFromId(lowerTfId);
        /** @type {any[]} */
        const acc = []; let done = false;
        try {
          api.getBars({ id: cid, tf, fromMs, toMs }, (/** @type {any} */ u) => {
            if (done) return;
            if (u && u.bars && u.bars.length) acc.push(...u.bars);
            if (!u || u.complete || u.error) { done = true; resolve(acc); }
          });
        } catch (_) { resolve([]); }
      }),
      // LIVE intrabar: a streaming subscription (push) so the forming bar's sub-bars update on
      // every tick without re-downloading. Returns a reqId the host drops via dropIntrabar.
      subscribeIntrabar: (/** @type {string} */ lowerTfId, /** @type {number} */ fromMs, /** @type {(bars: any[]) => void} */ onBars) => {
        const api = pane.api(), cid = pane.contractId;
        if (!api || !api.subscribeBars || !cid) return null;
        const tf = tfFromId(lowerTfId);
        try {
          return api.subscribeBars({ id: cid, tf, fromMs }, (/** @type {any} */ u) => {
            if (u && !u.error && u.bars && u.bars.length) onBars(u.bars);
          });
        } catch (_) { return null; }
      },
      dropIntrabar: (/** @type {any} */ id) => { const api = pane.api(); if (api && api.drop && id != null) { try { api.drop(id); } catch (_) {} } },
    });
    this.pane = pane;
    /** @type {any} */
    this._intrabarCid = null;
    // live instrument tick size -> ctx.tickSize (the pane sets it on resolve, after this host exists)
    this._tickSize = () => (this.pane && this.pane.tickSize != null ? this.pane.tickSize : null);
    this._noRemove = !!pane.board;   // study board: the study set is chosen in the builder -> no per-pane delete
    // app reactions to kapelka/skin's pane controls (the library does the mechanics + emits)
    this.on('panemode', (/** @type {any} */ a) => { if (a.surface) a.surface.setSuppressed(!this._show(a)); });
    this.on('moved', () => { if (this.pane._captureOrder) this.pane._captureOrder(); if (this.pane._positionCompareUI) this.pane._positionCompareUI(); });
    // Type-only declarations for the future-bar spacer members (set lazily in _updateFutureSpacer/destroy).
    /** @type {any} */ this._spacer;
    /** @type {number} */ this._spacerMax;
  }

  // Study-board panes are SEPARATE charts (one study each), so the library's within-chart pane
  // mechanics have nothing to act on. Route the legend controls to the LAYOUT instead, so they behave
  // exactly like the main chart's sub-pane study controls (reorder / collapse to a thin bar / maximize).
  /** @param {any} a @param {number} dir */
  movePane(a, dir) {
    if (this.pane.board) { bus.emit('board:move', { pane: this.pane, dir }); return; }
    return super.movePane(a, dir);
  }
  /** @param {any} a @param {string} mode */
  setPaneMode(a, mode) {
    if (!this.pane.board) return super.setPaneMode(a, mode);
    // Use the library's BATTLE-TESTED collapse/max: it hides the plot content, keeps the legend +
    // controls visible, and sets the toggle flags + button glyph (all geometry is try/catch-wrapped,
    // so it is safe on a board's single-pane chart). A board study is its OWN chart, so that alone
    // can't dock the pane -- board:mode then shrinks/grows the LAYOUT row into a clean thin strip.
    super.setPaneMode(a, mode);
    bus.emit('board:mode', { pane: this.pane, mode });
  }

  // ---- context accessors the library host reads (Pane-backed) ----
  _priceDecimals() { return this.pane.priceDecimals; }
  _isHidden() { return indicatorsHidden(); }
  _mainSeries() { return this.pane.series; }
  _candleStyle() { const c = this.pane && this.pane.settings && this.pane.settings.candles; return c ? { up: c.upColor, down: c.downColor } : null; }
  _barTimes() { return this.pane.barTimes; }
  /** @param {any} series */
  _paneIndexOf(series) { return this.pane.paneIndexOf(series); }
  _chartSec() { const tf = this.pane.tf(); return tf ? barMs(tf) / 1000 : super._chartSec(); }
  /** @param {any} study */
  _resolveLowerTf(study) {
    const want = study.lowerTimeframe;
    if (want && want !== 'auto') return want;
    const tf = this.pane.tf();
    if (!tf) return '1m';
    if (tf.unit === 'm' || tf.unit === 'h') return '1m';   // intraday -> 1m
    if (tf.unit === 'D') return '5m';                       // daily -> 5m
    return '1h';                                            // weekly / monthly -> 1h
  }
  // drop the sub-bar cache when the symbol changes
  /** @param {string} lowerTfId */
  _ensureIntrabar(lowerTfId) {
    if (this._intrabarCid !== this.pane.contractId) { this.resetIntrabar(); this._intrabarCid = this.pane.contractId; }
    return super._ensureIntrabar(lowerTfId);
  }

  // ---- lifecycle (app keeps its positional add signature + extra persistence fields) ----
  /** @param {string} id @param {any} [params] @param {boolean} [hidden] @param {any[]} [drawings] @param {number|null} [paneIdx] @param {any} [style] @param {any[]} [tree] */
  // @ts-expect-error -- the app's positional add(id, params, hidden, drawings, paneIdx, style, tree) is a
  // DELIBERATE override of kapelka's add(id, params, opts); it adapts to the base via super.add (below).
  add(id, params, hidden, drawings, paneIdx, style, tree) {
    // a FRESH user-add (no explicit params/style) seeds from the user's saved defaults for this study
    // (the "Save as default" feature), else built-in defaults apply. An EMPTY params object counts as
    // "nothing set" too -- the study board attaches its studies with params:{} (from the builder), so
    // without this they would ignore the saved defaults that a main-window add honours.
    const noParams = params == null || (typeof params === 'object' && Object.keys(params).length === 0);
    if (noParams && style == null) {
      const def = getStudyDefaults(id);
      if (def) { params = def.params; style = def.style; }
    }
    return super.add(id, params, { hidden, style, drawings, paneIdx, tree });
  }
  /** @param {any[]} studies */
  applyTemplate(studies) {
    this.clearAll();
    (studies || []).forEach((/** @type {any} */ s) => this.add(s.id, s.params, s.hidden, undefined, undefined, s.style));
  }
  clearAll() { while (this.attached.length) this.remove(this.attached.length - 1); }
  /** @param {number} i */
  remove(i) { super.remove(i); this._reindexPanes(); this._updateFutureSpacer(); bus.emit('objects:changed', { pane: this.pane }); }
  // LIVE-bar recompute THROTTLE (user setting, Settings > Status > INDICATORS > Recompute): on low timeframes
  // ticks arrive many times a second and every one recomputed every study in the worker. With a throttle, at
  // most one recompute per window, TRAILING-EDGE: the newest bars always compute at the window's end, so the
  // final tick is never lost -- studies just lag the tape by at most the chosen interval. 0 = every tick.
  /** @param {number} ms */
  setThrottle(ms) { this._throttleMs = Number(ms) || 0; }
  /** @param {any[]} bars */
  update(bars) {
    const ms = this._throttleMs || 0;
    if (ms <= 0) { this.setData(bars); return; }
    this._pendingBars = bars;
    if (this._thTimer) return;   // a trailing run is scheduled -- it picks up the newest bars
    const now = performance.now();
    const due = (this._lastCompute || 0) + ms - now;
    if (due <= 0) { this._lastCompute = now; this.setData(bars); return; }
    this._thTimer = setTimeout(() => { this._thTimer = 0; this._lastCompute = performance.now(); this.setData(this._pendingBars || []); }, due);
  }

  // ---- hooks the library host calls (the chrome is rendered by kapelka/skin via the emitted events) ----
  /** @param {any} a @param {any} opts */
  _onAdded(a, opts) {
    a.drawings = opts.drawings || [];
    a.tree = opts.tree || [];
    a._wantOrder = (opts.paneIdx != null ? opts.paneIdx : null);
    a.surface = null; a.mode = 'normal';
    super._onAdded(a, opts);   // emit 'added' -> skin attaches its chrome
  }
  /** @param {any} a @param {string} msg */
  _onError(a, msg) { if (a.errLogged !== msg) { a.errLogged = msg; log('Indicator "' + a.study.name + '" error: ' + msg, true); } super._onError(a, msg); }
  /** @param {any} a */
  _onRemoved(a) {
    if (a.surface) { try { this.pane.removePaneSurface(a.surface); } catch (_) {} a.surface = null; }
    super._onRemoved(a);   // emit 'removed' -> skin tears down its chrome
  }
  /** @param {any} a */
  _onComputed(a) {
    // sub-pane drawing surface, anchored to the study's primary series; drawings persist in a.drawings
    if (!a.overlay && !a.surface) {
      const series = a.plots.values().next().value;
      if (series) {
        const store = {
          load: () => a.drawings || [], save: (/** @type {any[]} */ arr) => { a.drawings = arr; this.persist(); },
          loadTree: () => a.tree || [], saveTree: (/** @type {any[]} */ t) => { a.tree = t; this.persist(); },
        };
        a.surface = this.pane.addPaneSurface({ series, store });
      }
    }
    if (!a.overlay && !a._ordered) {
      a._ordered = true;
      if (this.pane._scheduleApplyOrder) this.pane._scheduleApplyOrder();
    }
    this._updateFutureSpacer();   // extend the time scale so projected (future) shapes are reachable
    super._onComputed(a);   // emit 'computed' -> skin renders the sub-pane legend + controls
  }

  // crosshair legend values are rendered by kapelka/skin now; kept as a no-op for external callers
  onCrosshair() {}

  // ---- visibility / pane preservation ----
  /** @param {any} a */
  _applyPreserve(a) {
    if (a.overlay) return;
    try {
      const ps = this.pane.chart.panes();
      const series = a.plots.values().next().value;
      const idx = series ? this.pane.paneIndexOf(series) : a.paneIndex;
      const keep = !!a.collapsed && !a.hidden && !indicatorsHidden();
      if (ps[idx] && ps[idx].setPreserveEmptyPane) ps[idx].setPreserveEmptyPane(keep);
    } catch (_) {}
  }
  applyVisibility() { this.attached.forEach((a) => { this._restyle(a); this._applyPreserve(a); }); this.refreshVisibility(); this._repaintShapes(); if (this.pane.skin) this.pane.skin.refresh(); }
  /** @param {number} i */
  toggleHidden(i) {
    const a = this.attached[i];
    if (!a) return;
    a.hidden = !a.hidden;
    this._restyle(a);
    this._applyPreserve(a);
    if (a.shapesPrim) a.shapesPrim.repaint();
    if (a.mainShapesPrim) a.mainShapesPrim.repaint();   // also clear/redraw the MAIN-pane projection (overlay:true shapes)
    if (a.fillPrim) a.fillPrim.repaint();
    if (this.pane.skin) this.pane.skin.refresh();   // dim/hide the skin chrome for the hidden study
    this.persist();
  }
  _repaintShapes() { this.attached.forEach((a) => { if (a.shapesPrim) a.shapesPrim.repaint(); if (a.fillPrim) a.fillPrim.repaint(); }); }
  /** @param {number} i */
  surfaceEngine(i) { const a = this.attached[i]; return (a && a.surface) || null; }

  // ---- pane re-index after a move (the skin's controls drive movePane/setPaneMode on the library host) ----
  _reindexPanes() {
    let ps; try { ps = this.pane.chart.panes(); } catch (_) { return; }
    this.attached.forEach((a) => {
      if (a.overlay) return;
      const series = a.plots.values().next().value; if (!series) return;
      for (let i = 0; i < ps.length; i++) { let list; try { list = ps[i].getSeries(); } catch (_) { list = []; } if (list.indexOf(series) !== -1) { a.paneIndex = i; break; } }
    });
  }
  reindexAndReposition() { this._reindexPanes(); if (this.pane.skin) this.pane.skin.reposition(); }

  // ---- future-bar spacer: project the bar grid forward so shapes beyond the last bar are reachable ----
  _updateFutureSpacer() {
    const bt = this.pane.barTimes || [];
    if (!bt.length || !this.pane.seeded) return;
    const last = bt[bt.length - 1];
    const DAY = 86400;
    /** @type {number[]} */
    const anchors = [];
    let maxT = 0;
    this.attached.forEach((a) => (a.shapes || []).forEach((/** @type {any} */ s) => {
      [s.time, s.from, s.to].forEach((/** @type {any} */ t) => { if (t != null && t > last) { anchors.push(Math.round(t)); if (t > maxT) maxT = t; } });
    }));
    if (maxT <= last) {
      if (this._spacerMax) { this._spacerMax = 0; if (this._spacer) { try { this._spacer.feed([]); } catch (_) {} } }
      return;
    }
    if (maxT === this._spacerMax) return;
    const byDate = new Map();
    for (let i = Math.max(0, bt.length - 6000); i < bt.length; i++) {
      const di = Math.floor(bt[i] / DAY);
      let arr = byDate.get(di); if (!arr) { arr = []; byDate.set(di, arr); }
      arr.push(bt[i]);
    }
    const dates = [...byDate.keys()].sort((x, y) => x - y);
    if (dates.length < 2) return;
    let refDi = dates[0], refCount = -1;
    dates.slice(0, -1).forEach((di) => { const c = byDate.get(di).length; if (c >= refCount) { refCount = c; refDi = di; } });
    const refBars = byDate.get(refDi);
    const times = new Set(anchors);
    const lastDi = Math.floor(last / DAY);
    for (let di = lastDi; di * DAY <= maxT + DAY && times.size < 8000; di++) {
      if (new Date(di * DAY * 1000).getUTCDay() % 6 === 0) continue;
      const shift = (di - refDi) * DAY;
      for (let k = 0; k < refBars.length; k++) { const nt = refBars[k] + shift; if (nt > last && nt <= maxT) times.add(nt); }
    }
    const ws = [...times].sort((x, y) => x - y).map((t) => ({ time: t }));
    if (!this._spacer) {
      try { this._spacer = this.pane.chart.addPlot(Line, { visible: false, showLastValue: false, showPriceLine: false, showCursorMarker: false }, 0); } catch (_) {}
    }
    if (this._spacer) { try { this._spacer.feed(ws); this._spacerMax = maxT; } catch (_) {} }
  }

  // ---- persistence (pane.settings) ----
  persist() {
    this.pane.settings.studies = this.attached.map((a) => ({
      id: a.study.id, params: a.params, hidden: !!a.hidden,
      drawings: (a.drawings && a.drawings.length) ? a.drawings : undefined,
      tree: (a.tree && a.tree.length) ? a.tree : undefined,
      paneIdx: a.overlay ? undefined : (a._wantOrder != null ? a._wantOrder : undefined),
      style: a.style && Object.keys(a.style).length ? a.style : undefined,
    }));
    bus.emit('pane:changed');
  }
  _persist() { this.persist(); }
  restore() {
    (this.pane.settings.studies || []).forEach((/** @type {any} */ s) => this.add(s.id, s.params, s.hidden, s.drawings, s.paneIdx, s.style, s.tree));
  }

  destroy() {
    this.resetIntrabar();   // drop live intrabar subscriptions so they don't outlive the pane
    this.disposeStudyWorker();   // terminate the off-thread compute worker so a closed pane/board doesn't leak it
    this.attached.forEach((a) => { this._detachStudy(a); if (a.surface) { try { this.pane.removePaneSurface(a.surface); } catch (_) {} a.surface = null; } });
    this.attached.forEach((a) => a.plots.forEach((/** @type {any} */ s) => { try { this.pane.chart.removePlot(s); } catch (_) {} }));
    if (this._spacer) { try { this.pane.chart.removePlot(this._spacer); } catch (_) {} this._spacer = null; this._spacerMax = 0; }
    this.attached = [];
  }
}
