// @ts-check
// Fair Value Gap -- a vanilla port of the LuxAlgo "Fair Value Gap [FVG]" Pine indicator.
// Original: (c) LuxAlgo, licensed CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/).
//
// Detects three-bar imbalances (a gap between bar[-2] and bar[0]) and marks each as a coloured Box that
// extends `extend` bars to the right, with an optional mid line and label. A gap is "mitigated" once price
// closes back through its far edge -- mitigated gaps drop their box and can leave a dashed level line; the
// most recent unmitigated gaps can show a solid level line. Dynamic mode replaces boxes with a single
// evolving band per side that shrinks toward its base as price trades into it (rendered as a filled plot).
//
// Threshold gates small gaps (a manual % of price, or Auto = the running mean bar range). Confirmed-bars
// only shifts detection back one bar so a gap never appears then vanishes on a forming candle. Lookback
// limits detection to the last N bars. Built on the study `shapes` channel (box + raw marks) plus
// `plots`/`fills` for Dynamic. The original's higher-timeframe input is covered by the engine's universal
// Timeframe control (every study gets it), so it is not re-declared here; the dashboard is omitted.
//
// Declares alert conditions (Bullish/Bearish FVG formed, Bullish/Bearish FVG mitigated) and emits matching
// `events` from calc, each stamped with the bar time where it becomes knowable: formation at the DETECTION
// bar (one bar later under Confirmed bars only), mitigation at the bar that closes through the gap's far edge.

// ---- option lists / helpers ----
const LSTYLES = [
  { key: 'solid', name: 'Solid' },
  { key: 'dashed', name: 'Dashed' },
  { key: 'dotted', name: 'Dotted' },
];
const NONE = 'rgba(0,0,0,0)';

/** @type {StudyInput[]} */
const inputs = [
  // General -- detection
  { key: 'lookbackPeriod', type: 'number', name: 'Lookback (bars, 0 = all)', default: 0, min: 0, tab: 'General' },
  { key: 'confirmedOnly', type: 'bool', name: 'Confirmed bars only', default: false, tab: 'General' },
  // General -- THRESHOLD section
  {
    key: 'thresholdPer',
    type: 'number',
    name: 'Threshold %',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1,
    tab: 'General',
    group: 'Threshold',
  },
  { key: 'auto', type: 'bool', name: 'Auto threshold', default: false, tab: 'General', group: 'Threshold' },
  // General -- LEVELS section
  { key: 'showLast', type: 'number', name: 'Unmitigated levels', default: 0, min: 0, tab: 'General', group: 'Levels' },
  { key: 'mitigationLevels', type: 'bool', name: 'Mitigation levels', default: false, tab: 'General', group: 'Levels' },
  // Style
  { key: 'extend', type: 'number', name: 'Extend (bars)', default: 20, min: 0, tab: 'Style' },
  { key: 'dynamic', type: 'bool', name: 'Dynamic', default: false, tab: 'Style' },
  { key: 'bullCss', type: 'color', name: 'Bullish FVG', default: 'rgba(8,153,129,0.3)', tab: 'Style' },
  { key: 'bearCss', type: 'color', name: 'Bearish FVG', default: 'rgba(242,54,69,0.3)', tab: 'Style' },
  // Mid line -- the colour swatch is a stroke (colour + width + style), so width/style are hidden siblings.
  { key: 'showMidLine', type: 'bool', name: 'Mid line', default: false, tab: 'Style', inline: 'mid' },
  {
    key: 'midLineColor',
    type: 'color',
    name: '',
    noLabel: true,
    default: '#b2b5be',
    tab: 'Style',
    inline: 'mid',
    enableWhen: 'showMidLine',
    stroke: { width: 'midWidth', lineStyle: 'midStyle' },
  },
  { key: 'midStyle', type: 'select', options: LSTYLES, default: 'dashed', hidden: true },
  { key: 'midWidth', type: 'number', default: 1, min: 1, max: 4, hidden: true },
  // Label -- the colour swatch is a text swatch (colour + size + bold + italic) as hidden siblings.
  { key: 'showLabel', type: 'bool', name: 'Show label', default: true, tab: 'Style', inline: 'lbl' },
  {
    key: 'labelText',
    type: 'text',
    name: '',
    noLabel: true,
    default: 'FVG',
    width: 70,
    tab: 'Style',
    inline: 'lbl',
    enableWhen: 'showLabel',
  },
  {
    key: 'labelColor',
    type: 'color',
    name: '',
    noLabel: true,
    default: '#b2b5be',
    tab: 'Style',
    inline: 'lbl',
    enableWhen: 'showLabel',
    text: { size: 'labelSize', bold: 'labelBold', italic: 'labelItalic' },
  },
  { key: 'labelSize', type: 'number', default: 10, hidden: true },
  { key: 'labelBold', type: 'bool', default: false, hidden: true },
  { key: 'labelItalic', type: 'bool', default: false, hidden: true },
];

Studies.register({
  id: 'fvg',
  overlay: true,
  alertConditions: [
    { key: 'bull', name: 'Bullish FVG' },
    { key: 'bear', name: 'Bearish FVG' },
    { key: 'bullMit', name: 'Bullish FVG mitigated' },
    { key: 'bearMit', name: 'Bearish FVG mitigated' },
  ],
  inputs,
  /**
   * @param {StudyBar[]} bars
   * @param {Record<string, any>} p
   */
  calc(bars, p) {
    /** @type {any[]} */
    const shapes = [];
    /** @type {any[]} */
    const plots = [];
    /** @type {any[]} */
    const fills = [];
    /** @type {StudyEvent[]} */
    const events = [];
    if (!bars || bars.length < 3) return { plots, shapes, events };

    const bull = p.bullCss || 'rgba(8,153,129,0.3)';
    const bear = p.bearCss || 'rgba(242,54,69,0.3)';
    const extend = Math.max(0, p.extend | 0);
    const dynamic = !!p.dynamic;
    const off = p.confirmedOnly ? 1 : 0;
    const lookback = Math.max(0, p.lookbackPeriod | 0);
    const lastIdx = bars.length - 1;
    const lastTime = bars[lastIdx].time;

    // one bar's time step (extend boxes/lines to the right by whole bars)
    let barDelta = 60;
    for (let k = lastIdx; k > 0; k--) {
      const d = bars[k].time - bars[k - 1].time;
      if (d > 0) {
        barDelta = d;
        break;
      }
    }

    // ---- detect gaps + drive the dynamic bands in one forward pass ----
    /** @type {{maxP:number,minP:number,isbull:boolean,ct:number,oldestTime:number,i:number,mitigated?:boolean,mitTime?:number}[]} */
    const records = [];
    let lastT = null,
      cumRatio = 0;
    let maxBull = NaN,
      minBull = NaN,
      maxBear = NaN,
      minBear = NaN;
    /** @type {any[]} */ const dMaxBull = [];
    /** @type {any[]} */ const dMinBull = [];
    /** @type {any[]} */ const dMaxBear = [];
    /** @type {any[]} */ const dMinBear = [];

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (b.low > 0) cumRatio += (b.high - b.low) / b.low;
      const threshold = p.auto ? (i >= 1 ? cumRatio / i : 0) : (p.thresholdPer || 0) / 100;

      let rec = null;
      if (i - 2 - off >= 0) {
        const nw = bars[i - off],
          md = bars[i - 1 - off],
          od = bars[i - 2 - off];
        const isBull = nw.low > od.high && md.close > od.high && (nw.low - od.high) / od.high > threshold;
        const isBear = od.low > nw.high && md.close < od.low && (od.low - nw.high) / nw.high > threshold;
        const withinLookback = lookback === 0 || i >= lastIdx - lookback;
        if (isBull && withinLookback && nw.time !== lastT) {
          rec = { maxP: nw.low, minP: od.high, isbull: true, ct: nw.time, oldestTime: od.time, i };
          lastT = nw.time;
        } else if (isBear && withinLookback && nw.time !== lastT) {
          rec = { maxP: od.low, minP: nw.high, isbull: false, ct: nw.time, oldestTime: od.time, i };
          lastT = nw.time;
        }
      }
      if (rec) {
        records.push(rec);
        events.push({ key: rec.isbull ? 'bull' : 'bear', time: b.time });
      }

      if (dynamic) {
        // bull band: top (maxBull) shrinks toward the fixed base (minBull) as price falls into it
        if (rec && rec.isbull) {
          maxBull = rec.maxP;
          minBull = rec.minP;
        } else if (!isNaN(maxBull)) {
          maxBull = Math.max(Math.min(b.close, maxBull), minBull);
        }
        // bear band: bottom (minBear) rises toward the fixed cap (maxBear) as price rises into it
        if (rec && !rec.isbull) {
          maxBear = rec.maxP;
          minBear = rec.minP;
        } else if (!isNaN(maxBear)) {
          minBear = Math.min(Math.max(b.close, minBear), maxBear);
        }
        if (!isNaN(maxBull)) {
          dMaxBull.push({ time: b.time, value: maxBull });
          dMinBull.push({ time: b.time, value: minBull });
        }
        if (!isNaN(maxBear)) {
          dMaxBear.push({ time: b.time, value: maxBear });
          dMinBear.push({ time: b.time, value: minBear });
        }
      }
    }

    // ---- mitigation: first bar at/after formation that closes through the gap's far edge ----
    for (const r of records) {
      for (let j = r.i; j < bars.length; j++) {
        const c = bars[j].close;
        if (r.isbull ? c < r.minP : c > r.maxP) {
          r.mitigated = true;
          r.mitTime = bars[j].time;
          break;
        }
      }
    }
    for (const r of records) {
      if (r.mitigated && r.mitTime != null) events.push({ key: r.isbull ? 'bullMit' : 'bearMit', time: r.mitTime });
    }
    events.sort((a, b) => a.time - b.time);

    // ---- boxes / mid line / label (unmitigated, non-dynamic) + mitigation lines (both modes) ----
    for (const r of records) {
      const col = r.isbull ? bull : bear;
      if (!dynamic && !r.mitigated) {
        const from = r.oldestTime,
          to = bars[r.i].time + extend * barDelta,
          mid = (r.maxP + r.minP) / 2;
        shapes.push({
          type: 'box',
          from,
          to,
          top: r.maxP,
          bottom: r.minP,
          color: col,
          borderColor: null,
          borderWidth: 0,
        });
        if (p.showMidLine)
          shapes.push({
            marks: [
              {
                stroke: p.midLineColor || '#b2b5be',
                width: p.midWidth | 0 || 1,
                dash: p.midStyle || 'dashed',
                path: [
                  { t: from, p: mid },
                  { t: to, p: mid },
                ],
              },
            ],
          });
        if (p.showLabel && p.labelText)
          shapes.push({
            marks: [
              {
                text: String(p.labelText),
                at: { t: to, p: mid, dx: -4 },
                color: p.labelColor || '#b2b5be',
                align: 'right',
                baseline: 'middle',
                size: p.labelSize | 0 || 10,
                bold: p.labelBold,
                italic: p.labelItalic,
              },
            ],
          });
      }
      if (p.mitigationLevels && r.mitigated) {
        const level = r.isbull ? r.minP : r.maxP;
        shapes.push({
          marks: [
            {
              stroke: col,
              width: 1,
              dash: 'dashed',
              path: [
                { t: r.ct, p: level },
                { t: r.mitTime, p: level },
              ],
            },
          ],
        });
      }
    }

    // ---- unmitigated levels: solid line at the far edge for the most recent N unmitigated gaps ----
    const showLast = Math.max(0, p.showLast | 0);
    if (showLast > 0) {
      const unmit = records
        .filter((r) => !r.mitigated)
        .sort((a, b) => b.ct - a.ct)
        .slice(0, showLast);
      for (const r of unmit) {
        const level = r.isbull ? r.minP : r.maxP;
        shapes.push({
          marks: [
            {
              stroke: r.isbull ? bull : bear,
              width: 1,
              path: [
                { t: r.ct, p: level },
                { t: lastTime, p: level },
              ],
            },
          ],
        });
      }
    }

    // ---- dynamic bands: invisible bounding plots + a fill per side ----
    if (dynamic) {
      if (dMaxBull.length) {
        plots.push({
          key: 'maxBull',
          name: 'Bull',
          type: 'line',
          data: dMaxBull,
          color: NONE,
          lineWidth: 0,
          legend: false,
        });
        plots.push({
          key: 'minBull',
          name: 'Bull',
          type: 'line',
          data: dMinBull,
          color: NONE,
          lineWidth: 0,
          legend: false,
        });
        fills.push({ top: 'maxBull', bottom: 'minBull', color: bull });
      }
      if (dMaxBear.length) {
        plots.push({
          key: 'maxBear',
          name: 'Bear',
          type: 'line',
          data: dMaxBear,
          color: NONE,
          lineWidth: 0,
          legend: false,
        });
        plots.push({
          key: 'minBear',
          name: 'Bear',
          type: 'line',
          data: dMinBear,
          color: NONE,
          lineWidth: 0,
          legend: false,
        });
        fills.push({ top: 'maxBear', bottom: 'minBear', color: bear });
      }
    }

    return { plots, fills, shapes, events };
  },
});

// Loaded via dynamic import() at runtime; the empty export gives this file its own module scope.
export {};
