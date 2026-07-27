// @ts-check
// Bollinger Bands. An overlay study that showcases the `fills` channel: a middle SMA with
// an upper/lower envelope at +/- k standard deviations, and a shaded band filling the region
// between the two envelope lines. The fill is declared, not drawn — calc() names the two plot
// keys to fill between and the host paints the polygon (see band-primitive.js).
Studies.register({
  id: 'bollinger',
  name: 'Bollinger Bands',
  description: 'A moving average with standard-deviation bands above and below.',
  overlay: true,
  requires: { bars: true },
  inputs: [
    { key: 'length', name: 'Length', type: 'number', default: 20, min: 1, max: 5000 },
    { key: 'mult', name: 'StdDev', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
  ],
  calc(bars, p) {
    const len = Math.max(1, p.length | 0);
    const k = p.mult || 2;
    const src = bars.map((b) => Studies.priceOf(b, p.source));
    const mid = [], up = [], lo = [];
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += src[i];
      if (i >= len) sum -= src[i - len];
      if (i >= len - 1) {
        const mean = sum / len;
        // population standard deviation over the window
        let v = 0;
        for (let j = i - len + 1; j <= i; j++) { const d = src[j] - mean; v += d * d; }
        const sd = Math.sqrt(v / len);
        const t = bars[i].time;
        mid.push({ time: t, value: mean });
        up.push({ time: t, value: mean + k * sd });
        lo.push({ time: t, value: mean - k * sd });
      }
    }
    return {
      plots: [
        { key: 'upper', name: 'Upper', type: 'line', color: '#2196f3', lineWidth: 1, data: up },
        { key: 'basis', name: 'Basis', type: 'line', color: '#ff6d00', lineWidth: 1, lineStyle: 2, data: mid },
        { key: 'lower', name: 'Lower', type: 'line', color: '#2196f3', lineWidth: 1, data: lo },
      ],
      fills: [
        { top: 'upper', bottom: 'lower', color: 'rgba(33,150,243,0.10)' },
      ],
    };
  },

  // ---- step form: the same rolling window, advanced one bar at a time (running sum + a length ring buffer
  // for the population stdev). Emits a point once the window is full (i >= length-1), like calc. ----
  /** @param {Record<string, any>} p */
  init(p) { return { len: Math.max(1, p.length | 0), k: p.mult || 2, src: p.source, buf: /** @type {number[]} */ ([]), sum: 0 }; },
  plots() {
    return [
      { key: 'upper', name: 'Upper', type: 'line', color: '#2196f3', lineWidth: 1 },
      { key: 'basis', name: 'Basis', type: 'line', color: '#ff6d00', lineWidth: 1, lineStyle: 2 },
      { key: 'lower', name: 'Lower', type: 'line', color: '#2196f3', lineWidth: 1 },
    ];
  },
  fills() { return [{ top: 'upper', bottom: 'lower', color: 'rgba(33,150,243,0.10)' }]; },
  /** @param {number} i @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  step(i, sh, p, ctx, s) {
    const price = Studies.priceOf({ open: sh.open[i], high: sh.high[i], low: sh.low[i], close: sh.close[i], volume: sh.volume[i] }, s.src);
    s.buf.push(price); s.sum += price;
    if (s.buf.length > s.len) s.sum -= /** @type {number} */ (s.buf.shift());
    if (s.buf.length < s.len) return null;   // window not full yet (matches calc's i >= len-1 gate)
    const mean = s.sum / s.len;
    let v = 0; for (let j = 0; j < s.len; j++) { const d = s.buf[j] - mean; v += d * d; }   // population variance over the window
    const sd = Math.sqrt(v / s.len);
    return { upper: { value: mean + s.k * sd }, basis: { value: mean }, lower: { value: mean - s.k * sd } };
  },
});
