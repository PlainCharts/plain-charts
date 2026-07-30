// @ts-check
// Neutral bar: the extra (beyond-OHLCV) fields the pipeline carries end-to-end. The bar stays a plain
// object { time, open, high, low, close, volume, ...extras }; adapters map their raw feed into these
// stable neutral names so studies read one name across brokers. Fields are OPTIONAL -- a bar only
// carries an extra when its feed provides it (undefined otherwise). Capture-all: unknown extras ride
// along too (they just aggregate with the default rule).
//
// Each field has an AGGREGATION RULE, used when bars are coarsened (e.g. 1m -> 5m, or 1D -> 1W):
//   sum   -> additive over the group (counts/quantities)
//   last  -> the group's most recent value (point-in-time readings)  [default]
//   first -> the group's opening value
//   max/min -> extremes
/** @typedef {'sum'|'last'|'first'|'max'|'min'} AggRule */
/** @type {Record<string, AggRule>} */
export const EXTRA_AGG = {
  openInterest: 'last', // futures OI -- a daily point-in-time reading (settlement); last in the group
  tickVolume: 'sum', // trade count per bar -- additive like volume
  settlement: 'last', // official daily settlement price
  exchangeClose: 'last', // official exchange close price
};

// the OHLCV core -- everything else on a bar is an "extra"
const BASE = new Set(['time', 'open', 'high', 'low', 'close', 'volume']);
/** @param {string} k */
export const isExtraKey = (k) => !BASE.has(k);

// Fold one bar's extras into an aggregation accumulator `group`, applying each field's rule. Bars must
// be folded in ascending time order (so 'last'/'first' resolve correctly) -- every caller sorts first.
// Generic (capture-all): any non-OHLCV key is folded, using its known rule or 'last' as the default.
/** @param {Record<string, any>} group @param {Record<string, any>} bar */
export function foldExtras(group, bar) {
  for (const k in bar) {
    if (BASE.has(k)) continue;
    const v = bar[k];
    if (v == null) continue;
    const rule = EXTRA_AGG[k] || 'last';
    if (rule === 'sum') group[k] = (group[k] || 0) + v;
    else if (rule === 'first') {
      if (group[k] == null) group[k] = v;
    } else if (rule === 'max') group[k] = group[k] == null ? v : Math.max(group[k], v);
    else if (rule === 'min') group[k] = group[k] == null ? v : Math.min(group[k], v);
    else group[k] = v; // 'last' (default): overwrite, since we fold in ascending time
  }
}
