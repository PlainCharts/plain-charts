// @ts-check
// Open shapes channel (demo) — shows that a study's `shapes` are no longer a fixed catalog. A shape
// can be raw geometry ({ marks:[...] } — draw ANYTHING) or a convenience form (hline/vline/box/label,
// now just sugar over the same marks). And with `overlay:true`, a SUB-pane study can drop shapes onto
// the main PRICE pane. This one lives in its own sub-pane (a rolling range-position oscillator) and
// annotates the price chart above it — all declared as data, none of it hand-painted.
import { Studies } from '../registry.js';

Studies.register({
  id: 'marks_demo',
  name: 'Open Shapes (marks demo)',
  overlay: false,
  inputs: [{ key: 'length', name: 'Length', type: 'number', default: 20, min: 2, max: 500 }],
  /** @param {import('../types.js').StudyBar[]} bars @param {Record<string, any>} p */
  calc(bars, p) {
    const n = Math.max(2, p.length | 0);
    /** @type {{ time: number, value: number }[]} */
    const pos = []; // close's position within the rolling high/low range, 0..100
    for (let i = n - 1; i < bars.length; i++) {
      let hi = -Infinity,
        lo = Infinity;
      for (let j = i - n + 1; j <= i; j++) {
        if (bars[j].high > hi) hi = bars[j].high;
        if (bars[j].low < lo) lo = bars[j].low;
      }
      pos.push({ time: bars[i].time, value: hi === lo ? 50 : ((bars[i].close - lo) / (hi - lo)) * 100 });
    }
    const N = bars.length;
    if (!N) return { plots: [] };
    const k = Math.min(N, 30);
    const slice = bars.slice(N - k);
    const top = Math.max(...slice.map((b) => b.high));
    const bot = Math.min(...slice.map((b) => b.low));
    const from = bars[N - k].time,
      to = bars[N - 1].time,
      lastT = bars[N - 1].time;
    const lastV = pos.length ? pos[pos.length - 1].value : 50;

    return {
      plots: [{ key: 'pos', name: 'Range %', type: 'line', color: '#4dd0e1', lineWidth: 2, data: pos }],
      scale: { min: 0, max: 100 },
      shapes: [
        // --- own sub-pane ---
        // catalog SUGAR: overbought/oversold guides
        { type: 'hline', price: 80, color: 'rgba(239,83,80,0.5)', lineStyle: 'dashed' },
        { type: 'hline', price: 20, color: 'rgba(38,166,154,0.5)', lineStyle: 'dashed' },
        // INLINE MARKS: a pixel-sized diamond on the last value (price/osc anchor + fixed pixel geometry)
        {
          marks: [
            {
              closed: true,
              fill: '#4dd0e1',
              path: [
                { t: lastT, p: lastV, dy: -6 },
                { t: lastT, p: lastV, dx: 6 },
                { t: lastT, p: lastV, dy: 6 },
                { t: lastT, p: lastV, dx: -6 },
              ],
            },
          ],
        },

        // --- cross-pane: drawn on the MAIN price chart (overlay:true) ---
        // INLINE MARKS: a box around the last k bars' high/low range
        {
          overlay: true,
          marks: [
            {
              closed: true,
              fill: 'rgba(77,208,225,0.10)',
              stroke: '#4dd0e1',
              width: 1,
              path: [
                { t: from, p: top },
                { t: to, p: top },
                { t: to, p: bot },
                { t: from, p: bot },
              ],
            },
          ],
        },
        // catalog SUGAR on the price pane too
        { overlay: true, type: 'vline', time: from, color: 'rgba(77,208,225,0.4)', lineStyle: 'dotted' },
        { overlay: true, type: 'label', time: from, price: top, text: 'range', color: '#4dd0e1', size: 11 },
      ],
    };
  },
});
