// Cumulative Volume Delta (CVD) -- gallery copy of the app's src/studies/modules/volume_cvd.js. Identical
// algorithm; the only changes for the demo are (1) it registers via the global `Studies` (set by the demo
// page, the app convention) instead of an import, and (2) the chart-timezone offset is stubbed to 0 (the
// demo's synthetic data is UTC and the page sets no display timezone), replacing the app's workspace import.
//
// Unlike the per-bar Volume Delta (which zeroes every bar), CVD ACCUMULATES the buy/sell delta across bars
// within an ANCHOR period (default Day) and resets to 0 at each anchor boundary. It's drawn as candles: each
// bar is the OHLC of the running cumulative during that bar. Scans lower-timeframe sub-bars (ctx.intrabar)
// for the up/down volume split.
const getOffsetMin = () => 0; // demo: data is UTC, no display timezone (app reads workspace/timezone.js)

Studies.register({
  id: 'cvd',
  name: 'Cumulative Volume Delta',
  overlay: false, // its own sub-pane (the cumulative swings above/below zero)
  intrabar: true, // needs lower-timeframe sub-bars for the buy/sell split
  inputs: [
    {
      key: 'anchor',
      type: 'select',
      name: 'Anchor period',
      default: 'day',
      options: [
        { key: 'day', name: 'Day' },
        { key: 'week', name: 'Week' },
        { key: 'month', name: 'Month' },
      ],
    },
    { key: 'resetHour', type: 'number', name: 'Session reset (hour)', default: 0, min: 0, max: 23 },
    { key: 'chartColors', type: 'bool', name: 'Use chart colors', default: false },
    { key: 'upColor', type: 'color', name: 'Buy color', default: 'rgba(38,166,154,0.9)', legend: false },
    { key: 'downColor', type: 'color', name: 'Sell color', default: 'rgba(239,83,80,0.9)', legend: false },
  ],
  calc(bars, p, ctx) {
    const subs = ctx.intrabar || [];
    const cc = p.chartColors && ctx && ctx.candle ? ctx.candle : null;
    const up = cc ? cc.up : p.upColor || 'rgba(38,166,154,0.9)';
    const down = cc ? cc.down : p.downColor || 'rgba(239,83,80,0.9)';
    const anchor = p.anchor || 'day';
    const resetSec = Math.max(0, Math.min(23, p.resetHour | 0)) * 3600;
    let offSec = 0;
    try {
      offSec = (getOffsetMin() || 0) * 60;
    } catch (_) {} // chart display-tz offset (data is UTC)
    const keyOf = (t) => {
      const t2 = t + offSec - resetSec;
      const day = Math.floor(t2 / 86400);
      if (anchor === 'week') return Math.floor((day + 3) / 7); // Monday-aligned week (epoch day 0 = Thursday)
      if (anchor === 'month') {
        const d = new Date(t2 * 1000);
        return d.getUTCFullYear() * 12 + d.getUTCMonth();
      }
      return day;
    };

    let cvd = 0,
      prevKey = null;
    const data = [];
    bars.forEach((b, i) => {
      const key = keyOf(b.time);
      if (prevKey === null || key !== prevKey) {
        cvd = 0;
        prevKey = key;
      } // anchor boundary -> reset
      const open = cvd;
      let hi = open,
        lo = open;
      const sb = subs[i];
      if (sb && sb.length) {
        for (const s of sb) {
          const buy = s.open != null && s.close != null ? s.close >= s.open : true;
          cvd += buy ? s.volume || 0 : -(s.volume || 0);
          if (cvd > hi) hi = cvd;
          if (cvd < lo) lo = cvd;
        }
      } else {
        const vol = b.volume || 0;
        const buy = b.close != null && b.open != null ? b.close >= b.open : true;
        cvd += buy ? vol : -vol;
        if (cvd > hi) hi = cvd;
        if (cvd < lo) lo = cvd;
      }
      const close = cvd,
        col = close >= open ? up : down;
      data.push({
        time: b.time,
        value: close,
        segments: [{ from: open, to: close, color: col }], // candle body: open -> close
        wicks: [{ from: lo, to: hi, color: col, width: 1 }], // wick: intrabar cumulative low -> high
      });
    });

    return {
      plots: [{ key: 'cvd', name: 'CVD', type: 'segmented', precision: 0, data }],
      shapes: [{ type: 'hline', price: 0, color: 'rgba(120,123,134,0.5)', width: 1, lineStyle: 'solid' }], // zero axis
    };
  },
});
