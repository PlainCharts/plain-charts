// @ts-check
// Momentum Terrain 3D (ether capability demo). A LuxAlgo-style pseudo-3D surface, drawn ENTIRELY from
// the ether's two primitives -- anchored `path` + `text`. There is no "surface", "mesh", "3d" or
// "gradient-fill" type in the engine; this study builds a grid of momentum values, projects each grid
// point isometrically, and emits one filled quad per cell (coloured by a heatmap ramp). The 3D is just
// arithmetic the study author writes.
//
// Grid: X = last COLS bars (time), Z/depth = ROWS momentum lookbacks, Y/height = rate-of-change. This is
// REAL single-symbol data (the charted symbol's momentum at several lengths) -- what the ctx provides.
//
// Positioning: X is a viewport FRACTION (so it spans the pane width responsively); the base Y is a
// fraction and depth+height are pixel offsets (dy). So the terrain fills the pane and keeps its shape
// while you pan/zoom. Own pane (overlay:false) via a faint momentum plot that anchors the pane.

const COLS = 40, ROWS = 9;

// heatmap ramp: low -> cyan/blue -> purple -> red -> orange -> yellow (LuxAlgo-ish)
/** @type {[number, string][]} */
const STOPS = [[0, '#26c6da'], [0.28, '#4d6bd6'], [0.5, '#7b3fa0'], [0.68, '#e0405a'], [0.85, '#f28c3a'], [1, '#f5d020']];
/** @param {string} h */
const hx = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
/** @param {number} t */
function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const a = hx(STOPS[i - 1][1]), b = hx(STOPS[i][1]);
      const f = (t - STOPS[i - 1][0]) / ((STOPS[i][0] - STOPS[i - 1][0]) || 1);
      return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
    }
  }
  return hx(STOPS[STOPS.length - 1][1]);
}
/** @param {number[]} c @param {number} a */
const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

Studies.register({
  id: 'momentum_terrain',
  name: 'Momentum Terrain 3D (ether demo)',
  overlay: false,
  viewport: true,   // recompute over the VISIBLE window on pan/zoom -> the terrain morphs as you scroll
  inputs: [
    { key: 'height', name: 'Height (px)', type: 'number', default: 150, min: 40, max: 320 },
    { key: 'depth', name: 'Depth (px)', type: 'number', default: 150, min: 40, max: 320 },
    { key: 'opacity', name: 'Surface opacity', type: 'range', default: 0.7, min: 0.2, max: 1, step: 0.02 },
    { key: 'drops', name: 'Drop lines', type: 'bool', default: true },
  ],
  calc(bars, p, ctx) {
    const N = bars.length;
    const Ls = []; for (let r = 0; r < ROWS; r++) Ls.push(3 + r * 4);   // lookbacks 3..35
    const maxL = Ls[ROWS - 1];
    if (N < COLS + maxL + 2) return { plots: [] };

    // Choose the window of bars to sample COLS columns from: the VISIBLE range (so the terrain morphs
    // as you scroll/zoom) if provided, else the recent window.
    let lo = N - COLS, hi = N - 1;
    if (ctx && ctx.visibleRange) {
      let a = 0, b = N - 1;
      while (a < N && bars[a].time < ctx.visibleRange.from) a++;
      while (b > 0 && bars[b].time > ctx.visibleRange.to) b--;
      if (b > a + 1) { lo = a; hi = b; }
    }
    lo = Math.max(maxL, lo); if (hi <= lo) hi = Math.min(N - 1, lo + 1);
    // COLS bar indices sampled evenly across [lo, hi]
    const idx = [];
    for (let c = 0; c < COLS; c++) idx.push(Math.round(lo + (c / (COLS - 1)) * (hi - lo)));

    // grid[r][c] = rate-of-change (%) of close at sampled bar idx[c] over lookback Ls[r]
    const grid = []; let hmin = Infinity, hmax = -Infinity;
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const i = idx[c], base = bars[i - Ls[r]].close;
        const v = base ? ((bars[i].close - base) / base) * 100 : 0;
        row.push(v); if (v < hmin) hmin = v; if (v > hmax) hmax = v;
      }
      grid.push(row);
    }
    const span = (hmax - hmin) || 1;
    /** @param {number} v */
    const tnorm = (v) => (v - hmin) / span;                 // 0..1 for colour
    const HMAX = (p.height | 0) || 150, DEPTHY = (p.depth | 0) || 150;
    /** @param {number} v */
    const hpx = (v) => (tnorm(v) - 0.5) * 2 * HMAX;         // -HMAX..+HMAX pixels

    // isometric projection of grid point (c, r, heightPx) -> a vertex:
    //   x = viewport fraction (spans pane width; depth nudges it right)
    //   y = base fraction + pixel (depth raises up, height raises up)
    const baseY = 0.66, leftF = 0.06, widthF = 0.86, depthXF = 0.06;
    /** @param {number} c @param {number} r @param {number} ypx */
    const proj = (c, r, ypx) => ({
      vpx: leftF + (c / (COLS - 1)) * widthF + (r / (ROWS - 1)) * depthXF,
      vp: baseY,
      dy: -(r / (ROWS - 1)) * DEPTHY - ypx,
    });
    /** @param {number} c @param {number} r */
    const floor = (c, r) => proj(c, r, 0);

    const m = [];
    // dark floor plane
    m.push({ closed: true, fill: 'rgba(28,30,42,0.55)', stroke: 'rgba(120,124,140,0.25)', width: 1,
      path: [floor(0, 0), floor(COLS - 1, 0), floor(COLS - 1, ROWS - 1), floor(0, ROWS - 1)] });

    // drop lines from the FRONT row down to the floor (red = negative momentum, grey = positive)
    if (p.drops !== false) {
      for (let c = 0; c < COLS; c++) {
        const v = grid[0][c];
        m.push({ path: [proj(c, 0, hpx(v)), floor(c, 0)], width: 1, stroke: v < 0 ? 'rgba(233,70,70,0.65)' : 'rgba(170,174,186,0.35)' });
      }
    }

    // surface quads, painted BACK-to-FRONT (painter's algorithm) so nearer rows occlude farther ones
    for (let r = ROWS - 2; r >= 0; r--) {
      for (let c = 0; c < COLS - 1; c++) {
        const v = (grid[r][c] + grid[r][c + 1] + grid[r + 1][c] + grid[r + 1][c + 1]) / 4;
        m.push({
          closed: true, fill: rgba(ramp(tnorm(v)), p.opacity != null ? p.opacity : 0.7), stroke: 'rgba(0,0,0,0.18)', width: 0.5,
          path: [proj(c, r, hpx(grid[r][c])), proj(c + 1, r, hpx(grid[r][c + 1])), proj(c + 1, r + 1, hpx(grid[r + 1][c + 1])), proj(c, r + 1, hpx(grid[r + 1][c]))],
        });
      }
    }

    // bold white ridge = the front (shortest-lookback) momentum line
    const ridge = [];
    for (let c = 0; c < COLS; c++) ridge.push(proj(c, 0, hpx(grid[0][c])));
    m.push({ path: ridge, stroke: '#ffffff', width: 2 });

    m.push({ text: 'Momentum Terrain 3D', at: { vpx: 0.02, vp: 0.05, dx: 0, dy: 0 }, color: '#d3d6dd', size: 12 });

    // faint plot so the study gets its own pane + a value scale (the terrain itself is the show)
    const line = [];
    for (let c = 0; c < COLS; c++) line.push({ time: bars[idx[c]].time, value: grid[0][c] });
    return { plots: [{ key: 'mom', name: 'Momentum', type: 'line', color: 'rgba(255,255,255,0)', lineWidth: 0, data: line }], shapes: [{ marks: m }] };
  },
});

// Top-level COLS/ROWS/STOPS/hx/rgba would collide with other study modules in the shared global
// scope; making this file a module (loaded only via dynamic import()) scopes them. TYPE-ONLY -- no runtime effect.
export {};
