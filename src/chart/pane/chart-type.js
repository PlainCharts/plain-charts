// @ts-check
// Main-series chart type + line overlay for a Pane: the candlestick series is always present (it owns
// the index axis + price range); a "line" chart hides the candles and draws a Line reading one value
// per bar from a price source. Also the quick High/Low source toggle (hlMode -> an effective Line view
// without touching settings), the dialog setters, the shared chart-type dialog target factory
// (_ctTarget, also used by the compare mixin) and the H/L toggle button. Split out of pane.js as a
// prototype mixin -- these methods run with `this` bound to the Pane instance.
import { bus } from '../../bus.js';
import { Line } from '../../../lib/kapelka/index.js';
import { PRICE_SOURCES, dashToStroke } from '../pane-defaults.js';

// hlMode: quick source override -- 'high' | 'low' | null (null = use settings).
/** @typedef {'high'|'low'|null} HLMode */

// Per-series line settings (settings.line OR settings.compare.line). App-side structured config.
/**
 * @typedef {Object} LineSettings
 * @property {string} source
 * @property {string} color
 * @property {number} lineWidth
 * @property {string} lineStyle
 * @property {string} highColor
 * @property {string} lowColor
 */

// The Pane instance these mixin methods run against (`this`). Engine handles (chart/series/lineSeries)
// are the kapelka `any` boundary; app-side structured state (settings, hlMode, board) gets real types.
/**
 * @typedef {Object} Pane
 * @property {HLMode} hlMode
 * @property {{ chartType: string, pricePane?: boolean, line: LineSettings, compare?: { line: LineSettings } }} settings
 * @property {any} chart
 * @property {any} series
 * @property {any} lineSeries
 * @property {any} board
 * @property {Array<{ time: number, open: number, high: number, low: number, close: number }>} barArr
 * @property {(() => void)=} _updHLBtn
 * @property {() => void} applyCandles
 * @property {() => string} _effChartType
 * @property {() => string} _effSource
 * @property {() => string} _effColor
 * @property {() => ((b: any) => number)} _priceSource
 * @property {() => object} _lineOpts
 * @property {() => void} _feedLine
 * @property {() => void} applyChartType
 * @property {() => HLMode} cycleHL
 * @property {(t: string) => void} setChartType
 * @property {(s: string) => void} setLineSource
 * @property {(patch: Partial<LineSettings>) => void} setLineStyle
 * @property {(cfg: CtTargetConfig) => object} _ctTarget
 * @property {() => object} chartTypeTarget
 * @property {() => HTMLButtonElement} _makeHLBtn
 */

// Config passed to _ctTarget(): the getters/setters that wire a chart-type dialog to one series.
/**
 * @typedef {Object} CtTargetConfig
 * @property {string} title
 * @property {() => LineSettings} ln
 * @property {() => string} getType
 * @property {(t: string) => void} setType
 * @property {(s: string) => void} setSource
 * @property {(patch: Partial<LineSettings>) => void} setStyle
 * @property {((which: string) => void)=} reColor
 */

/** @type {ThisType<Pane> & Record<string, Function>} */
export const chartTypeMethods = {
  // Effective (display-override) getters: hlMode ('high'|'low'|null) forces a Line view with the
  // High/Low source + colour WITHOUT touching settings, so a toggle reopens on the base (Normal) view.
  // The renderer reads these "effective" values. null = whatever the pane is actually set to.
  _effChartType() { return this.hlMode ? 'line' : this.settings.chartType; },
  _effSource() { return this.hlMode || this.settings.line.source; },   // hlMode is 'high' | 'low'
  _effColor() { const ln = this.settings.line; return this.hlMode === 'high' ? ln.highColor : this.hlMode === 'low' ? ln.lowColor : ln.color; },
  _priceSource() { return PRICE_SOURCES[this._effSource()] || PRICE_SOURCES.close; },
  _lineOpts() {
    const ln = this.settings.line;
    return { color: this._effColor(), lineWidth: ln.lineWidth, lineStyle: dashToStroke(ln.lineStyle),
             showPriceLine: false, showLastValue: false };
  },
  _feedLine() {
    if (!this.lineSeries) return;
    const src = this._priceSource();
    this.lineSeries.feed(this.barArr.map((b) => ({ time: b.time, value: src(b) })));
  },
  applyChartType() {
    if (this.board && !this.settings.pricePane) return;   // a study board pane has no candle series
    if (this._effChartType() === 'line') {
      // hide the candles (kept as the axis + OHLC source), show the line overlay
      this.series.configure({ upColor: 'rgba(0,0,0,0)', downColor: 'rgba(0,0,0,0)', showBorder: false, showWick: false });
      if (!this.lineSeries) this.lineSeries = this.chart.addPlot(Line, this._lineOpts(), 0);
      else this.lineSeries.configure(this._lineOpts());
      this._feedLine();
    } else {
      if (this.lineSeries) { try { this.chart.removePlot(this.lineSeries); } catch (_) {} this.lineSeries = null; }
      this.applyCandles();   // restore candle appearance
    }
  },
  // Cycle the quick source toggle: Normal -> High -> Low -> Normal. High/Low force a Line view with the
  // High/Low source + its colour, WITHOUT changing settings (so Normal restores the exact base view).
  // Returns the new mode for the button label.
  cycleHL() {
    this.hlMode = this.hlMode == null ? 'high' : this.hlMode === 'high' ? 'low' : null;
    this.applyChartType();   // re-render with the effective type/source/colour
    return this.hlMode;
  },
  // dialog setters (apply live + persist via the workspace)
  /** @param {string} t */
  setChartType(t) { this.hlMode = null; this.settings.chartType = (t === 'line') ? 'line' : 'candles'; this.applyChartType(); if (this._updHLBtn) this._updHLBtn(); bus.emit('pane:changed'); },
  /** @param {string} s */
  setLineSource(s) { this.hlMode = null; this.settings.line.source = s; this._feedLine(); if (this._updHLBtn) this._updHLBtn(); bus.emit('pane:changed'); },
  /** @param {Partial<LineSettings>} patch */
  setLineStyle(patch) { Object.assign(this.settings.line, patch); if (this.lineSeries) this.lineSeries.configure(this._lineOpts()); bus.emit('pane:changed'); },

  // ONE chart-type dialog target factory. Both the pane's PRIMARY series and the "+ compare" overlay
  // build their target from this, so the (shared) dialog has ONE feature set -- previously these were
  // two hand-rolled targets, so a feature (e.g. the High/Low colours) landed in only one of them.
  //   ln       = () => the line-settings object (settings.line OR settings.compare.line)
  //   getType/setType, setSource, setStyle = the type/source/style setters for this series
  //   reColor(which) = re-render if the High/Low toggle is currently on that source (live colour edit)
  /** @param {CtTargetConfig} cfg */
  _ctTarget({ title, ln, getType, setType, setSource, setStyle, reColor }) {
    return {
      title,
      getType, setType,
      getSource: () => ln().source, setSource,
      line: {
        color: { get: () => ln().color, set: (/** @type {string} */ v) => setStyle({ color: v }) },
        width: { get: () => ln().lineWidth, set: (/** @type {number} */ v) => setStyle({ lineWidth: v }) },
        lineStyle: { get: () => ln().lineStyle, set: (/** @type {string} */ v) => setStyle({ lineStyle: v }) },
      },
      hl: {
        high: { get: () => ln().highColor, set: (/** @type {string} */ v) => { ln().highColor = v; if (reColor) reColor('high'); bus.emit('pane:changed'); } },
        low: { get: () => ln().lowColor, set: (/** @type {string} */ v) => { ln().lowColor = v; if (reColor) reColor('low'); bus.emit('pane:changed'); } },
      },
    };
  },
  // chart-type dialog target for THIS pane's main series
  chartTypeTarget() {
    const p = this;
    return p._ctTarget({
      title: 'Chart type',
      ln: () => p.settings.line,
      getType: () => p.settings.chartType, setType: (t) => p.setChartType(t),
      setSource: (s) => p.setLineSource(s),
      setStyle: (patch) => p.setLineStyle(patch),
      reColor: (which) => { if (p.hlMode === which) p.applyChartType(); },
    });
  },

  // The quick High/Low source toggle button: one button cycling Normal -> High -> Low. Shared by the
  // compare-pane control cluster and the main-chart cluster.
  _makeHLBtn() {
    const hl = document.createElement('button'); hl.className = 'skin-ctrl';
    const upd = () => {
      const m = this.hlMode, ln = this.settings.line;
      hl.textContent = m === 'high' ? 'H' : m === 'low' ? 'L' : 'N';
      hl.style.color = m === 'high' ? ln.highColor : m === 'low' ? ln.lowColor : '';
      hl.style.fontWeight = m ? '700' : '';
      hl.title = 'Source: ' + (m === 'high' ? 'High' : m === 'low' ? 'Low' : 'Normal') + ' — click to cycle';
    };
    hl.onclick = (e) => { e.stopPropagation(); this.cycleHL(); upd(); };
    this._updHLBtn = upd;   // so setChartType/setLineSource (which reset the mode) can refresh the label
    upd();
    return hl;
  },
};
