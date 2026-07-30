// @ts-check
// Volume Delta rendered as CANDLES on the bottom overlay
// price scale — the same bottom band regular volume uses, now open to any study via the general
// overlay-scale capability (priceScaleId + scaleMargins).
//
// It scans each bar's LOWER-TIMEFRAME sub-bars to build the running buy/sell delta's OHLC
// (open / max / min / last), then draws it as a candle of ABSOLUTE values
// (plotcandle(abs(open), abs(max), abs(min), abs(last))), colored teal when the net
// delta is positive (buying) and red when negative (selling). Uses the segmented series (body +
// wick) so no candlestick plot type is needed.
//
// Gallery copy of the app's studies/modules/volume_delta_candle.js — identical algorithm; the only
// change is importing Studies from the library registry instead of the app's window.Studies global.
import { Studies } from '../registry.js';

Studies.register({
  id: 'volume_delta_candle',
  name: 'Volume Delta',
  overlay: true, // draws on the price pane, pinned to the bottom band (its own overlay scale)
  intrabar: true, // needs lower-timeframe sub-bars for the running delta
  inputs: [
    { key: 'height', type: 'number', name: 'Height %', default: 25, min: 5, max: 60, legend: false },
    { key: 'upColor', type: 'color', name: 'Buy color', default: 'rgba(38,166,154,0.9)', legend: false },
    { key: 'downColor', type: 'color', name: 'Sell color', default: 'rgba(239,83,80,0.9)', legend: false },
  ],
  calc(bars, p, ctx) {
    const subs = ctx.intrabar || [];
    const up = p.upColor || 'rgba(38,166,154,0.9)';
    const down = p.downColor || 'rgba(239,83,80,0.9)';
    /** @type {import('../types.js').StudyPlotPoint[]} */
    const data = [];
    bars.forEach((b, i) => {
      const sb = subs[i];
      // running cumulative delta across the sub-bars. The delta OPENS AT 0 each bar, so the bar is
      // anchored to the zero baseline (not floating) — body 0 -> |net|, wick to the peak |excursion|.
      let d = 0,
        hi = 0,
        lo = 0;
      if (sb && sb.length) {
        for (const s of sb) {
          const buy = s.open != null && s.close != null ? s.close >= s.open : true;
          d += buy ? s.volume || 0 : -(s.volume || 0);
          if (d > hi) hi = d;
          if (d < lo) lo = d;
        }
      } else {
        // no sub-bars yet (forming / most-recent bars — intrabar fetch lags): approximate the delta
        // from the chart bar itself so the bar still renders live, then it refines once sub-bars land.
        const vol = b.volume || 0;
        if (!vol) return;
        d = (b.close != null && b.open != null ? b.close >= b.open : true) ? vol : -vol;
        hi = Math.max(0, d);
        lo = Math.min(0, d);
      }
      const close = d;
      // abs() values, colored by the sign of the net (last) delta
      const c = Math.abs(close),
        peak = Math.max(Math.abs(hi), Math.abs(lo), c);
      const col = close > 0 ? up : down;
      data.push({
        time: b.time,
        value: close,
        segments: [{ from: 0, to: c, color: col }], // body: 0 -> |net delta|
        wicks: [{ from: 0, to: peak, color: col, width: 1 }], // wick: up to the intrabar |extreme|
      });
    });
    // bottom band: the study occupies the lower `height`% of the pane, on its own overlay scale.
    const top = Math.min(0.95, Math.max(0.4, 1 - (p.height || 25) / 100));
    return {
      plots: [
        {
          key: 'vd',
          name: 'Vol Δ',
          type: 'segmented',
          precision: 0,
          legend: false,
          priceScaleId: 'voldelta',
          scaleMargins: { top, bottom: 0 },
          data,
        },
      ],
    };
  },
});
