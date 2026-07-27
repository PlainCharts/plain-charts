// @ts-check
// Pane lifecycle + layout geometry + the pane-ops API, lifted out of the Chart shell (index.js).
// Every entry takes the chart reference `c` -- the engine hub. Groups: the offchart grouping that
// drives the grid stack, create/destroy of the per-pane render bundles (grid+sidebar+crosshair
// canvases), sizing/placing those canvas layers, and the public panes()/removePane/movePane ops.
// The Chart keeps thin delegators; the tiny id<->position accessors (_idAt/_posOf/_gridAt/_gridOf)
// stay on the Chart since they are one-liners used pervasively. Bodies verbatim -- only `this` -> `c`.
import Grid from './components/js/grid.js';
import Sidebar from './components/js/sidebar.js';
import Crosshair from './components/js/crosshair.js';
import { buildOverlay } from './components/renderers/candles.js';

// offchart series grouped by pane index, ordered -> [{ paneIndex, series:[...] }]
/** @param {any} c */
export function offcharts(c) {
  const byPane = new Map();
  for (const s of c._series) {
    // a pane with NO visible series is dropped entirely, reclaiming its space — UNLESS
    // it's preserved (collapsed), in which case its grid is kept as an empty bar (the invisible
    // series still defines the y-range but isn't drawn). The id<->position mapping keeps the rest
    // consistent even mid-stack.
    if (s._pane > 0 && s._rows.length && (s._opts.visible !== false || c._preserve[s._pane])) {
      if (!byPane.has(s._pane)) byPane.set(s._pane, []);
      byPane.get(s._pane).push(s);
    }
  }
  return [...byPane.keys()].sort((a, b) => a - b).map((p) => ({ paneIndex: p, series: byPane.get(p) }));
}

// create/destroy pane bundles to match the grid count
/** @param {any} c @param {number} n */
export function ensurePanes(c, n) {
  while (c._panes.length < n) c._panes.push(c._makePane(c._panes.length));
  while (c._panes.length > n) { const pane = c._panes.pop(); c._destroyPane(pane); }
}
/** @param {any} c @param {number} k grid POSITION @returns {any} the pane render bundle */
export function makePane(c, k) {
  // The pane paints on three stacked sheets (DOM order = paint order):
  //   gridCv  -- the data sheet: gridlines, candles, series, markers, sent-to-back drawings
  //   objCv   -- the objects sheet: price lines + primitives (drawings, alert/order lines)
  //   crossCv -- the crosshair sheet
  // Dragging a line or moving the cursor repaints only its own sheet -- the candles underneath
  // keep their last paint. Input listens on the root; pointer-events:none keeps the overlay
  // sheets invisible to elementFromPoint-style hit checks.
  const gridCv = c._mkcv(), objCv = c._mkcv(), crossCv = c._mkcv(), sbCv = c._mkcv();
  objCv.style.pointerEvents = 'none';
  crossCv.style.pointerEvents = 'none';
  c._comp.$props.grid_id = k;             // Grid/Sidebar capture this.id = grid_id at construction
  const grid = new Grid(gridCv, c._comp);
  const sb = new Sidebar(sbCv, c._comp, c._scaleSide);
  // crosshair needs grid-level layout (id/width/height) -> its OWN tiny comp pointing at grids[k]
  const crossComp = { $props: { layout: c._comp.$props.layout.grids[k], cursor: c._comp.cursor, colors: c._comp.$props.colors } };
  const cross = new Crosshair(/** @type {any} */ (crossComp));
  const pane = { k, gridCv, objCv, crossCv, sbCv, grid, sb, crossComp, cross, objOverlays: [], series: [], ov: null };
  if (k === 0) { buildOverlay(c); pane.ov = c._ov; }   // overlays assigned in _rebuild
  return pane;
}
/** @param {any} c @param {any} pane */
export function destroyPane(c, pane) {
  try { c._root.removeChild(pane.gridCv); c._root.removeChild(pane.objCv); c._root.removeChild(pane.crossCv); c._root.removeChild(pane.sbCv); } catch (_) {}
}

// size + position each pane's grid+sidebar stack, plus the shared botbar (DPR-scaled; draw in CSS px)
/** @param {any} c @param {any} layout */
export function sizeLayers(c, layout) {
  const grids = layout.grids, bb = layout.botbar;
  const left = c._scaleSide === 'left';
  for (const pane of c._panes) {
    const g = grids[pane.k], sb = g.sb || 0;
    const gx = left ? sb : 0;          // grid x (chart shifts right when the scale is on the left)
    const sx = left ? 0 : g.width;     // sidebar x
    c._place(pane.gridCv, g.width, g.height, gx, g.offset);
    c._place(pane.objCv, g.width, g.height, gx, g.offset);     // objects sheet mirrors the grid rect
    c._place(pane.crossCv, g.width, g.height, gx, g.offset);   // cross sheet mirrors the grid rect
    c._place(pane.sbCv, sb, g.height, sx, g.offset);
    pane.sbCv.style.display = c._showPrice ? 'block' : 'none';   // visibility toggle (no space reclaim)
  }
  c._place(c._cv.bb, bb.width, bb.height, left ? (c._sbPx) : 0, bb.offset);
  c._cv.bb.style.display = c._showTime ? 'block' : 'none';
}
/** @param {any} c @param {HTMLCanvasElement} cv  @param {number} w  @param {number} h  @param {number} left  @param {number} top */
export function place(c, cv, w, h, left, top) {
  const dpr = c._dpr;
  cv.style.left = left + 'px'; cv.style.top = top + 'px';
  cv.style.width = Math.round(w) + 'px'; cv.style.height = Math.round(h) + 'px';
  const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
  if (cv.width !== bw) cv.width = bw;
  if (cv.height !== bh) cv.height = bh;
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);    // canvas.width assign resets transform; re-apply
  ctx.font = c._comp.$props.font;
}

/** @param {any} c */
export function resetPanes(c) { for (const p of c._panes) c._destroyPane(p); c._panes = []; }

/** @param {any} c @returns {any[]} */
export function panes(c) {
  // Derive panes from the CURRENT series (main 0 + each distinct offchart _pane), not from
  // c._panes, which only updates on rebuild. The app assigns a new study's pane via
  // panes().length, and restores several studies synchronously before any rebuild — using the
  // stale render bundles made them all land in the same pane (stacked). panes() must
  // reflect series immediately.
  // include ALL panes (even hidden ones) so the app's paneIndex assignment (panes().length) and
  // paneIndexOf stay collision-free. A hidden pane has no grid (excluded from _offcharts), so its
  // getHeight() reads 0 -> it occupies no space and doesn't shift the others.
  const ids = new Set([0]);
  for (const s of c._series) if (s._pane > 0) ids.add(s._pane);
  return [...ids].sort((a, b) => a - b).map((k, pos) => ({
    paneIndex: () => k,
    getHeight: () => { const g = c._gridOf(k); return g ? g.height : 0; },
    getStretchFactor: () => c._stretch[k] || 1,
    setStretchFactor: (/** @type {number} */ f) => { c._stretch[k] = Math.max(0.0001, +f || 1); c._invalidate(); },
    moveTo: (/** @type {number} */ idx) => c._movePane(pos, idx),   // pos = this pane's index in panes() (= _movePane's order)
    setPreserveEmptyPane: (/** @type {boolean} */ on) => { if (on) c._preserve[k] = true; else delete c._preserve[k]; c._invalidate(); },
    preserveEmptyPane: () => !!c._preserve[k],
    priceAxis: () => ({ width: () => c._sbWidth(), configure: (/** @type {any} */ o = {}) => { if (o.mode != null) c._setPaneMode(k, o.mode); }, getConfig: () => ({ mode: c._modeOf(k) }) }),
    getSeries: () => c._series.filter((/** @type {any} */ s) => s._pane === k),
  }));
}

/** @param {any} c @param {number} index pane ID */
export function removePane(c, index) {   // drop every series in that grid; the now-empty grid disappears on rebuild
  c._series = c._series.filter((/** @type {any} */ s) => s._pane !== index);
  delete c._scaleMode[index]; delete c._y[index]; delete c._stretch[index];
  c._invalidate();
}

// reorder panes: move grid `from` to position `to` (reassigns series._pane + per-pane state)
/** @param {any} c @param {number} from  @param {number} to */
export function movePane(c, from, to) {
  // ALL panes (incl. hidden ones) in id order — must match panes()'s position space, since the
  // app passes panes() positions. Using only active offcharts here desynced reorders whenever a
  // pane was hidden.
  const allIds = new Set(); for (const s of c._series) if (s._pane > 0) allIds.add(s._pane);
  const order = [0, ...[...allIds].sort((a, b) => a - b)];
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return;
  // The main candle pane is pinned to the top (it is always rendered as grid 0 via the Candles
  // overlay). Moving it, or moving any pane above it, would give the candle _pane>0 -> it would
  // render BOTH as grid 0 and as a duplicate offchart grid. So sub-panes reorder only below it.
  if (from === 0 || to === 0) return;
  const moved = order.splice(from, 1)[0]; order.splice(to, 0, moved);
  /** @type {Record<string, number>} */
  const remap = {}; order.forEach((oldP, newIdx) => { remap[oldP] = newIdx; });
  /** @param {Record<string, any>} obj @returns {Record<string, any>} */
  const reKey = (obj) => { const o = /** @type {Record<string, any>} */ ({}); for (const k in obj) o[(remap[k] != null ? remap[k] : k)] = obj[k]; return o; };
  for (const s of c._series) if (remap[s._pane] != null) s._pane = remap[s._pane];
  c._scaleMode = /** @type {any} */ (reKey(c._scaleMode)); c._y = /** @type {any} */ (reKey(c._y)); c._stretch = /** @type {any} */ (reKey(c._stretch));
  c._invalidate();
}

/** @param {any} c @returns {any} */
export function addPane(c) { const idx = c._panes.length; return { paneIndex: () => idx }; }
