// @ts-check
// Position — a trade-sizing box. THREE reference levels across a span: TARGET, ENTRY, STOP.
// Handle construction (deliberate):
//   ENTRY  — TWO handles, left + right. LEFT is multidirectional: it moves entry up/down AND owns the left
//            edge (drag it in time). RIGHT owns the right edge only -- it resizes the box in time and never
//            re-prices the entry line (so stretching the position can't offset the level you set).
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
// target + stop stats: the level's distance from entry -- as price points, in the instrument's smallest UNITS
// (a tick on a future, a pipette on forex -- both just the min increment), or a percent of the entry price.
// MULTI-select (checkboxes): a line can show any combination; an empty selection shows nothing.
const TS_STATS = [
  { key: 'offset', name: 'Price offset' },
  { key: 'units', name: 'Unit offset' },
  { key: 'percent', name: 'Percent offset' },
  { key: 'pnl', name: 'PnL' },
];
// entry stats: risk/reward ratio and the computed position quantity
const ENTRY_STATS = [
  { key: 'rr', name: 'Risk/reward ratio' },
  { key: 'qty', name: 'Quantity' },
];

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
    // position sizing inputs (Inputs tab). Account size is USD; 0 = unset. Risk is a % of the account or a
    // USD amount, per riskMode.
    accountSize: 0,
    risk: 1,
    riskMode: 'percent', // 'percent' | 'usd'
    // formatting: the displayed quantity is (base qty / lotSize) floored to `step`. User-set so it's broker-
    // agnostic: futures 1/1, forex micro-lot 100000/0.01, nano-lot 100000/0.001. Decimals come from step.
    lotSize: 1,
    step: 1,
  },
  settings: {
    inputs: buildInputsPanel, // the Inputs tab: entry/profit/stop levels in price + units, two-way with the tool
    style: [
      { name: 'Lines', controls: [{ key: 'color', type: 'color', width: 'width', lineStyle: 'lineStyle' }] },
      { name: 'Stop color', controls: [{ key: 'stopColor', type: 'color' }] },
      { name: 'Target color', controls: [{ key: 'targetColor', type: 'color' }] },
      { name: 'Text', controls: [{ key: 'textColor', type: 'color', size: 'textSize' }] },
      // STATS: pick which stat each level's label shows. The catalogs grow in later steps.
      { heading: 'Stats' },
      { name: 'Entry', controls: [{ key: 'entryStats', type: 'multiselect', options: ENTRY_STATS }] },
      { name: 'Target', controls: [{ key: 'targetStats', type: 'multiselect', options: TS_STATS }] },
      { name: 'Stop', controls: [{ key: 'stopStats', type: 'multiselect', options: TS_STATS }] },
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

    // horizontal center of the box IN SCREEN SPACE: average the edge PIXELS, not the time midpoint. The time
    // axis is not linear in time (non-uniform bars), so timeToX((left+right)/2) drifts off-center -- badly on
    // a narrow box, where the error is a large fraction of the width.
    const xL = view.timeToX(g.left),
      xR = view.timeToX(g.right);
    const scx = xL != null && xR != null ? (xL + xR) / 2 : null;

    // ---- per-level STAT labels (target/stop): the selected stat's VALUE, centered on the line. No role
    // prefix (the line's position says which it is). Placed OUTSIDE the box (target above, stop below). ----
    // offset  = the level's price distance from entry (points)
    // units   = that distance in the instrument's smallest units (price distance / tickSize -- a tick on a
    //           future, a pipette on forex; both are just the minimum increment)
    // percent = that distance as a percent of the entry price (entry is the 100% ruler)
    const unit = Number(view.tickSize) || 0;
    // pnlSign: target is a profit (+1), stop is a loss (-1). Only 'pnl' uses it.
    /** @param {string} stat @param {number} price @param {number} [pnlSign] @returns {string} */
    const statText = (stat, price, pnlSign) => {
      const d0 = Math.abs(price - g.entry);
      if (stat === 'offset') return d0.toFixed(dec);
      if (stat === 'units') return unit > 0 ? String(Math.round(d0 / unit)) : '';
      if (stat === 'percent') return g.entry ? ((d0 / Math.abs(g.entry)) * 100).toFixed(2) + '%' : '0%';
      if (stat === 'pnl') {
        const q = computeQty(s, g.entry, g.stop, view.tickSize, view.tickValue);
        const perPoint = unit > 0 ? (Number(view.tickValue) || 0) / unit : 0;
        if (q == null || perPoint <= 0) return '';
        const lot = Number(s.lotSize) > 0 ? Number(s.lotSize) : 1;
        const base = qtyLots(q, s) * lot; // the actual tradeable position, in base units
        // no currency symbol (USD is a given); 2 decimals; a loss keeps its minus so it can't read as a gain
        return 'PnL: ' + ((pnlSign || 1) * d0 * perPoint * base).toFixed(2);
      }
      return '';
    };
    // Each level's label is a rounded PILL centered on the box. Target/stop pills are filled with their zone
    // color (opaque, so they read over a translucent zone); the entry pill is light with an OUTLINE so it
    // stands out against the zones. The pill is sized to the text (screen-space rounded rect + the text).
    const size = parseInt(s.textSize, 10) || 12;
    /** @param {string} text @param {number} price @param {'above'|'below'|'on'} place @param {string} fill
     *  @param {string|null} stroke @param {string} txtColor */
    const pill = (text, price, place, fill, stroke, txtColor) => {
      if (!text || scx == null) return;
      const sx = scx;
      // size to the text -- multi-line for a stacked entry label (max line width x line count). lh matches
      // the mark renderer's line height (size * 1.25).
      const lines = String(text).split('\n');
      const lh = size * 1.25;
      let tw = 0;
      for (const ln of lines) tw = Math.max(tw, measureText(ln, size));
      const padX = 7,
        padY = 4,
        gap = 3,
        rad = 7,
        h = (lines.length - 1) * lh + size + 2 * padY;
      const dy = place === 'above' ? -(h / 2 + gap) : place === 'below' ? h / 2 + gap : 0;
      const sy = view.priceToY(price) + dy;
      const w = tw + 2 * padX;
      out.push({
        closed: true,
        fill,
        stroke: stroke || undefined,
        width: stroke ? 1.5 : undefined,
        path: roundRectPath(sx - w / 2, sy - h / 2, w, h, rad),
      });
      out.push({ text, at: sv(sx, sy), align: 'center', baseline: 'middle', color: txtColor, size });
    };
    /** @param {string[]} stats @param {number} price @param {number} pnlSign */
    const joined = (stats, price, pnlSign) =>
      (stats || [])
        .map((st) => statText(st, price, pnlSign))
        .filter(Boolean)
        .join(' · ');
    // target above its line (reward color, +PnL), stop below its line (risk color, -PnL)
    pill(joined(s.targetStats, g.target, 1), g.target, 'above', opaqueColor(s.targetColor || 'rgba(8,180,200,0.16)'), null, s.textColor || '#ffffff');
    pill(joined(s.stopStats, g.stop, -1), g.stop, 'below', opaqueColor(s.stopColor || 'rgba(120,123,134,0.12)'), null, s.textColor || '#ffffff');
    // entry stats (risk/reward ratio and/or quantity), joined into one pill on the entry line
    {
      const es = s.entryStats || [];
      /** @type {string[]} */
      const parts = [];
      if (es.includes('rr')) {
        const reward = Math.abs(g.target - g.entry),
          risk = Math.abs(g.stop - g.entry);
        if (risk > 0) parts.push('Risk/reward ratio: ' + (reward / risk).toFixed(2));
      }
      if (es.includes('qty')) {
        const q = computeQty(s, g.entry, g.stop, view.tickSize, view.tickValue);
        if (q != null) parts.push('Qty: ' + fmtQty(q, s));
      }
      // same fill as the target pill; the outline (band) is what makes it stand out, so no white needed.
      // entry stacks its stats (one per line) -- unlike the target/stop pills, which join on one line.
      if (parts.length)
        pill(parts.join('\n'), g.entry, 'on', opaqueColor(s.targetColor || 'rgba(8,180,200,0.16)'), s.color || '#363a45', s.textColor || '#ffffff');
    }

    // ---- optional price labels ON THE TOOL, at the LEFT or RIGHT end of each level (user's choice; separate
    // from the price-scale labels the engine draws in the axis gutter via style.priceLabels) ----
    // Left/right are SCREEN sides, not data points -- the tool is side-agnostic. Pick the edge whose pixel is
    // the visual left/right so a flipped box (right handle dragged past the left) still labels the right side.
    if (s.toolPriceLabels) {
      const onLeft = s.toolPriceSide === 'left';
      const flipped = xL != null && xR != null && xR < xL; // data right is visually left
      const leftEdge = flipped ? g.right : g.left; // time at the visual-left edge
      const rightEdge = flipped ? g.left : g.right; // time at the visual-right edge
      /** @param {number} p */
      const label = (p) => ({
        text: p.toFixed(dec),
        at: onLeft ? { t: leftEdge, p, dx: -6 } : { t: rightEdge, p, dx: 6 },
        align: onLeft ? 'right' : 'left',
        baseline: 'middle',
        color: s.textColor || '#ffffff',
        size: parseInt(s.textSize, 10) || 12,
      });
      out.push(label(g.target), label(g.entry), label(g.stop));
    }
    return out;
  },

  // Four handles: entry-left (moves entry + owns left edge), entry-right (owns right edge, time only), then
  // target-left, stop-left (price only). Order matches the reshape pins below. Each sits at its own point.
  /** @param {ToolScreenPoint[]} pts */
  handles(pts) {
    return pts.length >= 4 ? PINS.handles({ pts }) : pts;
  },
  /** @param {ToolDrawing} d @param {number} index @param {ToolDataPoint} dp */
  reshape(d, index, dp) {
    PINS.reshape(d, index, dp);
  },
});

// ---------------------------------------------------------------- Inputs tab (settings.inputs)
// The Inputs panel: entry / profit / stop levels shown as PRICE and as UNIT offset from entry (units = the
// instrument's smallest increment). Two-way with the tool -- edits write d.points and re-render; reopening
// reflects a dragged tool. Built with the settings-dialog's own classes so it matches the other tabs.
// ctx = { preview, tickSize, priceDecimals } from the dialog.
/** @param {string} tag @param {string} [cls] @param {string} [txt] */
const domEl = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
};

// The position quantity from the sizing inputs (style) + the stop distance + the instrument's currency-per-
// point. risk$ / (|entry-stop| * tickValue/tickSize). null when there isn't enough to size. Shared by the
// Inputs read-out and the entry-line stat.
/** @param {any} style @param {number} entry @param {number} stop @param {any} tickSize @param {any} tickValue @returns {number|null} */
const computeQty = (style, entry, stop, tickSize, tickValue) => {
  const account = Number(style.accountSize) || 0;
  const risk$ = style.riskMode === 'usd' ? Number(style.risk) || 0 : (account * (Number(style.risk) || 0)) / 100;
  const ts = Number(tickSize) || 0;
  const perPoint = ts > 0 ? (Number(tickValue) || 0) / ts : 0; // currency per price point per unit
  const lossPerUnit = Math.abs(entry - stop) * perPoint;
  return risk$ > 0 && lossPerUnit > 0 ? risk$ / lossPerUnit : null;
};
// the DISPLAYED quantity as a number: base / lotSize, floored to the tradeable step (round DOWN so you never
// exceed the risk). This is the real tradeable amount -- PnL uses it (times lotSize) too.
/** @param {number} qBase @param {any} style @returns {number} */
const qtyLots = (qBase, style) => {
  const lot = Number(style.lotSize) > 0 ? Number(style.lotSize) : 1;
  const step = Number(style.step) > 0 ? Number(style.step) : 1;
  return Math.floor(qBase / lot / step) * step;
};
// format that quantity with the decimals the step implies (1 -> 0, 0.01 -> 2, 0.001 -> 3).
/** @param {number} qBase @param {any} style @returns {string} */
const fmtQty = (qBase, style) => {
  const step = Number(style.step) > 0 ? Number(style.step) : 1;
  const decimals = (String(step).split('.')[1] || '').length;
  return qtyLots(qBase, style).toFixed(decimals);
};
/** @param {HTMLElement} body @param {ToolDrawing} d @param {{ preview: () => void, tickSize: any, tickValue: any, priceDecimals: any }} ctx */
function buildInputsPanel(body, d, ctx) {
  const unit = Number(ctx.tickSize) || 0;
  const dec = ctx.priceDecimals != null ? ctx.priceDecimals : 2;
  const step = unit > 0 ? String(unit) : 'any';
  const render = () => {
    body.innerHTML = '';
    const g = geo(d);
    /** @param {Partial<{entry:number, target:number, stop:number}>} ch */
    const commit = (ch) => {
      write(d, ch);
      ctx.preview();
      render(); // re-read so the linked price/unit fields refresh
    };
    // a labelled number-input row (price or unit count)
    /** @param {string} label @param {string} value @param {string} stp @param {(v:number)=>void} onCommit @param {boolean} [disabled] @param {string} [ph] */
    const row = (label, value, stp, onCommit, disabled, ph) => {
      const r = domEl('div', 'set-row');
      r.appendChild(domEl('div', 'set-row-left', label));
      const c = domEl('div', 'set-controls');
      const inp = /** @type {HTMLInputElement} */ (domEl('input', 'set-coord-in'));
      inp.type = 'number';
      inp.step = stp;
      inp.value = value;
      if (ph) inp.placeholder = ph;
      if (disabled) inp.disabled = true;
      inp.onchange = () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) onCommit(v);
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inp.blur();
      });
      c.appendChild(inp);
      r.appendChild(c);
      body.appendChild(r);
    };
    // units of a level from entry, and the price for a given unit count keeping the level's current side
    /** @param {number} lvl */
    const unitsOf = (lvl) => (unit > 0 ? String(Math.round(Math.abs(lvl - g.entry) / unit)) : '');
    /** @param {number} u @param {number} sign */
    const priceFromUnits = (u, sign) => g.entry + sign * Math.abs(Math.round(u)) * unit;
    const tSign = g.target < g.entry ? -1 : 1; // target defaults ABOVE entry
    const sSign = g.stop > g.entry ? 1 : -1; // stop defaults BELOW entry

    // ---- sizing inputs (params in style; account size is USD, 0 = unset) ----
    const st = /** @type {any} */ (d.style || (d.style = {}));
    const acct = Number(st.accountSize) || 0;
    row(
      'Account size',
      acct > 0 ? String(acct) : '',
      'any',
      (v) => {
        st.accountSize = v > 0 ? v : 0;
        ctx.preview();
        render();
      },
      false,
      'USD',
    );

    // Risk: a number + a %/USD mode select. Percent = of the account; USD = an absolute amount.
    {
      const r = domEl('div', 'set-row');
      r.appendChild(domEl('div', 'set-row-left', 'Risk'));
      const c = domEl('div', 'set-controls');
      const inp = /** @type {HTMLInputElement} */ (domEl('input', 'set-coord-in'));
      inp.type = 'number';
      inp.step = 'any';
      inp.value = (Number(st.risk) || 0).toFixed(2); // always a value -- blank risk is just zero
      inp.onchange = () => {
        const v = parseFloat(inp.value);
        st.risk = Number.isFinite(v) && v > 0 ? v : 0;
        ctx.preview();
        render();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inp.blur();
      });
      const sel = /** @type {HTMLSelectElement} */ (domEl('select'));
      [
        ['percent', '%'],
        ['usd', 'USD'],
      ].forEach(([k, n]) => {
        const o = /** @type {HTMLOptionElement} */ (domEl('option', undefined, n));
        o.value = k;
        sel.appendChild(o);
      });
      sel.value = st.riskMode === 'usd' ? 'usd' : 'percent';
      sel.onchange = () => {
        st.riskMode = sel.value;
        ctx.preview();
        render();
      };
      c.append(inp, sel);
      r.appendChild(c);
      body.appendChild(r);
    }

    // ---- formatting: how the quantity is expressed (broker-agnostic; user-set) ----
    body.appendChild(domEl('div', 'set-section', 'Formatting'));
    row('Lot size', String(Number(st.lotSize) > 0 ? Number(st.lotSize) : 1), 'any', (v) => {
      st.lotSize = v > 0 ? v : 1;
      ctx.preview();
      render();
    });
    // Step is a dropdown of the only realistic increments (whole / micro / nano) so users don't guess
    {
      const r = domEl('div', 'set-row');
      r.appendChild(domEl('div', 'set-row-left', 'Step'));
      const c = domEl('div', 'set-controls');
      const sel = /** @type {HTMLSelectElement} */ (domEl('select'));
      ['1', '0.01', '0.001'].forEach((v) => {
        const o = /** @type {HTMLOptionElement} */ (domEl('option', undefined, v));
        o.value = v;
        sel.appendChild(o);
      });
      const cur = String(Number(st.step) > 0 ? Number(st.step) : 1);
      sel.value = ['1', '0.01', '0.001'].includes(cur) ? cur : '1';
      sel.onchange = () => {
        st.step = Number(sel.value);
        ctx.preview();
        render();
      };
      c.appendChild(sel);
      r.appendChild(c);
      body.appendChild(r);
    }

    // ---- computed QUANTITY (read-out) -- shared calc + format with the entry-line stat ----
    const qty = computeQty(st, g.entry, g.stop, ctx.tickSize, ctx.tickValue);
    const qtyRow = domEl('div', 'set-row');
    qtyRow.appendChild(domEl('div', 'set-row-left', 'Quantity'));
    const qtyC = domEl('div', 'set-controls');
    qtyC.appendChild(domEl('b', undefined, qty != null ? fmtQty(qty, st) : '—'));
    qtyRow.appendChild(qtyC);
    body.appendChild(qtyRow);

    body.appendChild(domEl('div', 'set-section', 'Levels'));
    row('Entry price', g.entry.toFixed(dec), step, (v) => commit({ entry: v }));
    body.appendChild(domEl('div', 'set-section', 'Profit level'));
    row('Units', unitsOf(g.target), '1', (u) => commit({ target: priceFromUnits(u, tSign) }), !(unit > 0));
    row('Price', g.target.toFixed(dec), step, (v) => commit({ target: v }));
    body.appendChild(domEl('div', 'set-section', 'Stop level'));
    row('Units', unitsOf(g.stop), '1', (u) => commit({ stop: priceFromUnits(u, sSign) }), !(unit > 0));
    row('Price', g.stop.toFixed(dec), step, (v) => commit({ stop: v }));
  };
  render();
}

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

// pts (screen) are the four resolved points in order; each handle sits at its own point. Entry-left carries
// price + the left edge; entry-right carries the right edge only (dp.price ignored). Target/stop are price-
// only (dp.time ignored -- they stay at the left edge).
const PINS = pinHandles([
  pin({ at: (c) => c.pts[0], drag: (d, dp) => write(d, { left: dp.time, entry: dp.price }) }), // entry-left
  pin({ at: (c) => c.pts[1], drag: (d, dp) => write(d, { right: dp.time }) }), // entry-right (time only -- resizes width, never re-prices entry)
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
