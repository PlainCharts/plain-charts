// @ts-check
// Layout builder — a demand-driven replacement for fixed layout presets. You start with a
// blank canvas (one cell) and SLICE it however you want: split any cell left/right or
// top/bottom, remove cells, to any depth. Hit Apply and the layout engine builds exactly
// that arrangement. No preset wall — you describe what you want and it's made.
//
// Model: a binary slice tree. leaf = {} ; split = { dir:'v'|'h', ratio, a, b }.
// Any such tree maps to a CSS grid-template-areas matrix (tracks = the union of all split
// lines), which the existing grid+gutter engine already renders — see treeToGridSpec.
import { applyCustomLayout } from '../chart/layout.js';
import { t } from '../i18n/i18n.js';

// ---- slice tree ----
// A node is one mutable object: a bare {} is a leaf; splitLeaf mutates it in place to add
// dir/ratio/a/b, turning it into a split. All fields optional so the same shape covers both.
/**
 * @typedef {Object} SliceNode
 * @property {'v'|'h'} [dir]
 * @property {number} [ratio]
 * @property {SliceNode} [a]
 * @property {SliceNode} [b]
 */

/** @returns {SliceNode} */
const leaf = () => ({});
/** @param {SliceNode} node @param {'v'|'h'} dir */
function splitLeaf(node, dir) { node.dir = dir; node.ratio = 0.5; node.a = leaf(); node.b = leaf(); }
// remove a leaf: collapse its parent split to the surviving sibling
/** @param {SliceNode} node @param {SliceNode} target @returns {SliceNode} */
function removeFrom(node, target) {
  if (!node.dir) return node;
  if (node.a === target) return /** @type {SliceNode} */ (node.b);
  if (node.b === target) return /** @type {SliceNode} */ (node.a);
  node.a = removeFrom(/** @type {SliceNode} */ (node.a), target);
  node.b = removeFrom(/** @type {SliceNode} */ (node.b), target);
  return node;
}
/** @param {SliceNode} node @param {SliceNode[]} [out] @returns {SliceNode[]} */
function leavesOf(node, out = []) { if (node.dir) { leavesOf(/** @type {SliceNode} */ (node.a), out); leavesOf(/** @type {SliceNode} */ (node.b), out); } else out.push(node); return out; }

// ---- tree -> grid spec ({count, cols, rows, areas, cells, colFr, rowFr}) ----
/**
 * @param {SliceNode} node
 * @param {number} x0 @param {number} x1 @param {number} y0 @param {number} y1
 * @param {Array<{x0:number,x1:number,y0:number,y1:number}>} out
 */
function leafRects(node, x0, x1, y0, y1, out) {
  if (!node.dir) { out.push({ x0, x1, y0, y1 }); return; }
  const r = node.ratio == null ? 0.5 : node.ratio;
  if (node.dir === 'v') { const xm = x0 + (x1 - x0) * r; leafRects(/** @type {SliceNode} */ (node.a), x0, xm, y0, y1, out); leafRects(/** @type {SliceNode} */ (node.b), xm, x1, y0, y1, out); }
  else { const ym = y0 + (y1 - y0) * r; leafRects(/** @type {SliceNode} */ (node.a), x0, x1, y0, ym, out); leafRects(/** @type {SliceNode} */ (node.b), x0, x1, ym, y1, out); }
}
/** @param {number[]} vals @returns {number[]} */
function uniqSorted(vals) {
  const s = [...vals].sort((a, b) => a - b);
  /** @type {number[]} */
  const out = [];
  s.forEach((v) => { if (!out.length || Math.abs(v - out[out.length - 1]) > 1e-6) out.push(v); });
  return out;
}
/** @param {number[]} arr @param {number} v @returns {number} */
const idxNear = (arr, v) => { let bi = 0, bd = Infinity; arr.forEach((a, i) => { const d = Math.abs(a - v); if (d < bd) { bd = d; bi = i; } }); return bi; };

/** @param {SliceNode} tree */
export function treeToGridSpec(tree) {
  /** @type {Array<{x0:number,x1:number,y0:number,y1:number}>} */
  const rects = []; leafRects(tree, 0, 1, 0, 1, rects);
  const xs = uniqSorted(rects.flatMap((r) => [r.x0, r.x1]));
  const ys = uniqSorted(rects.flatMap((r) => [r.y0, r.y1]));
  const nc = xs.length - 1, nr = ys.length - 1;
  const names = rects.map((_, i) => 'p' + i);   // traversal order = pane index order
  const m = Array.from({ length: nr }, () => Array(nc).fill(names[0]));
  rects.forEach((r, li) => {
    const c0 = idxNear(xs, r.x0), c1 = idxNear(xs, r.x1), r0 = idxNear(ys, r.y0), r1 = idxNear(ys, r.y1);
    for (let i = r0; i < r1; i++) for (let j = c0; j < c1; j++) m[i][j] = names[li];
  });
  const colFr = []; for (let j = 0; j < nc; j++) colFr.push(+(xs[j + 1] - xs[j]).toFixed(4));
  const rowFr = []; for (let i = 0; i < nr; i++) rowFr.push(+(ys[i + 1] - ys[i]).toFixed(4));
  return {
    type: 'custom', count: rects.length,
    // minmax(0, fr) instead of plain fr: fr tracks default to a min-content floor (the cell's hover
    // tools), which makes the preview overflow the dialog once there are several columns/rows.
    // minmax(0, ...) lets the tracks shrink to fit the canvas no matter how many panes.
    cols: colFr.map((f) => 'minmax(0,' + f + 'fr)').join(' '),
    rows: rowFr.map((f) => 'minmax(0,' + f + 'fr)').join(' '),
    areas: m.map((row) => '"' + row.join(' ') + '"').join(' '),
    cells: names, colFr, rowFr,
  };
}


// ---- builder ----
// No modal window: the builder is an overlay that fills the chart (#panes) area so the grid flows
// freely at real proportions. Just the slice-able cell grid + Apply/Cancel — no title/hint/seeds.
/** @type {HTMLElement | null} */
let overlay = null;
/** @type {HTMLElement | null} */
let canvas = null;
/** @type {SliceNode | null} */
let tree = null;
/** @type {((e: KeyboardEvent) => void) | null} */
let onKey = null;

function build() {
  if (overlay) return;
  overlay = document.createElement('div'); overlay.className = 'lb-overlay';

  canvas = document.createElement('div'); canvas.className = 'lb-canvas';

  const actions = document.createElement('div'); actions.className = 'lb-actions';
  const cancel = document.createElement('button'); cancel.textContent = t('Cancel'); cancel.onclick = close;
  const apply = document.createElement('button'); apply.textContent = t('Apply'); apply.className = 'lb-apply';
  apply.onclick = () => { applyCustomLayout(treeToGridSpec(/** @type {SliceNode} */ (tree))); close(); };
  actions.append(cancel, apply);

  overlay.append(canvas, actions);
  (document.getElementById('panes') || document.body).appendChild(overlay);
}

function render() {
  const spec = treeToGridSpec(/** @type {SliceNode} */ (tree));
  /** @type {HTMLElement} */ (canvas).style.gridTemplateColumns = spec.cols;
  /** @type {HTMLElement} */ (canvas).style.gridTemplateRows = spec.rows;
  /** @type {HTMLElement} */ (canvas).style.gridTemplateAreas = spec.areas;
  /** @type {HTMLElement} */ (canvas).innerHTML = '';
  const leaves = leavesOf(/** @type {SliceNode} */ (tree));
  leaves.forEach((lf, i) => {
    const cell = document.createElement('div'); cell.className = 'lb-cell'; cell.style.gridArea = spec.cells[i];
    const tools = document.createElement('div'); tools.className = 'lb-tools';
    const mk = (/** @type {string} */ txt, /** @type {string} */ title, /** @type {() => void} */ fn) => { const b = document.createElement('button'); b.textContent = txt; b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
    tools.append(
      mk('⬌', t('Split left / right'), () => { splitLeaf(lf, 'v'); render(); }),
      mk('⬍', t('Split top / bottom'), () => { splitLeaf(lf, 'h'); render(); }),
    );
    if (leaves.length > 1) tools.appendChild(mk('✕', t('Remove'), () => { tree = removeFrom(/** @type {SliceNode} */ (tree), lf); render(); }));
    cell.appendChild(tools);
    /** @type {HTMLElement} */ (canvas).appendChild(cell);
  });
}

export function openLayoutBuilder() {
  build();
  tree = leaf();          // start blank — one cell, the user slices it however they want
  render();
  /** @type {HTMLElement} */ (overlay).classList.add('open');
  onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}
function close() {
  if (!overlay) return;
  overlay.classList.remove('open');
  if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
}
