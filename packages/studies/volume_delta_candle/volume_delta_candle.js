// @ts-check
// Volume Delta rendered as a single zero-anchored bar on the aggressor's side, pinned to the bottom
// overlay band (priceScaleId + scaleMargins), like regular volume.
//
// Each bar scans its LOWER-TIMEFRAME sub-bars and sums buy volume (up sub-bars) and sell volume
// (down sub-bars). The winning (aggressor) side sets the bar; the full height is the AGGRESSOR TOTAL
// and it splits at the net-delta line:
//     solid  0 -> |net|              what actually survived (net delta)
//     hollow |net| -> aggressorTotal the opposing side that was absorbed (= min(up,down))
// solid + hollow = max(up,down) = aggressor total. Colored teal when buyers won, red when sellers
// won. This is the "up/down delta on the aggressor candle" reading: total push (full height), net
// (solid), and absorbed counter-flow (hollow) in one bar -- and unlike a running-delta wick it uses
// the true up/down sums, so the hollow is the real opposing volume, not a path-dependent excursion.
Studies.register({
  id: 'volume_delta_candle',
  overlay: true,        // draws on the price pane, pinned to the bottom band (its own overlay scale)
  intrabar: true,       // needs lower-timeframe sub-bars for real up/down volume
  requires: { bars: true, intrabars: true },
  inputs: [
    { key: 'height', type: 'number', name: 'Height %', default: 25, min: 5, max: 60, legend: false },
    { key: 'upColor', type: 'color', name: 'Buy color', default: 'rgba(38,166,154,0.9)', legend: false },
    { key: 'downColor', type: 'color', name: 'Sell color', default: 'rgba(239,83,80,0.9)', legend: false },
  ],
  /**
   * @param {StudyBar[]} bars
   * @param {Record<string, any>} p
   * @param {Record<string, any>} [ctx]
   * @returns {StudyResult}
   */
  calc(bars, p, ctx) {
    const subs = (/** @type {Record<string, any>} */ (ctx)).intrabar || [];
    const up = p.upColor || 'rgba(38,166,154,0.9)';
    const down = p.downColor || 'rgba(239,83,80,0.9)';
    /** @type {StudyPlotPoint[]} */
    const data = [];
    bars.forEach((b, i) => {
      const sb = subs[i];
      // true up/down sums across the sub-bars (order-independent, unlike a running excursion)
      let upVol = 0, dnVol = 0;
      if (sb && sb.length) {
        for (const s of sb) {
          const buy = (s.open != null && s.close != null) ? s.close >= s.open : true;
          if (buy) upVol += s.volume || 0; else dnVol += s.volume || 0;
        }
      } else {
        // no sub-bars yet (forming / most-recent bars — intrabar fetch lags): approximate from the
        // chart bar's own direction so it still renders live, then it refines once sub-bars land.
        const vol = b.volume || 0; if (!vol) return;
        if (b.close != null && b.open != null ? b.close >= b.open : true) upVol = vol; else dnVol = vol;
      }
      const aggregate = Math.max(upVol, dnVol);   // aggressor total = full bar height
      const net = Math.abs(upVol - dnVol);        // net delta = solid part; opposing = aggregate - net
      const col = upVol >= dnVol ? up : down;      // aggressor side
      data.push({
        time: b.time,
        value: upVol - dnVol,
        segments: [
          { from: 0, to: net, color: col },                        // solid: net delta (survived)
          { from: net, to: aggregate, color: col, fill: false },   // hollow: absorbed opposing volume
        ],
      });
    });
    // bottom band: the study occupies the lower `height`% of the pane, on its own overlay scale.
    const top = Math.min(0.95, Math.max(0.4, 1 - (p.height || 25) / 100));
    return {
      plots: [{
        key: 'vd', name: 'Vol Δ', type: 'segmented', precision: 0, legend: false,
        priceScaleId: 'voldelta', scaleMargins: { top, bottom: 0 }, data,
      }],
    };
  },

  // ---- step form: the same bar, produced from the shared window's sub-bars (pure consumer) ----
  /** @param {Record<string, any>} p */
  init(p) {
    return {
      up: p.upColor || 'rgba(38,166,154,0.9)',
      down: p.downColor || 'rgba(239,83,80,0.9)',
      top: Math.min(0.95, Math.max(0.4, 1 - (p.height || 25) / 100)),
    };
  },
  /** @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  plots(p, ctx, s) {
    return [{
      key: 'vd', name: 'Vol Δ', type: 'segmented', precision: 0, legend: false,
      priceScaleId: 'voldelta', scaleMargins: { top: s.top, bottom: 0 },
    }];
  },
  /** @param {number} i @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  step(i, sh, p, ctx, s) {
    const sb = sh.sub && sh.sub[i];
    let upVol = 0, dnVol = 0;
    if (sb && sb.length) {
      for (const x of sb) { const buy = (x.open != null && x.close != null) ? x.close >= x.open : true; if (buy) upVol += x.volume || 0; else dnVol += x.volume || 0; }
    } else {
      // no sub-bars yet (forming / most-recent bars): approximate from the chart bar's own direction
      const vol = sh.volume[i] || 0; if (!vol) return null;   // matches calc's per-bar `return` (no point)
      if (sh.close[i] != null && sh.open[i] != null ? sh.close[i] >= sh.open[i] : true) upVol = vol; else dnVol = vol;
    }
    const aggregate = Math.max(upVol, dnVol);   // aggressor total = full bar height
    const net = Math.abs(upVol - dnVol);        // net delta = solid part; opposing = aggregate - net
    const col = upVol >= dnVol ? s.up : s.down;
    return { vd: { value: upVol - dnVol, segments: [
      { from: 0, to: net, color: col },
      { from: net, to: aggregate, color: col, fill: false },
    ] } };
  },
});
