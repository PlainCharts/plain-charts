// @ts-check
// Shape library (demo) — named, reusable shapes. Two recipes are registered here: 'ob-box' as a pure
// DATA template (params -> marks via $substitution; shareable as JSON) and 'pin' as a CODE function.
// The study then PLACES them by feeding params — { shape:'ob-box', from, to, ... } — instead of
// spelling out geometry each time. The library resolves name -> recipe -> marks; the ether draws it.
import { Studies } from '../registry.js';
import { registerShape } from '../shape-lib.js';

// DATA recipe: a labeled box. No code — just a template with $param placeholders + literals.
registerShape('ob-box', {
  params: { color: 'rgba(41,98,255,0.08)', border: '#2962ff', label: '' },
  marks: [
    { closed: true, fill: '$color', stroke: '$border', width: 1, path: [
      { t: '$from', p: '$top' }, { t: '$to', p: '$top' }, { t: '$to', p: '$bottom' }, { t: '$from', p: '$bottom' },
    ] },
    { text: '$label', at: { t: '$from', p: '$top', dx: 4, dy: 2 }, color: '$border', size: 11 },
  ],
});

// DATA recipe using the =expr grammar: conditional color (L4) + arithmetic inset (L2), pure JSON —
// no code. The same recipe renders green "accumulation" or red "distribution" purely from the `up` param.
registerShape('zone', {
  params: { up: true, pad: 0 },
  marks: [
    { closed: true, width: 1,
      fill: "=$up ? 'rgba(38,166,154,0.12)' : 'rgba(239,83,80,0.12)'",
      stroke: "=$up ? '#26a69a' : '#ef5350'",
      path: [
        { t: '$from', p: '=$top - $pad' }, { t: '$to', p: '=$top - $pad' },
        { t: '$to', p: '=$bottom + $pad' }, { t: '$from', p: '=$bottom + $pad' },
      ] },
    { text: "=$up ? 'accumulation' : 'distribution'", at: { t: '$from', p: '=$top - $pad', dx: 4, dy: 2 },
      color: "=$up ? '#26a69a' : '#ef5350'", size: 11 },
  ],
});

// CODE recipe: a downward pin (stem + dot) at a price/time. Full JS — the escape hatch.
registerShape('pin', (/** @type {any} */ d) => {
  const col = d.color || '#e0a030', H = d.height || 30, r = d.dot || 4;
  const dot = /** @type {any[]} */ ([]);
  for (let k = 0; k <= 16; k++) { const a = (k / 16) * Math.PI * 2; dot.push({ t: d.t, p: d.p, dx: r * Math.cos(a), dy: -H + r * Math.sin(a) }); }
  return [
    { path: [{ t: d.t, p: d.p }, { t: d.t, p: d.p, dy: -H }], stroke: col, width: 2 },
    { path: dot, closed: true, fill: col },
  ];
});

Studies.register({
  id: 'shape_lib_demo',
  name: 'Shape Library (demo)',
  overlay: false,
  inputs: [{ key: 'length', name: 'Length', type: 'number', default: 20, min: 2, max: 500 }],
  calc(bars, p) {
    const n = Math.max(2, p.length | 0);
    /** @type {import('../types.js').StudyPlotPoint[]} */
    const pos = [];
    for (let i = n - 1; i < bars.length; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - n + 1; j <= i; j++) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; }
      pos.push({ time: bars[i].time, value: hi === lo ? 50 : ((bars[i].close - lo) / (hi - lo)) * 100 });
    }
    const N = bars.length;
    if (N < 40) return { plots: [] };
    const R = Math.min(N, 90), start = N - R;
    let hiV = -Infinity, loV = Infinity, hiI = start;
    for (let i = start; i < N; i++) { if (bars[i].high > hiV) { hiV = bars[i].high; hiI = i; } if (bars[i].low < loV) loV = bars[i].low; }
    const up = bars[N - 1].close >= bars[start].close;   // trend over the window -> the zone colors itself

    return {
      plots: [{ key: 'pos', name: 'Range %', type: 'line', color: '#8e99f3', lineWidth: 2, data: pos }],
      scale: { min: 0, max: 100 },
      shapes: [
        // place the =expr DATA recipe: it colors + labels itself from the `up` param, and insets by `pad`.
        { shape: 'zone', overlay: true, from: bars[start].time, to: bars[N - 1].time, top: hiV, bottom: loV,
          up, pad: (hiV - loV) * 0.04 },
        // place the CODE recipe:
        { shape: 'pin', overlay: true, t: bars[hiI].time, p: hiV, color: '#ef5350', height: 34 },
      ],
    };
  },
});
