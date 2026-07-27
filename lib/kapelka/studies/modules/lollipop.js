// @ts-check
// Momentum (lollipop) — a gallery study that ships its OWN render primitive via the custom-series
// plug-in seam. It registers a primitive 'lollipop' (a stem from the zero line to the value, capped
// with a filled dot) and plots momentum through it. A lollipop is NOT in the built-in vocabulary
// (line/area/histogram/segmented/hbar) — so this demonstrates that a study author can bring their own
// render grammar: define the primitive once (registerCustomPlot), then select it as a plot `type`.
import { Studies } from '../registry.js';
import { registerCustomPlot } from '../channels.js';

// A primitive `view` is the engine's addCustomPlot contract:
//   priceValues(point) -> number[]   min/max drive pane auto-scale, last drives the crosshair
//   draw(scope)                       scope = { ctx, options, data:[{time,x,point}], priceToY, barWidth, ... }
registerCustomPlot('lollipop', {
  defaultOptions: () => ({ color: '#e0a030', dot: 4 }),
  priceValues: (/** @type {any} */ p) => [0, p.value],                 // stem spans 0..value, so the scale shows the baseline
  draw: (/** @type {any} */ s) => {
    const c = s.ctx, y0 = s.priceToY(0), r = s.options.dot || 4;
    for (const d of s.data) {
      const x = d.x, y = s.priceToY(d.point.value);
      const col = d.point.color || s.options.color || '#e0a030';
      c.strokeStyle = col; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y); c.stroke();   // stem
      c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();   // dot
    }
  },
});

Studies.register({
  id: 'lollipop_momentum',
  name: 'Momentum (lollipop primitive)',
  overlay: false,   // its own sub-pane
  inputs: [
    { key: 'length', name: 'Length', type: 'number', default: 10, min: 1, max: 500 },
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
  ],
  calc(bars, p) {
    const n = Math.max(1, p.length | 0), data = /** @type {import('../types.js').StudyPlotPoint[]} */ ([]);
    for (let i = n; i < bars.length; i++) {
      const mom = Studies.priceOf(bars[i], p.source) - Studies.priceOf(bars[i - n], p.source);
      data.push({ time: bars[i].time, value: mom, color: mom >= 0 ? '#26a69a' : '#ef5350' });
    }
    return { plots: [{ key: 'mom', name: 'Momentum', type: 'lollipop', data }] };
  },
});
