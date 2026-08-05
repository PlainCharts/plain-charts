// @ts-check
// Position — a trade-sizing box. THREE reference levels across a span: TARGET, ENTRY, STOP.
// Handle construction (deliberate):
//   ENTRY  — TWO handles, left + right. They own the TIME span (the box's left/right edges) and move entry
//            up/down. This is how you stretch the whole position in time.
//   TARGET — ONE handle, left side. Moves the target price up/down only.
//   STOP   — ONE handle, left side. Moves the stop price up/down only.
// The two tinted areas (reward = entry->target, risk = entry->stop) are just fills between the levels.
// A flexible order primitive you relocate and stretch; it will grow to feed the order system.
//
// Four data points ([entry-left, entry-right, target, stop]) make each level independent -- dragging one
// never moves the others. One click drops a default box (onCreate); after that you drag the handles.
//
// BACKBONE (step one): independent levels + zones + the two side edges + optional price labels. The smart
// long/short flip, a quantity readout, sizing math, and order integration come in later steps.
import { pin, pinHandles } from './pin.js';
// (`Tools`, `ToolDrawing`, `ToolView`, `ToolScreenPoint`, `ToolDataPoint`, `ToolPane`, … are ambiently typed in tools-global.d.ts.)

// The stat catalogs for the per-level labels. Target and stop can show their PRICE OFFSET from entry (a
// simple distance); entry has no stats yet (its stats -- e.g. quantity -- come from the sizing algorithm we
// have not built). The catalogs grow as we develop stats.
// target + stop stats: the level's distance from entry -- as price points, ticks, or a percent of the entry
// price. MULTI-select (checkboxes): a line can show any combination; an empty selection shows nothing.
const TS_STATS = [
  { key: 'offset', name: 'Price offset' },
  { key: 'ticks', name: 'Tick offset' },
  { key: 'percent', name: 'Percent offset' },
];
// entry stat: the only meaningful one is the risk/reward ratio (reward distance / risk distance)
const ENTRY_STATS = [{ key: 'rr', name: 'Risk/reward ratio' }];

// which side of the box the tool price labels sit on
const SIDES = [
  { key: 'left', name: 'Left' },
  { key: 'right', name: 'Right' },
];

// ---- pill helpers (label backgrounds) ----
// an offscreen canvas to measure label width; null in a non-DOM context (unit tests fall back to an estimate)
/** @type {CanvasRenderingContext2D|null|undefined} */
let _mctx;
const measureCtx = () => {
  if (_mctx !== undefined) return _mctx;
  _mctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  return _mctx;
};
/** @param {string} txt @param {number} size @returns {number} */
const measureText = (txt, size) => {
  const ctx = measureCtx();
  if (ctx) {
    ctx.font = size + 'px sans-serif';
    return ctx.measureText(txt).width;
  }
  return String(txt).length * size * 0.6; // no DOM (tests): rough estimate
};
// strip the alpha off an rgba() so a translucent zone color yields a SOLID pill; hex/named pass through
/** @param {string} col @returns {string} */
const opaqueColor = (col) => {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(col || '');
  return m ? 'rgb(' + m[1] + ',' + m[2] + ',' + m[3] + ')' : col || '#787b86';
};
// a screen-space vertex (absolute pixels) for a mark path/anchor
/** @param {number} x @param {number} y */
const sv = (x, y) => ({ vpx: 0, dx: x, vp: 0, dy: y });
// a rounded-rect path as screen vertices (4 points per corner arc)
/** @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
const roundRectPath = (x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  /** @param {number} ccx @param {number} ccy @param {number} a0 @param {number} a1 */
  const arc = (ccx, ccy, a0, a1) => {
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const a = a0 + ((a1 - a0) * i) / 4;
      pts.push(sv(ccx + r * Math.cos(a), ccy + r * Math.sin(a)));
    }
    return pts;
  };
  return [
    ...arc(x + w - r, y + r, -Math.PI / 2, 0), // top-right
    ...arc(x + w - r, y + h - r, 0, Math.PI / 2), // bottom-right
    ...arc(x + r, y + h - r, Math.PI / 2, Math.PI), // bottom-left
    ...arc(x + r, y + r, Math.PI, 1.5 * Math.PI), // top-left
  ];
};

Tools.register({
  id: 'position',
  name: 'Position',
  glyph: '⊞',
  kind: 'draw',
  points: 1, // one click; onCreate expands it into the three independent levels
  defaultStyle: {
    color: '#363a45', // the level lines + box edges
    width: 1,
    lineStyle: 'solid',
    targetColor: 'rgba(8,180,200,0.16)', // reward zone (entry -> target)
    stopColor: 'rgba(120,123,134,0.12)', // risk zone (entry -> stop)
    textColor: '#ffffff',
    textSize: 12,
    priceLabels: false, // price-SCALE labels (engine draws one per point in the price axis)
    toolPriceLabels: false, // price labels ON THE TOOL (this tool draws them at each line's end)
    toolPriceSide: 'right', // which side those tool price labels sit on
    // which stats each level's label shows. Target/stop are multi-select arrays (any combination); entry has
    // none yet. Empty = the line shows no stat label.
    targetStats: [],
    stopStats: [],
    entryStats: [],
  },
  settings: {
    style: [
      { name: 'Lines', controls: [{ key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' }] },
      { name: 'Stop color', controls: [{ key: 'stopColor', type: 'color' }] },
      { name: 'Target color', controls: [{ key: 'targetColor', type: 'color' }] },
      { name: 'Text', controls: [{ key: 'textColor', type: 'color', size: 'textSize' }] },
      // STATS: pick which stat each level's label shows. The catalogs grow in later steps.
      { heading: 'Stats' },
      { name: 'Target', controls: [{ key: 'targetStats', type: 'multiselect', options: TS_STATS }] },
      { name: 'Stop', controls: [{ key: 'stopStats', type: 'multiselect', options: TS_STATS }] },
      { name: 'Entry', controls: [{ key: 'entryStats', type: 'multiselect', options: ENTRY_STATS }] },
      { name: 'Price labels (price scale)', toggle: 'priceLabels' },
      { name: 'Price labels (tool)', toggle: 'toolPriceLabels', controls: [{ key: 'toolPriceSide', type: 'select', options: SIDES }] },
    ],
  },

  // Expand a single click into FOUR points: [entry-left, entry-right, target, stop]. Entry sits at the
  // clicked price and spans ~15 bars forward; target/stop straddle it by a default height (a few recent bar
  // ranges) and are anchored at the LEFT edge. Point order defines the handle/reshape indices.
  /** @param {ToolDataPoint} a @param {ToolPane} pane @returns {ToolDataPoint[]} */
  onCreate(a, pane) {
    const bars = pane.barArr || [];
    const recent = bars.slice(-20).filter((b) => b.high != null && b.low != null);
    const avg = recent.length
      ? recent.reduce((s, b) => s + (Number(b.high) - Number(b.low)), 0) / recent.length
      : Math.abs(a.price) * 0.01;
    const h = (avg > 0 ? avg : Math.abs(a.price) * 0.01) * 3; // default box half-height
    const times = pane.barTimes || bars.map((b) => b.time);
    let right = a.time;
    const i = times.indexOf(a.time);
    if (i >= 0 && times.length) right = times[Math.min(times.length - 1, i + 15)];
    else if (times.length >= 2) right = a.time + ((times[times.length - 1] - times[0]) / Math.max(1, times.length - 1)) * 15;
    return [
      { time: a.time, price: a.price }, // entry-left (owns left edge)
      { time: right, price: a.price }, // entry-right (owns right edge)
      { time: a.time, price: a.price + h }, // target (left-anchored)
      { time: a.time, price: a.price - h }, // stop (left-anchored)
    ];
  },

  // Declarative: two tinted zones (reward entry->target, risk entry->stop) as PLAIN FILLS -- no bounding
  // box, no target/stop lines, no side edges. The ONLY line is the entry line. Optional price labels at the
  // right. Entry is READ from its own point -- never recomputed -- so moving target or stop leaves it put.
  /** @param {ToolDrawing} d @param {ToolView} view */
  marks(d, view) {
    const P = d.points || [];
    if (!P.length) return [];
    const s = /** @type {any} */ (d.style || {});
    const g = geo(d);
    /** @type {any[]} */
    const out = [];

    // ---- zones: just colored areas (entry->target, entry->stop). No outline. ----
    /** @param {number} pa @param {number} pb @param {string} fill */
    const zone = (pa, pb, fill) => ({
      closed: true,
      fill,
      path: [
        { t: g.left, p: pa },
        { t: g.right, p: pa },
        { t: g.right, p: pb },
        { t: g.left, p: pb },
      ],
    });
    out.push(zone(g.entry, g.target, s.targetColor || 'rgba(8,180,200,0.16)')); // reward
    out.push(zone(g.entry, g.stop, s.stopColor || 'rgba(120,123,134,0.12)')); // risk

    // ---- the ONLY line: the entry reference ----
    out.push({
      path: [
        { t: g.left, p: g.entry },
        { t: g.right, p: g.entry },
      ],
      stroke: s.color || '#363a45',
      width: s.width || 1,
      dash: Tools.dash(s.lineStyle),
    });

    const dec = view.priceDecimals != null ? view.priceDecimals : 2;

    const cx = (g.left + g.right) / 2; // horizontal center of the box -- every tool label is centered here

    // ---- per-level STAT labels (target/stop): the selected stat's VALUE, centered on the line. No role
    // prefix (the line's position says which it is). Placed OUTSIDE the box (target above, stop below). ----
    // offset  = the level's price distance from entry (points)
    // ticks   = that distance in ticks (price distance / instrument tick size)
    // percent = that distance as a percent of the entry price (entry is the 100% ruler)
    const tick = Number(view.tickSize) || 0;
    /** @param {string} stat @param {number} price @returns {string} */
    const statText = (stat, price) => {
      const d0 = Math.abs(price - g.entry);
      if (stat === 'offset') return d0.toFixed(dec);
      if (stat === 'ticks') return tick > 0 ? String(Math.round(d0 / tick)) : '';
      if (stat === 'percent') return g.entry ? ((d0 / Math.abs(g.entry)) * 100).toFixed(2) + '%' : '0%';
      return '';
    };
    // Each level's label is a rounded PILL centered on the box. Target/stop pills are filled with their zone
    // color (opaque, so they read over a translucent zone); the entry pill is light with an OUTLINE so it
    // stands out against the zones. The pill is sized to the text (screen-space rounded rect + the text).
    const size = parseInt(s.textSize, 10) || 12;
    /** @param {string} text @param {number} price @param {'above'|'below'|'on'} place @param {string} fill
     *  @param {string|null} stroke @param {string} txtColor */
    const pill = (text, price, place, fill, stroke, txtColor) => {
      if (!text) return;
      const sx = view.timeToX(cx);
      if (sx == null) return;
      const padX = 7,
        padY = 4,
        gap = 3,
        rad = 7,
        h = size + 2 * padY;
      const dy = place === 'above' ? -(h / 2 + gap) : place === 'below' ? h / 2 + gap : 0;
      const sy = view.priceToY(price) + dy;
      const w = measureText(text, size) + 2 * padX;
      out.push({
        closed: true,
        fill,
        stroke: stroke || undefined,
        width: stroke ? 1.5 : undefined,
        path: roundRectPath(sx - w / 2, sy - h / 2, w, h, rad),
      });
      out.push({ text, at: sv(sx, sy), align: 'center', baseline: 'middle', color: txtColor, size });
    };
    /** @param {string[]} stats @param {number} price */
    const joined = (stats, price) =>
      (stats || [])
        .map((st) => statText(st, price))
        .filter(Boolean)
        .join(' · ');
    // target above its line (reward color), stop below its line (risk color), entry on the line (outlined)
    pill(joined(s.targetStats, g.target), g.target, 'above', opaqueColor(s.targetColor || 'rgba(8,180,200,0.16)'), null, s.textColor || '#ffffff');
    pill(joined(s.stopStats, g.stop), g.stop, 'below', opaqueColor(s.stopColor || 'rgba(120,123,134,0.12)'), null, s.textColor || '#ffffff');
    if ((s.entryStats || []).includes('rr')) {
      const reward = Math.abs(g.target - g.entry),
        risk = Math.abs(g.stop - g.entry);
      // same fill as the target pill; the outline (band) is what makes it stand out, so no white needed
      if (risk > 0)
        pill(
          'Risk/reward ratio: ' + (reward / risk).toFixed(2),
          g.entry,
          'on',
          opaqueColor(s.targetColor || 'rgba(8,180,200,0.16)'),
          s.color || '#363a45',
          s.textColor || '#ffffff',
        );
    }

    // ---- optional price labels ON THE TOOL, at the LEFT or RIGHT end of each level (user's choice; separate
    // from the price-scale labels the engine draws in the axis gutter via style.priceLabels) ----
    if (s.toolPriceLabels) {
      const onLeft = s.toolPriceSide === 'left';
      /** @param {number} p */
      const label = (p) => ({
        text: p.toFixed(dec),
        at: onLeft ? { t: g.left, p, dx: -6 } : { t: g.right, p, dx: 6 },
        align: onLeft ? 'right' : 'left',
        baseline: 'middle',
        color: s.textColor || '#ffffff',
        size: parseInt(s.textSize, 10) || 12,
      });
      out.push(label(g.target), label(g.entry), label(g.stop));
    }
    return out;
  },

  // Four handles: entry-left, entry-right (own the time span + move entry), then target-left, stop-left
  // (price only). Order matches the reshape pins below. Each handle sits at its own point's position.
  /** @param {ToolScreenPoint[]} pts */
  handles(pts) {
    return pts.length >= 4 ? PINS.handles({ pts }) : pts;
  },
  /** @param {ToolDrawing} d @param {number} index @param {ToolDataPoint} dp */
  reshape(d, index, dp) {
    PINS.reshape(d, index, dp);
  },
});

// ---------------------------------------------------------------- geometry + reshape helpers
// the position's normalized geometry, read from its four points: [entry-left, entry-right, target, stop].
// Entry's two ends own the time span; target/stop are left-anchored price levels.
/** @param {ToolDrawing} d */
const geo = (d) => {
  const p = /** @type {ToolDataPoint[]} */ (d.points || []);
  const el = p[0] || { time: 0, price: 0 };
  const er = p[1] || el;
  return {
    left: el.time,
    right: er.time,
    entry: el.price,
    target: p[2] ? p[2].price : el.price,
    stop: p[3] ? p[3].price : el.price,
  };
};
// rewrite the four points from a partial geometry change (each level stays independent). Target and stop
// are kept anchored at the LEFT edge so their single handle rides the left side.
/** @param {ToolDrawing} d @param {Partial<{left:number, right:number, entry:number, target:number, stop:number}>} ch */
const write = (d, ch) => {
  const g = Object.assign(geo(d), ch);
  d.points = [
    { time: g.left, price: g.entry }, // entry-left
    { time: g.right, price: g.entry }, // entry-right
    { time: g.left, price: g.target }, // target (left-anchored)
    { time: g.left, price: g.stop }, // stop (left-anchored)
  ];
};

// The smart side: direction is implied by where the STOP sits relative to the ENTRY pivot -- below = long,
// above = short. The TARGET must stay on the profit side (long: above entry, short: below); when a stop drag
// flips the side, the target MIRRORS across entry. Same rule the pill primitive uses (plan-rules.js).
/** @param {number} entry @param {number} stop @returns {'long'|'short'} */
const sideOf = (entry, stop) => (stop < entry ? 'long' : 'short');
// the target, mirrored across entry if the stop-implied side leaves it on the wrong (loss) side
/** @param {number} entry @param {number} stop @param {number} target @returns {number} */
const profitTarget = (entry, stop, target) => {
  const wrong = sideOf(entry, stop) === 'long' ? target < entry : target > entry;
  return wrong ? 2 * entry - target : target;
};

// pts (screen) are the four resolved points in order; each handle sits at its own point. Entry's two ends
// carry the time span; target/stop are price-only (their dp.time is ignored -- they stay at the left edge).
const PINS = pinHandles([
  pin({ at: (c) => c.pts[0], drag: (d, dp) => write(d, { left: dp.time, entry: dp.price }) }), // entry-left
  pin({ at: (c) => c.pts[1], drag: (d, dp) => write(d, { right: dp.time, entry: dp.price }) }), // entry-right
  pin({ at: (c) => c.pts[2], drag: (d, dp) => write(d, { target: dp.price }) }), // target-left (price only)
  // stop-left (price only): the smart anchor -- a stop drag re-implies the side and mirrors the target to the
  // profit side when it flips, so target and stop are never left on the same side of entry.
  pin({
    at: (c) => c.pts[3],
    drag: (d, dp) => {
      const g = geo(d);
      write(d, { stop: dp.price, target: profitTarget(g.entry, dp.price, g.target) });
    },
  }),
]);
