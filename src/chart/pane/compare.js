// @ts-check
// Compare overlay for a Pane: a second symbol drawn in its own sub-pane (candles or a line), kept in
// lockstep with the main chart's history, with its own drawing surface and a docked control cluster.
// Split out of pane.js as a prototype mixin -- these methods run with `this` bound to the Pane
// instance (attached via Object.assign in pane.js) and call the core Pane methods through `this`.
import { broker } from '../../../data_engine/index.js';
import { log } from '../../dom.js';
import { bus } from '../../bus.js';
import { lookFor } from '../../workspace/timeframes.js';
import { Candles, Line } from '../../../lib/kapelka/index.js';
import { DrawingEngine } from '../../tools/engine/engine.js';
import { PRICE_SOURCES, dashToStroke, candleOptions, LINE_STYLE_DEFAULT } from '../pane-defaults.js';

/** @typedef {import('../../../data_engine/index.js').Bar} Bar */
// One streamed bar update from an adapter's subscribeBars/getBars callback (opaque chunk shape).
/** @typedef {{ error?: any, bars?: Bar[], complete?: boolean, reachedStart?: boolean }} BarUpdate */
// The compare state record: a second symbol's overlay series + its own bar map, kept alongside the pane.
/**
 * @typedef {Object} Compare
 * @property {string} brokerId
 * @property {string} symbol
 * @property {string|null} contractId
 * @property {number} reqId
 * @property {Map<number, Bar>} bars
 * @property {any} series          kapelka candle series handle (engine boundary)
 * @property {any} lineSeries      kapelka line series handle, or null
 * @property {number=} fromMs      oldest history boundary requested so far
 * @property {boolean=} hidden
 */
// Button factory shared by the compare control cluster: (label, title, onClick) -> a <button>.
/** @typedef {(txt: string, title: string, fn: () => void) => HTMLButtonElement} BtnFactory */

// The methods below run with `this` bound to the Pane instance. The Pane wraps the vendored kapelka
// chart engine and has no TS types here, so `this` is the engine `any` boundary; the compare state
// record, DOM elements and typed callback params still get real types.
/** @type {Record<string, any> & ThisType<any>} */
export const compareMethods = {
  _effCompareChartType() { return this.compareHlMode ? 'line' : (this.settings.compare && this.settings.compare.chartType); },
  _effCompareSource() { return this.compareHlMode || (this.settings.compare && this.settings.compare.line.source); },
  _effCompareColor() { const ln = this.settings.compare.line; return this.compareHlMode === 'high' ? ln.highColor : this.compareHlMode === 'low' ? ln.lowColor : ln.color; },
  _compareSource() { return PRICE_SOURCES[this._effCompareSource()] || PRICE_SOURCES.close; },
  _compareLineOpts() {
    const ln = this.settings.compare.line;
    // showLastValue false: the hidden candle still draws the price label, so the line
    // must not add a second one.
    return { color: this._effCompareColor(), lineWidth: ln.lineWidth, lineStyle: dashToStroke(ln.lineStyle), showPriceLine: false, showLastValue: false };
  },
  _feedCompareLine() {
    const cmp = this.compare;
    if (!cmp || !cmp.lineSeries) return;
    const src = this._compareSource();
    cmp.lineSeries.feed([...cmp.bars.values()].sort((a, b) => a.time - b.time).map((b) => ({ time: b.time, value: src(b) })));
  },
  applyCompareChartType() {
    const cmp = this.compare, cfg = this.settings.compare;
    if (!cmp || !cmp.series || !cfg) return;
    if (this._effCompareChartType() === 'line') {
      cmp.series.configure({ upColor: 'rgba(0,0,0,0)', downColor: 'rgba(0,0,0,0)', showBorder: false, showWick: false });
      if (!cmp.lineSeries) cmp.lineSeries = this.chart.addPlot(Line, this._compareLineOpts(), cmp.series._pane);
      else cmp.lineSeries.configure(this._compareLineOpts());
      this._feedCompareLine();
    } else {
      if (cmp.lineSeries) { try { this.chart.removePlot(cmp.lineSeries); } catch (_) {} cmp.lineSeries = null; }
      cmp.series.configure(candleOptions(this.settings.candles));
    }
  },
  // Cycle the compare quick source toggle: Normal -> High -> Low -> Normal (mirrors cycleHL).
  cycleCompareHL() {
    if (!this.settings.compare) return null;
    this.compareHlMode = this.compareHlMode == null ? 'high' : this.compareHlMode === 'high' ? 'low' : null;
    this.applyCompareChartType();
    return this.compareHlMode;
  },
  /** @param {string} t */
  setCompareChartType(t) { if (!this.settings.compare) return; this.compareHlMode = null; this.settings.compare.chartType = (t === 'line') ? 'line' : 'candles'; this.applyCompareChartType(); if (this._updCmpHLBtn) this._updCmpHLBtn(); bus.emit('pane:changed'); },
  /** @param {string} s */
  setCompareLineSource(s) { if (!this.settings.compare) return; this.compareHlMode = null; this.settings.compare.line.source = s; this._feedCompareLine(); if (this._updCmpHLBtn) this._updCmpHLBtn(); bus.emit('pane:changed'); },
  /** @param {any} patch */
  setCompareLineStyle(patch) { if (!this.settings.compare) return; Object.assign(this.settings.compare.line, patch); if (this.compare && this.compare.lineSeries) this.compare.lineSeries.configure(this._compareLineOpts()); bus.emit('pane:changed'); },
  compareChartTypeTarget() {
    const p = this, c = this.settings.compare;
    if (!c) return null;
    return p._ctTarget({
      title: 'Compare: ' + c.symbol,
      ln: () => c.line,
      getType: () => c.chartType, setType: (/** @type {string} */ t) => p.setCompareChartType(t),
      setSource: (/** @type {string} */ s) => p.setCompareLineSource(s),
      setStyle: (/** @type {any} */ patch) => p.setCompareLineStyle(patch),
      reColor: (/** @type {string} */ which) => { if (p.compareHlMode === which) p.applyCompareChartType(); },   // compare H/L toggle: added next
    });
  },

  /** @param {string} brokerId @param {string} symbol */
  addCompare(brokerId, symbol) {
    this.removeCompare();
    const bid = brokerId || this.broker;
    const api = broker.for(bid);
    if (!api) { log('Connect a broker to compare symbols.', true); return; }
    const cmp = { brokerId: bid, symbol, contractId: null, reqId: 0, bars: new Map(), series: null, lineSeries: null };
    this.compare = cmp;
    this.compareMode = 'normal';
    this._cmpState = {};         // fresh stretch-factor snapshot holder for collapse/restore
    this._cmpNormal = [7, 3];   // default main:compare stretch
    // keep persisted drawings when re-adding the SAME comparison (reload); fresh otherwise
    if (!this.settings.compare || this.settings.compare.symbol !== symbol || this.settings.compare.brokerId !== bid) {
      this.settings.compare = { brokerId: bid, symbol };   // persist (serialized with the pane)
    }
    // chart type for the overlay (candles by default; can be switched to a line)
    const cc = this.settings.compare;
    cc.chartType = cc.chartType === 'line' ? 'line' : 'candles';
    cc.line = { ...LINE_STYLE_DEFAULT, ...(cc.line || {}) };
    bus.emit('pane:changed');
    // The adapter passes a second `err` arg the contract's resolveSymbol callback doesn't declare
    // (contract: (inst) => void). Cast the 2-arg callback to satisfy the typed signature without
    // dropping the extra param the runtime relies on.
    api.resolveSymbol(symbol, /** @type {any} */ ((/** @type {any} */ inst, /** @type {any} */ err) => {
      if (this.compare !== cmp) return;                 // replaced/removed meanwhile
      if (!inst) { log('[' + symbol + '] not resolved for compare' + (err ? ' (status ' + err.status + ')' : '') + '.', true); this.removeCompare(); return; }
      cmp.contractId = inst.id;
      // append a FRESH pane at the bottom (never index 1 — a study may already be there,
      // which would merge the compare candles into the study's pane).
      const ci = this.chart.panes().length;
      cmp.series = this.chart.addPlot(Candles, {
        ...candleOptions(this.settings.candles),
        priceFormat: { type: 'price', precision: inst.priceDecimals, minMove: inst.tickSize },
        showPriceLine: false, showLastValue: true,
      }, ci);
      try { const p = this.chart.panes()[this.paneIndexOf(cmp.series)]; if (p) p.setStretchFactor(0.45); } catch (_) {}
      this.applyCompareChartType();   // candles by default; switches to a line overlay if set
      // the sub-pane is its own drawing surface: an isolated engine on the compare
      // series (routes through the main interaction), registered below the main pane.
      // Its drawings persist into pane.settings.compare.drawings (with the workspace).
      const store = {
        load: () => (this.settings.compare && this.settings.compare.drawings) || [],
        save: (/** @type {any[]} */ arr) => { if (this.settings.compare) this.settings.compare.drawings = arr; bus.emit('pane:changed'); },
        loadTree: () => (this.settings.compare && this.settings.compare.tree) || [],
        saveTree: (/** @type {any} */ t) => { if (this.settings.compare) this.settings.compare.tree = t; bus.emit('pane:changed'); },
      };
      this.compareDrawings = new DrawingEngine(this, cmp.series, { isolated: true, noInteraction: true, store });
      const topFn = () => this.paneTopOf(cmp.series);
      this.surfaces.push({ engine: this.compareDrawings, top: topFn, yOffset: topFn, bars: () => cmp.bars });
      this.compareDrawings.restore();   // bring back persisted sub-pane drawings
      this._buildCompareUI();
      this._scheduleApplyOrder();       // place the compare pane at its saved position
      this._compareRequest();
    }));
  },
  _compareRequest() {
    const cmp = this.compare, tf = this.tf();
    if (!cmp || !cmp.contractId || !tf) return;
    const api = broker.for(cmp.brokerId);
    cmp.bars = new Map();
    if (cmp.series) cmp.series.feed([]);
    this._feedCompareLine();
    if (cmp.reqId && api) api.drop(cmp.reqId);
    // request the compare over the SAME span as the main chart (its earliest loaded bar),
    // not a fixed lookback — so the compare pane lines up with the main, full width.
    const fromMs = (this.earliest != null ? this.earliest * 1000 : Date.now() - lookFor(tf));
    cmp.fromMs = fromMs;   // oldest history boundary requested so far (extended by _compareFollow)
    cmp.reqId = api && api.subscribeBars(
      { id: cmp.contractId, tf, fromMs },
      (/** @type {any} */ u) => this._compareReport(cmp, u),
    );
  },
  // keep the compare history in lockstep with the main: when the main lazy-loads older bars
  // (this.earliest moves back), fetch the same older window for the compare and merge it in.
  _compareFollow() {
    const cmp = this.compare;
    if (!cmp || !cmp.contractId || this.earliest == null || cmp.fromMs == null) return;
    const want = this.earliest * 1000;
    if (want >= cmp.fromMs - 1) return;            // compare already covers the main's range
    const toMs = cmp.fromMs; cmp.fromMs = want;    // fetch only the newly-exposed gap
    const api = broker.for(cmp.brokerId);
    if (!api || !api.getBars) return;
    api.getBars({ id: cmp.contractId, tf: this.tf(), fromMs: want, toMs }, (/** @type {any} */ u) => {
      if (this.compare !== cmp || !u || u.error || !u.bars) return;
      u.bars.forEach((/** @type {Bar} */ b) => cmp.bars.set(b.time, b));
      cmp.series.feed([...cmp.bars.values()].sort((a, b) => a.time - b.time));
      this._feedCompareLine();
    });
  },
  /** @param {Compare} cmp @param {{ error?: any, bars: Bar[] }} u */
  _compareReport(cmp, u) {
    if (this.compare !== cmp || !cmp.series) return;
    if (u.error) { log('[' + cmp.symbol + '] compare bars failed: ' + u.error, true); return; }
    u.bars.forEach((b) => cmp.bars.set(b.time, b));
    cmp.series.feed([...cmp.bars.values()].sort((a, b) => a.time - b.time));
    this._feedCompareLine();
  },
  removeCompare() {
    const cmp = this.compare; if (!cmp) return;
    this.compare = null;
    this.compareHlMode = null;
    this._destroyCompareUI();
    // tear down the sub-pane's drawing surface first (detaches its primitive)
    if (this.compareDrawings) { try { this.compareDrawings.destroy(); } catch (_) {} this.compareDrawings = null; }
    this.surfaces = this.surfaces.filter((/** @type {{ engine: any }} */ s) => s.engine === this.drawings);
    const api = broker.for(cmp.brokerId);
    if (cmp.reqId && api) api.drop(cmp.reqId);
    const ci = cmp.series ? this.paneIndexOf(cmp.series) : -1;   // its actual pane (order-independent)
    if (cmp.lineSeries) { try { this.chart.removePlot(cmp.lineSeries); } catch (_) {} cmp.lineSeries = null; }
    if (cmp.series) { try { this.chart.removePlot(cmp.series); } catch (_) {} }
    // drop that pane only if it's now empty (never nuke a pane that still holds a study)
    try { const ps = this.chart.panes(); if (ci >= 0 && ps[ci] && ps[ci].getSeries().length === 0) this.chart.removePane(ci); } catch (_) {}
    if (this.studies && this.studies.reindexAndReposition) this.studies.reindexAndReposition();
    delete this.settings.compare;
    bus.emit('pane:changed');
  },
  // restore a persisted comparison once its broker is connected (called from resolve)
  _restoreCompare() {
    const c = this.settings.compare;
    if (this.compare || !c || !c.symbol) return;
    if (!broker.isConnected(c.brokerId)) return;       // wait for that broker's logon
    this.addCompare(c.brokerId, c.symbol);
  },
  /** @param {any} v */
  compareSetHidden(v) {
    const cmp = this.compare; if (!cmp) return;
    cmp.hidden = !!v;
    if (cmp.series) { try { cmp.series.configure({ visible: !cmp.hidden }); } catch (_) {} }
    if (cmp.lineSeries) { try { cmp.lineSeries.configure({ visible: !cmp.hidden }); } catch (_) {} }
    // hidden compare -> not preserved (its pane vanishes); a collapsed one keeps its bar
    try { const p = this.chart.panes()[this.paneIndexOf(cmp.series)]; if (p && p.setPreserveEmptyPane) p.setPreserveEmptyPane(this.compareMode === 'collapsed' && !cmp.hidden); } catch (_) {}
    if (this.compareDrawings) this.compareDrawings.setSuppressed(cmp.hidden);   // hide drawings too
    bus.emit('objects:changed', { pane: this });
  },

  // move the compare pane up/down (swap with the adjacent pane). Surfaces follow via
  // paneTopOf; study panes are re-indexed since their positions shift.
  /** @param {number} dir */
  _moveComparePane(dir) {
    const cmp = this.compare; if (!cmp || !cmp.series) return;
    let ps; try { ps = this.chart.panes(); } catch (_) { return; }
    const idx = this.paneIndexOf(cmp.series);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= ps.length) return;
    try { ps[idx].moveTo(target); } catch (_) { return; }
    if (this.studies && this.studies.reindexAndReposition) this.studies.reindexAndReposition();
    this._captureOrder();   // persist the new arrangement
    this._positionCompareUI();
    requestAnimationFrame(() => this._positionCompareUI());
  },

  // Quick High/Low source toggle for the compare overlay: one button cycling Normal -> High -> Low
  // (mirrors _makeHLBtn for the main series). Rendered inside the compare control cluster.
  /** @param {BtnFactory} mk */
  _makeCompareHLBtn(mk) {
    const hl = mk('N', '', () => { this.cycleCompareHL(); this._updCmpHLBtn(); });
    const upd = () => {
      const m = this.compareHlMode, ln = this.settings.compare && this.settings.compare.line;
      hl.textContent = m === 'high' ? 'H' : m === 'low' ? 'L' : 'N';
      hl.style.color = ln ? (m === 'high' ? ln.highColor : m === 'low' ? ln.lowColor : '') : '';
      hl.style.fontWeight = m ? '700' : '';
      hl.title = 'Source: ' + (m === 'high' ? 'High' : m === 'low' ? 'Low' : 'Normal') + ' — click to cycle';
    };
    this._updCmpHLBtn = upd;   // so the dialog setters (which reset the mode) can refresh the label
    upd();
    return hl;
  },
  // sub-pane controls, docked at its top-right by the price scale:
  // move up/down / H/L toggle / maximize / collapse / chart-type / remove.
  _buildCompareUI() {
    this._destroyCompareUI();
    const cmp = this.compare; if (!cmp) return;
    const ctrls = document.createElement('div'); ctrls.className = 'pane-compare-ctrls';
    const mk = (/** @type {string} */ txt, /** @type {string} */ title, /** @type {() => void} */ fn) => { const b = document.createElement('button'); b.textContent = txt; b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
    const up = mk('↑', 'Move pane up', () => this._moveComparePane(-1));
    const dn = mk('↓', 'Move pane down', () => this._moveComparePane(1));
    this._cmpMaxBtn = mk('⤢', 'Maximize pane', () => this._setPaneMode(this.compareMode === 'max' ? 'normal' : 'max'));
    this._cmpCollapseBtn = mk('⌄', 'Collapse pane', () => this._setPaneMode(this.compareMode === 'collapsed' ? 'normal' : 'collapsed'));
    const cfg = mk('⚙', 'Chart type (candles / line)', () => bus.emit('charttype:open', this.compareChartTypeTarget()));
    ctrls.append(this._makeCompareHLBtn(mk), up, dn, this._cmpMaxBtn, this._cmpCollapseBtn, cfg, mk('🗑', 'Remove comparison', () => this.removeCompare()));
    this.el.append(ctrls);
    this.compareUI = { ctrls };
    this._positionCompareUI();
    this._cmpReposition = () => { if (this._cmpRaf) return; this._cmpRaf = requestAnimationFrame(() => { this._cmpRaf = 0; this._positionCompareUI(); }); };
    this.el.addEventListener('pointermove', this._cmpReposition);   // keep glued while dragging the separator
    try { this._cmpRO = new ResizeObserver(this._cmpReposition); this._cmpRO.observe(this.el); } catch (_) {}
    requestAnimationFrame(() => this._positionCompareUI());          // after layout settles
  },
  _destroyCompareUI() {
    if (this._cmpRO) { try { this._cmpRO.disconnect(); } catch (_) {} this._cmpRO = null; }
    if (this._cmpReposition) { this.el.removeEventListener('pointermove', this._cmpReposition); this._cmpReposition = null; }
    if (this.compareUI) { this.compareUI.ctrls.remove(); this.compareUI = null; }
    this._updCmpHLBtn = null;
  },
  _positionCompareUI() {
    const ui = this.compareUI; if (!ui) return;
    let topH = 0, psw = 0;
    try { topH = this.paneTopOf(this.compare && this.compare.series); } catch (_) {}
    try { psw = this.chart.priceAxis('right').width(); } catch (_) {}
    ui.ctrls.style.top = (topH + 4) + 'px';
    ui.ctrls.style.right = (psw + 6) + 'px';
  },

  // pane height modes: normal | collapsed (thin bar, candles off) | max. Order-independent
  // (shared applyPaneMode), so it no longer assumes the compare pane is index 1.
  /** @param {string} mode */
  _setPaneMode(mode) {
    const cmp = this.compare; if (!cmp || !cmp.series) return;
    this._cmpState = this._cmpState || {};
    this.applyPaneMode(cmp.series, mode, this._cmpState);
    const visible = mode !== 'collapsed' && !cmp.hidden;
    try { cmp.series.configure({ visible }); } catch (_) {}
    if (cmp.lineSeries) { try { cmp.lineSeries.configure({ visible }); } catch (_) {} }
    // collapse -> keep the (now-invisible) pane as an empty bar; otherwise let it size normally
    try { const p = this.chart.panes()[this.paneIndexOf(cmp.series)]; if (p && p.setPreserveEmptyPane) p.setPreserveEmptyPane(mode === 'collapsed' && !cmp.hidden); } catch (_) {}
    if (this.compareDrawings) this.compareDrawings.setSuppressed(!visible);
    this.compareMode = mode;
    if (this._cmpCollapseBtn) { const c = mode === 'collapsed'; this._cmpCollapseBtn.textContent = c ? '⌃' : '⌄'; this._cmpCollapseBtn.title = c ? 'Expand pane' : 'Collapse pane'; }
    if (this._cmpMaxBtn) this._cmpMaxBtn.title = mode === 'max' ? 'Restore pane' : 'Maximize pane';
    this._positionCompareUI();
    requestAnimationFrame(() => this._positionCompareUI());   // after the heights settle
  },
};
