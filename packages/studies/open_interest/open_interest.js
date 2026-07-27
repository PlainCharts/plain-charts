// @ts-check
// Open Interest - the total number of contracts held open, straight off the broker feed (bar.openInterest,
// captured by the data layer). It is a LEVEL, not a per-bar quantity, so it renders as a line in its own
// sub-pane (auto-scaled to the OI range) rather than a bottom histogram like volume.
//
// Open interest is a DAILY reading (it updates once a day at settlement), so it only has values on the
// daily/weekly timeframes - on intraday charts there is no open-interest data and the study is empty,
// which is the honest picture. The first consumer of the widened data feed.
Studies.register({
  id: 'open_interest',
  overlay: false,   // its own sub-pane (OI is on a different scale from price)
  requires: { bars: true },
  inputs: [
    { key: 'line', type: 'stroke', name: 'Open interest', default: { color: '#ffa726', width: 2, style: 'solid' } },
  ],
  calc(bars, p) {
    // only the bars that actually carry open interest (daily/weekly); intraday bars have none -> empty line.
    /** @type {StudyPlotPoint[]} */
    const data = [];
    for (const b of bars) if (b.openInterest != null) data.push({ time: b.time, value: b.openInterest });
    const s = p.line || {};
    return {
      plots: [
        { key: 'oi', name: 'Open Interest', type: 'line', precision: 0,
          color: s.color || '#ffa726', lineWidth: s.width || 2, lineStyle: s.style || 'solid', data },
      ],
    };
  },

  // ---- step form: emit a point only on bars that carry OI (the sparse `openInterest` column) ----
  /** @param {Record<string, any>} p */
  init(p) { const s = p.line || {}; return { color: s.color || '#ffa726', width: s.width || 2, style: s.style || 'solid' }; },
  /** @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  plots(p, ctx, s) { return [{ key: 'oi', name: 'Open Interest', type: 'line', precision: 0, color: s.color, lineWidth: s.width, lineStyle: s.style }]; },
  /** @param {number} i @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh */
  step(i, sh) { const oi = sh.openInterest[i]; return oi != null ? { oi: oi } : null; },
});
