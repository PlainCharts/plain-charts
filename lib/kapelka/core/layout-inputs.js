// @ts-check
// Translators from chart state to buildLayout inputs. Each _rebuild input that needs assembling
// (rather than a straight property read) is built here, so the rebuild reads as one pipeline:
// assemble inputs -> buildLayout -> feed the comp -> refresh panes.

// manual Y windows keyed by grid POSITION (the layout indexes per grid). _y is keyed by pane
// ID; a hidden pane (not in _paneIds) is skipped — its window restores when it reappears.
/** @param {any} c the Chart hub @returns {Record<number, any>} */
export function yTransformsByPos(c) {
  /** @type {Record<number, any>} */
  const yTransforms = {};
  for (const k in c._y) { const y = c._y[k]; if (!y.auto && y.range) { const pos = c._paneIds.indexOf(+k); if (pos >= 0) yTransforms[pos] = { auto: false, range: y.range }; } }
  return yTransforms;
}

// per-pane auto-range shaping, keyed by grid POSITION as one layer carrying a y_range fn
// (grid_maker applies the first y_range it finds, auto mode only). Two inputs compose:
//   votes -- an attached primitive may report a price range to keep visible
//     (autoscaleInfo() -> { priceRange: { minValue, maxValue } } | null), and a price line
//     opts in with `autoscale: true`. Votes extend the data hi/lo FIRST, as if they were data.
//   scale provider -- the study `scale` fn then shapes/locks the result, so a pinned
//     oscillator range (RSI 0-100) stays pinned regardless of votes.
// A manual (dragged) scale ignores y_range entirely, votes included.
/** @param {any} c the Chart hub @returns {Record<number, any>} */
export function layersMetaByPos(c) {
  /** @type {Record<number, any>} */
  const layersMeta = {};
  for (let pos = 0; pos < c._paneIds.length; pos++) {
    const id = c._paneIds[pos];
    const sp = c._scaleProviders[id];
    const scaleFn = typeof sp === 'function' ? sp : null;
    /** @type {{ minValue: number, maxValue: number }[]} */
    const votes = [];
    for (const s of c._series) {
      if (s._pane !== id) continue;
      for (const prim of s._primitives) {
        if (typeof prim.autoscaleInfo !== 'function') continue;
        try {
          const a = prim.autoscaleInfo(); const r = a && a.priceRange;
          if (r && isFinite(r.minValue) && isFinite(r.maxValue)) votes.push(r);
        } catch (_) {}   // a misbehaving primitive must not break the scale
      }
      for (const pl of s._priceLines) { const o = pl._opts; if (o.autoscale && o.price != null && isFinite(o.price)) votes.push({ minValue: o.price, maxValue: o.price }); }
    }
    if (!scaleFn && !votes.length) continue;
    layersMeta[pos] = { scale: { y_range: (/** @type {number} */ hi, /** @type {number} */ lo) => {
      for (const v of votes) { if (v.maxValue > hi) hi = v.maxValue; if (v.minValue < lo) lo = v.minValue; }
      return scaleFn ? scaleFn(hi, lo) : [hi, lo];
    } } };
  }
  return layersMeta;
}

// offchart pane descriptors for buildLayout, one per _ocs entry (grids[1..N])
/** @param {any} c the Chart hub @returns {Array<{ rows: any[], grid: any }>} */
export function offchartDescriptors(c) {
  return c._ocs.map((/** @type {any} */ o) => {
    const id = o.paneIndex;   // pane ID (keys per-pane state, survives reorder/hide)
    const s0 = o.series[0];   // candle pane: drop volume so the y-range scan = [high, low], not volume
    const rows = s0._isCandle() ? s0._rows.map((/** @type {any[]} */ r) => [r[0], r[1], r[2], r[3], r[4]]) : s0._rows;
    return { rows, grid: { logScale: c._modeOf(id) === 1, scaleMode: c._modeOf(id), height: c._stretch[id] } };
  });
}
