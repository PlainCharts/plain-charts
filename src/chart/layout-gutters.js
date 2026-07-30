// @ts-check
// Pane-grid GUTTERS -- the draggable dividers between panes of a chart layout: pure
// grid geometry (area matrix, contiguous segments, per-track pixel edges) plus the
// gutter elements and their drag-resize. A gutter is created only over the sub-region
// where two DIFFERENT panes meet, so a divider never crosses a pane that spans the
// boundary (the big pane in 3lr/3tb/...). The layout's live state is reached through the accessor context passed
// to createGutters (dependency inversion -- this module never imports layout.js).

/** @typedef {import('./layout.js').LayoutDef} LayoutDef */
/**
 * The accessors the gutter controller reads the layout through:
 * host = the pane-grid element; def = the current layout definition; cols/rows = the
 * live track-fraction arrays (mutated in place on drag); isMaximized = hide gutters
 * while a pane is expanded; applyGrid = re-apply the grid template after a resize;
 * persist = save the workspace when a drag ends.
 * @typedef {Object} GutterCtx
 * @property {() => HTMLElement} host
 * @property {() => LayoutDef} def
 * @property {() => number[]} cols
 * @property {() => number[]} rows
 * @property {() => boolean} isMaximized
 * @property {() => void} applyGrid
 * @property {() => void} persist
 */

const GAP = 2,
  HIT = 6; // grid gap (px) and gutter hit width (px)

// grid-template-areas -> matrix of area letters, e.g. '"a b" "a c"' -> [[a,b],[a,c]]
/** @param {LayoutDef} def @returns {string[][]} */
function areaMatrix(def) {
  return (def.areas.match(/"[^"]*"/g) || []).map((r) => r.replace(/"/g, '').trim().split(/\s+/));
}
// contiguous [start,end] index ranges where pred(k) is true
/** @param {number} n @param {(k: number) => boolean} pred @returns {number[][]} */
function segments(n, pred) {
  /** @type {number[][]} */
  const out = [];
  let s = -1;
  for (let k = 0; k < n; k++) {
    if (pred(k)) {
      if (s < 0) s = k;
    } else if (s >= 0) {
      out.push([s, k - 1]);
      s = -1;
    }
  }
  if (s >= 0) out.push([s, n - 1]);
  return out;
}
// per-track [startPx, endPx] including the gaps between tracks
/** @param {number[]} sizes @param {number} extent @returns {number[][]} */
function trackEdges(sizes, extent) {
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  const content = extent - (sizes.length - 1) * GAP;
  /** @type {number[][]} */
  const edges = [];
  let pos = 0;
  for (let k = 0; k < sizes.length; k++) {
    const w = (sizes[k] / total) * content;
    edges.push([pos, pos + w]);
    pos += w + GAP;
  }
  return edges;
}

/** @param {GutterCtx} ctx */
export function createGutters(ctx) {
  /** @type {HTMLElement[]} */
  let gutters = [];

  function clear() {
    gutters.forEach((g) => g.remove());
    gutters = [];
  }

  function build() {
    clear();
    const m = areaMatrix(ctx.def());
    const nr = m.length,
      nc = (m[0] || []).length;
    for (let j = 0; j < nc - 1; j++)
      // boundary between col j and j+1
      segments(nr, (i) => m[i][j] !== m[i][j + 1]).forEach(([r0, r1]) => gutters.push(makeGutter('col', j, r0, r1)));
    for (let i = 0; i < nr - 1; i++)
      // boundary between row i and i+1
      segments(nc, (j) => m[i][j] !== m[i + 1][j]).forEach(([c0, c1]) => gutters.push(makeGutter('row', i, c0, c1)));
    position();
  }
  /** @param {'col'|'row'} axis @param {number} index @param {number} s0 @param {number} s1 */
  function makeGutter(axis, index, s0, s1) {
    const g = document.createElement('div');
    g.className = 'pane-gutter ' + axis;
    g.dataset.axis = axis;
    g.dataset.index = /** @type {any} */ (index);
    g.dataset.s0 = /** @type {any} */ (s0);
    g.dataset.s1 = /** @type {any} */ (s1); // s0..s1 = cross-axis tracks it spans
    g.addEventListener('pointerdown', (e) => startDrag(e, axis, index));
    ctx.host().appendChild(g);
    return g;
  }
  function position() {
    const host = ctx.host();
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const colEdges = trackEdges(ctx.cols(), rect.width),
      rowEdges = trackEdges(ctx.rows(), rect.height);
    gutters.forEach((g) => {
      if (ctx.isMaximized()) {
        g.style.display = 'none';
        return;
      }
      g.style.display = '';
      const idx = +(/** @type {string} */ (g.dataset.index)),
        s0 = +(/** @type {string} */ (g.dataset.s0)),
        s1 = +(/** @type {string} */ (g.dataset.s1));
      if (g.dataset.axis === 'col') {
        g.style.left = colEdges[idx][1] + GAP / 2 - HIT / 2 + 'px';
        g.style.top = rowEdges[s0][0] + 'px';
        g.style.width = HIT + 'px';
        g.style.height = rowEdges[s1][1] - rowEdges[s0][0] + 'px';
      } else {
        g.style.top = rowEdges[idx][1] + GAP / 2 - HIT / 2 + 'px';
        g.style.left = colEdges[s0][0] + 'px';
        g.style.height = HIT + 'px';
        g.style.width = colEdges[s1][1] - colEdges[s0][0] + 'px';
      }
    });
  }
  /** @param {PointerEvent} e @param {'col'|'row'} axis @param {number} i */
  function startDrag(e, axis, i) {
    e.preventDefault();
    const sizes = axis === 'col' ? ctx.cols() : ctx.rows();
    const rect = ctx.host().getBoundingClientRect();
    const extent = (axis === 'col' ? rect.width : rect.height) - (sizes.length - 1) * GAP;
    const total = sizes.reduce((a, b) => a + b, 0);
    const start = axis === 'col' ? e.clientX : e.clientY;
    const a0 = sizes[i],
      b0 = sizes[i + 1];
    const minFrac = Math.min((a0 + b0) / 2, (80 / extent) * total); // keep each side ~>= 80px
    document.body.style.cursor = axis === 'col' ? 'col-resize' : 'row-resize';
    /** @param {PointerEvent} ev */
    const move = (ev) => {
      let dF = (((axis === 'col' ? ev.clientX : ev.clientY) - start) / extent) * total;
      let na = a0 + dF,
        nb = b0 - dF;
      if (na < minFrac) {
        na = minFrac;
        nb = a0 + b0 - na;
      }
      if (nb < minFrac) {
        nb = minFrac;
        na = a0 + b0 - nb;
      }
      sizes[i] = na;
      sizes[i + 1] = nb;
      ctx.applyGrid();
      position();
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      ctx.persist();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  return { build, position, clear };
}
