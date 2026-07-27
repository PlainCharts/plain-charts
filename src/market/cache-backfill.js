// @ts-check
// Background cache maintenance for opted-in symbols. For one (broker, symbol, tf) it keeps
// the local library filled toward [startMs, now]: the FORWARD gap (cacheEnd -> now) first so
// the series is current, then BACKWARD toward startMs to deepen history.
//
// Cache-only: it writes to the server store and does NOT touch the open chart's series — the
// deepened history shows up on the next seed (or via on-demand scroll). Throttled, single-
// flight per series (so multiple panes/re-seeds don't double-run), and resumable across
// restarts because it re-reads coverage each run and only fills what's missing. A complete
// cache makes this a near no-op (one coverage read, both loops fall through).
import { broker } from '../../data_engine/index.js';
import { barCache } from './bar-cache.js';
import { lookFor } from '../workspace/timeframes.js';

/** @typedef {import('../../data_engine/index.js').Bar} Bar */
// Neutral timeframe descriptor: unit + multiple, with a canonical string id.
/** @typedef {{ id: string, unit: string, n: number }} Tf */
// One streamed history-fetch update from an adapter's getBars callback (opaque chunk shape).
/** @typedef {{ error?: any, bars?: Bar[], complete?: boolean, reachedStart?: boolean }} FetchUpdate */

/** @type {Set<string>} */
const inFlight = new Set();                    // 'broker|symbol|tf' currently maintaining
/** @param {string} b @param {string} s @param {string} t */
const keyOf = (b, s, t) => b + '|' + s + '|' + t;
/** @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_HOPS = 6;                            // empty windows to skip before accepting start-of-data
const THROTTLE = 300;                          // ms between broker requests (rate-limit friendly)

// one history window -> all bars on report-complete (some brokers stream several chunks)
/** @param {any} api @param {any} params @returns {Promise<{ bars: Bar[], error?: any, reachedStart?: boolean }>} */
function fetchWindow(api, params) {
  return new Promise((resolve) => {
    /** @type {Bar[]} */
    const acc = []; let done = false;
    api.getBars(params, (/** @type {FetchUpdate} */ u) => {
      if (done || !u) return;
      if (u.error) { done = true; resolve({ bars: acc, error: u.error }); return; }
      if (u.bars) acc.push(...u.bars);
      if (u.complete) { done = true; resolve({ bars: acc, reachedStart: u.reachedStart }); }
    });
  });
}

/**
 * @param {{ brokerId: string, symbol: string, id: string, tf: Tf, startMs: number }} params
 * @param {() => boolean} isAlive
 */
export async function backfillCache({ brokerId, symbol, id, tf, startMs }, isAlive) {
  const k = keyOf(brokerId, symbol, tf.id);
  if (inFlight.has(k)) return;                  // already maintaining this series in this window
  inFlight.add(k);
  try {
    const api = broker.for(brokerId);
    if (!api) return;
    const step = lookFor(tf);
    /** @param {Bar[]} bars */
    const store = async (bars) => { if (bars && bars.length) await barCache.putBars(brokerId, symbol, tf.id, bars); };
    const cov = await barCache.coverage({ broker: brokerId, symbol, tf: tf.id }).catch(() => null);

    // FORWARD: cacheEnd -> now, but only the part the live window doesn't already cover.
    if (cov && cov.to) {
      let cursor = cov.to * 1000;
      while (isAlive() && cursor < Date.now() - step) {
        const winFrom = cursor, winTo = Math.min(Date.now(), cursor + step);
        const u = await fetchWindow(api, { id, tf, fromMs: winFrom, toMs: winTo });
        if (u.error) break;
        await store(u.bars);
        cursor = winTo;
        await sleep(THROTTLE);
      }
    }

    // BACKWARD: cacheStart (or now, if the cache is empty) -> startMs, skipping market-closed gaps.
    let cursor = (cov && cov.from) ? cov.from * 1000 : Date.now();
    let hops = 0;
    while (isAlive() && cursor > startMs && hops < GAP_HOPS) {
      const winTo = cursor, winFrom = Math.max(startMs, cursor - step);
      const u = await fetchWindow(api, { id, tf, fromMs: winFrom, toMs: winTo });
      if (u.error) break;                       // broker wall (e.g. a 90-day intraday limit) -> stop
      if (u.bars.length) { await store(u.bars); hops = 0; } else hops++;
      if (u.reachedStart) break;
      cursor = winFrom;
      await sleep(THROTTLE);
    }
  } finally {
    inFlight.delete(k);
  }
}
