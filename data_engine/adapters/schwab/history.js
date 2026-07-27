// @ts-check
// Price-history plumbing for the Schwab adapter: the neutral-timeframe -> Schwab REST query mapping
// (periodType/frequencyType), client-side bar aggregation for units Schwab doesn't serve natively,
// and the candle fetch itself. The adapter surface (index.js) decides WHEN to fetch and how to stream
// the forming bar; this module owns HOW a window of candles is requested and shaped.
import { emitRaw } from '/data_engine/data/raw-tap.js';   // diagnostic tap (Data Interceptor); no-op when unused
import { foldExtras } from '/data_engine/bar-fields.js';
import { j, mdFail } from './common.js';

/**
 * @typedef {import('/data_engine/data/adapter-contract.js').Bar} Bar
 * @typedef {{ unit: string, n: number }} Timeframe
 * @typedef {{ q: Record<string, any>, bucket: number }} HistoryParams
 */

const NATIVE_MIN = [1, 5, 10, 15, 30];   // Schwab-supported minute frequencies
/** @param {Timeframe} tf */
export const pollMs = (tf) => (tf.unit === 'm' || tf.unit === 'h' ? 5000 : 60000);

// neutral tf -> { query params, aggregation bucket seconds (0 = native) }
/** @param {Timeframe} tf @param {number} fromMs @param {number} toMs @returns {HistoryParams} */
function historyParams(tf, fromMs, toMs) {
  const startDate = Math.round(fromMs), endDate = Math.round(toMs);
  if (tf.unit === 'm' || tf.unit === 'h') {
    if (tf.unit === 'm' && NATIVE_MIN.includes(tf.n)) {
      return { q: { periodType: 'day', frequencyType: 'minute', frequency: tf.n, startDate, endDate, needExtendedHoursData: false }, bucket: 0 };
    }
    // unsupported minute count or hours: fetch a native base and aggregate
    const base = tf.unit === 'h' ? 30 : 1;        // 30m aligns to hour boundaries
    const secs = (tf.unit === 'h' ? tf.n * 3600 : tf.n * 60);
    return { q: { periodType: 'day', frequencyType: 'minute', frequency: base, startDate, endDate, needExtendedHoursData: false }, bucket: secs };
  }
  const frequencyType = tf.unit === 'D' ? 'daily' : tf.unit === 'W' ? 'weekly' : 'monthly';
  return { q: { periodType: 'year', frequencyType, frequency: 1, startDate, endDate }, bucket: 0 };
}

// bucket native candles up to a coarser interval
/** @param {Bar[]} bars @param {number} secs @returns {Bar[]} */
function aggregate(bars, secs) {
  if (!secs) return bars;
  /** @type {Map<number, Bar & { volume: number }>} */
  const out = new Map();
  bars.forEach((b) => {
    const t = Math.floor(b.time / secs) * secs;
    let o = out.get(t);
    if (!o) { o = { time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }; out.set(t, o); }
    else { o.high = Math.max(o.high, b.high); o.low = Math.min(o.low, b.low); o.close = b.close; o.volume += b.volume || 0; }
    foldExtras(o, b);   // carry extra fields (open interest / tick volume / settlement) through aggregation
  });
  return [...out.values()].sort((a, b) => a.time - b.time);
}

/** @param {string} symbol @param {Timeframe} tf @param {number} fromMs @param {number} toMs @returns {Promise<{ bars: Bar[], error?: any }>} */
export async function fetchCandles(symbol, tf, fromMs, toMs) {
  const { q, bucket } = historyParams(tf, fromMs, toMs);
  const qs = new URLSearchParams({ symbol, ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])) });
  const data = await j('/api/schwab/md/pricehistory?' + qs.toString()).catch(() => null);
  emitRaw('schwab', 'bars', data);   // raw pricehistory response
  if (!data || data.error || !Array.isArray(data.candles)) {
    const err = (data && data.error) || 'no data';
    mdFail('bars (' + symbol + ')', err);
    return { bars: [], error: err };
  }
  const bars = data.candles.map((/** @type {any} */ c) => ({
    time: Math.floor(c.datetime / 1000),     // Schwab datetime is epoch ms
    open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
  }));
  return { bars: aggregate(bars, bucket) };
}
