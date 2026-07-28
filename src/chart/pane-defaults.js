// @ts-check
// Appearance defaults + option builders for a pane (pure data + pure functions, lifted out of
// pane.js). The *_DEFAULT objects seed pane.settings and back the chart templates; the *Options
// builders translate those settings into the engine's configure() shape. No pane state.

// Stroke enum: 0 Solid, 1 Dotted, 2 Dashed, 3 LongDash.
/** @type {Record<string, number>} */
const DASH_STROKE = { solid: 0, dotted: 1, dashed: 2, 'large dashed': 3 };
/** @param {string} name */
export const dashToStroke = (name) => (DASH_STROKE[name] != null ? DASH_STROKE[name] : 1);

// candle appearance defaults (overridable per pane / via templates)
/**
 * @typedef {Object} CandleSettings
 * @property {boolean} bodyVisible
 * @property {string} upColor
 * @property {string} downColor
 * @property {boolean} borderVisible
 * @property {string} borderUpColor
 * @property {string} borderDownColor
 * @property {boolean} wickVisible
 * @property {string} wickUpColor
 * @property {string} wickDownColor
 */
export const CANDLES_DEFAULT = {
  bodyVisible: true, upColor: '#26a69a', downColor: '#ef5350',
  borderVisible: false, borderUpColor: '#26a69a', borderDownColor: '#ef5350',
  wickVisible: true, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
};
/** @param {CandleSettings} c */
export const candleOptions = (c) => ({
  upColor: c.bodyVisible ? c.upColor : 'rgba(0,0,0,0)',
  downColor: c.bodyVisible ? c.downColor : 'rgba(0,0,0,0)',
  showBorder: c.borderVisible, borderUpColor: c.borderUpColor, borderDownColor: c.borderDownColor,
  showWick: c.wickVisible, wickUpColor: c.wickUpColor, wickDownColor: c.wickDownColor,
});

// Chart type. The candlestick series is ALWAYS present (it owns the index axis + price
// range); a "line" chart hides the candles and draws a Line overlay that reads one value
// per bar from a price source. Adding Area/Bars later = another entry here.
export const LINE_STYLE_DEFAULT = { source: 'close', color: '#2962ff', lineWidth: 2, lineStyle: 'solid',
  highColor: '#26a69a', lowColor: '#ef5350' };   // quick High/Low line-source toggle colours (compare panes)
/**
 * @typedef {{ open: number, high: number, low: number, close: number }} OhlcBar
 * @type {Record<string, (b: OhlcBar) => number>}
 */
export const PRICE_SOURCES = {
  open:  (b) => b.open,
  high:  (b) => b.high,
  low:   (b) => b.low,
  close: (b) => b.close,
  hl2:   (b) => (b.high + b.low) / 2,
  hlc3:  (b) => (b.high + b.low + b.close) / 3,
  ohlc4: (b) => (b.open + b.high + b.low + b.close) / 4,
};
// [value, label] pairs for the chart-type dialog's Price source dropdown.
/** @type {Array<[string, string]>} */
export const PRICE_SOURCE_OPTIONS = [
  ['open', 'Open'], ['high', 'High'], ['low', 'Low'], ['close', 'Close'],
  ['hl2', '(H + L) / 2'], ['hlc3', '(H + L + C) / 3'], ['ohlc4', '(O + H + L + C) / 4'],
];

// canvas appearance: background, grid lines, crosshair
export const CANVAS_DEFAULT = {
  background: '#0e0e11',
  gridMode: 'both', gridColor: '#1a1a20', gridStyle: 0,  // both|vert|horz|none ; one color, style 0..4 (no width — the engine's grid is 1px)
  crosshairColor: '#9598a1', crosshairOpacity: 100, crosshairWidth: 1, crosshairStyle: 2,
  crosshairTimeLabel: true, crosshairPriceLabel: true,   // axis labels under the crosshair (each toggled separately)
  crosshairLabelBg: '#9598a1',   // background color of the crosshair's axis labels (time + price)
  scaleTextColor: '#dddddd', scaleFontSize: 12, scaleFontFamily: '',   // '' = default font stack
  scaleLineColor: '#333333', scaleLineOpacity: 100,
  navButtons: 'hover',   // hover | always | never
  paneButtons: 'hover',  // sub-pane / compare control rows: hover | always | never
  marginTop: 10, marginBottom: 10, marginRight: 10,   // price %, price %, bars
  shiftEnd: true,        // shift end of chart from right border: on -> keep marginRight gap; off -> flush
  autoScroll: true,      // auto-scroll: on -> follow the latest bar as new bars arrive; off -> stay put
  maxZoom: 700,          // horizontal zoom-out limit: most bars on screen before it stops (over-compression)
  maxVZoom: 3,           // vertical zoom-out limit: visible price span <= N x the visible data range
  candleWidthPct: 70,    // candle body width as % of the bar slot (CANDLEW 0.7)
};

// Status-line ("Status line" tab) defaults.
export const STATUS_DEFAULT = {
  title: true, chartValues: false, color: '', fontSize: 13,   // color '' = follow the theme's Text
  bgColor: '#0e0e11', bgOpacity: 70,
  // market-status dot (far right of the status line): open / maintenance / closed, from the broker's
  // trading hours. marketColors are user-overridable (Settings > Status line).
  marketStatus: true,
  marketColors: { open: '#26a69a', maintenance: '#f0b90b', closed: '#ef5350' },
};

// Indicator legend (kapelka/skin) display: which parts of each study's readout show, plus the
// underlay box that makes the legend a solid pointer target. bgColor follows the chart background
// ("same color as background"), so only the on/off + opacity are stored here.
export const INDICATORS_DEFAULT = {
  title: true, inputs: true, values: true, bg: true, bgOpacity: 60,
};

// Executed trades on the chart (Trading section): buy fills draw an up-arrow, sell fills a
// down-arrow, at the execution price. Off by default; needs a broker that reports fills.
export const TRADES_DEFAULT = {
  visible: false,
  buyColor: '#26a69a',   // buy tick / dot
  sellColor: '#ef5350',  // sell tick / dot
  thickness: 2,          // tick line thickness (px) / dot base size
  style: 'dot',          // 'dot' = a ball on the candle's centre axis at the fill price, 'tick' = bar-wide line
  // ORDER PROJECTION (the pre-trade string): where the gray dot + bracket seed sit before an order exists.
  // projBars = how far RIGHT the string hangs, in bars (horizontal, instrument-agnostic).
  // projHeightPct = the seeded stop/target distance as a percent of the VISIBLE chart height -- a screen-relative
  // measure, so one number is sane on every instrument (MES, BTC, EURUSD...) with no price-unit mess. Frozen to a
  // price the moment the projection is placed (then draggable); it does not ride the screen afterwards.
  projBars: 5,
  projHeightPct: 20,
  // PER-CHART visibility of the on-chart position/order display (entry + stop/limit dots + the pre-trade plan):
  // turn it off on charts where you don't want the clutter.
  // Purely a DISPLAY gate for this pane -- it never touches the book, orders, or any other chart.
  showOrders: true,
};

// pick a readable (dark/light) text colour for a given background, by luminance
/** @param {string} bg @returns {string} */
export function readableText(bg) {
  /** @type {number} */ let r; /** @type {number} */ let g; /** @type {number} */ let b;
  const h = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(bg || '');
  if (h) { r = parseInt(h[1], 16); g = parseInt(h[2], 16); b = parseInt(h[3], 16); }
  else { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg || ''); if (!m) return '#e8e8e8'; r = +m[1]; g = +m[2]; b = +m[3]; }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#131722' : '#e8e8e8';
}

// Flat line/scale appearance keys ("Scales and lines" tab). These live directly on
// pane.settings (applied live via setLineSetting), NOT inside candles/canvas/statusLine.
// Exported so chart templates can capture and restore them too.
export const LINE_DEFAULTS = {
  priceLine: true, bidLine: false, askLine: false,
  lastPriceLabel: true, bidLabel: true, askLabel: true, priceTags: true, countdown: false,
  noOverlapLabels: true,   // push price-axis labels apart so they don't overlap (lines stay put)
  countdownColor: '#e8e8e8', countdownBg: '#363a45',   // font / background of the countdown box
  // spread meter: live ask-bid shown on the price scale, above the countdown. Normal color,
  // plus a max color the label turns when the spread reaches spreadMax (price units; 0 = never).
  spreadMeter: false, spreadColor: '#363a45', spreadMax: 0, spreadMaxColor: '#ef5350',
  // time-axis label formatting. tsDayOfWeek = weekday on the crosshair date label;
  // tsDowAxis = weekday on the time-scale axis ticks (independent of each other).
  tsDayOfWeek: false, tsDowAxis: false, tsDateFmt: '%b %-d', tsHours24: true,
  tsLabelGap: 48,   // min px between two time-axis labels before one is dropped (engine MIN_LABEL_PX)
  scaleLeft: false, priceScale: true, timeScale: true,
  // price scale mode: 0 Regular, 2 Percent, 3 Indexed to 100, 1 Logarithmic (PriceMode)
  priceScaleMode: 0,
  invertScale: false,   // flip the price scale (the engine's native invertScale)
  plusButton: false,   // hover "+" on the price-scale edge (left-click action / right-click menu)
  plusDefaultAction: 'hline',   // which action the +'s left click runs
  // per-line stroke (colour / width / dash) for the price, bid and ask lines
  priceLineColor: '#787b86', priceLineWidth: 1, priceLineDash: 'dotted',
  bidLineColor: '#26a69a', bidLineWidth: 1, bidLineDash: 'dotted',
  askLineColor: '#ef5350', askLineWidth: 1, askLineDash: 'dotted',
  // price-alert line appearance (the visual alert lines) + the price-scale label toggle
  alertColor: '#f5a623', alertWidth: 1, alertDash: 'dashed', alertLabel: true,
};
export const LINE_KEYS = Object.keys(LINE_DEFAULTS);

// the chart's default text font (the engine's default), used when no custom scale font is chosen
export const SCALE_FONT_DEFAULT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
/** @param {typeof CANVAS_DEFAULT} c */
export const canvasOptions = (c) => {
  // Opacity now rides inside the colour (rgba from the picker); a bare hex is fully opaque.
  // The legacy *Opacity fields are retired and intentionally ignored.
  const cross = c.crosshairColor || '#888888';
  const lineCol = c.scaleLineColor || '#cccccc';
  return {
    layout: { background: { color: c.background }, textColor: c.scaleTextColor, fontSize: c.scaleFontSize, fontFamily: c.scaleFontFamily || SCALE_FONT_DEFAULT },
    grid: {
      vertLines: { visible: c.gridMode === 'both' || c.gridMode === 'vert', color: c.gridColor, style: c.gridStyle || 0 },
      horzLines: { visible: c.gridMode === 'both' || c.gridMode === 'horz', color: c.gridColor, style: c.gridStyle || 0 },
    },
    cursor: {
      // vertLine label rides the time axis; horzLine label rides the price axis
      vertLine: { color: cross, width: c.crosshairWidth, style: c.crosshairStyle, showLabel: c.crosshairTimeLabel !== false, labelBg: c.crosshairLabelBg || cross },
      horzLine: { color: cross, width: c.crosshairWidth, style: c.crosshairStyle, showLabel: c.crosshairPriceLabel !== false, labelBg: c.crosshairLabelBg || cross },
    },
    leftPriceAxis: { borderColor: lineCol, margins: { top: c.marginTop / 100, bottom: c.marginBottom / 100 } },
    rightPriceAxis: { borderColor: lineCol, margins: { top: c.marginTop / 100, bottom: c.marginBottom / 100 } },
    timeAxis: { borderColor: lineCol, rightOffset: (c.shiftEnd !== false ? c.marginRight : 0), followNewBars: c.autoScroll !== false },   // shift toggle + auto-scroll on new bar
    maxZoom: c.maxZoom,                        // horizontal zoom-out limit (bars on screen)
    maxVZoom: c.maxVZoom,                      // vertical zoom-out limit (x the visible data range)
    candleWidth: (c.candleWidthPct || 70) / 100,   // CANDLEW: body width as fraction of the bar slot
  };
};
