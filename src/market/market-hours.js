// @ts-check
// Market Hours -- a per-instrument trading-session model, learned from the broker's own INTRADAY BARS
// (ground truth), not a hours API (those can be wrong -- a broker can report futures an hour off from its
// own bars). It fetches ~10 days of a fine timeframe, finds the gaps (a gap = the market is shut), and
// derives:
//   - sessions [{ open, close }] -- the actual traded windows -> the status dot/popup (state at NOW).
//   - openRule { hh, mm } -- the recurring open TIME-OF-DAY, taken from the reopen after the BIGGEST gap
//     (always the weekend). Projected (DST-aware) onto any date, this anchors every daily bar -- years
//     back -- from those few days. The weekend is universal, so this works for every asset class:
//       futures : ...16:55 -> [65m halt] -> 18:00 ET   (+ weekend reopen 18:00 confirms) -> open 18:00
//       forex   : Fri 17:00 -> [weekend] -> Sun 17:00 ET                                  -> open 17:00
//       equities: Fri close -> [weekend] -> Mon 09:30 ET                                  -> open 09:30
//     Forex/futures reopen Sunday evening; equities Monday morning -- each gets its own correct open
//     from the SAME rule, no asset-class branching.
import { byId } from '../workspace/timeframes.js';
import { getCachedHours, putCachedHours } from './market-hours-store.js';

/** @typedef {import('../../data_engine/index.js').Bar} Bar */
/** @typedef {{ hh: number, mm: number }} OpenRule   recurring open time-of-day in NY local time */
/** @typedef {{ open: number, close: number, ongoing?: boolean }} Session   a traded window (ms) */
/** the data API the model reads bars from (a subset of the broker adapter surface)
 * @typedef {{ getBars: (req: { id: any, tf: any, fromMs: number, toMs: number }, cb: (res: { bars?: Bar[], error?: any, complete?: boolean } | null) => void) => void }} BarsApi */
/**
 * the market state + timing returned by stateAt()
 * @typedef {{ state: 'open', session: Session, msToClose: number, progress: number }
 *   | { state: 'maintenance' | 'closed', prevClose: number | null, nextOpen: number, msToOpen: number }
 *   | { state: 'closed', prevClose?: number | null }
 *   | { state: 'unknown' }} MarketState */

const DAY = 86400000;
const MAINT_MAX = 4 * 3600 * 1000;   // a close->next-open gap this short is the daily maintenance halt; longer = closed
const GAP_SEC = 40 * 60;             // an intraday jump longer than this = the market was shut (halt/overnight/weekend)

// US-exchange local time (America/New_York -- CME Central and US Eastern share DST transitions, so an
// open expressed in NY local time is stable across the year regardless of the exchange). DST-aware.
const NY_TZ = 'America/New_York';
// Intl.DateTimeFormat construction is EXPENSIVE (~0.1-1ms each) -- build the two formatters ONCE and reuse
// them. Constructing one per call inside the future-projection loop (thousands of calls per redraw) was a
// catastrophic per-tick cost.
const _offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, timeZoneName: 'shortOffset' });
const _todFmt = new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, hour12: false, hour: '2-digit', minute: '2-digit' });
/** @type {Map<number, number>} */
const _offCache = new Map();   // day bucket -> NY offset hours (offset only changes at DST boundaries)
/** @param {number} utcMs @returns {number} */
function nyOffsetHours(utcMs) {
  const day = Math.floor(utcMs / 86400000);
  const hit = _offCache.get(day);
  if (hit !== undefined) return hit;
  const tzn = /** @type {Intl.DateTimeFormatPart} */ (_offsetFmt.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')).value;   // "GMT-4"
  const m = /GMT([+-]\d+)/.exec(tzn);
  const off = m ? parseInt(m[1], 10) : -5;
  _offCache.set(day, off);
  return off;
}
// UTC ms for hh:mm New York on the calendar date y/mo/d.  NY_local = UTC + off  ->  UTC = local - off.
/** @param {number} y @param {number} mo @param {number} d @param {number} hh @param {number} mm @returns {number} */
function nyClockUtc(y, mo, d, hh, mm) {
  const guess = Date.UTC(y, mo, d, hh, mm, 0);
  return guess - nyOffsetHours(guess) * 3600000;
}
// the NY wall-clock time-of-day {hh, mm} of an absolute UTC instant
/** @param {number} utcMs @returns {OpenRule} */
function nyTimeOfDay(utcMs) {
  const s = _todFmt.format(new Date(utcMs));
  const [h, m] = s.split(':');
  return { hh: (+h) % 24, mm: +m };
}

export class MarketHours {
  /** @param {BarsApi} api @param {any} contractId @param {string | null} [persistKey] */
  constructor(api, contractId, persistKey) {
    this.api = api;
    this.contractId = contractId;
    this._key = persistKey || null;   // `${broker}:${symbol}` -- the persistent open-rule cache key
    /** @type {Session[]} */
    this.days = [];                  // derived sessions, ascending by open: [{ open, close, ongoing? }] (ms)
    /** @type {OpenRule | null} */
    this.openRule = null;            // { hh, mm } -- recurring open time-of-day in NY local time
    this._sessionLen = 23 * 3600000; // typical session length (for projecting the live/next close)
    /** @type {number | null} */
    this._loadedAt = null;
    this._pending = false;
    this._retryAfter = 0;            // after a failed fetch, don't retry until this ms (broker backoff)
    /** @type {Set<() => void>} */
    this._listeners = new Set();
  }

  /** @param {() => void} cb @returns {() => boolean} */
  onUpdate(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit() { for (const cb of this._listeners) { try { cb(); } catch (_) {} } }

  // Fetch ~10 days of a fine intraday TF (guarantees a weekend gap) and learn the sessions + open rule.
  // Anchored on NOW (the pane may pass a forward margin in its args -- ignored). One fetch; refetch only
  // when the data goes stale as NOW advances.
  ensure(/* fromMs, toMs */) {
    if (!this.api || !this.api.getBars || this.contractId == null || this._pending) return;
    const now = Date.now();
    if (this._loadedAt != null && now - this._loadedAt < 2 * DAY) return;   // learned this session -> done
    // PERSISTENT cache first: the open rule is DST-stable and barely ever changes, so if a recent entry is
    // on disk we adopt it and make NO historical fetch. This is the whole point -- one learn per symbol
    // every week or two, shared across every window and restart, instead of a look-back fetch per open.
    if (this._key) {
      const cached = getCachedHours(this._key);
      if (cached) { this.openRule = cached.openRule; if (cached.sessionLen) this._sessionLen = cached.sessionLen; this._loadedAt = now; this._emit(); return; }
    }
    if (this._retryAfter && now < this._retryAfter) return;                 // a recent fetch failed -> back off
    const tf = byId('15m') || { unit: 'm', n: 15, id: '15m' };
    /** @type {Bar[]} */
    const acc = [];
    this._pending = true;
    this.api.getBars({ id: this.contractId, tf, fromMs: now - 10 * DAY, toMs: now }, (res) => {
      if (!res) return;
      if (res.error) { this._pending = false; this._retryAfter = Date.now() + 60000; return; }   // back off 60s, don't hammer
      if (Array.isArray(res.bars)) acc.push(...res.bars);
      if (res.complete) {
        this._pending = false;
        this._deriveFromIntraday(acc);
        this._loadedAt = now;
        if (this._key && this.openRule) putCachedHours(this._key, this.openRule, this._sessionLen);   // remember it
        this._emit();
      }
    });
  }

  // Split the intraday bars into sessions at every gap; the reopen after the BIGGEST gap (the weekend)
  // gives the recurring open time-of-day. Bar times are unix SECONDS; sessions are stored in ms.
  /** @param {Bar[]} bars */
  _deriveFromIntraday(bars) {
    const b = (bars || []).filter((x) => x && Number.isFinite(x.time)).sort((p, q) => p.time - q.time);
    if (b.length < 3) return;
    /** @type {Session[]} */
    const sessions = [];
    let openSec = b[0].time, maxGap = 0, maxReopenSec = null;
    for (let i = 1; i < b.length; i++) {
      const dt = b[i].time - b[i - 1].time;
      if (dt > GAP_SEC) {
        sessions.push({ open: openSec * 1000, close: b[i - 1].time * 1000 });   // a completed session
        if (dt > maxGap) { maxGap = dt; maxReopenSec = b[i].time; }
        openSec = b[i].time;
      }
    }
    sessions.push({ open: openSec * 1000, close: b[b.length - 1].time * 1000, ongoing: true });   // live tail
    this.days = sessions;
    if (maxReopenSec != null) this.openRule = nyTimeOfDay(maxReopenSec * 1000);   // reopen after the weekend
    const lens = sessions.filter((s) => !s.ongoing).map((s) => s.close - s.open).filter((x) => x > 0).sort((x, y) => x - y);
    if (lens.length) this._sessionLen = lens[Math.floor(lens.length / 2)];   // median completed session
  }

  hasData() { return this.days.length > 0 || this.openRule != null; }   // the rule alone is enough to anchor

  // The trading weekday a session opening at openMs BELONGS to (0=Sun..6=Sat). Evening opens (>=12:00
  // local, futures/forex) own the NEXT day; morning opens (equities) own the same day. Skip Sat/Sun.
  /** @param {number} openMs @returns {number} */
  _ownsWeekday(openMs) {
    const local = new Date(openMs + nyOffsetHours(openMs) * 3600000);
    const wd = local.getUTCDay();
    return (this.openRule && this.openRule.hh >= 12) ? (wd + 1) % 7 : wd;
  }
  /** @param {number} openMs @returns {boolean} */
  _isTradingSession(openMs) { const d = this._ownsWeekday(openMs); return d !== 0 && d !== 6; }

  // The next real session open at/after `now`, PROJECTED from the rule (for when it's beyond the fetched
  // window -- e.g. the countdown to Sunday's open while it's the weekend). Skips non-trading opens.
  /** @param {number} now @returns {number | null} */
  _projectNextOpen(now) {
    const r = this.openRule; if (!r) return null;
    const b = new Date(now);
    for (let off = 0; off <= 9; off++) {
      const d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + off));
      const o = nyClockUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), r.hh, r.mm);
      if (o > now && this._isTradingSession(o)) return o;
    }
    return null;
  }

  // The most recent trading-session OPEN at or before instant t (UTC ms): the rule's open-time projected
  // onto each recent date, walking back until one is <= t AND a trading session. null if no rule.
  /** @param {number} t @returns {number | null} */
  _sessionOpenAtOrBefore(t) {
    const r = this.openRule; if (!r) return null;
    const b = new Date(t);
    for (let off = 0; off >= -6; off--) {
      const d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + off));
      const o = nyClockUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), r.hh, r.mm);
      if (o <= t && this._isTradingSession(o)) return o;
    }
    return null;
  }

  // Project `count` future bar times (unix SECONDS) past lastSec at a `tfSec` cadence, FOLLOWING the
  // session: step forward one TF; if the next slot lands past the current session's close (in a
  // maintenance/overnight/weekend gap), jump to the next session's open instead. This makes the future
  // axis collapse weekends exactly like the past does -- the app feeds these to the engine as whitespace
  // so i2t/t2i stay gapless. Same session model as the daily anchor; no asset-class branching.
  /** @param {number} lastSec @param {number} tfSec @param {number} count @returns {number[]} */
  projectFutureBars(lastSec, tfSec, count) {
    if (!this.openRule || !(tfSec > 0) || !(count > 0) || lastSec == null) return [];
    const tf = tfSec * 1000;
    /** @type {number[]} */
    const out = [];
    let t = lastSec * 1000, guard = 0;
    while (out.length < count && guard++ < count * 4 + 16) {
      const next = t + tf;
      const open = this._sessionOpenAtOrBefore(next);
      const close = open != null ? open + this._sessionLen : null;
      if (open == null || next < /** @type {number} */ (close)) {
        t = next;                              // still inside a session -> a valid slot
      } else {
        const no = this._projectNextOpen(next);   // in the gap -> jump to the next session open
        if (no == null || no <= t) break;
        t = no;
      }
      out.push(Math.round(t / 1000));
    }
    return out;
  }

  // The session OPEN (absolute UTC ms) for a daily+ bar stamped at tSec (unix seconds): the rule's open
  // time-of-day projected onto the bar's date (nearest instant). Anchors any bar from a few fetched days.
  /** @param {number | null} tSec @returns {number | null} */
  openForBarSec(tSec) {
    if (tSec == null) return null;
    const t = tSec * 1000;
    const r = this.openRule;
    if (r) {
      const b = new Date(t);
      /** @type {number | null} */
      let best = null;
      let bestD = Infinity;
      for (let off = -1; off <= 1; off++) {
        const d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + off));
        const o = nyClockUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), r.hh, r.mm);
        const dd = Math.abs(o - t); if (dd < bestD) { bestD = dd; best = o; }
      }
      return best;
    }
    if (!this.days.length) return null;
    /** @type {number | null} */
    let best = null;
    let bestD = 18 * 3600000;
    for (const d of this.days) { const dd = Math.abs(d.open - t); if (dd < bestD) { bestD = dd; best = d.open; } }
    return best;
  }

  // the session a timestamp is INSIDE (open<=t<close); the live tail uses its projected close. null in a gap.
  /** @param {number} t @returns {{ open: number, close: number } | null} */
  sessionOf(t) {
    for (const s of this.days) { const close = s.ongoing ? s.open + this._sessionLen : s.close; if (t >= s.open && t < close) return { open: s.open, close }; }
    return null;
  }

  // market state + timing at `now`:
  //   open        -> { state, session, msToClose, progress: 0..1 }
  //   maintenance -> { state, prevClose, nextOpen, msToOpen }   (short gap = daily halt)
  //   closed      -> same shape (long gap / weekend), or { state:'closed', prevClose } if no next open
  //   unknown     -> { state:'unknown' }   (no data yet)
  /** @param {number} now @returns {MarketState} */
  stateAt(now) {
    // No fetched sessions but we DO have the learned rule (e.g. adopted from the persistent cache) ->
    // project the state purely from the rule + typical session length. Same status the fetched-days path
    // gives, a few minutes' fuzz at boundaries (fine for a status dot).
    if (!this.days.length && this.openRule) {
      const open = this._sessionOpenAtOrBefore(now);
      if (open != null && now < open + this._sessionLen) {
        const close = open + this._sessionLen;
        return { state: 'open', session: { open, close }, msToClose: close - now, progress: (now - open) / (close - open) };
      }
      const nextOpen = this._projectNextOpen(now);
      if (nextOpen == null) return { state: 'closed' };
      const prevClose = open != null ? open + this._sessionLen : null;
      const gap = prevClose != null ? nextOpen - prevClose : Infinity;
      return { state: gap <= MAINT_MAX ? 'maintenance' : 'closed', prevClose, nextOpen, msToOpen: nextOpen - now };
    }
    if (!this.days.length) return { state: 'unknown' };
    /** @type {number | null} */
    let prevClose = null;
    /** @type {number | null} */
    let nextOpen = null;
    for (const s of this.days) {
      const close = s.ongoing ? s.open + this._sessionLen : s.close;
      if (now >= s.open && now < close) return { state: 'open', session: { open: s.open, close }, msToClose: close - now, progress: (now - s.open) / (close - s.open) };
      if (close <= now && (prevClose == null || close > prevClose)) prevClose = close;
      if (s.open > now && (nextOpen == null || s.open < nextOpen)) nextOpen = s.open;
    }
    if (nextOpen == null) nextOpen = this._projectNextOpen(now);   // future open not in the window -> project
    if (nextOpen == null) return { state: 'closed', prevClose };
    const gap = prevClose != null ? nextOpen - prevClose : Infinity;
    return { state: gap <= MAINT_MAX ? 'maintenance' : 'closed', prevClose, nextOpen, msToOpen: nextOpen - now };
  }
}

// One shared model per broker/symbol for the whole window. The trading session is a property of the
// INSTRUMENT, not of a pane -- so every pane, tab and compare showing the same contract reads the SAME
// instance, and it fetches its learning data exactly ONCE (not per pane, not per redraw, not per tab
// switch). Panes that don't render the symbol's candles (study / board sub-panes) never call this, so
// they never fetch at all. (Registry is per window; multiple browser windows each learn once -- a
// cross-window cache via the data-host is a possible follow-up.)
/** @type {Map<string, MarketHours>} */
const _registry = new Map();   // `${brokerKey}:${contractId}` -> MarketHours
/** @param {BarsApi} api @param {any} contractId @param {string | null} [brokerKey] @param {string} [symbol] @returns {MarketHours} */
export function sharedMarketHours(api, contractId, brokerKey, symbol) {
  const key = (brokerKey == null ? '' : brokerKey) + ':' + contractId;
  let mh = _registry.get(key);
  // persist key is broker:SYMBOL (stable across contract rolls), not contractId, so the learned open rule
  // is reused for every month/contract of the same instrument.
  if (!mh) { mh = new MarketHours(api, contractId, (brokerKey == null ? '' : brokerKey) + ':' + (symbol || contractId)); _registry.set(key, mh); }
  return mh;
}
