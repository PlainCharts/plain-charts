// @ts-check
// Fibonacci retracement — a 2-point tool. Anchor 1 (P1) is level 1.0, anchor 2 (P2) is
// level 0.0; horizontal lines are drawn at each enabled ratio between (and beyond) them,
// labelled with the ratio and the price. Optional diagonal trend line between the anchors,
// optional translucent background bands, and left/right extension.
//
// Level y is interpolated in SCREEN space (exact on a linear price scale): y(r) = y2 +
// (y1 - y2) * r. The price shown is computed in DATA space: price(r) = P2 + (P1 - P2) * r.

// (`Tools`, `ToolDrawing`, `ToolView`, `ToolScreenPoint`, … are ambiently typed in tools-global.d.ts.)
/** @typedef {{ value:number, on?:boolean, color?:string, width?:number, lineStyle?:string }} FibLevel */

// the classic retracement set + default per-level colours (cloned into defaultStyle at register time,
// so it must be declared before the register call below).
/** @type {FibLevel[]} */
const DEFAULT_LEVELS = [
  { value: 0, on: true, color: '#787b86' },
  { value: 0.236, on: true, color: '#f23645' },
  { value: 0.382, on: true, color: '#ff9800' },
  { value: 0.5, on: true, color: '#4caf50' },
  { value: 0.618, on: true, color: '#089981' },
  { value: 0.786, on: true, color: '#00bcd4' },
  { value: 1, on: true, color: '#787b86' },
];

Tools.register({
  id: 'fib',
  glyph: 'F',
  kind: 'draw',
  points: 2,
  defaultStyle: {
    levels: structuredClone(DEFAULT_LEVELS),
    lineWidth: 1,
    lineStyle: 'solid',
    trendOn: false,
    trendColor: '#787b86',
    trendWidth: 1,
    trendStyle: 'dashed',
    bgOn: true,
    bgOpacity: 0.1,
    oneColor: false,
    color: '#787b86',
    extend: 'none',
    showRatio: true,
    showPrice: true,
    levelMode: 'values',
    labelHAlign: 'right',
    labelVAlign: 'middle',
    labelFontSize: 11,
  },
  settings: {
    style: [
      {
        name: 'Trend line',
        toggle: 'trendOn',
        controls: [{ key: 'trendColor', type: 'color', width: 'trendWidth', lineStyle: 'trendStyle' }],
      },
      {
        name: 'Extend',
        controls: [
          {
            key: 'extend',
            type: 'select',
            options: [
              { key: 'none', name: "Don't extend" },
              { key: 'right', name: 'Extend right' },
              { key: 'left', name: 'Extend left' },
              { key: 'both', name: 'Extend both' },
            ],
          },
        ],
      },
      { controls: [{ key: 'levels', type: 'fiblevels' }] },
      { name: 'Use one color', toggle: 'oneColor', controls: [{ key: 'color', type: 'color' }] },
      {
        name: 'Background',
        toggle: 'bgOn',
        toggleDefault: true,
        controls: [{ key: 'bgOpacity', type: 'range', min: 0, max: 0.5, step: 0.02 }],
      },
      { name: 'Prices', toggle: 'showPrice', toggleDefault: true },
      {
        name: 'Levels',
        toggle: 'showRatio',
        toggleDefault: true,
        controls: [
          {
            key: 'levelMode',
            type: 'select',
            options: [
              { key: 'values', name: 'Values' },
              { key: 'percents', name: 'Percents' },
            ],
          },
        ],
      },
      {
        name: 'Labels',
        controls: [
          {
            key: 'labelHAlign',
            type: 'select',
            options: [
              { key: 'left', name: 'Left' },
              { key: 'center', name: 'Center' },
              { key: 'right', name: 'Right' },
            ],
          },
          {
            key: 'labelVAlign',
            type: 'select',
            options: [
              { key: 'top', name: 'Top' },
              { key: 'middle', name: 'Middle' },
              { key: 'bottom', name: 'Bottom' },
            ],
          },
        ],
      },
      {
        name: 'Font size',
        controls: [
          {
            key: 'labelFontSize',
            type: 'select',
            options: [10, 11, 12, 13, 14, 16, 18].map((n) => ({ key: String(n), name: String(n) })),
          },
        ],
      },
    ],
  },

  // Declarative: bands, the diagonal trend line, per-level lines and labels — all computed in screen
  // space (levels interpolate between the two anchor screen-y's; prices are data-space) and emitted as
  // marks (absolute-screen vertices). Bands are pushed first so they render under the lines.
  /** @param {ToolDrawing} d @param {ToolView} view */
  marks(d, view) {
    const P = d.points || [];
    if (P.length < 2) return [];
    // fib carries many bespoke style fields (levels/bgOpacity/trendStyle/labelFontSize/…) that the
    // shared ToolStyle types as `unknown`; treat the bag as any so those reads stay legible.
    const s = /** @type {any} */ (d.style || {});
    /** @type {FibLevel[]} */
    const levels = s.levels && s.levels.length ? s.levels : DEFAULT_LEVELS;
    const enabled = levels.filter((l) => l.on !== false);
    if (!enabled.length) return [];

    const x1 = view.timeToX(P[0].time),
      y1 = view.priceToY(P[0].price);
    const x2 = view.timeToX(P[1].time),
      y2 = view.priceToY(P[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return [];
    const W = view.width || 0;
    let xa = Math.min(x1, x2),
      xb = Math.max(x1, x2);
    if (s.extend === 'left' || s.extend === 'both') xa = 0;
    if (s.extend === 'right' || s.extend === 'both') xb = W;

    const dec = view.priceDecimals != null ? view.priceDecimals : 2;
    const base = P[1].price,
      span = P[0].price - P[1].price;
    /** @param {number} r */
    const yAt = (r) => y2 + (y1 - y2) * r;
    /** @param {number} r */
    const priceAt = (r) => base + span * r;
    /** @param {FibLevel} l */
    const colOf = (l) => (s.oneColor ? s.color || '#787b86' : l.color || '#787b86');
    /** @param {number} x @param {number} y */
    const sv = (x, y) => ({ vpx: 0, dx: x, vp: 0, dy: y });
    /** @type {any[]} */
    const out = [];

    if (s.bgOn !== false && enabled.length > 1) {
      const op = s.bgOpacity != null ? s.bgOpacity : 0.1;
      for (let i = 0; i < enabled.length - 1; i++) {
        const ya = yAt(enabled[i].value),
          yb = yAt(enabled[i + 1].value),
          yl = Math.min(ya, yb),
          yh = Math.max(ya, yb);
        out.push({
          closed: true,
          fill: toAlpha(colOf(enabled[i]), op),
          path: [sv(xa, yl), sv(xb, yl), sv(xb, yh), sv(xa, yh)],
        });
      }
    }
    if (s.trendOn)
      out.push({
        path: [sv(x1, y1), sv(x2, y2)],
        stroke: s.trendColor || '#787b86',
        width: s.trendWidth || 1,
        dash: Tools.dash(s.trendStyle),
      });

    const lha = s.labelHAlign || 'right',
      lva = s.labelVAlign || 'middle';
    const fontSize = parseInt(s.labelFontSize, 10) || 11;
    const align = lha === 'left' ? 'right' : lha === 'center' ? 'center' : 'left';
    const baseline = lva === 'top' ? 'bottom' : lva === 'bottom' ? 'top' : 'middle';
    const lx = lha === 'left' ? xa - 4 : lha === 'center' ? (xa + xb) / 2 : xb + 4;
    const lyOff = lva === 'top' ? -3 : lva === 'bottom' ? 3 : 0;
    const centerGap = lha === 'center' && lva === 'middle'; // text on the line -> break it
    const mc = measureCtx();
    mc.font = fontSize + 'px sans-serif';
    enabled.forEach((l) => {
      const y = yAt(l.value),
        col = colOf(l);
      const parts = [];
      if (s.showRatio !== false)
        parts.push(s.levelMode === 'percents' ? `${+(l.value * 100).toFixed(1)}%` : String(l.value));
      if (s.showPrice !== false) parts.push(`(${priceAt(l.value).toFixed(dec)})`);
      const txt = parts.join(' ');
      const width = l.width != null ? l.width : s.lineWidth || 1,
        dash = Tools.dash(l.lineStyle != null ? l.lineStyle : s.lineStyle);
      /** @param {any} a @param {any} b */
      const line = (a, b) => ({ path: [a, b], stroke: col, width, dash });
      if (txt && centerGap) {
        const tw = mc.measureText(txt).width,
          cx = (xa + xb) / 2,
          g0 = cx - tw / 2 - 6,
          g1 = cx + tw / 2 + 6;
        if (g0 > xa) out.push(line(sv(xa, y), sv(g0, y)));
        if (g1 < xb) out.push(line(sv(g1, y), sv(xb, y)));
      } else {
        out.push(line(sv(xa, y), sv(xb, y)));
      }
      if (txt) out.push({ text: txt, at: sv(lx, y + lyOff), align, baseline, color: col, size: fontSize });
    });
    return out;
  },

  // Only the diagonal trend line (anchor P1 -> anchor P2) and its two endpoints are hit targets -- the level
  // lines, the background fills and the empty area between them are NOT. So the fib no longer behaves as a
  // solid rectangle: you grab/move/select it by its diagonal, and everything under the fib (other drawings,
  // lower-timeframe action when a higher-TF fib is zoomed in) stays reachable. The
  // diagonal is the hit line whether or not it is stroked (trendOn), since the anchors always define it.
  /** @param {ToolScreenPoint[]} pts @param {number} x @param {number} y @param {number} tol @param {ToolDrawing} [_d] */
  hitTest(pts, x, y, tol, _d) {
    if (pts.length < 2) return null;
    for (let i = 0; i < 2; i++)
      if (Tools.geom.dist(x, y, pts[i].x, pts[i].y) <= tol + 3) return { part: 'point', index: i };
    if (Tools.geom.distToSegment(x, y, pts[0].x, pts[0].y, pts[1].x, pts[1].y) <= tol) return { part: 'body' };
    return null;
  },
});

// ---------------------------------------------------------------- drawing helpers
// '#rrggbb'/'#rgb' -> 'rgba(...)'; pass-through if already rgb/rgba.
/** @param {string|undefined} color @param {number} a */
function toAlpha(color, a) {
  if (!color || color[0] !== '#') return color || 'rgba(0,0,0,0)';
  let h = color.slice(1);
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** @type {CanvasRenderingContext2D|null} */
let _mctx = null; // offscreen ctx to measure level labels (for the centered-label line break)
const measureCtx = () =>
  _mctx || (_mctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d')));

// Loaded via dynamic import() (an ES module at runtime); the empty export marks it a module for the
// checker too, giving it its own scope (no clash with sibling globals). No-op.
export {};
