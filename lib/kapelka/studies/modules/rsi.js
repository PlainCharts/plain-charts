// @ts-check
// Relative Strength Index (Wilder) — a built-in oscillator study. Renders in its own sub-pane with
// overbought/oversold band lines, a shaded envelope, and the scale locked to 0..100.
import { Studies } from '../registry.js';

Studies.register({
  id: 'rsi',
  name: 'Relative Strength Index (RSI)',
  overlay: false,
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
    let avgGain = 0,
      avgLoss = 0;
    for (let i = 1; i < bars.length; i++) {
      const ch = src[i] - src[i - 1];
      const gain = ch > 0 ? ch : 0,
        loss = ch < 0 ? -ch : 0;
      if (i <= len) {
        avgGain += gain;
        avgLoss += loss;
        if (i === len) {
          avgGain /= len;
          avgLoss /= len;
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
    /** @param {number} lvl */
    const band = (lvl) => bars.map((b) => ({ time: b.time, value: lvl }));
    return {
      plots: [
        { key: 'rsi', name: 'RSI', type: 'line', color: '#ec206e', lineWidth: 2, data: out },
        {
          key: 'upper',
          name: 'Upper band',
          type: 'line',
          color: '#787b86',
          lineWidth: 1,
          lineStyle: 2,
          legend: false,
          data: band(p.upper),
        },
        {
          key: 'lower',
          name: 'Lower band',
          type: 'line',
          color: '#787b86',
          lineWidth: 1,
          lineStyle: 2,
          legend: false,
          data: band(p.lower),
        },
      ],
      fills: [{ top: 'upper', bottom: 'lower', color: 'rgba(120,123,134,0.07)' }],
      scale: { min: 0, max: 100 },
    };
  },
});
