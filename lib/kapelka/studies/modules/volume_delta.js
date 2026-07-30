// @ts-check
// Volume Delta. Scans each bar's LOWER-TIMEFRAME sub-bars and
// builds the running buy/sell delta. The delta opens at 0 each bar, so it's drawn as a column
// ANCHORED at the zero line up to the net (close), with a wick for the intrabar high/low swing
// (max/min the running delta reached). Teal when the net is positive, red when negative.
//
// Gallery copy of the app's studies/modules/volume_delta.js — identical algorithm; the only change
// is importing Studies from the library registry instead of the app's window.Studies global.
import { Studies } from '../registry.js';

Studies.register({
  id: 'volume_delta',
  name: 'Volume Delta-Sub',
  overlay: false,
  intrabar: true, // needs sub-bars (auto: intraday->1m, daily->5m, higher->1h)
  inputs: [],
  calc(bars, p, ctx) {
    const subs = ctx.intrabar || [];
    /** @type {import('../types.js').StudyPlotPoint[]} */
    const data = [];
    bars.forEach((b, i) => {
      const sb = subs[i];
      let d = 0,
        hi = 0,
        lo = 0; // the delta opens at 0 each bar (so the body is anchored to zero)
      if (sb && sb.length) {
        for (const s of sb) {
          const up = s.open != null && s.close != null ? s.close >= s.open : true;
          d += up ? s.volume || 0 : -(s.volume || 0);
          if (d > hi) hi = d;
          if (d < lo) lo = d;
        }
      } else {
        // no sub-bars yet (forming / most-recent bars): approximate from the chart bar so it renders
        const vol = b.volume || 0;
        if (!vol) return;
        d = (b.close != null && b.open != null ? b.close >= b.open : true) ? vol : -vol;
        hi = Math.max(0, d);
        lo = Math.min(0, d);
      }
      const close = d,
        col = close >= 0 ? '#26a69a' : '#ef5350';
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
