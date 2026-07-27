// @ts-check
// Volume - now just a study, not a baked-in engine feature. It renders as a histogram overlaid on
// the PRICE pane, pinned to the bottom via its own independent (invisible) overlay price scale
// (priceScaleId + scaleMargins). This is the general "overlay scale" capability - any study can use
// it, not just volume. Height and up/down colors are configurable like any indicator.
Studies.register({
  id: 'volume',
  overlay: true,        // draws on the price pane (not its own sub-pane)
  inputs: [
    { key: 'height', type: 'number', name: 'Height %', default: 20, min: 5, max: 60, legend: false },
    // match the chart's candle up/down colors instead of the custom ones below
    { key: 'chartColors', type: 'bool', name: 'Use chart colors', default: false },
    { key: 'upColor', type: 'color', name: 'Up color', default: 'rgba(38,166,154,0.5)', legend: false },
    { key: 'downColor', type: 'color', name: 'Down color', default: 'rgba(239,83,80,0.5)', legend: false },
  ],
  // reads only the chart bars (no sub-bars) -- for the data-flow dedup
  requires: { bars: true },
  /**
   * @param {StudyBar[]} bars
   * @param {Record<string, any>} p
   * @param {Record<string, any>} [ctx]
   * @returns {StudyResult}
   */
  calc(bars, p, ctx) {
    // when "Use chart colors" is on, take the app's bull/bear candle colors from ctx.candle
    const cc = (p.chartColors && ctx && ctx.candle) ? ctx.candle : null;
    const up = cc ? cc.up : (p.upColor || 'rgba(38,166,154,0.5)');
    const down = cc ? cc.down : (p.downColor || 'rgba(239,83,80,0.5)');
    const data = bars.map((b) => ({
      time: b.time,
      value: b.volume || 0,
      color: (b.close != null && b.open != null ? b.close >= b.open : true) ? up : down,
    }));
    // bottom band: the study occupies the lower `height`% of the pane, on its own scale.
    const top = Math.min(0.95, Math.max(0.4, 1 - (p.height || 20) / 100));
    return {
      plots: [{
        key: 'vol', name: 'Volume', type: 'histogram', precision: 0, legend: false,
        priceScaleId: 'volume', scaleMargins: { top, bottom: 0 }, data,
      }],
    };
  },

  // ---- step form: the same result, produced one bar at a time over the shared window (pure consumer) ----
  /** once per run: the constants calc computed up front. @param {Record<string, any>} p @param {Record<string, any>} [ctx] */
  init(p, ctx) {
    const cc = (p.chartColors && ctx && ctx.candle) ? ctx.candle : null;
    return {
      up: cc ? cc.up : (p.upColor || 'rgba(38,166,154,0.5)'),
      down: cc ? cc.down : (p.downColor || 'rgba(239,83,80,0.5)'),
      top: Math.min(0.95, Math.max(0.4, 1 - (p.height || 20) / 100)),
    };
  },
  /** once: declare the output plot (static meta, no data). @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  plots(p, ctx, s) {
    return [{
      key: 'vol', name: 'Volume', type: 'histogram', precision: 0, legend: false,
      priceScaleId: 'volume', scaleMargins: { top: s.top, bottom: 0 },
    }];
  },
  /** per bar: this bar's histogram value + color, read from the shared window.
   * @param {number} i @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  step(i, sh, p, ctx, s) {
    const upBar = (sh.close[i] != null && sh.open[i] != null) ? sh.close[i] >= sh.open[i] : true;
    return { vol: { value: sh.volume[i] || 0, color: upBar ? s.up : s.down } };
  },
});
