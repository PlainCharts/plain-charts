// @ts-check
// Volume Profile (Fixed Range) — volume distributed across PRICE levels, drawn as horizontal bars
// on the price (Y) axis using the engine's segmented horizontal-bar series (type 'hbar'). Each
// level's bar is split into up- and down-volume segments; Value-Area levels are brighter. Point of
// Control + VAH/VAL are marked with lines.
//
// Volume distribution follows LonesomeTheBlue's method: each bar is split into body + top-wick +
// bottom-wick, and each part's volume is shared across the levels it overlaps (get_vol). Body volume
// is up or down by bar polarity (close >= open); wick volume is split 50/50 up/down.
Studies.register({
  id: 'volume_profile',
  name: 'Volume Profile',
  description: 'A study that shows volume traded at each price level.',
  overlay: true,
  inputs: [
    { key: 'lookback', type: 'number', name: 'Number of bars', default: 150, min: 20, max: 500, legend: false },
    { key: 'rows', type: 'number', name: 'Row size', default: 24, min: 5, max: 100, legend: false },
    { key: 'width', type: 'number', name: 'Width %', default: 30, min: 5, max: 80, legend: false },
    { key: 'va', type: 'number', name: 'Value Area %', default: 70, min: 30, max: 95, legend: false },
    { key: 'side', type: 'select', name: 'Side', default: 'right',
      options: [{ key: 'right', name: 'Right' }, { key: 'left', name: 'Left' }], legend: false },
    { key: 'vaUp', type: 'color', name: 'Value area up', default: 'rgba(33,150,243,0.9)', legend: false },
    { key: 'vaDown', type: 'color', name: 'Value area down', default: 'rgba(255,152,0,0.9)', legend: false },
    // outside the value area: light tints (opaque enough to read blue/orange on any background)
    { key: 'upVol', type: 'color', name: 'Up volume', default: 'rgba(150,190,240,0.85)', legend: false },
    { key: 'downVol', type: 'color', name: 'Down volume', default: 'rgba(252,205,150,0.85)', legend: false },
    { key: 'pocColor', type: 'color', name: 'PoC', default: '#ff0000', legend: false },
  ],
  calc(bars, p) {
    const N = Math.min(p.lookback || 150, bars.length);
    if (N < 2) return { plots: [] };
    const slice = bars.slice(-N);
    let top = -Infinity, bot = Infinity;
    for (const b of slice) { if (b.high > top) top = b.high; if (b.low < bot) bot = b.low; }
    if (!(top > bot)) return { plots: [] };
    const cnum = Math.max(2, p.rows || 24);
    const step = (top - bot) / cnum;
    /** @param {number} x */
    const level = (x) => bot + step * x;   // bottom edge of level x
    // overlap length of segments [a1,a2] and [b1,b2], times vol/height (LonesomeTheBlue's get_vol)
    /**
     * @param {number} a1 @param {number} a2 @param {number} b1 @param {number} b2
     * @param {number} height @param {number} vol
     */
    const getVol = (a1, a2, b1, b2, height, vol) => {
      if (!(height > 0)) return 0;
      const inter = Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)));
      return inter * vol / height;
    };
    const up = new Array(cnum).fill(0), down = new Array(cnum).fill(0);
    for (const b of slice) {
      const vol = b.volume || 0; if (!vol) continue;
      const bt = Math.max(b.close, b.open), bb = Math.min(b.close, b.open);
      const green = b.close >= b.open;
      const tw = b.high - bt, bw = bb - b.low, body = bt - bb;
      const denom = 2 * tw + 2 * bw + body;
      if (denom <= 0) continue;
      const bodyvol = body * vol / denom, twvol = 2 * tw * vol / denom, bwvol = 2 * bw * vol / denom;
      const s = Math.max(0, Math.floor((b.low - bot) / step));
      const e = Math.min(cnum - 1, Math.floor((b.high - bot) / step));
      for (let x = s; x <= e; x++) {
        const lx = level(x), lx1 = level(x + 1);
        const bodyPart = getVol(lx, lx1, bb, bt, body, bodyvol);
        const wickPart = getVol(lx, lx1, bt, b.high, tw, twvol) / 2 + getVol(lx, lx1, bb, b.low, bw, bwvol) / 2;
        up[x] += (green ? bodyPart : 0) + wickPart;
        down[x] += (green ? 0 : bodyPart) + wickPart;
      }
    }
    const total = up.map((u, x) => u + down[x]);
    let poc = 0; for (let x = 1; x < cnum; x++) if (total[x] > total[poc]) poc = x;
    // value area: grow out from the PoC until it holds `va`% of total volume
    const target = total.reduce((a, v) => a + v, 0) * ((p.va || 70) / 100);
    let laP = poc, lbP = poc, acc = total[poc], guard = cnum * 2;
    while (acc < target && guard-- > 0) {
      const u = laP < cnum - 1 ? total[laP + 1] : 0;
      const d = lbP > 0 ? total[lbP - 1] : 0;
      if (u === 0 && d === 0) break;
      if (u >= d) { acc += u; laP++; } else { acc += d; lbP--; }
    }
    const data = total.map((tv, x) => {
      const inVA = x >= lbP && x <= laP;
      return {
        price: level(x) + step / 2,
        segments: [
          { value: up[x], color: inVA ? p.vaUp : p.upVol },
          { value: down[x], color: inVA ? p.vaDown : p.downVol },
        ],
      };
    });
    return {
      // hbar points are PRICE-anchored ({price, segments}), not the time/value StudyPlotPoint shape -- cast at this boundary
      plots: [{ key: 'vp', name: 'VP', type: 'hbar', legend: false, side: p.side || 'right', widthFrac: (p.width || 30) / 100, data: /** @type {StudyPlotPoint[]} */ (/** @type {unknown} */ (data)) }],
      shapes: [
        { type: 'hline', price: level(poc) + step / 2, color: p.pocColor, width: 2 },   // Point of Control (the only line the original draws)
      ],
    };
  },
});
