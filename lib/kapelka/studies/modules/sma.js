// @ts-check
// Moving Average (SMA) — a built-in overlay study.
import { Studies } from '../registry.js';

Studies.register({
  id: 'sma',
  name: 'Moving Average (SMA)',
  overlay: true,
  inputs: [
    { key: 'length', name: 'Length', type: 'number', default: 20, min: 1, max: 5000 },
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
  ],
  calc(bars, p) {
    const len = Math.max(1, p.length | 0);
    const out = [];
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += Studies.priceOf(bars[i], p.source);
      if (i >= len) sum -= Studies.priceOf(bars[i - len], p.source);
      if (i >= len - 1) out.push({ time: bars[i].time, value: sum / len });
    }
    return { plots: [{ key: 'ma', name: 'SMA', type: 'line', color: '#e0a030', lineWidth: 2, data: out }] };
  },
});
