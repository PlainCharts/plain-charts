// @ts-check
// Bar data pipeline for a Pane: broker/cache subscription, clock-anchored aggregation, write-through
// caching, lazy older-history paging (with weekend/holiday gap-hopping) and the opening-fill state
// machine. Split out of pane.js as a prototype mixin -- these methods run with `this` bound to the
// Pane instance and call the core Pane methods (redraw, api, tf, chart, …) through `this`. The static
// fill/gap thresholds stay on the Pane class; the moved methods read them via this.constructor.
import { barMs, lookFor } from '../../workspace/timeframes.js';
import { baseTfFor, offGrid, aggregate } from '../../market/bar-aggregate.js';
import { barCache } from '../../market/bar-cache.js';
import { backfillCache } from '../../market/cache-backfill.js';
import { classifyTicks } from './tick-class.js';
import { log } from '../../dom.js';

// Does a (broker, symbol, displayTf) feed deliver bars OFF the UTC clock grid (session-anchored)?
// Probed once from the first batch, then remembered so later loads go straight to the base TF.
// 'broker|symbol|tfId' -> true (aggregate) | false (native). Shared across panes.
/** @type {Map<string, boolean>} */
const OFFGRID_VERDICT = new Map();

/** @typedef {import('../../../data_engine/index.js').Bar} Bar */
// One streamed bar update from an adapter's subscribeBars/getBars callback (opaque chunk shape).
/** @typedef {{ error?: any, bars?: Bar[], complete?: boolean, reachedStart?: boolean }} BarUpdate */

// The methods below run with `this` bound to the Pane instance. The Pane wraps the vendored
// kapelka chart engine and has no TS types here, so `this` is the engine `any` boundary; local
// variables and typed callback params still get real types.
/** @type {Record<string, any> & ThisType<any>} */
export const dataMethods = {
  // ---- data-TF routing + ingest (clock-anchored aggregation) ----
  // The TF we actually request / cache / subscribe: the base TF when this feed is off the clock
  // grid, else the display TF. All broker + cache I/O routes through this.
  _dataTf() { return (this._aggregate && this._baseTf) ? this._baseTf : this.tf(); },
  _tfSec() { const tf = this.tf(); return tf ? barMs(tf) / 1000 : 60; },   // DISPLAY TF in seconds
  // oldest SOURCE bar loaded: base bar in aggregate mode (display buckets can start before it, so we
  // page from the base edge to keep making progress), else the oldest display bar.
  _oldestSrc() { return this._aggregate ? this._baseEarliest : this.earliest; },
  // Take broker/cache bars into the pane. In aggregate mode they are BASE bars: store them and
  // rebuild the derived display bars (this.bars). Else they go straight in. Returns the count of NEW
  // source bars (for the older-history gap-hop logic).
  /** @param {Bar[]=} bars @returns {number} */
  _ingest(bars) {
    if (!bars || !bars.length) return 0;
    let added = 0;
    if (!this._aggregate) {
      const valid = bars.filter((b) => b && b.close > 0);
      // Classify the batch for redraw's fast path (see tick-class.js): last-bar-only ops
      // accumulate in this._fastOps; anything structural pins the 'full' sentinel. Runs before
      // the map mutation below. redraw() consumes and resets both fields.
      if (this._fastOps !== 'full') {
        const lastT = this._fastLastTime != null ? this._fastLastTime
          : (this.seeded && this.lastBar ? this.lastBar.time : null);
        const r = classifyTicks(this.bars, lastT, valid);
        if (r.ops === 'full') { this._fastOps = 'full'; this._fastLastTime = null; }
        else {
          if (!Array.isArray(this._fastOps)) this._fastOps = [];
          for (const b of r.ops) this._fastOps.push(b);
          this._fastLastTime = r.lastT;
        }
      }
      for (const b of valid) { if (!this.bars.has(b.time)) added++; this.applyBar(b); }
      return added;
    }
    this._fastOps = 'full';   // aggregate mode rebuilds the display bars wholesale below
    for (const b of bars) {
      if (!b || !(b.close > 0)) continue;
      if (!this._base.has(b.time)) added++;
      this._base.set(b.time, b);
      if (this._baseEarliest == null || b.time < this._baseEarliest) this._baseEarliest = b.time;
    }
    const agg = aggregate([...this._base.values()], this._tfSec());
    this.bars = new Map();
    for (const b of agg) this.bars.set(b.time, b);
    return added;
  },

  requestBars() {
    const tf = this.tf();
    if (!this.contractId || !tf) {
      if (this.contractId && !tf) log('Add and select a timeframe to load data.');
      return;
    }
    // decide up front whether THIS feed is off the clock grid (remembered verdict); if so, we fetch
    // and cache a finer BASE TF and derive clock-anchored display bars from it. baseTfFor() is null
    // for 1m / Daily+ (nothing finer / already day-anchored) -> never aggregate those.
    const vkey = this.broker + '|' + this.symbol + '|' + tf.id;
    this._baseTf = baseTfFor(tf);
    this._aggregate = !!this._baseTf && OFFGRID_VERDICT.get(vkey) === true;
    this.bars = new Map();
    this._base = new Map();
    this._baseEarliest = null;
    if (this._series) this._series.feed([]);
    this.seeded = false;
    this.earliest = null;
    this.loadingOlder = false;
    this.exhausted = false;
    this.olderCursorMs = null;
    this.gapHops = 0;
    this.lastStored = 0;
    this.cached = barCache.isCachedSync(this.broker, this.symbol);
    // Opening fill. The live subscription returns only the recent session's few bars; DEEP history is a
    // separate getBars (loadOlder). So an UNCACHED symbol at a session reopen would seed on ~4 bars and
    // sit there over-zoomed until the user scrolled and triggered loadOlder. Instead we hold the first
    // paint, auto-pull the history on open, and frame the view once it has filled (or a max wait passes)
    // -- "wait for data, then reset the view". Cached symbols fill from seedFromCache, so they skip this.
    clearTimeout(this._openSettle); clearTimeout(this._openMax);
    // Uncached panes hold + auto-pull deep history. Board (study) panes need this too: they subscribe
    // their OWN bars and the anchor pushes a full-history time window (setTimeWindow), so without the
    // fill the board frames that window over the thin recent sliver -- data-less, zoomed into NULL.
    this._openPending = !this.cached;
    this._openFillKicked = false;
    this._boardWantFrom = null;
    if (this._openPending) this._openMax = setTimeout(() => this._finishOpen(), this.constructor.OPEN_MAX_MS);
    if (this.reqId) this.api() && this.api().drop(this.reqId);
    // Opted-in symbols: subscribe LIVE first so the initial view is the true forward edge (current
    // bars + prices). Only once live has seeded that view does seedFromCache prepend OLDER history
    // (see onReport). Seeding from the local cache BEFORE live painted a slightly-stale view that
    // live then corrected -- the startup "jerk" on cached symbols. Deferring keeps instant scrollback
    // (the history is in place by the time you scroll) without the correction flash.
    this._wantCacheSeed = this.cached;
    this.reqId = this.api() && this.api().subscribeBars(
      { id: this.contractId, tf: this._dataTf(), fromMs: Date.now() - lookFor(tf) },   // base resolution, display-sized window
      (/** @type {any} */ u) => this.onReport(u),
    );
    log('Subscribed: ' + this.symbol + ' @ ' + tf.id + (this._aggregate ? ' (via ' + this._dataTf().id + ')' : '') + ' (contract ' + this.contractId + ').');
  },

  // normalized bar update: { bars:[Bar], complete, reachedStart?, error? }
  /** @param {BarUpdate} u */
  onReport(u) {
    if (this.destroyed) return;   // a late reply after the pane was torn down
    if (u.error) { log('[' + this.symbol + '] bar request failed: ' + u.error, true); return; }
    // one-time probe: is this (as-yet-undecided) intraday feed off the UTC clock grid? If so, remember
    // the verdict and restart at the base TF (requestBars then derives clock-anchored display bars).
    // Only tested on a complete batch, when the historical bars are present.
    if (!this._aggregate && u.complete && u.bars && u.bars.length) {
      const dtf = this.tf();
      const vkey = this.broker + '|' + this.symbol + '|' + (dtf && dtf.id);
      if (dtf && baseTfFor(dtf) && !OFFGRID_VERDICT.has(vkey)) {
        const off = offGrid(u.bars, barMs(dtf) / 1000);
        OFFGRID_VERDICT.set(vkey, off);
        if (off) { this.requestBars(); return; }   // restart at the base TF, now aggregating
      }
    }
    this._ingest(u.bars);
    this.redraw(u.complete);
    this.storeClosed(u.bars);     // write-through: persist closed bars for cached symbols
    // Live has now established the recent view (seeded). Backfill OLDER history from the local cache,
    // silently (seeded -> redraw prepends, no refit). Deferred so the cache never repaints/corrects
    // the visible window.
    if (u.complete && this._wantCacheSeed && this.seeded) {
      this._wantCacheSeed = false;
      const tf = this.tf(); if (tf) this.seedFromCache(tf);
    }
  },

  /** @param {Bar} b */
  applyBar(b) { if (b && b.close > 0) this.bars.set(b.time, b); },   // guard: a 0/invalid close would pin autoscale to 0

  // Seed the chart instantly from the persistent cache (all cached bars for this tf),
  // then the live subscription extends the forward edge. Loading every cached bar means
  // scrolling back through the library is instant — no broker round-trips inside it.
  /** @param {any} tf */
  seedFromCache(tf) {
    const tfId = tf.id, id = this.contractId;   // tfId = DISPLAY tf (guard); dtf = the cached BASE stream
    const dtf = this._dataTf();
    const row = barCache.rowFor(this.broker, this.symbol);
    const startMs = (row && row.startMs) || (Date.now() - 90 * 86400000);
    barCache.getBars({ broker: this.broker, symbol: this.symbol, tf: dtf.id }).then((res) => {
      if (this.destroyed || this.tfId !== tfId) return;   // timeframe/symbol changed meanwhile
      const bars = (res && res.bars) || [];
      if (bars.length) this.lastStored = Math.max(this.lastStored, bars[bars.length - 1].time);   // already in the cache
      // Only PREPEND history OLDER than what live already loaded. Live owns the recent/visible bars;
      // applying an overlapping (possibly stale) cache bar over a live bar would visibly correct the
      // candle = the jerk. So filter to bars older than the current oldest loaded bar.
      const cutoff = this._oldestSrc();   // oldest SOURCE bar (base edge in aggregate mode) live has loaded
      const older = (cutoff == null) ? bars : bars.filter((b) => b.time < cutoff);
      if (older.length) {
        this._ingest(older);
        // Prepend the cached history. The series feed shifts the visible index window by the prepend
        // count (index.js keeps the same bars on screen), like loadOlder().
        this.redraw(true);
        // The initial LIVE batch can be tiny (a contract with only a few session bars so far), so the
        // seed-time fit over-zoomed into them. Now that the cache has supplied the full history, fit
        // the recent window over the WHOLE dataset. The newest bar stays pinned at the right edge, so
        // this is a zoom-OUT to show context -- NOT the backward "jump". Once only (deferred seed).
        try { this.chart.timeAxis().scrollToNow(); } catch (_) {}
      }
      // background: keep the library filled toward [startMs, now] (forward gap, then backward).
      // Cancels itself if the pane is torn down or its symbol/timeframe changes.
      backfillCache({ brokerId: this.broker, symbol: this.symbol, id, tf: dtf, startMs },
        () => !this.destroyed && this.tfId === tfId && this.contractId === id);
    });
  },

  // write-through: persist CLOSED bars (strictly older than the forming bar) into the
  // cache for opted-in symbols, skipping anything already stored. The live history and
  // lazy older fetches thus grow the library as you use the chart.
  /** @param {Bar[]=} bars */
  storeClosed(bars) {
    if (!this.cached || !bars || !bars.length) return;
    const dtf = this._dataTf(); if (!dtf) return;   // cache the BASE stream when aggregating
    const formingStart = Math.floor(Date.now() / barMs(dtf)) * barMs(dtf) / 1000;
    const last = this.lastStored || 0;
    const closed = bars.filter((b) => b && b.close > 0 && b.time < formingStart && b.time > last);
    if (!closed.length) return;
    this.lastStored = Math.max(last, ...closed.map((b) => b.time));
    barCache.putBars(this.broker, this.symbol, dtf.id, closed);
  },

  // Board pane: the anchor pushes a time window via setTimeWindow, which is SILENT (no onBarWindow, so
  // the near-left-edge lazy-load never fires). Following the anchor into older history would then show
  // gaps. Remember the requested left edge and pull older bars until the loaded history covers it (or we
  // hit the start of data). Called from the board sync's applyRange on every anchor range change.
  /** @param {{ from: number }=} range */
  boardEnsureHistory(range) {
    if (!this.board || this.blanked || !this.seeded || this._openPending || !range) return;
    const from = range.from;   // seconds
    if (!Number.isFinite(from)) return;
    // keep the DEEPEST edge requested (anchor may still be settling several range events)
    this._boardWantFrom = (this._boardWantFrom == null) ? from : Math.min(this._boardWantFrom, from);
    this._boardPullIfNeeded();
  },
  _boardPullIfNeeded() {
    if (this._boardWantFrom == null) return;
    if (this.exhausted) { this._boardWantFrom = null; return; }   // no more history to be had
    if (this.loadingOlder) return;                                // a hop is in flight -> onOlder re-drives
    const oldest = this._oldestSrc();                            // oldest loaded SOURCE bar (secs)
    if (oldest == null) return;
    if (oldest <= this._boardWantFrom) { this._boardWantFrom = null; return; }   // window is covered
    this.loadOlder();
  },

  // fetch an older chunk and prepend it (keeps the current view). A backward cursor
  // walks past empty windows so a weekend/holiday gap (e.g. a 2-day intraday lookback
  // landing on a closed market) doesn't look like the end of data.
  loadOlder() {
    const tf = this.tf(), dtf = this._dataTf();
    if (!this.contractId || !tf) return;
    if (this.olderCursorMs == null) {
      const oe = this._oldestSrc();
      if (oe == null) return;
      this.olderCursorMs = oe * 1000;   // start at the current oldest SOURCE bar (base edge when aggregating)
    }
    this.loadingOlder = true;
    const toMs = this.olderCursorMs;             // exclusive upper bound for this hop
    const fromMs = toMs - lookFor(tf);           // window sized by the DISPLAY tf, fetched at base resolution
    this._olderFromMs = fromMs;
    this.olderReqId = this.api() && this.api().getBars({ id: this.contractId, tf: dtf, fromMs, toMs }, (/** @type {any} */ u) => this.onOlder(u));
  },

  // Drive the opening fill after each ingest. Finish as soon as the window is full or the deep pull is
  // exhausted; while a hop is in flight, wait for it (onOlder re-enters via redraw); if it returned and
  // we are still thin, pull the next hop; otherwise arm a short settle timer so a truly sparse market
  // still opens. OPEN_MAX (armed in requestBars) is the ultimate backstop.
  _armOpenSettle() {
    if (!this._openPending) return;
    if (this.barCount >= this.constructor.FILL_MIN || this.exhausted) { this._finishOpen(); return; }
    if (this.loadingOlder) return;                                   // a hop is in flight -> wait for onOlder
    if (this._openFillKicked) { this.loadOlder(); return; }          // still thin, more may exist -> keep pulling
    clearTimeout(this._openSettle);
    this._openSettle = setTimeout(() => this._finishOpen(), this.constructor.OPEN_SETTLE_MS);
  },

  // End the opening hold: flip the flag off and re-enter redraw, which now paints and frames the full
  // window (scrollToNow in the seed block). Idempotent.
  _finishOpen() {
    if (!this._openPending) return;
    this._openPending = false;
    clearTimeout(this._openSettle); clearTimeout(this._openMax);
    this.redraw(true);
  },

  /** @param {BarUpdate} u */
  onOlder(u) {
    if (this.destroyed) return;   // a late history chunk after the pane was torn down
    if (u.complete) this.olderReqId = 0;
    if (u.error) { this.loadingOlder = false; this.exhausted = true; if (this._openPending) this._armOpenSettle(); this._boardPullIfNeeded(); return; }
    const added = this._ingest(u.bars);          // base bars (aggregate mode) -> derived display bars
    if (added > 0) this.redraw(true);            // seeded already -> feed, no refit
    this.storeClosed(u.bars);                    // write-through older bars into the cache
    if (!u.complete) return;
    this.loadingOlder = false;
    // opening fill / board follow: this hop finished (loadingOlder now false) -> let _armOpenSettle finish
    // or pull the next hop, and let _boardPullIfNeeded chain until the anchor's window is covered. Both
    // are guarded (no-op when their flag is unset), so they are safe on every branch.
    if (u.reachedStart) { this.exhausted = true; if (this._openPending) this._armOpenSettle(); this._boardPullIfNeeded(); return; }   // adapter knows it's the true start
    if (added > 0) {
      this.gapHops = 0;
      this.olderCursorMs = this._oldestSrc() * 1000;   // continue back from the new oldest SOURCE bar
      if (this._openPending) this._armOpenSettle();
      this._boardPullIfNeeded();
      return;
    }
    // empty window: a market-closed gap, or the true end. Hop the cursor past it and
    // retry a bounded number of times — data usually resumes older than the gap.
    this.gapHops = (this.gapHops || 0) + 1;
    if (this.gapHops >= this.constructor.GAP_HOPS) { this.exhausted = true; if (this._openPending) this._armOpenSettle(); this._boardPullIfNeeded(); return; }
    this.olderCursorMs = this._olderFromMs;
    this.loadOlder();
  },
};
