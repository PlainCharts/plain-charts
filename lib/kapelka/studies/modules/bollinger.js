// @ts-check
// Bollinger Bands — a built-in overlay study showcasing the `fills` channel: a middle SMA with an
// upper/lower envelope at +/- k standard deviations and a shaded band between them.
import { Studies } from '../registry.js';

Studies.register({
  id: 'bollinger',
  name: 'Bollinger Bands',
  overlay: true,
  inputs: [
    { key: 'length', name: 'Length', type: 'number', default: 20, min: 1, max: 5000 },
    { key: 'mult', name: 'StdDev', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
  ],
  calc(bars, p) {
    const len = Math.max(1, p.length | 0);
    const k = p.mult || 2;
    const src = bars.map((b) => Studies.priceOf(b, p.source));
    const mid = [],
      up = [],
      lo = [];
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += src[i];
      if (i >= len) sum -= src[i - len];
      if (i >= len - 1) {
        const mean = sum / len;
        let v = 0;
        for (let j = i - len + 1; j <= i; j++) {
          const d = src[j] - mean;
          v += d * d;
        }
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
      fills: [{ top: 'upper', bottom: 'lower', color: 'rgba(33,150,243,0.10)' }],
    };
  },
});
