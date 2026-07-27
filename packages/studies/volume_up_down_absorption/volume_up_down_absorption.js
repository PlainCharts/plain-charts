// @ts-check
// Up/Down Volume + Absorption - the Up/Down Volume study with an absorption highlight. Absorption =
// strongly one-sided aggression (delta is a large share of the aggressor volume) that produces almost
// no price result (a small candle body relative to its range): the aggressors were met by passive
// orders and soaked up - effort without result. It works BOTH ways - strong buying met by passive
// selling (bullish delta) highlights the up box; strong selling met by passive buying (bearish delta)
// highlights the down box. When |delta| and the flat-body test both hold, that side's box is repainted
// in the highlight colour. Both thresholds are user inputs. Copy of volume_up_down.js with the highlight.
Studies.register({
  id: 'volume_stack_absorption',
  overlay: false,
  intrabar: true,   // real up/down needs sub-bars
  requires: { bars: true, intrabars: true },
  inputs: [
    { key: 'chartColors', type: 'bool', name: 'Use chart colors', default: false },   // match the chart candles for up/down
    { key: 'upColor', type: 'color', name: 'Up volume', default: 'rgba(38,166,154,0.55)', legend: false },
    { key: 'downColor', type: 'color', name: 'Down volume', default: 'rgba(239,83,80,0.55)', legend: false },
    // the Delta delineation line, coloured by the sign of the net delta (up minus down)
    { key: 'deltaUp', type: 'color', name: 'Delta up', default: '#0b3d1e', legend: false },
    { key: 'deltaDown', type: 'color', name: 'Delta down', default: '#5c1212', legend: false },
    // --- absorption highlight: strong bullish delta + a flat candle body ---
    { key: 'absorb', type: 'bool', name: 'Absorption highlight', default: true },
    { key: 'deltaPct', type: 'number', name: 'Delta ≥ % of volume', default: 65, min: 0, max: 100, enableWhen: 'absorb' },
    { key: 'bodyPct', type: 'number', name: 'Body ≤ % of range', default: 10, min: 0, max: 100, enableWhen: 'absorb' },
    { key: 'absorbColor', type: 'color', name: 'Highlight', default: 'rgba(224,64,251,0.9)', legend: false, enableWhen: 'absorb' },
  ],
  /**
   * @param {StudyBar[]} bars
   * @param {Record<string, any>} p
   * @param {Record<string, any>} [ctx]
   * @returns {StudyResult}
   */
  calc(bars, p, ctx) {
    const subs = (/** @type {Record<string, any>} */ (ctx)).intrabar || [];
    // up/down volume colours: the chart's candle colours when "Use chart colors" is on, else the custom ones
    const cc = (p.chartColors && ctx && ctx.candle) ? ctx.candle : null;
    const upCol = cc ? cc.up : (p.upColor || 'rgba(38,166,154,0.55)');
    const downCol = cc ? cc.down : (p.downColor || 'rgba(239,83,80,0.55)');
    const dThr = (p.deltaPct != null ? p.deltaPct : 65) / 100;   // delta as a share of aggressor volume
    const bThr = (p.bodyPct != null ? p.bodyPct : 10) / 100;     // body as a share of the bar range
    const hi = p.absorbColor || 'rgba(224,64,251,0.9)';
    /** @type {StudyPlotPoint[]} */
    const data = [];
    bars.forEach((b, i) => {
      const sb = subs[i];
      let up = 0, down = 0;
      const hasSubs = !!(sb && sb.length);
      if (hasSubs) {
        for (const s of sb) {
          const bull = (s.open != null && s.close != null) ? s.close >= s.open : true;
          if (bull) up += s.volume || 0; else down += s.volume || 0;
        }
      } else {
        // no sub-bars yet (forming / most-recent bars): approximate from the chart bar so it renders
        const vol = b.volume || 0; if (!vol) return;
        if (b.close != null && b.open != null ? b.close >= b.open : true) up = vol; else down = vol;
      }
      const delta = up - down, total = up + down;
      // absorption: strongly one-sided aggression (|delta| a big share of volume) meeting a flat candle
      // body -- in EITHER direction. Only on bars with REAL sub-bars (the approximated forming bar has
      // a fake +/-100% delta).
      const range = (b.high != null && b.low != null) ? (b.high - b.low) : 0;
      const body = (b.close != null && b.open != null) ? Math.abs(b.close - b.open) : range;
      const ratio = total > 0 ? delta / total : 0;                 // (up - down) / (up + down), signed
      const bodyR = range > 0 ? body / range : 1;                  // range == 0 -> can't be flat
      const absorbed = p.absorb && hasSubs && Math.abs(ratio) >= dThr && bodyR <= bThr;
      const bullAbsorb = absorbed && ratio > 0;   // strong buying soaked up -> highlight the up box
      const bearAbsorb = absorbed && ratio < 0;   // strong selling soaked up -> highlight the down box
      data.push({
        time: b.time,
        value: delta,
        segments: [
          { from: 0, to: up, color: bullAbsorb ? hi : upCol },      // up-volume BOX: highlight when buying is absorbed
          { from: -down, to: 0, color: bearAbsorb ? hi : downCol }, // down-volume BOX: highlight when selling is absorbed
        ],
        lines: [
          // delta delineation keeps its own colour so it stays readable ON TOP of a highlighted box
          { level: delta, color: delta >= 0 ? (p.deltaUp || '#0b3d1e') : (p.deltaDown || '#5c1212'), width: 1 },
        ],
      });
    });
    return { plots: [{ key: 'vol', name: 'Up/Dn Vol', type: 'segmented', precision: 0, data }] };
  },

  // ---- step form: same bar, from the shared window's sub-bars (pure consumer) ----
  /** @param {Record<string, any>} p @param {Record<string, any>} [ctx] */
  init(p, ctx) {
    const cc = (p.chartColors && ctx && ctx.candle) ? ctx.candle : null;
    return {
      upCol: cc ? cc.up : (p.upColor || 'rgba(38,166,154,0.55)'),
      downCol: cc ? cc.down : (p.downColor || 'rgba(239,83,80,0.55)'),
      dThr: (p.deltaPct != null ? p.deltaPct : 65) / 100,
      bThr: (p.bodyPct != null ? p.bodyPct : 10) / 100,
      hi: p.absorbColor || 'rgba(224,64,251,0.9)',
    };
  },
  plots() { return [{ key: 'vol', name: 'Up/Dn Vol', type: 'segmented', precision: 0 }]; },
  /** @param {number} i @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  step(i, sh, p, ctx, s) {
    const sb = sh.sub && sh.sub[i];
    let up = 0, down = 0;
    const hasSubs = !!(sb && sb.length);
    if (hasSubs) {
      for (const x of sb) { const bull = (x.open != null && x.close != null) ? x.close >= x.open : true; if (bull) up += x.volume || 0; else down += x.volume || 0; }
    } else {
      const vol = sh.volume[i] || 0; if (!vol) return null;
      if (sh.close[i] != null && sh.open[i] != null ? sh.close[i] >= sh.open[i] : true) up = vol; else down = vol;
    }
    const delta = up - down, total = up + down;
    const range = (sh.high[i] != null && sh.low[i] != null) ? (sh.high[i] - sh.low[i]) : 0;
    const body = (sh.close[i] != null && sh.open[i] != null) ? Math.abs(sh.close[i] - sh.open[i]) : range;
    const ratio = total > 0 ? delta / total : 0;
    const bodyR = range > 0 ? body / range : 1;
    const absorbed = p.absorb && hasSubs && Math.abs(ratio) >= s.dThr && bodyR <= s.bThr;
    const bullAbsorb = absorbed && ratio > 0;
    const bearAbsorb = absorbed && ratio < 0;
    return { vol: { value: delta, segments: [
      { from: 0, to: up, color: bullAbsorb ? s.hi : s.upCol },
      { from: -down, to: 0, color: bearAbsorb ? s.hi : s.downCol },
    ], lines: [
      { level: delta, color: delta >= 0 ? (p.deltaUp || '#0b3d1e') : (p.deltaDown || '#5c1212'), width: 1 },
    ] } };
  },
});
