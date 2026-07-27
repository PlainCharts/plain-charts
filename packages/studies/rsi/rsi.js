// @ts-check
// Relative Strength Index (Wilder). A non-overlay (oscillator) study: it renders in its
// own sub-pane below the chart, with overbought/oversold band lines at 70/30.
Studies.register({
  id: 'rsi',
  name: 'Relative Strength Index (RSI)',
  description: 'A momentum oscillator that measures the speed of price changes.',
  overlay: false,   // → own pane below the price chart
  requires: { bars: true },
  // line appearance lives on the Style tab — see the plot defaults below.
  inputs: [
    { key: 'length', name: 'Length', type: 'number', default: 14, min: 1, max: 5000 },
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
    { key: 'upper', name: 'Upper band', type: 'number', default: 70, min: 1, max: 100, legend: false },
    { key: 'lower', name: 'Lower band', type: 'number', default: 30, min: 0, max: 99, legend: false },
  ],
  calc(bars, p) {
    const len = Math.max(1, p.length | 0);
    const src = bars.map((b) => Studies.priceOf(b, p.source));
    const out = [];
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < bars.length; i++) {
      const ch = src[i] - src[i - 1];
      const gain = ch > 0 ? ch : 0, loss = ch < 0 ? -ch : 0;
      if (i <= len) {
        avgGain += gain; avgLoss += loss;
        if (i === len) {
          avgGain /= len; avgLoss /= len;
          const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
          out.push({ time: bars[i].time, value: 100 - 100 / (1 + rs) });
        }
      } else {
        avgGain = (avgGain * (len - 1) + gain) / len;
        avgLoss = (avgLoss * (len - 1) + loss) / len;
        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
        out.push({ time: bars[i].time, value: 100 - 100 / (1 + rs) });
      }
    }
    // constant band lines across the full range (overbought / oversold)
    /** @param {number} lvl */
    const band = (lvl) => bars.map((b) => ({ time: b.time, value: lvl }));
    return {
      plots: [
        { key: 'rsi', name: 'RSI', type: 'line', color: '#ec206e', lineWidth: 2, data: out },
        // constant overbought/oversold lines: drawn, but kept out of the value readout (legend:false)
        { key: 'upper', name: 'Upper band', type: 'line', color: '#787b86', lineWidth: 1, lineStyle: 2, legend: false, data: band(p.upper) },
        { key: 'lower', name: 'Lower band', type: 'line', color: '#787b86', lineWidth: 1, lineStyle: 2, legend: false, data: band(p.lower) },
      ],
      // shade the overbought/oversold envelope, and lock the pane to 0..100 so the scale
      // never drifts as you pan (the author's y_range, expressed declaratively).
      fills: [
        { top: 'upper', bottom: 'lower', color: 'rgba(120,123,134,0.07)' },
      ],
      scale: { min: 0, max: 100 },
    };
  },

  // ---- step form: Wilder's running averages advanced one bar at a time. The band lines are flat (the
  // level at every bar); the RSI line starts once the seed window fills, matching calc's i >= length gate. ----
  /** @param {Record<string, any>} p */
  init(p) { return { len: Math.max(1, p.length | 0), src: p.source, avgGain: 0, avgLoss: 0, /** @type {number | null} */ prevSrc: null }; },
  plots() {
    return [
      { key: 'rsi', name: 'RSI', type: 'line', color: '#ec206e', lineWidth: 2 },
      { key: 'upper', name: 'Upper band', type: 'line', color: '#787b86', lineWidth: 1, lineStyle: 2, legend: false },
      { key: 'lower', name: 'Lower band', type: 'line', color: '#787b86', lineWidth: 1, lineStyle: 2, legend: false },
    ];
  },
  fills() { return [{ top: 'upper', bottom: 'lower', color: 'rgba(120,123,134,0.07)' }]; },
  scale() { return { min: 0, max: 100 }; },
  /** @param {number} i @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  step(i, sh, p, ctx, s) {
    const price = Studies.priceOf({ open: sh.open[i], high: sh.high[i], low: sh.low[i], close: sh.close[i], volume: sh.volume[i] }, s.src);
    /** @type {Record<string, any>} */
    const row = { upper: { value: p.upper }, lower: { value: p.lower } };   // flat band lines at every bar (like calc's band())
    if (i === 0) { s.prevSrc = price; return row; }   // no change on the first bar; RSI has no value yet
    const ch = price - s.prevSrc; s.prevSrc = price;
    const gain = ch > 0 ? ch : 0, loss = ch < 0 ? -ch : 0;
    const len = s.len;
    if (i <= len) {
      s.avgGain += gain; s.avgLoss += loss;
      if (i === len) { s.avgGain /= len; s.avgLoss /= len; const rs = s.avgLoss === 0 ? Infinity : s.avgGain / s.avgLoss; row.rsi = { value: 100 - 100 / (1 + rs) }; }
    } else {
      s.avgGain = (s.avgGain * (len - 1) + gain) / len; s.avgLoss = (s.avgLoss * (len - 1) + loss) / len;
      const rs = s.avgLoss === 0 ? Infinity : s.avgGain / s.avgLoss; row.rsi = { value: 100 - 100 / (1 + rs) };
    }
    return row;
  },
});
