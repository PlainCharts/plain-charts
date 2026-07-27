// @ts-check
// %R Terrain 3D (ether demo) -- the 3D generalization of the %R Trend Exhaustion study. That study
// reads Williams %R at just TWO lookbacks (fast 21 / slow 112). Those are only two samples of a whole
// %R-vs-lookback SURFACE: %R at every lookback from fast..slow. This renders that surface as a terrain,
// so "exhaustion" becomes a shape you can see -- when short AND long %R both bottom out, the entire
// surface sinks (deep-blue oversold); when both top out it bulges up (red overbought). The old fast /
// slow lines are simply the FRONT (fast) and BACK (slow) ridges of this terrain.
//
// Drawn entirely from the ether (path + text). Viewport-reactive: recomputes over the visible window.

const COLS = 40, ROWS = 12;

// diverging %R ramp: oversold (blue) -> neutral -> overbought (red)
/** @type {[number, string][]} */
const STOPS = [[0, '#4d8fd6'], [0.35, '#6a52c0'], [0.55, '#c9a227'], [0.78, '#f28c3a'], [1, '#e0405a']];
/** @param {string} h @returns {[number, number, number]} */
const hx = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
/** @param {number} t @returns {number[]} */
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
// apply an alpha to any colour string (hex or rgb/rgba)
/** @param {string} color @param {number} a */
function withAlpha(color, a) {
  color = color || '#ffffff';
  if (color[0] === '#') { const c = hx(color); return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`; }
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (m) { const q = m[1].split(',').map((s) => s.trim()); return `rgba(${q[0]}, ${q[1]}, ${q[2]}, ${a})`; }
  return color;
}
// parse a colour (hex/rgb/rgba) to [r,g,b]; blend two rgb arrays
/** @param {string} c @returns {number[]} */
const parseRgb = (c) => { if (!c) return [128, 128, 128]; if (c[0] === '#') return hx(c); const m = /rgba?\(([^)]+)\)/.exec(c); if (m) { const q = m[1].split(',').map((s) => parseFloat(s)); return [q[0] || 0, q[1] || 0, q[2] || 0]; } return [128, 128, 128]; };
/** @param {number[]} a @param {number[]} b @param {number} t @returns {number[]} */
const mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
const NEUTRAL = [78, 82, 98];   // muted slate for the between-zones band, so exhaustion pops

// Williams %R series (0 = overbought high, -100 = oversold low) + the smoothing MAs, copied from the
// %R Trend Exhaustion study so the terrain reads EXACTLY like its fast/slow lines. Raw %R over a short
// lookback pins to 0/-100 (a ceiling); the MA pulls it off the extremes -- that's what was missing.
/** @param {StudyBar[]} bars @param {number} len @param {string} srcKey @returns {(number|null)[]} */
function percentR(bars, len, srcKey) {
  const n = bars.length, out = new Array(n).fill(null), L = Math.max(1, len | 0);
  for (let i = L - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let k = i - L + 1; k <= i; k++) { if (bars[k].high > hh) hh = bars[k].high; if (bars[k].low < ll) ll = bars[k].low; }
    const src = Studies.priceOf(bars[i], srcKey);
    out[i] = (hh === ll) ? 0 : (100 * (src - hh)) / (hh - ll);
  }
  return out;
}
/** @param {(number|null)[]} a @param {number} n @returns {(number|null)[]} */
function _sma(a, n) { const out = new Array(a.length).fill(null); for (let i = n - 1; i < a.length; i++) { let s = 0, ok = true; for (let k = i - n + 1; k <= i; k++) { if (a[k] == null) { ok = false; break; } s += /** @type {number} */ (a[k]); } if (ok) out[i] = s / n; } return out; }
/** @param {(number|null)[]} a @param {number} n @returns {(number|null)[]} */
function _wma(a, n) { const out = new Array(a.length).fill(null), wsum = (n * (n + 1)) / 2; for (let i = n - 1; i < a.length; i++) { let s = 0, ok = true; for (let k = 0; k < n; k++) { const x = a[i - n + 1 + k]; if (x == null) { ok = false; break; } s += x * (k + 1); } if (ok) out[i] = s / wsum; } return out; }
/** @param {(number|null)[]} a @param {number} alpha @returns {(number|null)[]} */
function _ewma(a, alpha) { const out = new Array(a.length).fill(null); let prev = null; for (let i = 0; i < a.length; i++) { const x = a[i]; if (x == null) { out[i] = null; continue; } prev = prev == null ? x : alpha * x + (1 - alpha) * prev; out[i] = prev; } return out; }
/** @param {(number|null)[]} a @param {(number|null|undefined)[]|null|undefined} vol @param {number} n @returns {(number|null)[]} */
function _vwma(a, vol, n) { if (!vol) return _sma(a, n); const out = new Array(a.length).fill(null); for (let i = n - 1; i < a.length; i++) { let num = 0, den = 0, ok = true; for (let k = i - n + 1; k <= i; k++) { if (a[k] == null || vol[k] == null) { ok = false; break; } num += /** @type {number} */ (a[k]) * /** @type {number} */ (vol[k]); den += /** @type {number} */ (vol[k]); } if (ok && den) out[i] = num / den; } return out; }
/** @param {(number|null)[]} series @param {string} type @param {number} len @param {(number|null|undefined)[]|null} [volumes] @returns {(number|null)[]} */
function movingAverage(series, type, len, volumes) {
  const n = Math.max(1, len | 0);
  if (n <= 1) return series.slice();
  switch (type) {
    case 'sma': return _sma(series, n);
    case 'rma': return _ewma(series, 1 / n);
    case 'wma': return _wma(series, n);
    case 'vwma': return _vwma(series, volumes, n);
    case 'hma': { const half = _wma(series, Math.max(1, Math.round(n / 2))), full = _wma(series, n); const diff = series.map((_, i) => (half[i] == null || full[i] == null) ? null : 2 * /** @type {number} */ (half[i]) - /** @type {number} */ (full[i])); return _wma(diff, Math.max(1, Math.round(Math.sqrt(n)))); }
    case 'ema': default: return _ewma(series, 2 / (n + 1));
  }
}

Studies.register({
  id: 'pr_terrain',
  overlay: false,
  viewport: true,
  inputs: [
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
    { key: 'fast', name: 'Period 1', type: 'number', default: 21, min: 2, max: 400, group: 'Periods', showDuration: true },
    { key: 'slow', name: 'Period 2', type: 'number', default: 112, min: 3, max: 2000, group: 'Periods', showDuration: true },
    { key: 'period3', name: 'Period 3', type: 'number', default: 50, min: 2, max: 2000, group: 'Periods', showDuration: true },
    { key: 'smoothType', name: 'Smoothing', type: 'select', default: 'ema', group: 'Smoothing', options: [
      { key: 'sma', name: 'sma' }, { key: 'ema', name: 'ema' }, { key: 'rma', name: 'rma' }, { key: 'wma', name: 'wma' }, { key: 'hma', name: 'hma' }, { key: 'vwma', name: 'vwma' } ] },
    { key: 'fastSmooth', name: 'Period 1 smoothing', type: 'number', default: 7, min: 1, max: 200, group: 'Smoothing' },
    { key: 'slowSmooth', name: 'Period 2 smoothing', type: 'number', default: 3, min: 1, max: 200, group: 'Smoothing' },
    { key: 'p3Smooth', name: 'Period 3 smoothing', type: 'number', default: 5, min: 1, max: 200, group: 'Smoothing' },
    { key: 'pitch', name: 'Tilt (°)', type: 'range', default: 42, min: 0, max: 90, step: 1 },
    { key: 'height', name: 'Height (px)', type: 'number', default: 120, min: 30, max: 320 },
    { key: 'depth', name: 'Depth (px)', type: 'number', default: 120, min: 20, max: 320 },
    { key: 'baseline', name: 'Baseline (lift)', type: 'range', default: 0.58, min: 0.2, max: 0.9, step: 0.02 },
    { key: 'opacity', name: 'Surface opacity', type: 'range', default: 0.72, min: 0.2, max: 1, step: 0.02 },
    { key: 'baseColor', name: 'Base colour', type: 'color', default: '#4e5262' },
    { key: 'relief', name: 'Relief shading', type: 'bool', default: true },
    { key: 'reliefStrength', name: 'Relief strength', type: 'range', default: 0.55, min: 0, max: 1, step: 0.05 },
    { key: 'morph', name: 'Morph (animate)', type: 'bool', default: true },
    { key: 'morphSpeed', name: 'Morph speed', type: 'range', default: 0.18, min: 0.03, max: 0.6, step: 0.01 },
    { key: 'zones', name: 'Colour by OB/OS zones', type: 'bool', default: true },
    { key: 'shadeConfirm', name: 'Shade when', type: 'select', default: '123', options: [
      { key: '12', name: 'Period 1 & 2' }, { key: '13', name: 'Period 1 & 3' }, { key: '23', name: 'Period 2 & 3' }, { key: '123', name: 'All three' } ] },
    { key: 'threshold', name: 'Exhaustion threshold', type: 'number', default: 30, min: 0, max: 50 },
    { key: 'lvlTop', name: 'Top', type: 'level', tab: 'Levels', min: -100, max: 0, default: { value: 0, show: true, color: 'rgba(202,0,23,0.6)', width: 1, style: 'solid' } },
    { key: 'lvlMid', name: 'Middle', type: 'level', tab: 'Levels', min: -100, max: 0, default: { value: -50, show: true, color: 'rgba(120,123,134,0.5)', width: 1, style: 'solid' } },
    { key: 'lvlBot', name: 'Bottom', type: 'level', tab: 'Levels', min: -100, max: 0, default: { value: -100, show: true, color: 'rgba(36,102,167,0.65)', width: 1, style: 'solid' } },
    // the two derived zone lines (Middle +/- threshold) -- their appearance only; the VALUES stay tied to threshold
    { key: 'upperLine', name: 'Upper threshold', type: 'stroke', tab: 'Levels', default: { color: 'rgba(202,0,23,0.7)', width: 1, style: 'dashed' } },
    { key: 'lowerLine', name: 'Lower threshold', type: 'stroke', tab: 'Levels', default: { color: 'rgba(36,102,167,0.7)', width: 1, style: 'dashed' } },
    { key: 'signals', name: 'Exhaustion pearls', type: 'bool', tab: 'Levels', default: true },
    { key: 'confirm', name: 'Confirm with', type: 'select', tab: 'Levels', default: '123', options: [
      { key: '12', name: 'Period 1 & 2' }, { key: '13', name: 'Period 1 & 3' }, { key: '23', name: 'Period 2 & 3' }, { key: '123', name: 'All three' } ] },
    { key: 'pearlColor', name: 'Pearl colour', type: 'color', tab: 'Levels', default: '#f3efe6' },
    { key: 'pearlSize', name: 'Pearl size (px)', type: 'number', tab: 'Levels', default: 4, min: 1, max: 14 },
    { key: 'fastColor', name: 'Period 1 line', type: 'stroke', default: { color: '#ffffff', width: 2, style: 'solid' } },
    { key: 'slowColor', name: 'Period 2 line', type: 'stroke', default: { color: '#8baeff', width: 2, style: 'solid' } },
    { key: 'p3Color', name: 'Period 3 line', type: 'stroke', default: { color: '#b39ddb', width: 2, style: 'solid' } },
    { key: 'edgeOpacity', name: 'Edge opacity', type: 'range', default: 0.5, min: 0, max: 1, step: 0.02 },
  ],
  /**
   * @param {StudyBar[]} bars
   * @param {Record<string, any>} p
   * @param {{ visibleRange?:{from:number,to:number}, self?:any, requestFrames?:Function, [k:string]:any }} [ctx]
   */
  calc(bars, p, ctx) {
    const N = bars.length;
    // three period lookbacks; the surface fan spans the SHORTEST..LONGEST of them, so a longer Period 3
    // extends the surface's DEPTH (adds rows out the back). Each period is drawn as a ridge at its own depth.
    const p1 = Math.max(2, (p.fast | 0) || 21);
    const p2 = Math.max(2, (p.slow | 0) || 112);
    const p3v = Math.max(2, (p.period3 | 0) || 50);
    const fast = Math.min(p1, p2, p3v);              // front bound of the fan (shortest lookback)
    const slow = Math.max(fast + 1, p1, p2, p3v);    // back bound (longest lookback)
    if (N < slow + COLS + 2) {
      // not enough history for the longest lookback. Keep the pane's anchor plot alive and STOP any morph
      // loop (else it repaints against a removed series and throws); just draw no surface this round.
      if (ctx && typeof ctx.requestFrames === 'function') ctx.requestFrames(null);
      return { plots: [{ key: 'pr', name: '%R', type: 'line', color: 'rgba(255,255,255,0)', lineWidth: 0, data: [] }], shapes: [] };
    }

    // Period 1 anchors the FRONT (row 0), Period 2 the CENTRE row, Period 3 the BACK (row ROWS-1) -- by
    // LABEL, not by value, so each period keeps its slot (a big number in Period 1 pulls that long lookback
    // to the front). Evenly spaced; lookback-per-row is log-interpolated PIECEWISE between the anchors, so
    // the surface stays smooth even if the periods aren't in increasing order. periods carries row + colour.
    /** @param {any} v @returns {{ color?:string, width?:number, style?:string }} */
    const strk = (v) => (typeof v === 'string' ? { color: v } : (v || {}));   // migrate an old plain-colour value
    const s1 = strk(p.fastColor), s2 = strk(p.slowColor), s3 = strk(p.p3Color);
    /** @type {{ L:number, col:string, wd:number, dash:string, row:number }[]} */
    const periods = /** @type {any} */ ([
      { L: p1, col: s1.color || '#ffffff', wd: s1.width || 2, dash: s1.style || 'solid' },
      { L: p2, col: s2.color || '#8baeff', wd: s2.width || 2, dash: s2.style || 'solid' },
      { L: p3v, col: s3.color || '#b39ddb', wd: s3.width || 2, dash: s3.style || 'solid' },
    ]);
    const midRow = (ROWS - 1) / 2;
    periods[0].row = 0; periods[1].row = midRow; periods[2].row = ROWS - 1;
    /** @param {number} r */
    const lookbackAtRow = (r) => {
      if (r <= midRow) { const t = midRow ? r / midRow : 0; return periods[0].L * Math.pow(periods[1].L / periods[0].L, t); }
      const t = (r - midRow) / ((ROWS - 1) - midRow); return periods[1].L * Math.pow(periods[2].L / periods[1].L, t);
    };
    const Ls = []; for (let r = 0; r < ROWS; r++) Ls.push(Math.max(2, Math.round(lookbackAtRow(r))));

    // window: the visible range if viewport, else the recent window
    let lo = N - COLS, hi = N - 1;
    if (ctx && ctx.visibleRange) {
      let a = 0, b = N - 1;
      while (a < N && bars[a].time < ctx.visibleRange.from) a++;
      while (b > 0 && bars[b].time > ctx.visibleRange.to) b--;
      if (b > a + 1) { lo = a; hi = b; }
    }
    lo = Math.max(slow, lo); if (hi <= lo) hi = Math.min(N - 1, lo + 1);
    /** @type {number[]} */
    const idx = []; for (let c = 0; c < COLS; c++) idx.push(Math.round(lo + (c / (COLS - 1)) * (hi - lo)));

    // grid[r][c] = SMOOTHED %R at sampled bar idx[c] over lookback Ls[r]. Each row's %R series is EMA-
    // smoothed (interpolating the length from fastSmooth on the front row to slowSmooth on the back, like
    // the original's fast/slow lines). Computed over a sliced window (lookback + smoothing warmup) so the
    // viewport-reactive recompute stays cheap.
    const src = p.source || 'close', smType = p.smoothType || 'ema';
    const fastSm = Math.max(1, (p.fastSmooth | 0) || 7), slowSm = Math.max(1, (p.slowSmooth | 0) || 3), p3Sm = Math.max(1, (p.p3Smooth | 0) || 5);
    // smoothing anchored to the periods like the lookbacks: Period 1 smoothing at the front (row 0), Period 2
    // at the centre row, Period 3 at the back (row ROWS-1), interpolated piecewise between the anchors.
    /** @param {number} r */
    const smoothAtRow = (r) => {
      if (r <= midRow) { const t = midRow ? r / midRow : 0; return fastSm + (slowSm - fastSm) * t; }
      const t = (r - midRow) / ((ROWS - 1) - midRow); return slowSm + (p3Sm - slowSm) * t;
    };
    const w0 = Math.max(0, lo - slow - 4 * Math.max(fastSm, slowSm, p3Sm) - 2);
    const w = bars.slice(w0);
    const wvols = w.map((b) => b.volume);
    /** @type {number[][]} */
    const grid = [];
    for (let r = 0; r < ROWS; r++) {
      let s = percentR(w, Ls[r], src);
      const sm = Math.max(1, Math.round(smoothAtRow(r)));   // Period 1/2/3 smoothing, anchored front/centre/back
      if (sm > 1) s = movingAverage(s, smType, sm, wvols);
      const row = [];
      for (let c = 0; c < COLS; c++) { const gi = idx[c] - w0; row.push((gi >= 0 && s[gi] != null) ? s[gi] : 0); }
      grid.push(row);
    }

    // the three period %R reads at their EXACT lookbacks + own smoothing (like the 2D study). These drive
    // the exhaustion confirmation that fires the pearls -- separate from the surface's interpolated rows.
    /** @param {(number|null)[]} s @param {number} len @returns {(number|null)[]} */
    const smoothS = (s, len) => (len > 1 ? movingAverage(s, smType, len, wvols) : s);
    const pSeries = [smoothS(percentR(w, p1, src), fastSm), smoothS(percentR(w, p2, src), slowSm), smoothS(percentR(w, p3v, src), p3Sm)];
    // which periods must AGREE (all beyond the zone) for an exhaustion -- user-configurable via `confirm`
    const conf = String(p.confirm || '123');
    /** @type {(number|null)[][]} */
    const sel = [];
    if (conf.indexOf('1') >= 0) sel.push(pSeries[0]);
    if (conf.indexOf('2') >= 0) sel.push(pSeries[1]);
    if (conf.indexOf('3') >= 0) sel.push(pSeries[2]);

    /** @param {number} v */
    const u = (v) => (v + 100) / 100;                    // 0 (oversold) .. 1 (overbought)
    const HMAX = (p.height | 0) || 120, DEP = (p.depth | 0) || 120;
    /** @param {number} v */
    const hpx = (v) => (u(v) - 0.5) * 2 * HMAX;          // %R -> height px (overbought up, oversold down)
    const pit = ((p.pitch != null ? p.pitch : 42) * Math.PI) / 180, cp = Math.cos(pit), sp = Math.sin(pit);
    const baseY = p.baseline != null ? p.baseline : 0.58; // baseline (viewport fraction of the pane) where %R -50 sits;
                                                         // lower = model lifted up. Pure vertical placement -- the %R
                                                         // range (Top/Middle/Bottom) and threshold logic are untouched.

    // X = the sampled bar's TIME, so the terrain stays ALIGNED with price on the time axis. The lookback
    // (depth) recedes straight UP and the height rises -- both tilted by pitch in the VERTICAL plane. No
    // yaw, so time never rotates away from the chart. Pitch 90 = top-down (a time x lookback heatmap);
    // pitch 0 = the %R lines overlaid flat.
    /** @param {number} c @param {number} r @param {number} v */
    const proj = (c, r, v) => { const Y = hpx(v), Z = (r / (ROWS - 1)) * DEP; return { t: bars[idx[c]].time, vp: baseY, dy: -(Y * cp + Z * sp) }; };


    // ---- OB/OS zone colouring (like the original study): a cell is coloured by WHERE it sits vs the
    // exhaustion zones. upper/lower = Middle +/- threshold. Above upper -> hot (fades in toward Top),
    // below lower -> cold (toward Bottom), between -> muted neutral so exhaustion pops. Toggle 'zones'
    // off to fall back to the continuous %R ramp.
    const th = p.threshold != null ? p.threshold : 30;
    /** @param {any} o @param {number} dv @param {string} dc @returns {{ value:number, color:string, show:boolean }} */
    const lv = (o, dv, dc) => (o && typeof o === 'object') ? { value: o.value != null ? o.value : dv, color: o.color || dc, show: o.show } : { value: dv, color: dc, show: true };
    const topLv = lv(p.lvlTop, 0, 'rgba(202,0,23,0.6)'), midLv = lv(p.lvlMid, -50, 'rgba(120,123,134,0.5)'), botLv = lv(p.lvlBot, -100, 'rgba(36,102,167,0.65)');
    const upper = midLv.value + th, lower = midLv.value - th;
    const hotRgb = parseRgb(topLv.color), coldRgb = parseRgb(botLv.color), zonesOn = p.zones !== false;
    const baseRgb = p.baseColor ? parseRgb(p.baseColor) : NEUTRAL;   // the between-zones band colour
    /** @param {number} v */
    const zoneRgb = (v) => {
      if (v >= upper) return mix(baseRgb, hotRgb, topLv.value > upper ? Math.min(1, Math.max(0, (v - upper) / (topLv.value - upper))) : 1);
      if (v <= lower) return mix(baseRgb, coldRgb, botLv.value < lower ? Math.min(1, Math.max(0, (lower - v) / (lower - botLv.value))) : 1);
      return baseRgb;
    };
    // SHADING gate: shade the surface hot/cold only in COLUMNS where the chosen periods confirm the zone
    // (shadeConfirm = 1&2, 1&3, 2&3, or all). Per sampled column, ALL selected periods must be beyond the
    // threshold; otherwise that column stays neutral. Independent of the pearl trigger.
    const shConf = String(p.shadeConfirm || '123');
    /** @type {(number|null)[][]} */
    const selS = [];
    if (shConf.indexOf('1') >= 0) selS.push(pSeries[0]);
    if (shConf.indexOf('2') >= 0) selS.push(pSeries[1]);
    if (shConf.indexOf('3') >= 0) selS.push(pSeries[2]);
    const obCol = new Array(COLS), osCol = new Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const gi = idx[c] - w0;
      obCol[c] = selS.length > 0 && selS.every((s) => gi >= 0 && s[gi] != null && s[gi] >= upper);
      osCol[c] = selS.length > 0 && selS.every((s) => gi >= 0 && s[gi] != null && s[gi] <= lower);
    }
    /** @param {number} v @param {number} c */
    const cellRgb = (v, c) => zonesOn ? ((obCol[c] || osCol[c]) ? zoneRgb(v) : baseRgb) : ramp(u(v));
    const FA = p.opacity != null ? p.opacity : 0.72;

    // ---- build every mark from a grid `g`. Surface + ridges MORPH with g; guides/pearls/text are fixed
    // references (they don't ease). Called once per frame by the tween loop with the eased display grid.
    /** @param {number[][]} g @returns {any[]} */
    const render = (g) => {
      /** @type {any[]} */
      const m = [];
      // relief (hillshade): shade each quad by the tilt of its surface normal against a fixed light, so the
      // surface reads as 3D relief instead of a flat sheet. The shading normal is taken from a COLUMN-smoothed
      // copy of the height field (gs) -- raw %R jitters bar-to-bar and would otherwise turn into noisy vertical
      // stripes. When relief is on the grid mesh lines are dropped so the shading carries the form on its own.
      const relief = p.relief !== false, reliefK = p.reliefStrength != null ? p.reliefStrength : 0.55;
      const Lx = -0.5, Ly = 0.72, Lz = 0.48, HN = 8;   // light from the upper-left, slightly toward the viewer
      let gs = g;
      if (relief) {   // 5-tap blur along columns (the noisy time axis); rows/depth kept as-is
        gs = g.map((row, r) => row.map((_, c) => { let s = 0, n = 0; for (let dc = -2; dc <= 2; dc++) { const cc = c + dc; if (cc >= 0 && cc < COLS) { s += g[r][cc]; n++; } } return s / n; }));
      }
      const gridStroke = relief ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.18)';
      // surface quads, BACK-to-FRONT by row (the front row covers the back -- correct without yaw)
      for (let r = ROWS - 2; r >= 0; r--) {
        for (let c = 0; c < COLS - 1; c++) {
          const v = (g[r][c] + g[r][c + 1] + g[r + 1][c] + g[r + 1][c + 1]) / 4;
          let col = cellRgb(v, c);
          if (relief) {
            const gx = ((gs[r][c + 1] + gs[r + 1][c + 1]) - (gs[r][c] + gs[r + 1][c])) * 0.5;
            const gz = ((gs[r + 1][c] + gs[r + 1][c + 1]) - (gs[r][c] + gs[r][c + 1])) * 0.5;
            const nx = -gx, nz = -gz, nl = Math.sqrt(nx * nx + HN * HN + nz * nz) || 1;
            const d = Math.max(0, (nx * Lx + HN * Ly + nz * Lz) / nl);
            const sh = (1 - reliefK) + reliefK * d;
            col = [Math.round(col[0] * sh), Math.round(col[1] * sh), Math.round(col[2] * sh)];
          }
          m.push({ closed: true, fill: rgba(col, FA), stroke: gridStroke, width: relief ? 0 : 0.5,
            path: [proj(c, r, g[r][c]), proj(c + 1, r, g[r][c + 1]), proj(c + 1, r + 1, g[r + 1][c + 1]), proj(c, r + 1, g[r + 1][c])] });
        }
      }

      // Top / Middle / Bottom guide lines + the derived zone lines (Middle +/- threshold), on the front
      // plane at their %R level -- the same references as the 2D study.
      /** @param {number} val @param {string} color @param {string} [dash] @param {number} [wd] */
      const guide = (val, color, dash, wd) => { const path = []; for (let c = 0; c < COLS; c++) path.push(proj(c, 0, val)); m.push({ path, stroke: color, width: wd || 1, dash }); };
      if (topLv.show !== false) guide(topLv.value, topLv.color);
      if (midLv.show !== false) guide(midLv.value, midLv.color);
      if (botLv.show !== false) guide(botLv.value, botLv.color);
      const ul = p.upperLine || {}, ll = p.lowerLine || {};   // Upper/Lower line appearance (colour/width/style)
      guide(upper, ul.color || withAlpha(topLv.color, 0.8), ul.style || 'dashed', ul.width);
      guide(lower, ll.color || withAlpha(botLv.color, 0.8), ll.style || 'dashed', ll.width);

      // the period ridges (surface contours) -- one per period, styled by its stroke (colour/width/dash)
      const eo = p.edgeOpacity != null ? p.edgeOpacity : 0.5;
      // draw a ridge at a fractional row, interpolating between the two surrounding rows
      /** @param {number} rf @param {string} color @param {number} width @param {string} dash */
      const ridgeAt = (rf, color, width, dash) => {
        const r0 = Math.floor(rf), r1 = Math.min(ROWS - 1, r0 + 1), f = rf - r0;
        const path = [];
        for (let c = 0; c < COLS; c++) { const v = g[r0][c] + (g[r1][c] - g[r0][c]) * f; path.push(proj(c, rf, v)); }
        m.push({ path, stroke: withAlpha(color, eo), width, dash });
      };
      // one ridge per period at its EVENLY spaced anchor row, painted back-to-front so nearer ridges win
      for (let k = periods.length - 1; k >= 0; k--) ridgeAt(periods[k].row, periods[k].col, periods[k].wd, periods[k].dash);

      // Exhaustion pearls: the %R Trend Exhaustion reversal signal, generalized. overbought = EVERY selected
      // period's %R >= upper; oversold = every selected period's %R <= lower (the `confirm` set picks which
      // periods must agree: 1&2, 1&3, 2&3, or all three). A run is a contiguous stretch where that holds; the
      // reversal fires on the FIRST bar the run breaks (any selected period leaves the zone). The pearl sits on
      // the threshold line (front plane) at that reversal bar -- a bead the orange line runs through.
      if (p.signals !== false && sel.length) {
        const pr = Math.max(1, (p.pearlSize | 0) || 4), pc = p.pearlColor || '#f3efe6';
        const rim = withAlpha('#000000', 0.35), sheen = withAlpha('#ffffff', 0.5);
        // a signal sits on the FRONT threshold line (row 0 -> depth Z = 0), at level v, at bar time t
        /** @param {number} t @param {number} v */
        const projSig = (t, v) => ({ t, vp: baseY, dy: -(hpx(v) * cp) });
        /** @param {{ t:number, vp:number, dy:number }} b */
        const pearl = (b) => {
          const ring = [];
          for (let k = 0; k <= 22; k++) { const a = (k / 22) * Math.PI * 2; ring.push({ t: b.t, vp: b.vp, dx: pr * Math.cos(a), dy: b.dy + pr * Math.sin(a) }); }
          m.push({ closed: true, path: ring, fill: pc, stroke: rim, width: 1 });
          const hr = pr * 0.4, hi = [];
          for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI * 2; hi.push({ t: b.t, vp: b.vp, dx: -pr * 0.3 + hr * Math.cos(a), dy: b.dy - pr * 0.3 + hr * Math.sin(a) }); }
          m.push({ closed: true, path: hi, fill: sheen });
        };
        // confirmation state per bar: every SELECTED period beyond the zone (series aligned to w = bars.slice(w0))
        const nW = w.length, ob = new Array(nW), os = new Array(nW);
        for (let i = 0; i < nW; i++) {
          ob[i] = sel.every((s) => s[i] != null && /** @type {number} */ (s[i]) >= upper);
          os[i] = sel.every((s) => s[i] != null && /** @type {number} */ (s[i]) <= lower);
        }
        // fire on the run break (true -> false); only draw signals whose bar is in the visible span [lo, hi]
        for (let i = 1; i < nW; i++) {
          const gi = w0 + i;
          if (gi < lo || gi > hi) continue;
          if (ob[i - 1] && !ob[i]) pearl(projSig(w[i].time, upper));   // overbought run broke -> pearl on upper line
          if (os[i - 1] && !os[i]) pearl(projSig(w[i].time, lower));   // oversold run broke  -> pearl on lower line
        }
      }

      m.push({ text: '%R Terrain 3D  ·  fast ' + fast + ' (front) / slow ' + slow + ' (back)', at: { vpx: 0.02, vp: 0.05, dx: 0, dy: 0 }, color: '#d3d6dd', size: 12 });
      return m;
    };

    // faint plot so the study owns a pane + scale (the fast %R line drives it)
    const line = []; for (let c = 0; c < COLS; c++) line.push({ time: bars[idx[c]].time, value: grid[0][c] });
    const plots = [{ key: 'pr', name: '%R', type: 'line', color: 'rgba(255,255,255,0)', lineWidth: 0, data: line }];

    // ---- retained "breath": ease a DISPLAY grid toward the freshly computed TARGET so the surface FLOWS
    // instead of snapping. Screen identity -- cell (r,c) is a fixed screen cell, so market data ADVECTS
    // through the surface as you scroll (values flow, the sheet doesn't just translate). State lives on
    // ctx.self (per-attachment, survives recomputes); ctx.requestFrames drives the ease on the chart's
    // frame clock. Toggle 'morph' off (or in a headless/no-rAF host) to snap straight to the target.
    const animate = p.morph !== false && ctx && ctx.self && typeof ctx.requestFrames === 'function';
    if (!animate) {
      if (ctx && typeof ctx.requestFrames === 'function') ctx.requestFrames(null);   // stop any running loop
      return { plots, shapes: [{ marks: render(grid) }] };
    }
    const self = ctx.self;
    const sameDims = self.display && self.display.length === ROWS && self.display[0] && self.display[0].length === COLS;
    if (!sameDims) self.display = grid.map((row) => row.slice());   // first paint (or dims changed) -> snap
    self.target = grid;
    const k = Math.min(0.6, Math.max(0.03, p.morphSpeed != null ? p.morphSpeed : 0.18));
    let settled = false;
    const step = () => {
      if (settled) return null;
      const d = self.display, tg = self.target;
      let maxd = 0;
      for (let r = 0; r < ROWS; r++) { const dr = d[r], tr = tg[r]; for (let c = 0; c < COLS; c++) { const diff = tr[c] - dr[c]; const ad = diff < 0 ? -diff : diff; if (ad > maxd) maxd = ad; dr[c] += diff * k; } }
      if (maxd < 0.06) { for (let r = 0; r < ROWS; r++) { const dr = d[r], tr = tg[r]; for (let c = 0; c < COLS; c++) dr[c] = tr[c]; } settled = true; }   // snap on the last frame, then stop
      return [{ marks: render(d) }];
    };
    // `animate` already verified ctx + requestFrames-is-a-function above; TS can't carry that narrowing here.
    /** @type {Function} */ (ctx.requestFrames)(step);
    return { plots, shapes: [{ marks: render(self.display) }] };
  },
});

// Loaded via dynamic import() (an ES module at runtime); the empty export gives this file its own
// module scope so its top-level const helpers don't collide with sibling study modules' globals.
export {};
