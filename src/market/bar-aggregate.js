// @ts-check
// Broker-agnostic bar aggregation: build clock-anchored (UTC) display bars from a finer BASE
// timeframe. Some feeds stamp intraday bars at the SESSION open (e.g. RTH futures on :30), so the
// native higher-TF bar lands OFF the clock grid. We fix it once, at the data layer -- aggregate a
// base TF into UTC clock buckets (floor(t / tf) * tf) -- so every display TF is clock-anchored for
// ANY broker. No broker is special-cased; a generic off-grid test decides when to aggregate.
// Bar times are UNIX SECONDS throughout (matching the rest of the app).
import { barMs } from '../workspace/timeframes.js';
import { foldExtras } from '../../data_engine/index.js';

/** @typedef {import('../../data_engine/index.js').Bar} Bar */
// Neutral timeframe descriptor: unit + multiple, with a canonical string id (the canonical shape
// callers pass, from timeframes.js — assignable to barMs's TfSpec).
/** @typedef {import('../workspace/timeframes.js').Interval} Tf */
// An aggregation group: a Bar whose volume is always materialized (seeded to 0, then summed).
/** @typedef {Bar & { volume: number }} AggBar */

// The base TF to aggregate a display TF from, or null = use the feed natively (no aggregation):
//   Daily+ (already day-anchored)          -> null
//   1m (the finest display resolution)     -> null (already on the minute)
//   a multiple of 5m, and > 5m             -> 5m  (10m, 15m, 30m, 1h, 4h, ...)
//   any other intraday (2m, 3m, 7m, ...)   -> 1m
// Every display TF is a whole multiple of its base, so clock buckets line up exactly.
/** @param {Tf | null | undefined} tf @returns {Tf | null} */
export function baseTfFor(tf) {
  if (!tf || tf.unit === 'D' || tf.unit === 'W' || tf.unit === 'M') return null;
  const ms = barMs(tf);
  if (ms <= 60000) return null; // 1m: finest, already clock-aligned
  const FIVE = 5 * 60000;
  if (ms % FIVE === 0 && ms > FIVE) return { id: '5m', unit: 'm', n: 5 };
  return { id: '1m', unit: 'm', n: 1 };
}

// Does this feed deliver bars OFF the clock grid for `tf`? True if ANY bar's time is not a whole
// multiple of the TF (i.e. session-anchored rather than clock-anchored). tfSec = TF in seconds.
/** @param {Bar[] | null | undefined} bars @param {number} tfSec @returns {boolean} */
export function offGrid(bars, tfSec) {
  if (!bars || !tfSec) return false;
  for (const b of bars) {
    if (b && Number.isFinite(b.time) && b.time % tfSec !== 0) return true;
  }
  return false;
}

// Aggregate base bars into clock-anchored display bars. bucket = floor(time / tfSec) * tfSec;
// O = first bar in the bucket, H = max high, L = min low, C = last close, V = summed volume.
// Input may be unsorted; output is ascending by time. tfSec = display TF in seconds.
/** @param {Bar[] | null | undefined} baseBars @param {number} tfSec @returns {Bar[]} */
export function aggregate(baseBars, tfSec) {
  /** @type {Map<number, AggBar>} */
  const out = new Map();
  const sorted = [...(baseBars || [])].sort((a, b) => a.time - b.time);
  for (const b of sorted) {
    if (!b || !(b.close > 0)) continue;
    const bt = Math.floor(b.time / tfSec) * tfSec;
    let g = out.get(bt);
    if (!g) {
      g = { time: bt, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 };
      out.set(bt, g);
    } else {
      if (b.high > g.high) g.high = b.high;
      if (b.low < g.low) g.low = b.low;
      g.close = b.close;
      g.volume += b.volume || 0;
    }
    foldExtras(g, b); // carry openInterest / tickVolume / settlement / ... through aggregation
  }
  return [...out.values()]; // insertion order == ascending (base was sorted)
}
