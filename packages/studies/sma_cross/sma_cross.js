// @ts-check
// SMA Cross — a Pacman demo package. Two simple moving averages (fast + slow) on the price pane;
// self-contained (no imports), so installing it into any packages/studies/ folder just works.
Studies.register({
  id: 'sma_cross',
  name: 'SMA Cross',
  description: 'Fast and slow simple moving averages on the price pane.',
  overlay: true,
  requires: { bars: true },
  inputs: [
    { key: 'fast', name: 'Fast', type: 'number', default: 10, min: 1, max: 500 },
    { key: 'slow', name: 'Slow', type: 'number', default: 30, min: 1, max: 500 },
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
    { key: 'fastColor', name: 'Fast line', type: 'color', default: '#26a69a', legend: false },
    { key: 'slowColor', name: 'Slow line', type: 'color', default: '#ef5350', legend: false },
  ],
  /** @param {Record<string, any>} p */
  init(p) {
    return {
      fast: Math.max(1, p.fast | 0), slow: Math.max(1, p.slow | 0), src: p.source,
      fastC: p.fastColor || '#26a69a', slowC: p.slowColor || '#ef5350',
      fb: /** @type {number[]} */ ([]), fs: 0, sb: /** @type {number[]} */ ([]), ss: 0,
    };
  },
  /** @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  plots(p, ctx, s) {
    return [
      { key: 'fast', name: 'Fast SMA', type: 'line', color: s.fastC, lineWidth: 2 },
      { key: 'slow', name: 'Slow SMA', type: 'line', color: s.slowC, lineWidth: 2 },
    ];
  },
  /** @param {number} i @param {any} sh @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  step(i, sh, p, ctx, s) {
    const price = Studies.priceOf({ open: sh.open[i], high: sh.high[i], low: sh.low[i], close: sh.close[i], volume: sh.volume[i] }, s.src);
    /** @type {Record<string, any>} */
    const row = {};
    s.fb.push(price); s.fs += price; if (s.fb.length > s.fast) s.fs -= s.fb.shift(); if (s.fb.length === s.fast) row.fast = { value: s.fs / s.fast };
    s.sb.push(price); s.ss += price; if (s.sb.length > s.slow) s.ss -= s.sb.shift(); if (s.sb.length === s.slow) row.slow = { value: s.ss / s.slow };
    return row;
  },
});
