// @ts-check
// Moving Average Ribbon. Four moving averages, each
// with its own type (SMA / EMA / SMMA (RMA) / WMA / VWMA), source, length, and line style. Drawn on
// the price pane. Each MA is independent (show toggle + full stroke picker), so it doubles as a
// single configurable MA when you disable the other three.

const MA_TYPES = [
  { key: 'SMA', name: 'SMA' },
  { key: 'EMA', name: 'EMA' },
  { key: 'SMMA (RMA)', name: 'SMMA (RMA)' },
  { key: 'WMA', name: 'WMA' },
  { key: 'VWMA', name: 'VWMA' },
];
const DEF = [
  { len: 20, color: '#f6c309' },
  { len: 50, color: '#fb9800' },
  { len: 100, color: '#fb6500' },
  { len: 200, color: '#f60c0c' },
];

// a stroke value is { color, width, style }; migrate an older plain-colour param.
const strk = (/** @type {any} */ v) => (typeof v === 'string' ? { color: v } : v || {});

// One moving average over `bars`, using `srcKey` (close/hl2/hlc3/...), `length`, `type`. Returns an
// array aligned to bars with null during warm-up. SMA/VWMA use rolling sums (O(n)); EMA/RMA seed
// with the SMA at the first full window then recurse (standard); WMA is linearly weighted.
/**
 * @param {StudyBar[]} bars
 * @param {string} srcKey
 * @param {number} length
 * @param {string} type
 * @returns {(number | null)[]}
 */
function movingAverage(bars, srcKey, length, type) {
  const n = bars.length,
    L = Math.max(1, length | 0);
  /** @type {(number | null)[]} */
  const out = new Array(n).fill(null);
  if (!n) return out;
  /** @type {number[]} */
  const src = new Array(n);
  for (let i = 0; i < n; i++) src[i] = Studies.priceOf(bars[i], srcKey);

  if (type === 'EMA' || type === 'SMMA (RMA)') {
    const a = type === 'EMA' ? 2 / (L + 1) : 1 / L;
    let ma = null;
    for (let i = 0; i < n; i++) {
      if (i < L - 1) continue;
      if (ma === null) {
        let s = 0;
        for (let j = i - L + 1; j <= i; j++) s += src[j];
        ma = s / L;
      } else ma = ma + a * (src[i] - ma);
      out[i] = ma;
    }
  } else if (type === 'WMA') {
    const denom = (L * (L + 1)) / 2;
    for (let i = L - 1; i < n; i++) {
      let s = 0;
      for (let k = 0; k < L; k++) s += src[i - k] * (L - k);
      out[i] = s / denom;
    }
  } else if (type === 'VWMA') {
    let sv = 0,
      sw = 0;
    for (let i = 0; i < n; i++) {
      const v = bars[i].volume || 0;
      sv += src[i] * v;
      sw += v;
      if (i >= L) {
        const vo = bars[i - L].volume || 0;
        sv -= src[i - L] * vo;
        sw -= vo;
      }
      if (i >= L - 1) out[i] = sw > 0 ? sv / sw : null;
    }
  } else {
    // SMA
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += src[i];
      if (i >= L) s -= src[i - L];
      if (i >= L - 1) out[i] = s / L;
    }
  }
  return out;
}

// Incremental single-value equivalent of movingAverage: a per-type runner fed one bar at a time, returning
// this bar's MA value (or null during warm-up) -- byte-identical to the whole-array form above, so the step
// form matches calc. The runner state is a PLAIN object (a length ring, a running sum, the EMA/RMA recurrence)
// -- no closures -- so the worker can snapshot it for the forming-bar checkpoint (deep-copy, not a hidden var).
/** @typedef {{ mode: string, L: number, a?: number, denom?: number, ma?: (number|null), seedSum?: number,
 *    idx?: number, seed?: number[], buf?: number[], sum?: number, prod?: number[], vols?: number[], sv?: number, sw?: number }} MaState */
/** @param {string} type @param {number} length @returns {MaState} */
function initMA(type, length) {
  const L = Math.max(1, length | 0);
  if (type === 'EMA' || type === 'SMMA (RMA)')
    return { mode: 'ema', L, a: type === 'EMA' ? 2 / (L + 1) : 1 / L, ma: null, seedSum: 0, idx: -1, seed: [] };
  if (type === 'WMA') return { mode: 'wma', L, denom: (L * (L + 1)) / 2, buf: [] };
  if (type === 'VWMA') return { mode: 'vwma', L, prod: [], vols: [], sv: 0, sw: 0 };
  return { mode: 'sma', L, buf: [], sum: 0 };
}
/** Advance one MA runner by one bar; mutates `st`, returns this bar's value or null (warm-up).
 *  @param {MaState} st @param {number} price @param {number} [vol] @returns {number | null} */
function advanceMA(st, price, vol) {
  const L = st.L;
  if (st.mode === 'ema') {
    const seed = /** @type {number[]} */ (st.seed);
    st.idx = /** @type {number} */ (st.idx) + 1;
    seed.push(price);
    st.seedSum = /** @type {number} */ (st.seedSum) + price;
    if (seed.length > L) st.seedSum -= /** @type {number} */ (seed.shift());
    if (st.idx < L - 1) return null;
    st.ma =
      st.ma == null ? /** @type {number} */ (st.seedSum) / L : st.ma + /** @type {number} */ (st.a) * (price - st.ma);
    return st.ma;
  }
  if (st.mode === 'wma') {
    const buf = /** @type {number[]} */ (st.buf);
    buf.push(price);
    if (buf.length > L) buf.shift();
    if (buf.length < L) return null;
    let s = 0;
    for (let k = 0; k < L; k++) s += buf[L - 1 - k] * (L - k);
    return s / /** @type {number} */ (st.denom);
  }
  if (st.mode === 'vwma') {
    const prod = /** @type {number[]} */ (st.prod),
      vols = /** @type {number[]} */ (st.vols);
    const v = vol || 0,
      pr = price * v;
    prod.push(pr);
    vols.push(v);
    st.sv = /** @type {number} */ (st.sv) + pr;
    st.sw = /** @type {number} */ (st.sw) + v;
    if (prod.length > L) {
      st.sv -= /** @type {number} */ (prod.shift());
      st.sw -= /** @type {number} */ (vols.shift());
    }
    if (prod.length < L) return null;
    return st.sw > 0 ? /** @type {number} */ (st.sv) / /** @type {number} */ (st.sw) : null;
  }
  const buf = /** @type {number[]} */ (st.buf); // sma
  buf.push(price);
  st.sum = /** @type {number} */ (st.sum) + price;
  if (buf.length > L) st.sum -= /** @type {number} */ (buf.shift());
  return buf.length < L ? null : /** @type {number} */ (st.sum) / L;
}

// One tidy row per MA: the [x MA #n] toggle hosts its type / source / length /
// line controls inline via the bool-sibling `right: [...]` array -- no separate rows, no labels.
/** @type {StudyInput[]} */
const inputs = [];
DEF.forEach((d, i) => {
  const n = i + 1;
  inputs.push(
    {
      key: `show${n}`,
      type: 'bool',
      name: `MA #${n}`,
      default: true,
      right: [`type${n}`, `source${n}`, `length${n}`, `line${n}`],
    },
    { key: `type${n}`, type: 'select', name: 'Type', options: MA_TYPES, default: 'SMA', hidden: true },
    { key: `source${n}`, type: 'source', name: 'Source', default: 'close', hidden: true },
    { key: `length${n}`, type: 'number', name: 'Length', default: d.len, min: 1, max: 5000, hidden: true },
    {
      key: `line${n}`,
      type: 'stroke',
      name: 'Line',
      default: { color: d.color, width: 2, style: 'solid' },
      hidden: true,
    },
  );
});

Studies.register({
  id: 'ma_ribbon',
  overlay: true,
  requires: { bars: true },
  inputs,
  calc(bars, p) {
    const plots = [];
    for (let n = 1; n <= 4; n++) {
      if (p[`show${n}`] === false) continue;
      const type = p[`type${n}`] || 'SMA';
      const len = Math.max(1, p[`length${n}`] | 0 || DEF[n - 1].len);
      const out = movingAverage(bars, p[`source${n}`] || 'close', len, type);
      const ln = strk(p[`line${n}`] || p[`ma${n}_color`]);
      /** @type {StudyPlotPoint[]} */
      const data = [];
      for (let i = 0; i < bars.length; i++)
        if (out[i] != null && isFinite(/** @type {number} */ (out[i])))
          data.push({ time: bars[i].time, value: /** @type {number} */ (out[i]) });
      plots.push({
        key: `ma${n}`,
        name: `MA${n} ${type} ${len}`,
        type: 'line',
        color: ln.color || DEF[n - 1].color,
        lineWidth: ln.width || 2,
        lineStyle: ln.style || 'solid',
        data,
      });
    }
    return { plots };
  },

  // ---- step form: each enabled MA is an incremental runner advanced over the shared window; step() feeds
  // every runner this bar's source price + volume and emits the ones that have warmed up. ----
  /** @param {Record<string, any>} p */
  init(p) {
    // meta (constant) is kept apart from `st` (the mutable runner state) so the worker snapshots only `st`.
    /** @type {{ key:string, name:string, color:string, width:number, style:string, src:string }[]} */
    const meta = [];
    /** @type {any[]} */
    const st = [];
    for (let n = 1; n <= 4; n++) {
      if (p[`show${n}`] === false) continue;
      const type = p[`type${n}`] || 'SMA';
      const len = Math.max(1, p[`length${n}`] | 0 || DEF[n - 1].len);
      const src = p[`source${n}`] || 'close';
      const ln = strk(p[`line${n}`] || p[`ma${n}_color`]);
      meta.push({
        key: `ma${n}`,
        name: `MA${n} ${type} ${len}`,
        color: ln.color || DEF[n - 1].color,
        width: ln.width || 2,
        style: ln.style || 'solid',
        src,
      });
      st.push(initMA(type, len));
    }
    return { meta, st };
  },
  /** @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  plots(p, ctx, s) {
    return s.meta.map((/** @type {any} */ r) => ({
      key: r.key,
      name: r.name,
      type: 'line',
      color: r.color,
      lineWidth: r.width,
      lineStyle: r.style,
    }));
  },
  /** @param {number} i @param {import('../../../lib/kapelka/studies/step-engine.js').Shared} sh @param {Record<string, any>} p @param {Record<string, any>} ctx @param {any} s */
  step(i, sh, p, ctx, s) {
    const bar = { open: sh.open[i], high: sh.high[i], low: sh.low[i], close: sh.close[i], volume: sh.volume[i] };
    /** @type {Record<string, any>} */
    const row = {};
    for (let k = 0; k < s.meta.length; k++) {
      const v = advanceMA(s.st[k], Studies.priceOf(bar, s.meta[k].src), sh.volume[i]);
      if (v != null && isFinite(v)) row[s.meta[k].key] = { value: v }; // matches calc's out[i] != null && isFinite gate
    }
    return row;
  },
});

export {};
