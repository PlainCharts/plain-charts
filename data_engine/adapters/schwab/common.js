// @ts-check
// Shared REST plumbing for the Schwab adapter: the resilient JSON fetch, the never-silent market-data
// failure notice, and the tick-inference helper. A leaf — imported by index.js and history.js.
import { bus } from '/data_engine/bus.js';
import { log } from '/data_engine/status.js';

// resilient JSON fetch: never throws. Non-JSON (e.g. a plaintext 404 from an
// un-restarted server) or a network error comes back as { error }.
/** @param {string} url @param {any} [opts] @returns {Promise<any>} */
export const j = (url, opts) =>
  fetch(url, opts)
    .then(async (r) => {
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch (_) {
        return { error: (text || '').slice(0, 200) || 'HTTP ' + r.status };
      }
    })
    .catch((e) => ({ error: String((e && e.message) || e) }));

// Infer price decimals from the COARSEST available quote field. Schwab returns
// an over-precise mark (e.g. 70.7141) alongside true-tick bid/ask (73.19), so
// taking the minimum decimal count approximates the real tick (2 for equities/
// index futures, more for forex). Clamped to [2, 6].
/** @param {...(number|null|undefined)} prices @returns {number} */
export function decimalsOf(...prices) {
  const ds = prices
    .filter((p) => p != null && isFinite(p))
    .map((p) => {
      const s = String(p);
      const i = s.indexOf('.');
      return i < 0 ? 0 : s.length - i - 1;
    });
  if (!ds.length) return 2;
  return Math.min(6, Math.max(2, Math.min(...ds)));
}

// Surface a market-data failure so it is NEVER silent. Symbol search / bars used to
// swallow errors (return [] / empty), so a dead token looked identical to "no results".
// Now every failure is logged AND (throttled) raised as a broker:notice the Connections
// dialog shows -- so you can always see WHY a call came back empty.
let lastMdNoticeAt = 0;
/** @param {string} what @param {any} err */
export function mdFail(what, err) {
  const raw = err == null || err === '' ? 'no data' : String(err);
  const hint = /not authorized|unauthorized|401/i.test(raw) ? ' — Schwab session expired, re-Authorize.' : '';
  const msg = 'Schwab ' + what + ' failed: ' + raw + hint;
  log(msg, true);
  const now = Date.now();
  if (now - lastMdNoticeAt > 4000) {
    lastMdNoticeAt = now;
    bus.emit('broker:notice', { id: 'schwab', ok: false, error: true, message: msg });
  }
}
