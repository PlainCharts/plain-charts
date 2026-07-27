// @ts-check
// The intrabar (lower-timeframe) sub-bar feed for the StudyHost. Owns the per-lower-TF cache and its
// IO: history is DOWNLOADED ONCE (windowed over the last N chart bars), and live updates arrive by
// PUSH via a streaming subscription -- never re-downloaded on a timer. An idle chart makes zero
// intrabar requests. Two outward seams only: `toWorker` (feed the worker's resident sub-bar cache)
// and `onData` (fresh sub-bars arrived -> the host recomputes its intrabar studies). The host decides
// WHICH lower-TF a study wants and WHEN to ensure/reset/reconcile; this module moves the data.
import { mergeBars } from './channels.js';

export class IntrabarFeed {
  /**
   * @param {any} opts the host's opts bag, read late: intrabar(tf,fromMs,toMs), subscribeIntrabar,
   *   dropIntrabar(id), intrabarMaxBars
   * @param {{ toWorker: (msg: any) => void, onData: () => void }} hooks
   */
  constructor(opts, hooks) {
    this.opts = opts;
    this.hooks = hooks;
    /** @type {Record<string, any>} */
    this.cache = {};   // lowerTfId -> { subBars, from, to, loading, subId } (subId = live push subscription)
  }

  // drop the sub-bar cache AND its live subscriptions (symbol change / teardown) so nothing leaks
  reset() {
    for (const k in this.cache) this._dropSub(this.cache[k].subId);
    this.cache = {};
  }

  // drop the subscription AND the cached sub-bars for any lower-TF not in `needed` (frees memory;
  // a fresh, gap-free fetch happens if a study using it becomes visible again).
  /** @param {Set<string>} needed */
  reconcile(needed) {
    for (const k in this.cache) if (!needed.has(k)) { this._dropSub(this.cache[k].subId); delete this.cache[k]; }
  }

  /** @param {string} lowerTfId @param {import('../core/types.js').Bar[]} bars @param {number} chartSec @returns {any} */
  ensure(lowerTfId, bars, chartSec) {
    // A timeframe change swaps the lower-TF; drop any subscription + cache for a DIFFERENT one so it can't leak.
    for (const k in this.cache) {
      if (k !== lowerTfId) { this._dropSub(this.cache[k].subId); delete this.cache[k]; }
    }
    let e = this.cache[lowerTfId];
    if (!e) e = this.cache[lowerTfId] = { subBars: [], from: null, to: null, loading: false, subId: null };
    if (!bars.length) return e;
    const chartMs = chartSec * 1000;
    const lastBar = /** @type {import('../core/types.js').Bar} */ (bars[bars.length - 1]);
    // WINDOW the intrabar range: cover only the last N main bars, not the whole loaded history (which on a
    // deep chart is tens of thousands of sub-bars fetched up front). Studies need recent context (CVD resets
    // each session, oscillators need a lookback), not weeks of sub-bars.
    const MAXN = this.opts.intrabarMaxBars || 750;
    const startIdx = Math.max(0, bars.length - MAXN);
    const wantFrom = /** @type {number} */ (bars[startIdx].time) * 1000, wantTo = /** @type {number} */ (lastBar.time) * 1000 + chartMs;
    // HISTORY: fetch the window's closed sub-bars ONCE. Never re-downloaded (no polling).
    if (e.from == null && !e.loading && this.opts.intrabar) this._fetch(lowerTfId, e, wantFrom, wantTo);
    // LIVE: one streaming subscription pushes the forming bar's sub-bars on every tick (and streams newly
    // closed bars), so the study's live value updates by PUSH -- no re-download. Started from a small recent
    // overlap; the initial history came from the fetch above. mergeBars overwrites the forming bar in place.
    if (e.subId == null && this.opts.subscribeIntrabar) {
      const liveFrom = /** @type {number} */ (bars[Math.max(0, bars.length - 3)].time) * 1000;
      e.subId = this.opts.subscribeIntrabar(lowerTfId, liveFrom, (/** @type {import('../core/types.js').Bar[]} */ subBars) => {
        if (!subBars || !subBars.length) return;
        e.subBars = mergeBars(e.subBars, subBars);
        this.hooks.toWorker({ type: 'append-intrabar', tf: lowerTfId, sub: subBars });   // the live delta -> worker's resident cache
        const tailMs = /** @type {number} */ (subBars[subBars.length - 1].time) * 1000;
        if (e.to == null || tailMs > e.to) e.to = tailMs;
        this.hooks.onData();
      });
    }
    return e;
  }

  /** @param {any} id */
  _dropSub(id) { if (id != null && this.opts.dropIntrabar) { try { this.opts.dropIntrabar(id); } catch (_) {} } }

  /** @param {string} lowerTfId @param {any} e @param {number} fromMs @param {number} toMs */
  _fetch(lowerTfId, e, fromMs, toMs) {
    e.loading = true;
    Promise.resolve(/** @type {Function} */ (this.opts.intrabar)(lowerTfId, fromMs, toMs)).then((/** @type {import('../core/types.js').Bar[]} */ subBars) => {
      e.loading = false;
      e.subBars = mergeBars(e.subBars, subBars || []);
      this.hooks.toWorker({ type: 'append-intrabar', tf: lowerTfId, sub: subBars || [] });   // the fetched window -> worker's resident cache
      e.from = e.from == null ? fromMs : Math.min(e.from, fromMs);
      e.to = e.to == null ? toMs : Math.max(e.to, toMs);
      this.hooks.onData();
    }).catch(() => { e.loading = false; });
  }
}
