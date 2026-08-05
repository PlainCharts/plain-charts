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
const ENTRY_STATS = [{ key: 'none', name: 'None' }]; // entry: nothing yet

// which side of the box the tool price labels sit on
const SIDES = [
  { key: 'left', name: 'Left' },
  { key: 'right', name: 'Right' },
];

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
    entryStat: 'none',
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
      { name: 'Entry', controls: [{ key: 'entryStat', type: 'select', options: ENTRY_STATS }] },
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
    // a line can show several stats at once (multi-select) -- render them as one centered label, joined.
    /** @param {string[]} stats @param {number} price @param {boolean} above */
    const statLabel = (stats, price, above) => {
      const text = (stats || [])
        .map((st) => statText(st, price))
        .filter(Boolean)
        .join(' · ');
      if (!text) return;
      out.push({
        text,
        at: { t: cx, p: price, dy: above ? -5 : 5 },
        align: 'center',
        baseline: above ? 'bottom' : 'top',
        color: s.textColor || '#ffffff',
        size: parseInt(s.textSize, 10) || 12,
      });
    };
    statLabel(s.targetStats, g.target, true);
    statLabel(s.stopStats, g.stop, false);

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
