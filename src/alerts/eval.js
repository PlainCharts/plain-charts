// @ts-check
// The alert EVALUATION core -- pure, headless, no DOM, no engine. One gap-proof OHLC cross primitive + direction gating +
// trigger-cadence gating + expiry. Everything here is a pure function of (compiled condition, bar, runtime
// state, clock) so it is trivially testable and reusable in any window role.
//
// A "compiled" condition is the host-friendly form the dialog produces (create-alert-dialog.js compile()):
// display labels + i18n live in the UI; the host only ever sees stable terms.
//   compiled = { match: 'all' | 'any', terms: Term[] }
//   Term     = { op: 'cross'|'cross-up'|'cross-down'|'gt'|'lt', level: number }    (price vs a fixed level)
//            | { op: <same level ops>, extent: Extent }                             (price vs a drawn object)
//            | { op: 'unsupported', ... }                                           (nothing to evaluate)
//   Extent   = { kind: 'segments', points: [{time,price}...], extend: 'none'|'left'|'right'|'both' }
//            | { kind: 'region',   points: [corner, corner] }
// An extent is the anchored drawing's data-space reduction. SEGMENTS (trend-line family, path): the polyline's
// price value(s) at the CURRENT bar on the alert-interval bar grid -- the level ops run against those values
// exactly as against a fixed level. REGION (rect): a time x price zone -- within its drawn time span,
// Crossing = the bar touches the zone, Crossing Up/Down = the bar enters through the bottom/top edge,
// Greater/Less Than = close beyond the zone; outside the span nothing fires.

// The bar-tail ring size the feed keeps -- at least the largest lookback any relative condition may ask for.
export const BAR_TAIL_CAP = 300;

/** the tail-ring size covering `spanMs` of history at `perMs` per bar (with slack), never below the base
 * cap -- so an extent-anchored alert's bar grid reaches its oldest anchor. Pure (the feed binds barMs).
 * @param {number} perMs @param {number} spanMs */
export function capForSpan(perMs, spanMs) {
  if (!(perMs > 0) || !(spanMs > 0)) return BAR_TAIL_CAP;
  return Math.max(BAR_TAIL_CAP, Math.ceil(spanMs / perMs) + 50);
}

/**
 * Fold a report's bars into the tail ring: dedup by bar time (a re-reported forming bar overwrites in place),
 * keep time order, and cap to the last `cap`. Pure, so relative conditions (Moving %) get a clean recent-bars
 * sequence. @param {any[]} tail @param {any[]} bars @param {number} cap @returns {any[]}
 */
export function mergeTail(tail, bars, cap) {
  /** @type {Map<number, any>} */
  const byTime = new Map();
  for (const b of tail || []) if (b && b.time != null) byTime.set(b.time, b);
  for (const b of bars || []) if (b && b.time != null) byTime.set(b.time, b); // newer report wins per time
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return merged.slice(-cap);
}

/**
 * Gap-proof OHLC cross: a bar crosses `level` if it closes on
 * one side while its wick reached across -- catches crossings that a tick-to-tick compare misses on a gap.
 * @param {{ open:number, high:number, low:number, close:number }} bar
 * @param {number} level
 * @param {'up'|'down'|'both'} direction
 */
export function crossed(bar, level, direction) {
  const up = bar.close >= level && bar.low < level; // closed at/above, wick dipped below -> crossed up
  const down = bar.close <= level && bar.high > level; // closed at/below, wick poked above -> crossed down
  if (direction === 'up') return up;
  if (direction === 'down') return down;
  return up || down;
}

/**
 * The % change of close from `lookback` bars before `bar` to `bar`, over the recent-bars tail; null when the
 * tail is too short to confirm (an unconfirmable move must not fire). The bars are at the alert's OWN interval
 * (set in the dialog's picker), so "N bars" is a well-defined span. The bar is located in the tail by time, so
 * it works whether we're evaluating the forming bar (`last`) or a just-closed one.
 * @param {any[]} tail @param {{ time?:number, close:number }} bar @param {number} lookback @returns {number|null}
 */
export function movePct(tail, bar, lookback) {
  if (!Array.isArray(tail) || !bar || !(lookback > 0)) return null;
  const idx = tail.findIndex((b) => b && b.time === bar.time);
  if (idx < 0 || idx - lookback < 0) return null;
  const ref = tail[idx - lookback];
  if (!ref || ref.close == null || ref.close === 0) return null;
  return ((bar.close - ref.close) / ref.close) * 100;
}

/**
 * The absolute price change of close from `lookback` bars ago to `bar` (close - refClose), over the tail; null
 * when the tail is too short. Same lookup as movePct, but the RAW price delta -- the basis of Moving Up/Down
 * (Moving Up/Down % is this over the reference price). @param {any[]} tail @param {{ time?:number, close:number }} bar
 * @param {number} lookback @returns {number|null}
 */
export function moveAbs(tail, bar, lookback) {
  if (!Array.isArray(tail) || !bar || !(lookback > 0)) return null;
  const idx = tail.findIndex((b) => b && b.time === bar.time);
  if (idx < 0 || idx - lookback < 0) return null;
  const ref = tail[idx - lookback];
  if (!ref || ref.close == null) return null;
  return bar.close - ref.close;
}

/** a well-formed extent (segments or region): at least two anchors with finite time+price. @param {any} e */
export const validExtent = (e) =>
  !!(
    e &&
    (e.kind === 'segments' || e.kind === 'region') &&
    Array.isArray(e.points) &&
    e.points.filter((/** @type {any} */ p) => p && Number.isFinite(Number(p.time)) && Number.isFinite(Number(p.price)))
      .length >= 2
  );

/**
 * Fractional logical index of `time` against the ordered bar times -- the same interpolation the chart's
 * time axis uses (geometry.js timeToX's fallback), so a segment evaluates where it is DRAWN: bar-INDEX
 * space, not wall time (a session gap must not bend the line). Extrapolates past both ends on the edge span.
 * @param {number[]} times @param {number} time @returns {number|null}
 */
export function fracIndex(times, time) {
  const n = times.length;
  if (n < 2) return null;
  if (time <= times[0]) {
    const span = times[1] - times[0];
    return span > 0 ? (time - times[0]) / span : 0;
  }
  if (time >= times[n - 1]) {
    const span = times[n - 1] - times[n - 2];
    return n - 1 + (span > 0 ? (time - times[n - 1]) / span : 0);
  }
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  return lo + (span > 0 ? (time - times[lo]) / span : 0);
}

/**
 * The price value(s) of a drawn polyline at `barTime`, on the bar grid `tail` provides. Each consecutive
 * anchor pair is one segment, linearly interpolated in (bar-index, price) space -- exactly how the renderer
 * places it. `extend` mirrors the renderer's direction-aware rule: 'left' extends past points[0] (s<0, first
 * segment only), 'right' past the last point (s>1, last segment only) -- so a ray drawn right-to-left extends
 * into the past, same as on screen. A bar outside every segment's span yields no values (nothing to fire on);
 * a path that doubles back over a bar yields several (any strand can fire). Vertical segments are skipped.
 * @param {{ time:number }[]} tail @param {{ time:any, price:any }[]} points @param {string|undefined} extend
 * @param {number} barTime @returns {number[]}
 */
export function segLevelsAt(tail, points, extend, barTime) {
  /** @type {number[]} */
  const out = [];
  if (!Array.isArray(points) || points.length < 2) return out;
  const times = (tail || []).map((b) => b.time);
  const k = fracIndex(times, barTime);
  if (k == null) return out;
  const idx = points.map((p) => (p != null ? fracIndex(times, Number(p.time)) : null));
  const extL = extend === 'left' || extend === 'both';
  const extR = extend === 'right' || extend === 'both';
  const last = points.length - 2;
  for (let j = 0; j <= last; j++) {
    const ia = idx[j],
      ib = idx[j + 1];
    if (ia == null || ib == null || ia === ib) continue;
    const pa = Number(points[j].price),
      pb = Number(points[j + 1].price);
    if (!Number.isFinite(pa) || !Number.isFinite(pb)) continue;
    const s = (k - ia) / (ib - ia); // parametric position along A->B (the renderer's point order, not x order)
    if (s < 0 && !(extL && j === 0)) continue;
    if (s > 1 && !(extR && j === last)) continue;
    out.push(pa + (pb - pa) * s);
  }
  return out;
}

/**
 * Does a level op fire against a REGION extent (a time x price zone) on this bar? The zone is the box the
 * two corner anchors span; it exists only over its drawn TIME span (a bar outside it never fires -- the
 * zone is where it is drawn). Within the span: 'cross' = the bar's range touches the zone (a gap straight
 * through still touched it), 'cross-up' = the bar enters through the BOTTOM edge, 'cross-down' through the
 * TOP edge, 'gt'/'lt' = close beyond the zone.
 * @param {string} op @param {{ points:{time:any,price:any}[] }} extent
 * @param {{ time?:number, open:number, high:number, low:number, close:number }} bar
 */
export function regionFires(op, extent, bar) {
  const pts = (extent && extent.points) || [];
  if (pts.length < 2 || !bar) return false;
  const t0 = Number(pts[0].time),
    t1 = Number(pts[1].time),
    p0 = Number(pts[0].price),
    p1 = Number(pts[1].price);
  if (![t0, t1, p0, p1].every(Number.isFinite)) return false;
  const t = Number(bar.time);
  if (!(t >= Math.min(t0, t1) && t <= Math.max(t0, t1))) return false;
  const lo = Math.min(p0, p1),
    hi = Math.max(p0, p1);
  switch (op) {
    case 'cross':
      return bar.low <= hi && bar.high >= lo;
    case 'cross-up':
      return crossed(bar, lo, 'up');
    case 'cross-down':
      return crossed(bar, hi, 'down');
    case 'gt':
      return bar.close > hi;
    case 'lt':
      return bar.close < lo;
    default:
      return false;
  }
}

/**
 * Resolve a level-op term to the price value(s) it tests on this bar: a fixed level as-is, a segments
 * extent via the bar grid. Empty = nothing to test (out of span / malformed) -- the term cannot fire.
 * @param {{ level?:number, extent?:any }} term @param {{ time?:number }} bar @param {any[]} [tail]
 * @returns {number[]}
 */
export function termLevels(term, bar, tail) {
  if (term.level != null) return [Number(term.level)];
  const e = term.extent;
  if (e && e.kind === 'segments') return segLevelsAt(tail || [], e.points, e.extend, Number(bar.time));
  return [];
}

/** Is a compiled term well-formed enough to arm / evaluate (not the drawing/indicator 'unsupported')?
 * @param {{ op:string, level?:number, extent?:any, percent?:number, amount?:number, lookback?:number }} t */
export function isSupportedTerm(t) {
  if (!t || t.op === 'unsupported') return false;
  if (t.op === 'move-up-pct' || t.op === 'move-down-pct') return Number(t.percent) > 0 && Number(t.lookback) > 0;
  if (t.op === 'move-up' || t.op === 'move-down') return Number(t.amount) > 0 && Number(t.lookback) > 0;
  return t.level != null || validExtent(t.extent); // level ops (cross / gt / lt): a fixed level or a drawn object
}

/**
 * Can this compiled condition EVER fire? The one predicate the arming loop, the panel's status, and the
 * dialog's validation all share, mirroring conditionFires exactly: an `any` match needs at least one
 * supported term; an `all` match refuses if any term is unsupported (an unconfirmable term must not
 * silently pass an AND). A condition that fails this is a dead alert: it saves fine, shows in the panel,
 * and never fires -- the honesty gap this predicate closes.
 * @param {{ match?: string, terms?: any[] } | null | undefined} compiled
 */
export function conditionEvaluable(compiled) {
  const terms = (compiled && compiled.terms) || [];
  const supported = terms.filter(isSupportedTerm);
  if (!supported.length) return false;
  return compiled && compiled.match === 'any' ? true : supported.length === terms.length;
}

/**
 * Does one compiled term fire on this bar? Level ops (cross/gt/lt) read the bar; the relative Moving % ops
 * read the `tail` (close now vs close `lookback` bars ago). Fires AT the threshold, not below.
 * @param {{ op: string, level?: number, extent?: any, percent?: number, amount?: number, lookback?: number }} term
 * @param {{ open:number, high:number, low:number, close:number, time?:number }} bar
 * @param {any[]} [tail]
 */
export function termFires(term, bar, tail) {
  if (!term || !bar) return false;
  // a REGION extent has its own zone semantics per op; segments/level fall through to termLevels below
  if (term.extent && term.extent.kind === 'region') return regionFires(term.op, term.extent, bar);
  switch (term.op) {
    // level ops resolve their value(s) first: one fixed level, or the anchored line's value(s) at this bar
    // (termLevels). Any resolved value firing fires the term -- a zigzag strand behaves like its own line.
    case 'cross':
      return termLevels(term, bar, tail).some((l) => crossed(bar, l, 'both'));
    case 'cross-up':
      return termLevels(term, bar, tail).some((l) => crossed(bar, l, 'up'));
    case 'cross-down':
      return termLevels(term, bar, tail).some((l) => crossed(bar, l, 'down'));
    case 'gt':
      return termLevels(term, bar, tail).some((l) => bar.close > l);
    case 'lt':
      return termLevels(term, bar, tail).some((l) => bar.close < l);
    case 'move-up-pct': {
      const m = movePct(tail || [], bar, Number(term.lookback));
      return m != null && m >= Number(term.percent);
    }
    case 'move-down-pct': {
      const m = movePct(tail || [], bar, Number(term.lookback));
      return m != null && -m >= Number(term.percent);
    }
    case 'move-up': {
      const d = moveAbs(tail || [], bar, Number(term.lookback));
      return d != null && d >= Number(term.amount);
    }
    case 'move-down': {
      const d = moveAbs(tail || [], bar, Number(term.lookback));
      return d != null && -d >= Number(term.amount);
    }
    default:
      return false; // unsupported (drawing/indicator side) -- never fires yet
  }
}

/**
 * Does the whole compiled condition fire on this bar? `all` requires every term (and, for safety, refuses to
 * fire if any term is unsupported -- an unconfirmable term must not silently pass an AND). `any` fires on the
 * first supported term that fires. `tail` is the feed's recent-bars ring, for Moving % terms.
 * @param {{ match?: string, terms?: any[] }} compiled
 * @param {{ open:number, high:number, low:number, close:number, time?:number }} bar
 * @param {any[]} [tail]
 */
export function conditionFires(compiled, bar, tail) {
  const terms = (compiled && compiled.terms) || [];
  const supported = terms.filter(isSupportedTerm);
  if (!supported.length) return false;
  if (compiled.match === 'any') return supported.some((t) => termFires(t, bar, tail));
  if (supported.length !== terms.length) return false; // an unsupported term can't pass an ALL match
  return supported.every((t) => termFires(t, bar, tail));
}

/**
 * Map the dialog's Trigger LABEL to a stable cadence key. The one place the label vocabulary is decoded -- the dialog
 * stamps `cadence: cadenceOf(trigger)` onto the record so the host's eval loop reads a stable field, never a label
 * (the same "compile UI -> stable terms" rule conditions and expiry already follow). @param {string} trigger */
export function cadenceOf(trigger) {
  if (trigger === 'Once per bar') return 'per-bar';
  if (trigger === 'Once per bar close') return 'per-bar-close';
  if (trigger === 'Once per minute') return 'per-minute';
  return 'once';
}

/**
 * Trigger-cadence gate. Given a candidate fire, decide whether
 * the cadence permits it now, from the alert's runtime state (rt). Does NOT mutate -- call markFired() after.
 * @param {'once'|'per-bar'|'per-bar-close'|'per-minute'} cadence
 * @param {{ fired?: boolean, lastFireMs?: number, lastFireBar?: number }|undefined} rt
 * @param {number} barTime      the candidate bar's time (its stable key)
 * @param {number} nowMs        Date.now()
 * @param {boolean} onClosedBar true if the candidate bar is a just-CLOSED bar (not the forming one)
 */
export function cadenceAllows(cadence, rt, barTime, nowMs, onClosedBar) {
  rt = rt || {};
  switch (cadence) {
    case 'per-minute':
      return !rt.lastFireMs || nowMs - rt.lastFireMs >= 60000;
    case 'per-bar':
      return rt.lastFireBar !== barTime;
    case 'per-bar-close':
      return onClosedBar && rt.lastFireBar !== barTime;
    case 'once':
    default:
      return !rt.fired;
  }
}

/**
 * @param {number} barTime @param {number} nowMs
 * @returns {{ fired: true, lastFireMs: number, lastFireBar: number }}
 */
export function markFired(barTime, nowMs) {
  return { fired: true, lastFireMs: nowMs, lastFireBar: barTime };
}

/**
 * Has the alert passed its expiry? expiryMs is a resolved epoch-ms instant (null = open-ended).
 * @param {number|null|undefined} expiryMs @param {number} nowMs
 */
export function isExpired(expiryMs, nowMs) {
  return expiryMs != null && nowMs >= expiryMs;
}
