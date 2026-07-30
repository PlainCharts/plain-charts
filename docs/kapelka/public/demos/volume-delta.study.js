// Volume Delta -- demo copy of the gallery's studies/modules/volume_delta.js. Identical algorithm; the
// only change is two color inputs (upColor / downColor) so the demo page can tint the bars to match the
// light theme's candle colors. Registers via the global `Studies` (set by the demo page) with the same id
// 'volume_delta', so it OVERWRITES the gallery version (the registry keys by id).
Studies.register({
  id: 'volume_delta',
  name: 'Volume Delta-Sub',
  overlay: false,
  intrabar: true, // needs sub-bars (auto: intraday->1m, daily->5m, higher->1h)
  inputs: [
    { key: 'upColor', type: 'color', name: 'Buy color', default: '#26a69a', legend: false },
    { key: 'downColor', type: 'color', name: 'Sell color', default: '#ef5350', legend: false },
  ],
  calc(bars, p, ctx) {
    const subs = ctx.intrabar || [];
    const up = p.upColor || '#26a69a',
      down = p.downColor || '#ef5350';
    const data = [];
    bars.forEach((b, i) => {
      const sb = subs[i];
      let d = 0,
        hi = 0,
        lo = 0; // the delta opens at 0 each bar (so the body is anchored to zero)
      if (sb && sb.length) {
        for (const s of sb) {
          const u = s.open != null && s.close != null ? s.close >= s.open : true;
          d += u ? s.volume || 0 : -(s.volume || 0);
          if (d > hi) hi = d;
          if (d < lo) lo = d;
        }
      } else {
        const vol = b.volume || 0;
        if (!vol) return;
        d = (b.close != null && b.open != null ? b.close >= b.open : true) ? vol : -vol;
        hi = Math.max(0, d);
        lo = Math.min(0, d);
      }
      const close = d,
        col = close >= 0 ? up : down;
      data.push({
        time: b.time,
        value: close,
        segments: [{ from: Math.min(0, close), to: Math.max(0, close), color: col }], // body: 0 -> net
        wicks: [{ from: lo, to: hi, color: col, width: 1 }], // intrabar swing
      });
    });
    return {
      plots: [{ key: 'vd', name: 'Vol Δ', type: 'segmented', precision: 0, data }],
      shapes: [{ type: 'hline', price: 0, color: 'rgba(120,123,134,0.5)', width: 1, lineStyle: 'dashed' }], // zero line
    };
  },
});
