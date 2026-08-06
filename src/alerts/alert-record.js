// @ts-check
// Alert-record SCHEMA -- a PURE, import-free leaf (no DOM, no store, no funnel, no engine). The ONE place that knows
// the shape of an alert record: how to read its eval level / operator / status / condition lines, and (withLevel, added
// next) how to rewrite its level. UI and drawing code call these instead of reaching into a.compiled.terms[] /
// a.conditions.conditions[] / a.rt directly, so the schema has a single home -- mirroring order-intent.js for the
// order ticket and eval.js's pure-core philosophy. Every function is a pure read of its argument; display strings
// (i18n) stay in the UI -- statusOf returns a stable KEY the panel maps to a translated label.

/** the PRODUCER that drives this alert: 'price' (a condition on a bar feed, the default/legacy shape) or
 * 'time' (a schedule). The one field the arming branch keys off. @param {any} a @returns {'price'|'time'} */
export function sourceOf(a) {
  return a && a.source === 'time' ? 'time' : 'price';
}

/** a time alert's schedule (null for price alerts). @param {any} a */
export function scheduleOf(a) {
  return (a && a.schedule) || null;
}

/** does this alert's condition depend on a TIMEFRAME? The "Moving" family does (price over bars), and so
 * does a segments extent (the drawn line evaluates on the alert-interval bar grid). Fixed-level conditions
 * (cross/gt/lt on one price) are TF-independent; a time alert has none. The interval is shown
 * (dialog/row/card) only when this is true. @param {any} a @returns {boolean} */
export function usesTimeframe(a) {
  const terms = (a && a.compiled && a.compiled.terms) || [];
  return terms.some((/** @type {any} */ t) => t && (/^move/.test(String(t.op)) || t.extent != null));
}

/** the producer TYPE of an alert, for the Log's "show events by type" filter: 'watchlist' (one rule fanned out
 * over a named list), 'time' (a schedule), or 'price' (a single-symbol price condition -- the default). Watchlist
 * takes precedence: a list rule is price-sourced but reads as a Watchlist event. @param {any} a @returns {'price'|'time'|'watchlist'} */
export function alertType(a) {
  if (applyOf(a).kind === 'watchlist') return 'watchlist';
  if (sourceOf(a) === 'time') return 'time';
  return 'price';
}

/** WHAT this alert applies to: a single symbol (the default/legacy shape) or every symbol in a named watchlist.
 * A record that predates the field, or any price alert without an explicit apply, is a single-symbol alert on
 * its own `symbol`. The watchlist `name` is a denormalized display label (may be stale after a rename).
 * @param {any} a @returns {{ kind:'symbol', symbol:string } | { kind:'watchlist', listId:string, name:string }} */
export function applyOf(a) {
  const ap = a && a.apply;
  if (ap && ap.kind === 'watchlist' && ap.listId)
    return { kind: 'watchlist', listId: ap.listId, name: ap.name || 'Watchlist' };
  return { kind: 'symbol', symbol: (a && a.symbol) || '' };
}

/** the SYMBOLS a watchlist doc's named list contains, in order, de-duped. Pure schema read of the file at
 * /api/watchlist ({ lists:[{ id, items:[{type:'symbol',broker,symbol}|{type:'section',...}] }] }); the flat
 * `items` array mixes section headers and symbols -- we keep only symbols. @param {any} doc @param {string} listId
 * @returns {{ broker:(string|null), symbol:string }[]} */
export function listSymbols(doc, listId) {
  const lists = doc && Array.isArray(doc.lists) ? doc.lists : [];
  const L = lists.find((/** @type {any} */ l) => l && l.id === listId);
  const items = L && Array.isArray(L.items) ? L.items : [];
  /** @type {{ broker:(string|null), symbol:string }[]} */
  const out = [];
  const seen = new Set();
  for (const it of items) {
    if (!it || it.type !== 'symbol' || !it.symbol) continue;
    const key = (it.broker || '*') + '|' + it.symbol;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ broker: it.broker || null, symbol: it.symbol });
  }
  return out;
}

/** read the runtime latch for a given symbol. A watchlist alert keys `rt` BY symbol so one symbol's fire never
 * latches another; a single-symbol alert keeps the flat `rt`. Returns {} when nothing has fired yet -- the shape
 * the eval core (cadenceAllows/markFired) expects. @param {any} a @param {string} symbol @returns {any} */
export function rtFor(a, symbol) {
  if (applyOf(a).kind === 'watchlist') {
    const m = (a && a.rt) || {};
    return m[symbol] || {};
  }
  return (a && a.rt) || {};
}

/** the update PATCH that writes a symbol's runtime latch back. Watchlist: merge into the per-symbol map, leaving
 * every other symbol's latch untouched (the isolation the acceptance test pins). Single-symbol: replace flat `rt`.
 * @param {any} a @param {string} symbol @param {any} rt @returns {{ rt:any }} */
export function withRt(a, symbol, rt) {
  if (applyOf(a).kind === 'watchlist') return { rt: { ...((a && a.rt) || {}), [symbol]: rt } };
  return { rt };
}

/** the eval price level of an alert: the first compiled term carrying a finite numeric level. @param {any} a @returns {number|null} */
export function levelOf(a) {
  const terms = a && a.compiled && a.compiled.terms;
  if (Array.isArray(terms)) {
    for (const tm of terms) {
      const l = tm && Number(tm.level);
      if (Number.isFinite(l)) return l;
    }
  }
  return null;
}

/** the first condition operator label (e.g. "Crossing"), for the hover pill / display. @param {any} a @returns {string} */
export function opOf(a) {
  const rows = a && a.conditions && a.conditions.conditions;
  return Array.isArray(rows) && rows[0] && rows[0].op ? rows[0].op : 'Crossing';
}

/** the human condition lines from the UI form, e.g. "Price Crossing Trend line" or, for a Moving % row (which
 * carries a percent + a bar count instead of a right-hand object), "Price Moving Up 0.1% in 1 bar".
 * @param {any} a @returns {string[]} */
export function condLines(a) {
  const rows = a && a.conditions && Array.isArray(a.conditions.conditions) ? a.conditions.conditions : [];
  return rows
    .map((/** @type {any} */ r) => {
      if (/Moving/i.test(String(r.op || ''))) {
        const isPct = /%\s*$/.test(String(r.op));
        const base = String(r.op).replace(/\s*%\s*$/, ''); // "Moving Up %" -> "Moving Up"
        const mag = isPct ? (r.percent != null ? r.percent + '%' : '') : r.amount != null ? String(r.amount) : '';
        const n = Number(r.lookback);
        const bars = Number.isFinite(n) ? 'in ' + n + ' ' + (n === 1 ? 'bar' : 'bars') : '';
        return [r.left, base, mag, bars].filter(Boolean).join(' ');
      }
      return [r.left, r.op, r.right].filter(Boolean).join(' ');
    })
    .filter(Boolean);
}

/** does this alert use an ANY (vs ALL) match? @param {any} a @returns {boolean} */
export function isAny(a) {
  return !!(a && a.conditions && /any/i.test(a.conditions.match || 'all'));
}

/** the alert's lifecycle status as a stable KEY (the panel maps it to a translated label). @param {any} a @returns {'active'|'triggered'|'stopped'} */
export function statusOf(a) {
  if (a && a.enabled) return 'active';
  if (a && a.rt && a.rt.fired) return 'triggered'; // fired then auto-stopped (Once only)
  return 'stopped'; // manually paused
}

// The update PATCH to MOVE an alert to a new price level -- the one home for the "set level + re-arm" mutation that was
// hand-rolled in the drag handler (alert-primitive) and the drawing-move sync (alert-drawing-sync). It rewrites every
// compiled term's level, resets the fired latch (rt: {}) so the moved alert re-arms, and -- ONLY when the record carries
// a literal Value (a condition row with a numeric value) -- rewrites those rows' value too. A drawing-ANCHORED alert
// carries no Value; its anchor is rebuilt by the caller that owns the drawing geometry (spread this patch, add anchor).
/** @param {any} a @param {number} lvl @returns {{ compiled: any, rt: {}, conditions?: any }} */
export function withLevel(a, lvl) {
  const compiled =
    a && a.compiled
      ? {
          ...a.compiled,
          terms: (a.compiled.terms || []).map((/** @type {any} */ tm) =>
            tm && tm.level != null ? { ...tm, level: lvl } : tm,
          ),
        }
      : a && a.compiled;
  const rows = (a && a.conditions && a.conditions.conditions) || [];
  /** @type {{ compiled: any, rt: {}, conditions?: any }} */
  const patch = { compiled, rt: {} };
  if (rows.some((/** @type {any} */ r) => r && r.value != null)) {
    patch.conditions = {
      ...a.conditions,
      conditions: rows.map((/** @type {any} */ r) => (r && r.value != null ? { ...r, value: lvl } : r)),
    };
  }
  return patch;
}

/** Substitute `#token` placeholders in an alert MESSAGE with fire-time values. Generic and pure: the caller
 * supplies the token map (symbol/broker/interval/price/timenow -- preformatted strings; this leaf stays
 * import-free). An unknown token passes through untouched; a token with no value becomes empty.
 * @param {any} text @param {Record<string, any>} subs @returns {string} */
export function fillPlaceholders(text, subs) {
  let out = String(text == null ? '' : text);
  for (const [k, v] of Object.entries(subs || {})) out = out.split('#' + k).join(v == null ? '' : String(v));
  return out;
}

/** the update PATCH to RESTART a stopped/triggered alert: re-enable it AND clear the fired latch (rt) so a spent
 * "Once only" (or any recurring) alert re-arms fresh -- the same reset-to-rearm rule withLevel applies on a move.
 * The rt-schema knowledge lives HERE, not in the view. @returns {{ enabled: true, rt: {} }} */
export function restartPatch() {
  return { enabled: true, rt: {} };
}

/** Price decimals for a record's Value fields: the alert's OWN precision (stamped on the record at creation);
 * a legacy record (no priceDecimals) falls back to the max precision of its stored condition values -- so
 * editing never truncates a value whose instrument differs from whatever chart is open (a forex alert edited
 * on an index). @param {any} a @returns {number} */
export function priceDecimalsOf(a) {
  if (a && a.priceDecimals != null) return a.priceDecimals;
  /** @param {any} v @returns {number} */
  const decimalsOf = (v) => {
    if (v == null) return 0;
    const i = String(v).indexOf('.');
    return i < 0 ? 0 : String(v).length - i - 1;
  };
  const rows = (a && a.conditions && a.conditions.conditions) || [];
  return rows.length ? Math.max(0, ...rows.map((/** @type {any} */ r) => decimalsOf(r.value))) : 0;
}
