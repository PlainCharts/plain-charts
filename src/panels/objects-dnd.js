// @ts-check
// Object Manager drag/drop -- the row drag handlers and the two drop resolvers: doDrop
// moves the dragged tree-selection within a surface's folder tree (into / before / after
// a node, or to the root), dropOntoLayer moves it into another layer's tree (dropped on
// a layer tab). The shared drag/selection
// state lives in objects-state.js.
import { findNode, removeNode, inSubtree } from './objects-tree-ops.js';
import { state, eng } from './objects-state.js';

/** @typedef {any} Engine */
/** @typedef {import('./objects-tree-ops.js').TreeNode} TreeNode */

export function clearDrop() { if (state.listEl) state.listEl.querySelectorAll('.drop-into,.drop-before,.drop-after').forEach((r) => r.classList.remove('drop-into', 'drop-before', 'drop-after')); }

/** @param {Engine} e @param {any} row @param {string} id @param {boolean} isFolder */
export function rowDnd(e, row, id, isFolder) {
  row.draggable = true;
  row.dataset.id = id;
  row._eng = e;
  row.ondragstart = (/** @type {DragEvent} */ ev) => { state.dragId = id; state.dragEngine = e; /** @type {DataTransfer} */ (ev.dataTransfer).effectAllowed = 'move'; try { /** @type {DataTransfer} */ (ev.dataTransfer).setData('text/plain', id); } catch (_) {} row.classList.add('drag'); };
  row.ondragend = () => { row.classList.remove('drag'); clearDrop(); state.dragId = null; state.dragEngine = null; state.dropTarget = null; };
  row.ondragover = (/** @type {DragEvent} */ ev) => {
    if (!state.dragId || state.dragId === id) return;
    if (state.dragEngine && state.dragEngine !== row._eng) return;   // within-surface only: objects can't move between panes
    ev.preventDefault(); clearDrop();
    const r = row.getBoundingClientRect(), y = ev.clientY - r.top, h = r.height;
    if (isFolder && y > h * 0.25 && y < h * 0.75) { state.dropTarget = { id, mode: 'into' }; row.classList.add('drop-into'); }
    else if (y < h / 2) { state.dropTarget = { id, mode: 'before' }; row.classList.add('drop-before'); }
    else { state.dropTarget = { id, mode: 'after' }; row.classList.add('drop-after'); }
  };
  row.ondrop = (/** @type {DragEvent} */ ev) => { ev.preventDefault(); ev.stopPropagation(); doDrop(); };
}

export function doDrop() {
  const e = state.dragEngine || eng(); if (!e || !state.dragId) { clearDrop(); return; }
  const tree = e.getTree();
  const t = state.dropTarget; clearDrop();
  const primary = state.dragId; state.dragId = null; state.dragEngine = null; state.dropTarget = null;

  // move the WHOLE tree-selection if the dragged row is part of it; otherwise just the dragged node.
  let ids = (state.selectedIds.has(primary) && state.selectedIds.size > 1) ? [...state.selectedIds] : [primary];
  ids = ids.filter((id) => findNode(tree, id));   // only nodes in THIS engine's tree
  // drop any node whose ancestor folder is also moving (that folder carries its children)
  ids = ids.filter((id) => !ids.some((o) => { if (o === id) return false; const r = findNode(tree, o); return r && r.node.type === 'folder' && inSubtree(r.node, id); }));
  ids.sort((a, b) => state.flatOrder.indexOf(a) - state.flatOrder.indexOf(b));   // keep visual order so they land in order
  if (!ids.length) return;
  const moving = new Set(ids);
  // can't drop onto a moved node, and can't drop a moved folder into its own subtree
  if (t && moving.has(t.id)) return;
  if (t && ids.some((id) => { const n = (findNode(tree, id) || {}).node; return n && n.type === 'folder' && inSubtree(n, t.id); })) return;

  const nodes = /** @type {TreeNode[]} */ (ids.map((id) => removeNode(tree, id)).filter(Boolean));   // pull them out, in order
  if (!nodes.length) return;
  if (!t) { tree.push(...nodes); }                                       // empty area → root end
  else if (t.mode === 'into') {
    const f = (findNode(tree, t.id) || {}).node;
    if (!f || f.type !== 'folder') tree.push(...nodes);                  // fallback → root end
    else { (f.children || (f.children = [])).unshift(...nodes); f.expanded = true; }
  } else {
    const loc = findNode(tree, t.id);
    if (!loc) tree.push(...nodes); else loc.list.splice(t.mode === 'after' ? loc.index + 1 : loc.index, 0, ...nodes);
  }
  e.saveTree();
}

// move the current drag-selection onto another LAYER (dropped on its tab). The rows always come from
// the ACTIVE layer's tree (only that one is rendered), so the source is getTree(); we pull the nodes
// out and append them to the destination layer's tree. Organization only -- the drawings themselves are
// untouched (a drawing lives in exactly one layer's tree). Whole folders move with their contents.
/** @param {Engine} e @param {string} targetLayerId */
export function dropOntoLayer(e, targetLayerId) {
  const L = e.layers(); if (!L || !state.dragId) return;
  const target = L.list.find((/** @type {any} */ x) => x.id === targetLayerId);
  const src = e.getTree();                       // active layer's tree = the source
  const primary = state.dragId; state.dragId = null; state.dragEngine = null; state.dropTarget = null;
  if (!target || targetLayerId === L.active) return;

  // same node-collection logic as doDrop: move the whole tree-selection if the dragged row is part of
  // it, else just the dragged node; drop children whose folder is also moving; keep visual order.
  let ids = (state.selectedIds.has(primary) && state.selectedIds.size > 1) ? [...state.selectedIds] : [primary];
  ids = ids.filter((id) => findNode(src, id));
  ids = ids.filter((id) => !ids.some((o) => { if (o === id) return false; const r = findNode(src, o); return r && r.node.type === 'folder' && inSubtree(r.node, id); }));
  ids.sort((a, b) => state.flatOrder.indexOf(a) - state.flatOrder.indexOf(b));
  if (!ids.length) return;
  const nodes = ids.map((id) => removeNode(src, id)).filter(Boolean);
  if (!nodes.length) return;
  target.nodes.push(...nodes);                   // append to the destination layer, in order
  state.selectedIds.clear();
  e.saveTree();                                  // persists both layers (workspace:changed) + re-renders
}
