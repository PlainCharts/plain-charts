// @ts-check
// Line Types (demo) — shows the three line renderings (lineType) on ONE series so you can compare
// the shapes directly. It smooths the source, then DOWNSAMPLES to every Nth bar so the segments are
// long enough to see the difference, and plots that same series three times:
//   Simple  (lineType 0) — straight segments between points
//   Stepped (lineType 1) — holds each value flat, then jumps at the next point
//   Curved  (lineType 2) — a smoothed spline through the points
// The three lines meet exactly AT each sample point (line type only changes what happens BETWEEN
// points); toggle plots in the legend to isolate one. Increase "Sample every N bars" to exaggerate it.
import { Studies } from '../registry.js';

Studies.register({
  id: 'line_types_demo',
  name: 'Line Types (demo)',
  overlay: false, // its own sub-pane, so the three shapes read clearly
  inputs: [
    { key: 'length', name: 'Smoothing', type: 'number', default: 5, min: 1, max: 100 },
    { key: 'every', name: 'Sample every N bars', type: 'number', default: 8, min: 1, max: 50 },
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
  ],
  calc(bars, p) {
    const len = Math.max(1, p.length | 0),
      every = Math.max(1, p.every | 0);
    /** @type {import('../types.js').StudyPlotPoint[]} */
    const sm = [];
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += Studies.priceOf(bars[i], p.source);
      if (i >= len) sum -= Studies.priceOf(bars[i - len], p.source);
      if (i >= len - 1) sm.push({ time: bars[i].time, value: sum / len });
    }
    const pts = sm.filter((_, i) => i % every === 0); // long segments -> the shapes are visible
    return {
      plots: [
        { key: 'simple', name: 'Simple', type: 'line', color: '#2962ff', lineWidth: 2, lineType: 0, data: pts },
        { key: 'stepped', name: 'Stepped', type: 'line', color: '#26a69a', lineWidth: 2, lineType: 1, data: pts },
        { key: 'curved', name: 'Curved', type: 'line', color: '#f0a030', lineWidth: 2, lineType: 2, data: pts },
      ],
    };
  },
});
