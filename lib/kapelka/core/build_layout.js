// @ts-check
// Phase 3+4 wiring — drive trading-vue's faithful Layout/GridMaker from plain engine state
// (no Vue). Replicates Chart.vue's pipeline: detect interval -> slice sub -> build ti_map ->
// new Layout(ctx). Returns { layout, sub, interval } where layout.grids[0] carries:
//   candles (screen coords) · ys [y,label] price ticks · xs [x,[t],rank] time ticks · A,B,sb,t2screen,$2screen
import Layout from './components/js/layout.js';
import TI from './components/js/ti_mapping.js';
import Context from './stuff/context.js';
import Const from './stuff/constants.js';
import Utils from './stuff/utils.js';

const DEFAULT_FONT = '11px -apple-system, BlinkMacSystemFont, Arial, sans-serif';

// rows: ohlcv as [t_ms, o, h, l, c, v] sorted ascending; range: [t0_ms, t1_ms]
// yTransforms: per-grid Y-scale map { gridIndex: { auto:false, range:[hi,lo] } } (absent = auto-fit)
// offcharts: [{ rows:[[t_ms, v, ...]], grid:{height?,logScale?} }] -> stacked offchart panes (grids[1..N])
// ib: index-based mode (non-linear time axis — collapses weekend/overnight gaps). range is in
// INDEX units; the layout consumes the index-mapped sub (ti_map.sub_i).
/** @param {import('./types.js').BuildLayoutOptions} opts */
export function buildLayout({ rows, range, width, height, colors, font, timezone, yTransforms, layersMeta, offcharts, future, logScale, scaleMode, scaleMargins, ib, mainGridHeight, hidePrice, hideTime, candleWidth, labelGap, minMove, tickPrec }) {
  // hidden scales reclaim their space: force sidebar width -> 0 (SBMIN/SBMAX=0) and/or botbar -> 0.
  // candleWidth overrides CANDLEW; labelGap overrides MIN_LABEL_PX. Copy ChartConfig so we never
  // mutate the shared Const.ChartConfig.
  let config = Const.ChartConfig;
  if (hidePrice || hideTime || (candleWidth > 0) || (labelGap > 0 && labelGap !== config.MIN_LABEL_PX)) {
    config = { ...Const.ChartConfig };
    if (hidePrice) { config.SBMIN = 0; config.SBMAX = 0; }
    if (hideTime) config.BOTBAR = 0;
    if (candleWidth > 0) config.CANDLEW = candleWidth;
    if (labelGap > 0) config.MIN_LABEL_PX = labelGap;
  }
  const $props = {
    width, height, timezone: timezone || 0,
    font: font || DEFAULT_FONT,
    colors: colors || {},
    config,   // CANDLEW/BOTBAR/EXPAND/VOLSCALE/GRIDX/... (NOT the time-consts Const)
    ib: !!ib,
  };

  const interval = Utils.detect_interval(rows) || 60000;   // real-bar cadence (future whitespace excluded)
  const ti_map = new TI();

  // Future whitespace rows (app-supplied): [t, null, null, null, null, null] -- a time-axis slot with no
  // OHLC, following the session (weekend-skipped). Appended to the INDEXED stream ONLY (ib mode). The past
  // collapses weekends by having no bars there; the future now does the SAME by having whitespace bars, so
  // i2t/t2i resolve future indices by lookup instead of linear-extrapolating real clock time (which drags
  // the weekend back in). App-supplied whitespace bars are indexed alongside the real ones. The real-bar `rows`
  // array is left untouched, so last-price / legend / current-price-line reads stay correct.
  const indexRows = (ib && future && future.length) ? rows.concat(future) : rows;

  // main visible subset: time-filter (regular) or array index-slice (ib / index-based mode)
  let sub, sub_start;
  if (ib) {
    sub_start = Math.max(0, Math.floor(range[0]) - 1);
    sub = indexRows.slice(sub_start, Math.min(indexRows.length, Math.ceil(range[1]) + 2));
  } else {
    [sub, sub_start] = Utils.fast_filter(rows, range[0] - interval, range[1]);
    sub = sub || []; sub_start = sub_start || 0;
  }

  // offchart panes: slice each to the visible TIME window (t2screen auto-converts in ib mode)
  const tw0 = sub.length ? sub[0][0] : range[0];
  const tw1 = sub.length ? sub[sub.length - 1][0] : range[1];
  const offsub = [], offsubs = [];
  for (const oc of (offcharts || [])) {
    const [d] = Utils.fast_filter(oc.rows || [], tw0 - interval, tw1 + interval);
    const data = d || [];
    offsub.push({ data, grid: oc.grid || {} });
    offsubs.push(data);
  }

  // the "component" surrogate Layout + the render classes read off
  const ctx = {
    chart: { grid: { logScale: !!logScale, scaleMode: scaleMode || 0, height: mainGridHeight,
      // scaleMargins on the MAIN price scale (undefined -> full height, keeps default EXPAND padding)
      marginTop: scaleMargins ? (scaleMargins.top || 0) : undefined, marginBottom: scaleMargins ? (scaleMargins.bottom || 0) : undefined,
      minMove, tickPrec } },   // instrument tick grid -> price labels on the main scale quantize to it
    ohlcv: rows,
    sub,
    offsub,                          // offchart panes -> grids[1..N]
    // ib mode: range is in INDEX units, so the layout's bar-step interval is 1 (each bar = 1 index).
    // Using the real ms interval here makes capacity microscopic -> px_step explodes -> giant candles.
    interval: ib ? 1 : interval, interval_ms: interval,
    range,
    ctx: Context($props),            // headless canvas ctx for text measurement (sidebar width)
    layers_meta: layersMeta || {},   // per-grid-position { layerId: { y_range } } — shapes auto-fit
    ti_map,
    y_transforms: yTransforms || {},   // per-grid Y zoom/shift (absent = auto-fit)
    meta: { sub_start },
    sub_start,
    ib: !!ib,
    $props,
  };

  ti_map.init(ctx, sub);             // ib: builds ti_map/it_map + sub_i (index-mapped rows); else no-op
  if (ib) ctx.sub = /** @type {any} */ (ti_map.sub_i);    // layout uses the INDEX-based sub (grid_x/candles are range-relative)
  const layout = new (/** @type {any} */ (Layout))(ctx);    // -> { grids:[main, ...offchart], botbar:{...} }  (Layout typed in a later phase)
  return { layout, sub: ctx.sub, interval, offsubs };
}
