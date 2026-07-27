// Fast-path / slow-path parity checks. Run: npm run parity
//
// The incremental tick feed (classify -> patch -> feedBar) must produce EXACTLY the state a full
// rebuild produces, for any sequence of live-feed events. This drives both paths side by side over
// seeded random sequences and asserts deep equality after every batch.
//
// Units under test are the real modules: classifyTicks (src/chart/pane/tick-class.js) and Series
// (lib/kapelka/core/series.js). The apply loop below mirrors pane.js _redrawFast's patch (replace
// last / append) and _ingest's valid-filter + accumulation contract -- if those change shape,
// change this mirror with them.
import { Series } from '../lib/kapelka/core/series.js';
import { classifyTicks } from '../src/chart/pane/tick-class.js';

const CANDLE = { type: 'Candlestick' };
const chartStub = () => ({ _ib: false, _range: [0, 1], _ds: () => null, _autoScrollAppend: () => {}, _fitToData: () => {}, _invalidate: () => {}, _schedule: () => {}, _restyle: () => {} });

// seeded PRNG (mulberry32) so a failure is reproducible from the printed seed
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const TF = 300;   // bar step, seconds
function bar(t, c, v) { return { time: t, open: c - 1, high: c + 1.5, low: c - 1.5, close: c, volume: v == null ? 100 : v }; }

function makeWorld(nextRand, histLen) {
  const map = new Map();
  let t = 1700000000, c = 5000;
  for (let i = 0; i < histLen; i++) { map.set(t, bar(t, c)); t += TF; c += (nextRand() - 0.5) * 4; }
  const arr = [...map.values()].sort((a, b) => a.time - b.time);
  const times = arr.map((b) => b.time);
  const series = new Series(chartStub(), CANDLE);
  series.feed(arr.slice());
  return { map, arr, times, series, nextT: t, lastC: c };
}

// one random feed batch: mostly forming/append (the live-tape shape), sometimes resends,
// corrections, prepends, invalid bars
function makeBatch(w, r) {
  const roll = r();
  const last = w.arr[w.arr.length - 1];
  if (roll < 0.45) {          // forming update (sometimes preceded by an identical closed-bar resend)
    const b = { ...last, close: last.close + (r() - 0.5) * 2, high: last.high + r(), volume: last.volume + 1 };
    return r() < 0.3 && w.arr.length > 1 ? [{ ...w.arr[w.arr.length - 2] }, b] : [b];
  }
  if (roll < 0.7) {           // append 1..3 new bars, ascending
    const out = []; let t = w.nextT, c = w.lastC;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) { c += (r() - 0.5) * 4; out.push(bar(t, c)); t += TF; }
    w.nextT = t; w.lastC = c;
    return out;
  }
  if (roll < 0.8) return [{ ...last }];                                   // identical resend -> no-op
  if (roll < 0.88) {          // closed-bar correction -> must take the full path
    const i = Math.floor(r() * (w.arr.length - 1));
    return [{ ...w.arr[i], close: w.arr[i].close + 1 }];
  }
  if (roll < 0.95) {          // prepend a chunk of older history -> full path
    const first = w.arr[0].time; const out = [];
    for (let i = 1; i <= 3; i++) out.push(bar(first - i * TF, w.arr[0].close + i));
    return out;
  }
  return [null, { ...last, close: 0 }, { ...last, close: last.close + 0.5 }];   // invalid bars filtered out
}

// FAST world: mirror _ingest (filter + classify + apply to map) and _redrawFast (patch + feedBar);
// a 'full' classification falls back exactly like redraw does (rebuild sorted arr, full feed).
function applyFast(w, batches) {
  let ops = [];            // accumulated like this._fastOps across ingests before one redraw
  let lastT = w.arr.length ? w.arr[w.arr.length - 1].time : null;
  let full = false;
  for (const bars of batches) {
    const valid = bars.filter((b) => b && b.close > 0);
    if (!full) {
      const res = classifyTicks(w.map, lastT, valid);
      if (res.ops === 'full') full = true;
      else { ops = ops.concat(res.ops); lastT = res.lastT; }
    }
    for (const b of valid) w.map.set(b.time, b);
  }
  if (full) {
    w.arr = [...w.map.values()].sort((a, b) => a.time - b.time);
    w.times = w.arr.map((b) => b.time);
    w.series.feed(w.arr.slice());
    return;
  }
  for (const b of ops) {
    const n = w.arr.length;
    if (n && b.time === w.arr[n - 1].time) w.arr[n - 1] = b;
    else if (!n || b.time > w.arr[n - 1].time) { w.arr.push(b); w.times.push(b.time); }
    w.series.feedBar(b);
  }
}

// SLOW world: authoritative full rebuild from the same map
function slowState(map) {
  const arr = [...map.values()].sort((a, b) => a.time - b.time);
  const s = new Series(chartStub(), CANDLE);
  s.feed(arr.slice());
  return { arr, times: arr.map((b) => b.time), rows: s._rows };
}

function run(seed, rounds) {
  const r = rng(seed);
  const w = makeWorld(r, 40 + Math.floor(r() * 200));
  for (let round = 0; round < rounds; round++) {
    // 1 or 2 ingest batches before one redraw (accumulation contract)
    const batches = [makeBatch(w, r)];
    if (r() < 0.2) batches.push(makeBatch(w, r));
    applyFast(w, batches);
    const slow = slowState(w.map);
    const ok = JSON.stringify(w.arr) === JSON.stringify(slow.arr)
      && JSON.stringify(w.times) === JSON.stringify(slow.times)
      && JSON.stringify(w.series._rows) === JSON.stringify(slow.rows);
    if (!ok) {
      console.error(`PARITY FAIL seed=${seed} round=${round}`);
      console.error('fast arr tail:', JSON.stringify(w.arr.slice(-3)));
      console.error('slow arr tail:', JSON.stringify(slow.arr.slice(-3)));
      console.error('fast rows tail:', JSON.stringify(w.series._rows.slice(-3)));
      console.error('slow rows tail:', JSON.stringify(slow.rows.slice(-3)));
      return false;
    }
  }
  return true;
}

const SEEDS = 40, ROUNDS = 120;
let pass = 0;
for (let s = 1; s <= SEEDS; s++) { if (!run(s * 7919, ROUNDS)) process.exit(1); pass++; }
console.log(`parity: ${pass}/${SEEDS} seeds x ${ROUNDS} rounds green (tick feed fast path == full rebuild)`);
