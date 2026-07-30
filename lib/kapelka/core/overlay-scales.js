// @ts-check
// Overlay price scales. A non-main priceScaleId puts a series on an independent, invisible scale
// confined to a region of its pane (scaleMargins), auto-fit over just that scale's series. This
// generalizes the baked-in volume region so ANY series can be a bottom (or any-region) overlay.
// No coordinate-core change: each such series gets a `_scaleView` -- a g-like object the existing
// renderers consume in place of the pane grid. Pure functions of (grid, series); lifted out of the
// Chart shell unchanged. buildScaleViews is the entry point (Chart._rebuild calls it per pane).

/** @param {any} id @returns {boolean} */
export function isOverlayId(id) {
  return id != null && id !== '' && id !== 'right' && id !== 'left';
}

// value->pixel over a sub-region [top..(1-bottom)] of the pane height; mirrors layout_fn's A/B.
/** @param {import('./types.js').GridLayout} g @param {{ top?: number, bottom?: number, hi: number, lo: number, log?: boolean }} o @returns {import('./types.js').ScaleView} */
export function makeScaleView(g, o) {
  const H = g.height,
    mt = o.top || 0,
    mb = o.bottom || 0;
  const regionTop = mt * H,
    regionBot = (1 - mb) * H,
    regionH = Math.max(1, regionBot - regionTop);
  let hi = o.hi,
    lo = o.lo;
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const log = o.log,
    tf = (/** @type {number} */ v) => (log ? Math.log(v) : v);
  const A = -regionH / (tf(hi) - tf(lo)),
    B = regionTop - tf(hi) * A;
  return {
    A,
    B,
    height: regionBot,
    width: g.width,
    px_step: g.px_step,
    ti_map: g.ti_map,
    $2screen: (v) => /** @type {import('./types.js').YPx} */ (Math.floor(tf(v) * A + B) - 0.5),
    screen2$: (y) => /** @type {import('./types.js').Price} */ (log ? Math.exp((y - B) / A) : (y - B) / A),
    t2screen: (t) => g.t2screen(t),
    screen2t: (x) => g.screen2t(x),
  };
}

// auto-fit [hi,lo] over only the given series' rows; histograms include base 0 (bars grow from it)
/** @param {import('./series.js').Series[]} list @param {boolean} [isHist] @returns {{ hi: number, lo: number }|null} */
export function scanScaleRange(list, isHist) {
  let hi = -Infinity,
    lo = Infinity;
  for (const s of list)
    for (const r of s._rows) {
      if (s._isCandle()) {
        if (r[2] > hi) hi = r[2];
        if (r[3] < lo) lo = r[3];
      } else if (s._type.type === 'Segmented' || s._view) {
        const a = r[1],
          b = r[2];
        const mx = Math.max(a, b),
          mn = Math.min(a, b);
        if (mx > hi) hi = mx;
        if (mn < lo) lo = mn;
      } else {
        const v = r[1];
        if (v != null) {
          if (v > hi) hi = v;
          if (v < lo) lo = v;
        }
      }
    }
  if (!isFinite(hi) || !isFinite(lo)) return null;
  if (isHist) return { hi: Math.max(hi, 0), lo: Math.min(lo, 0) }; // volume-style: fill region to max, base 0
  if (lo >= 0) return { hi: hi + (hi * 0.08 || 1), lo: 0 }; // all-positive overlay -> anchor at the baseline
  const pad = (hi - lo) * 0.08 || 1;
  return { hi: hi + pad, lo: lo - pad };
}

// group a pane's series by overlay scale id and assign each member a shared _scaleView
/** @param {import('./types.js').GridLayout} g @param {import('./series.js').Series[]} seriesList @returns {void} */
export function buildScaleViews(g, seriesList) {
  const groups = /** @type {Map<any, import('./series.js').Series[]>} */ (new Map());
  for (const s of seriesList) {
    if (isOverlayId(s._priceScaleId)) {
      /** @type {import('./series.js').Series[]} */ (
        groups.get(s._priceScaleId) || groups.set(s._priceScaleId, []).get(s._priceScaleId)
      ).push(s);
    } else s._scaleView = null;
  }
  groups.forEach((list) => {
    const isHist = list.some((s) => s._type.type === 'Histogram');
    const range = scanScaleRange(list, isHist);
    if (!range) {
      list.forEach((s) => {
        s._scaleView = null;
      });
      return;
    }
    const m = (list.find((s) => s._scaleMargins) || {})._scaleMargins || { top: 0, bottom: 0 };
    const log = list.some((s) => s._overlayLog);
    const view = makeScaleView(g, { hi: range.hi, lo: range.lo, top: m.top || 0, bottom: m.bottom || 0, log });
    list.forEach((s) => {
      s._scaleView = view;
    });
  });
}
