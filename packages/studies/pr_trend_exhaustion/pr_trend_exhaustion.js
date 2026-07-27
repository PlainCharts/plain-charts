// @ts-check
// %R Trend Exhaustion [upslidedown] -- vanilla port, built up in layers.
//
// So far: the reusable Williams %R function run as a DUAL read -- fast (short lookback) + slow
// (long lookback) -- each smoothed by a shared MA; three guide lines (Top/Middle/Bottom) plus an
// Exhaustion Threshold that draws the two overbought/oversold zone lines at Middle +/- threshold.
// Still to layer: the OB/OS state itself, the cross-pane price boxes, and the reversal markers.
//
// Williams %R over `len` bars, measured against `src`:
//   %R = 100 * (src - highestHigh) / (highestHigh - lowestLow)
// where highestHigh / lowestLow are the extremes of the last `len` bars. Ranges 0..-100
// (src can't exceed the window's high, so the numerator is <= 0).
/**
 * @param {StudyBar[]} bars
 * @param {number} len
 * @param {string} srcKey
 * @returns {(number | null)[]}
 */
function percentR(bars, len, srcKey) {
  const n = bars.length;
  /** @type {(number | null)[]} */
  const out = new Array(n).fill(null);
  const L = Math.max(1, len | 0);
  for (let i = L - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let k = i - L + 1; k <= i; k++) {
      if (bars[k].high > hh) hh = bars[k].high;
      if (bars[k].low < ll) ll = bars[k].low;
    }
    const src = Studies.priceOf(bars[i], srcKey);
    out[i] = (hh === ll) ? 0 : (100 * (src - hh)) / (hh - ll);
  }
  return out;
}

// ---- moving averages (smoothing) ----
// Applied to a %R series that has a leading null prefix (until its window fills). Each returns
// an array aligned to the input; null where there isn't enough data yet. This helper is the
// reusable smoother -- the full indicator runs it on the fast, slow, and average %R.
/**
 * @param {(number | null)[]} a
 * @param {number} n
 * @returns {(number | null)[]}
 */
function _sma(a, n) {
  /** @type {(number | null)[]} */
  const out = new Array(a.length).fill(null);
  for (let i = n - 1; i < a.length; i++) {
    let s = 0, ok = true;
    for (let k = i - n + 1; k <= i; k++) { if (a[k] == null) { ok = false; break; } s += /** @type {number} */ (a[k]); }
    if (ok) out[i] = s / n;
  }
  return out;
}
/**
 * @param {(number | null)[]} a
 * @param {number} n
 * @returns {(number | null)[]}
 */
function _wma(a, n) {
  /** @type {(number | null)[]} */
  const out = new Array(a.length).fill(null);
  const wsum = (n * (n + 1)) / 2;
  for (let i = n - 1; i < a.length; i++) {
    let s = 0, ok = true;
    for (let k = 0; k < n; k++) { const x = a[i - n + 1 + k]; if (x == null) { ok = false; break; } s += x * (k + 1); }
    if (ok) out[i] = s / wsum;
  }
  return out;
}
// exponential family (ema alpha=2/(n+1), rma alpha=1/n); seeded at the first value, so it
// carries from the first non-null sample.
/**
 * @param {(number | null)[]} a
 * @param {number} alpha
 * @returns {(number | null)[]}
 */
function _ewma(a, alpha) {
  /** @type {(number | null)[]} */
  const out = new Array(a.length).fill(null);
  /** @type {number | null} */
  let prev = null;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x == null) { out[i] = null; continue; }
    prev = prev == null ? x : alpha * x + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}
/**
 * @param {(number | null)[]} a
 * @param {(number | null | undefined)[] | null | undefined} vol
 * @param {number} n
 * @returns {(number | null)[]}
 */
function _vwma(a, vol, n) {
  if (!vol) return _sma(a, n);
  /** @type {(number | null)[]} */
  const out = new Array(a.length).fill(null);
  for (let i = n - 1; i < a.length; i++) {
    let num = 0, den = 0, ok = true;
    for (let k = i - n + 1; k <= i; k++) { if (a[k] == null || vol[k] == null) { ok = false; break; } num += /** @type {number} */ (a[k]) * /** @type {number} */ (vol[k]); den += /** @type {number} */ (vol[k]); }
    if (ok && den) out[i] = num / den;
  }
  return out;
}
/**
 * @param {(number | null)[]} series
 * @param {string} type
 * @param {number} len
 * @param {(number | null | undefined)[] | null | undefined} volumes
 * @returns {(number | null)[]}
 */
function movingAverage(series, type, len, volumes) {
  const n = Math.max(1, len | 0);
  if (n <= 1) return series.slice();
  switch (type) {
    case 'sma': return _sma(series, n);
    case 'rma': return _ewma(series, 1 / n);
    case 'wma': return _wma(series, n);
    case 'vwma': return _vwma(series, volumes, n);
    case 'hma': {   // Hull: wma( 2*wma(n/2) - wma(n), sqrt(n) )
      const half = _wma(series, Math.max(1, Math.round(n / 2))), full = _wma(series, n);
      const diff = series.map((_, i) => (half[i] == null || full[i] == null) ? null : 2 * half[i] - full[i]);
      return _wma(diff, Math.max(1, Math.round(Math.sqrt(n))));
    }
    case 'ema':
    default: return _ewma(series, 2 / (n + 1));
  }
}

// contiguous [start, end] index spans where cond[i] is true (inclusive) -- the OB/OS runs.
/**
 * @param {boolean[]} cond
 * @returns {[number, number][]}
 */
function runs(cond) {
  /** @type {[number, number][]} */
  const out = [];
  let start = -1;
  for (let i = 0; i < cond.length; i++) {
    if (cond[i] && start < 0) start = i;
    else if (!cond[i] && start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, cond.length - 1]);
  return out;
}

// a small filled signal triangle at a price anchor, matching the sub-pane reversal markers:
// up=true (overbought) -> a down triangle above the point; up=false (oversold) -> an up triangle below.
/**
 * @param {number} t
 * @param {number} p
 * @param {string} color
 * @param {boolean} up
 */
function triMark(t, p, color, up) {
  const s = up ? -1 : 1;   // above the box (OB) / below the box (OS); apex points toward the box
  return { closed: true, fill: color, path: [
    { t, p, dx: -5, dy: s * 22 }, { t, p, dx: 5, dy: s * 22 }, { t, p, dx: 0, dy: s * 12 } ] };
}

// a color (#rrggbb or rgb/rgba) at a given alpha -- for the zone gradient's opaque/transparent stops
/**
 * @param {string} col
 * @param {number} a
 * @returns {string}
 */
function withAlpha(col, a) {
  if (!col) return `rgba(0,0,0,${a})`;
  const hex = /^#?([0-9a-f]{6})$/i.exec(String(col).trim());
  if (hex) { const n = parseInt(hex[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  const rm = /rgba?\(([^)]+)\)/i.exec(col);
  if (rm) { const [r, g, b] = rm[1].split(',').map((s) => parseFloat(s)); return `rgba(${r || 0},${g || 0},${b || 0},${a})`; }
  return col;
}

Studies.register({
  id: 'pr_trend_exhaustion',
  name: '%R Trend Exhaustion',
  description: 'A study that flags trend exhaustion using Williams %R.',
  overlay: false,   // oscillator: its own sub-pane below price
  inputs: [
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
    // exhaustion threshold: offsets the two zone lines away from the Middle line (Middle +/- threshold).
    // 0 = at the middle, 50 = at the top/bottom extremes. This is the overbought/oversold boundary.
    { key: 'threshold', name: 'Exhaustion Threshold', type: 'number', default: 30, min: 0, max: 50 },
    // multi read: several %R lookbacks (bar counts), each with an on/off toggle (the length + time
    // read-out sit to the right of the checkbox). Turning a period OFF drops its line and skips its
    // smoothing. The OB/OS exhaustion window is opened by ALL periods that are ON (every active %R must
    // agree); with only Period 1 & 2 on it is the original battle-tested dual confirmation.
    { key: 'show1', name: 'Period 1', type: 'bool', default: true, group: 'Periods', right: 'fastLength' },
    { key: 'fastLength', name: 'Period 1', type: 'number', default: 21, min: 1, max: 5000, showDuration: true, hidden: true },
    { key: 'show2', name: 'Period 2', type: 'bool', default: true, group: 'Periods', right: 'slowLength' },
    { key: 'slowLength', name: 'Period 2', type: 'number', default: 112, min: 1, max: 5000, showDuration: true, hidden: true },
    { key: 'show3', name: 'Period 3', type: 'bool', default: true, group: 'Periods', right: 'period3' },
    { key: 'period3', name: 'Period 3', type: 'number', default: 50, min: 1, max: 5000, showDuration: true, hidden: true },
    // smoothing: shared type + a per-line smoothing length (length 1 = raw). ema by default.
    { key: 'smoothType', name: 'Smoothing Type', type: 'select', default: 'ema', group: 'Smoothing', options: [
      { key: 'sma', name: 'sma' }, { key: 'ema', name: 'ema' }, { key: 'rma', name: 'rma' },
      { key: 'wma', name: 'wma' }, { key: 'hma', name: 'hma' }, { key: 'vwma', name: 'vwma' },
    ] },
    { key: 'fastSmoothLen', name: 'Period 1 Smoothing', type: 'number', default: 7, min: 1, max: 200, group: 'Smoothing' },
    { key: 'slowSmoothLen', name: 'Period 2 Smoothing', type: 'number', default: 3, min: 1, max: 200, group: 'Smoothing' },
    { key: 'p3SmoothLen', name: 'Period 3 Smoothing', type: 'number', default: 5, min: 1, max: 200, group: 'Smoothing' },
    // ---- Display tab ----
    // draw the exhaustion boxes on the price pane, capped to the most recent N (avoids clutter)
    { key: 'drawBoxes', name: 'Draw Boxes on Chart', type: 'bool', tab: 'Display', default: true, right: 'maxBoxes' },
    { key: 'maxBoxes', name: '#', type: 'number', tab: 'Display', hidden: true, default: 20, min: 1, max: 300 },
    // master palette: hot = overbought/top zone, cold = oversold/bottom zone. Drives the zone
    // shading (and, later, the price boxes + reversal markers).
    { key: 'coldColor', name: 'Cold Color', type: 'color', tab: 'Display', default: '#2466A7' },
    { key: 'hotColor', name: 'Hot Color', type: 'color', tab: 'Display', default: '#CA0017' },
    // the %R lines (color + width + dash in one swatch)
    { key: 'fastLine', name: 'Period 1 line', type: 'stroke', tab: 'Display', default: { color: '#d1d4dc', width: 1, style: 'solid' } },
    { key: 'slowLine', name: 'Period 2 line', type: 'stroke', tab: 'Display', default: { color: '#8baeff', width: 1, style: 'solid' } },
    { key: 'line3', name: 'Period 3 line', type: 'stroke', tab: 'Display', default: { color: '#b39ddb', width: 1, style: 'solid' } },
    // toggle the OB/OS gradient zone shading (a fill between the fast and slow lines)
    { key: 'shading', name: 'Fill Gradients in OB/OS Zone', type: 'bool', tab: 'Display', default: true },
    { key: 'fillZones', name: 'Fill Threshold Zones', type: 'bool', tab: 'Display', default: false, right: 'zoneOpacity' },
    { key: 'zoneOpacity', name: 'Zone opacity', type: 'range', tab: 'Display', hidden: true, min: 0, max: 0.5, step: 0.02, default: 0.1 },
    // Guide lines -- each is one row: [x show] Name [value] [color/width/style]. Self-styled hline
    // shapes. Middle is the reference; the two zone lines are DERIVED (Middle +/- threshold) and
    // inherit Top's stroke (upper zone) and Bottom's stroke (lower zone). Top/Bottom bound the range.
    { key: 'lvlTop', name: 'Top', type: 'level', tab: 'Levels', min: -100, max: 0, default: { value: 0, show: true, color: 'rgba(202,0,23,0.55)', width: 1, style: 'solid' } },
    { key: 'lvlMid', name: 'Middle', type: 'level', tab: 'Levels', min: -100, max: 0, default: { value: -50, show: true, color: 'rgba(120,123,134,0.5)', width: 1, style: 'solid' } },
    { key: 'lvlBot', name: 'Bottom', type: 'level', tab: 'Levels', min: -100, max: 0, default: { value: -100, show: true, color: 'rgba(36,102,167,0.6)', width: 1, style: 'solid' } },
  ],
  calc(bars, p) {
    const vols = bars.map((b) => b.volume);
    const on1 = p.show1 !== false, on2 = p.show2 !== false, on3 = p.show3 !== false;
    // each %R read is computed ONLY if its period is on; a period that's off drops its line and skips its
    // smoothing. Periods 1 & 2 feed the OB/OS signal, so it needs both on (guarded below).
    /** @type {(number | null)[] | null} */
    let fast = null;
    /** @type {(number | null)[] | null} */
    let slow = null;
    /** @type {(number | null)[] | null} */
    let p3 = null;
    if (on1) { fast = percentR(bars, p.fastLength, p.source); if (p.fastSmoothLen > 1) fast = movingAverage(fast, p.smoothType, p.fastSmoothLen, vols); }
    if (on2) { slow = percentR(bars, p.slowLength, p.source); if (p.slowSmoothLen > 1) slow = movingAverage(slow, p.smoothType, p.slowSmoothLen, vols); }
    if (on3) { p3 = percentR(bars, p.period3, p.source); if (p.p3SmoothLen > 1) p3 = movingAverage(p3, p.smoothType, p.p3SmoothLen, vols); }
    /** @type {StudyPlotPoint[]} */
    const fastData = [];
    /** @type {StudyPlotPoint[]} */
    const slowData = [];
    /** @type {StudyPlotPoint[]} */
    const p3Data = [];
    for (let i = 0; i < bars.length; i++) {
      if (on1 && /** @type {(number | null)[]} */ (fast)[i] != null) fastData.push({ time: bars[i].time, value: /** @type {number} */ (/** @type {(number | null)[]} */ (fast)[i]) });
      if (on2 && /** @type {(number | null)[]} */ (slow)[i] != null) slowData.push({ time: bars[i].time, value: /** @type {number} */ (/** @type {(number | null)[]} */ (slow)[i]) });
      if (on3 && /** @type {(number | null)[]} */ (p3)[i] != null) p3Data.push({ time: bars[i].time, value: /** @type {number} */ (/** @type {(number | null)[]} */ (p3)[i]) });
    }

    // guide lines as self-styled hline shapes (non-overlay -> drawn on the study's own sub-pane)
    /** @type {any[]} */
    const shapes = [];
    const hline = (/** @type {number} */ price, /** @type {any} */ s) => shapes.push({ type: 'hline', price, color: s.color, width: s.width || 1, lineStyle: s.style });
    const guide = (/** @type {any} */ lv) => { if (lv && typeof lv === 'object' && lv.show !== false && lv.value != null) hline(lv.value, lv); };
    [p.lvlTop, p.lvlMid, p.lvlBot].forEach(guide);

    // derived zone lines: Middle +/- threshold, inheriting Top's stroke (upper) and Bottom's (lower)
    const mid = (p.lvlMid && typeof p.lvlMid === 'object' && p.lvlMid.value != null) ? p.lvlMid.value : -50;
    const th = p.threshold != null ? p.threshold : 30;
    if (th > 0) {
      if (p.lvlTop && typeof p.lvlTop === 'object') hline(mid + th, p.lvlTop);
      if (p.lvlBot && typeof p.lvlBot === 'object') hline(mid - th, p.lvlBot);
    }

    // OB/OS state (dual confirmation): BOTH lines beyond a zone line. Overbought near the top,
    // oversold near the bottom.
    const upper = mid + th, lower = mid - th;
    // the exhaustion window is opened by ALL periods that are ON -- every active %R must agree: overbought
    // when each is at/beyond the upper zone, oversold when each is at/beyond the lower zone. One period on
    // -> single read; two/three -> dual/triple confirmation (Period 3 off reduces to the original P1 & P2).
    /** @type {(number | null)[][]} */
    const active = [];
    if (on1) active.push(/** @type {(number | null)[]} */ (fast));
    if (on2) active.push(/** @type {(number | null)[]} */ (slow));
    if (on3) active.push(/** @type {(number | null)[]} */ (p3));
    const signalOn = active.length > 0;
    const everyAt = (/** @type {number} */ i, /** @type {(v: number) => boolean} */ cmp) => active.every((s) => s[i] != null && cmp(/** @type {number} */ (s[i])));
    const overbought = signalOn ? bars.map((_, i) => everyAt(i, (v) => v >= upper)) : [];
    const oversold = signalOn ? bars.map((_, i) => everyAt(i, (v) => v <= lower)) : [];
    const hot = p.hotColor || '#CA0017', cold = p.coldColor || '#2466A7';
    const topVal = (p.lvlTop && typeof p.lvlTop === 'object' && p.lvlTop.value != null) ? p.lvlTop.value : 0;
    const botVal = (p.lvlBot && typeof p.lvlBot === 'object' && p.lvlBot.value != null) ? p.lvlBot.value : -100;

    // optional static zone fills: full-width bands over the overbought (Top..upper) and oversold
    // (lower..Bottom) zones, behind the lines. Anchored by price (p) full width (vpx 0..1).
    if (p.fillZones && th > 0) {
      const band = (/** @type {number} */ hiP, /** @type {number} */ loP, /** @type {string} */ color) => shapes.push({ marks: [{ back: true, closed: true, fill: color,
        path: [{ vpx: 0, p: hiP }, { vpx: 1, p: hiP }, { vpx: 1, p: loP }, { vpx: 0, p: loP }] }] });
      const topColor = (p.lvlTop && p.lvlTop.color) || hot, botColor = (p.lvlBot && p.lvlBot.color) || cold;
      const op = p.zoneOpacity != null ? p.zoneOpacity : 0.1;
      band(topVal, upper, withAlpha(topColor, op));   // overbought zone -> Top line's color
      band(lower, botVal, withAlpha(botColor, op));   // oversold zone -> Bottom line's color
    }

    // mark each exhaustion run on the PRICE pane (overlay) with a filled box spanning the run's time
    // and its price range (max high .. min low) -- hot for overbought, cold for oversold.
    const box = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ color, /** @type {boolean} */ up) => {
      let hi = -Infinity, lo = Infinity;
      for (let i = a; i <= b; i++) { if (bars[i].high > hi) hi = bars[i].high; if (bars[i].low < lo) lo = bars[i].low; }
      // ended = a bar AFTER the run dropped out of the zone (the exhaustion break happened). The final
      // run may still be ACTIVE (both lines still in the zone) -- no exit, no signal yet.
      const ended = b < bars.length - 1;
      const L = a, R = ended ? b + 1 : b;   // window opens on the first exhaustion candle; active run -> right edge = current bar
      shapes.push({ overlay: true, type: 'box', from: bars[L].time, to: bars[R].time, top: hi, bottom: lo,
        color: withAlpha(color, 0.2), borderColor: withAlpha(color, 0.55), borderWidth: 1 });
      // signal triangle only once the run has ENDED (down above the OB top, up below the OS bottom)
      if (ended) shapes.push({ overlay: true, marks: [triMark(bars[R].time, up ? hi : lo, color, up)] });
    };

    // sub-pane: ONE thin filled strip hugging the pane edge (top OB / bottom OS) over the run's time,
    // expanding as the run grows -- a single continuous box, no per-bar ticks. Plus the reversal
    // triangle at the exit once the run has ended.
    const track = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ color, /** @type {boolean} */ up) => {
      const ended = b < bars.length - 1;
      const from = bars[a].time, to = bars[ended ? b + 1 : b].time;
      const vp = up ? 0 : 1, s = up ? 1 : -1, y0 = s * 3, y1 = s * 10;   // ~7px strip at the edge
      // bounded + filled with slight opacity, same as the price-pane box (fill 0.2, border 0.55)
      /** @type {any[]} */
      const marks = [{ closed: true, fill: withAlpha(color, 0.2), stroke: withAlpha(color, 0.55), width: 1, path: [
        { t: from, vp, dy: y0 }, { t: to, vp, dy: y0 }, { t: to, vp, dy: y1 }, { t: from, vp, dy: y1 } ] }];
      if (ended) {
        marks.push({ closed: true, fill: color, path: [
          { t: to, vp, dx: -5, dy: s * 12 }, { t: to, vp, dx: 5, dy: s * 12 }, { t: to, vp, dx: 0, dy: s * 22 } ] });
      }
      shapes.push({ marks });
    };

    const obRuns = runs(overbought), osRuns = runs(oversold);
    obRuns.forEach(([a, b]) => track(a, b, hot, true));      // sub-pane markers (always shown)
    osRuns.forEach(([a, b]) => track(a, b, cold, false));
    if (p.drawBoxes !== false) {                             // price-pane boxes (capped to most recent N)
      /** @type {{ a: number, b: number, color: string, up: boolean }[]} */
      const events = [];
      obRuns.forEach(([a, b]) => events.push({ a, b, color: hot, up: true }));
      osRuns.forEach(([a, b]) => events.push({ a, b, color: cold, up: false }));
      events.sort((x, y) => x.b - y.b);
      events.slice(-Math.max(1, p.maxBoxes | 0)).forEach((e) => box(e.a, e.b, e.color, e.up));
    }

    // OB/OS zone shading: a gradient fill between the two %R lines, price-anchored so each zone's
    // color is strong at its extreme (Top / Bottom) and fades to transparent at the zone line.
    /** @type {any[]} */
    const fills = [];
    if (p.shading && on1 && on2) {   // the gradient fills BETWEEN the Period 1 & 2 lines -- both must be on
      // deep at the extreme, fading out 30 points in (the pine's look): 0 -> -30 (hot), -70 -> -100 (cold)
      fills.push(
        { top: 'fast', bottom: 'slow', gradient: { at: [topVal, topVal - 30], colors: [withAlpha(hot, 0.5), withAlpha(hot, 0)] } },
        { top: 'fast', bottom: 'slow', gradient: { at: [botVal + 30, botVal], colors: [withAlpha(cold, 0), withAlpha(cold, 0.5)] } },
      );
    }

    const fl = p.fastLine || {}, sl = p.slowLine || {}, l3 = p.line3 || {};
    /** @type {StudyPlot[]} */
    const plots = [];
    if (on2) plots.push({ key: 'slow', name: 'Period 2 %R', type: 'line', color: sl.color || '#8baeff', lineWidth: sl.width || 1, lineStyle: sl.style || 'solid', data: slowData });
    if (on3) plots.push({ key: 'p3', name: 'Period 3 %R', type: 'line', color: l3.color || '#b39ddb', lineWidth: l3.width || 1, lineStyle: l3.style || 'solid', data: p3Data });
    if (on1) plots.push({ key: 'fast', name: 'Period 1 %R', type: 'line', color: fl.color || '#d1d4dc', lineWidth: fl.width || 1, lineStyle: fl.style || 'solid', data: fastData });
    return {
      plots,
      fills,
      shapes,
      scale: { min: -100, max: 0 },   // %R lives in 0..-100; lock the pane so it never drifts
    };
  },
});

export {};
