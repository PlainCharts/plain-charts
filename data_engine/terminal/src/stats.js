// Execution-speed stats. Each command sent over MCP is timed (send -> broker reply); we accumulate per
// broker:command key. command() resolves when the worker's handler finishes -- for orders that is the broker
// round-trip (ack/fill/reject), so this measures real execution latency (incl. the MT5 VM hop).

const rows = new Map();   // key -> { n, last, min, max, sum }
let last = null;          // { key, ms } -- most recent
const subs = new Set();

/** @param {string} key @param {number} ms */
export function record(key, ms) {
  const r = rows.get(key) || { n: 0, last: 0, min: Infinity, max: 0, sum: 0 };
  r.n += 1; r.last = ms; r.min = Math.min(r.min, ms); r.max = Math.max(r.max, ms); r.sum += ms;
  rows.set(key, r);
  last = { key, ms };
  subs.forEach((fn) => { try { fn(); } catch (_) {} });
}

export function snapshot() {
  return [...rows.entries()].map(([key, r]) => ({ key, n: r.n, last: r.last, avg: Math.round(r.sum / r.n), min: r.min === Infinity ? 0 : r.min, max: r.max }));
}

export const latest = () => last;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
