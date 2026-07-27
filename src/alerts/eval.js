// @ts-check
// The alert EVALUATION core -- pure, headless, no DOM, no engine. One gap-proof OHLC cross primitive + direction gating +
// trigger-cadence gating + expiry. Everything here is a pure function of (compiled condition, bar, runtime
// state, clock) so it is trivially testable and reusable in any window role.
//
// A "compiled" condition is the host-friendly form the dialog produces (create-alert-dialog.js compile()):
// display labels + i18n live in the UI; the host only ever sees stable terms.
//   compiled = { match: 'all' | 'any', terms: Term[] }
//   Term     = { op: 'cross'|'cross-up'|'cross-down'|'gt'|'lt', level: number }   (price vs a fixed level)
//            | { op: 'unsupported', ... }                                          (drawing/indicator side -- P5)

// The bar-tail ring size the feed keeps -- at least the largest lookback any relative condition may ask for.
export const BAR_TAIL_CAP = 300;

/**
 * Fold a report's bars into the tail ring: dedup by bar time (a re-reported forming bar overwrites in place),
 * keep time order, and cap to the last `cap`. Pure, so relative conditions (Moving %) get a clean recent-bars
 * sequence. @param {any[]} tail @param {any[]} bars @param {number} cap @returns {any[]}
 */
export function mergeTail(tail, bars, cap) {
  /** @type {Map<number, any>} */
  const byTime = new Map();
  for (const b of (tail || [])) if (b && b.time != null) byTime.set(b.time, b);
  for (const b of (bars || [])) if (b && b.time != null) byTime.set(b.time, b);   // newer report wins per time
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
  const up = bar.close >= level && bar.low < level;      // closed at/above, wick dipped below -> crossed up
  const down = bar.close <= level && bar.high > level;   // closed at/below, wick poked above -> crossed down
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

/** Is a compiled term well-formed enough to arm / evaluate (not the drawing/indicator 'unsupported')?
 * @param {{ op:string, level?:number, percent?:number, amount?:number, lookback?:number }} t */
export function isSupportedTerm(t) {
  if (!t || t.op === 'unsupported') return false;
  if (t.op === 'move-up-pct' || t.op === 'move-down-pct') return Number(t.percent) > 0 && Number(t.lookback) > 0;
  if (t.op === 'move-up' || t.op === 'move-down') return Number(t.amount) > 0 && Number(t.lookback) > 0;
  return t.level != null;   // level ops (cross / gt / lt)
}

/**
 * Does one compiled term fire on this bar? Level ops (cross/gt/lt) read the bar; the relative Moving % ops
 * read the `tail` (close now vs close `lookback` bars ago). Fires AT the threshold, not below.
 * @param {{ op: string, level?: number, percent?: number, amount?: number, lookback?: number }} term
 * @param {{ open:number, high:number, low:number, close:number, time?:number }} bar
 * @param {any[]} [tail]
 */
export function termFires(term, bar, tail) {
  if (!term || !bar) return false;
  switch (term.op) {
    case 'cross': return term.level != null && crossed(bar, term.level, 'both');
    case 'cross-up': return term.level != null && crossed(bar, term.level, 'up');
    case 'cross-down': return term.level != null && crossed(bar, term.level, 'down');
    case 'gt': return term.level != null && bar.close > term.level;
    case 'lt': return term.level != null && bar.close < term.level;
    case 'move-up-pct': { const m = movePct(tail || [], bar, Number(term.lookback)); return m != null && m >= Number(term.percent); }
    case 'move-down-pct': { const m = movePct(tail || [], bar, Number(term.lookback)); return m != null && -m >= Number(term.percent); }
    case 'move-up': { const d = moveAbs(tail || [], bar, Number(term.lookback)); return d != null && d >= Number(term.amount); }
    case 'move-down': { const d = moveAbs(tail || [], bar, Number(term.lookback)); return d != null && -d >= Number(term.amount); }
    default: return false;   // unsupported (drawing/indicator side) -- never fires yet
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
  if (supported.length !== terms.length) return false;   // an unsupported term can't pass an ALL match
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
    case 'per-minute': return !rt.lastFireMs || (nowMs - rt.lastFireMs) >= 60000;
    case 'per-bar': return rt.lastFireBar !== barTime;
    case 'per-bar-close': return onClosedBar && rt.lastFireBar !== barTime;
    case 'once':
    default: return !rt.fired;
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
export function isExpired(expiryMs, nowMs) { return expiryMs != null && nowMs >= expiryMs; }
