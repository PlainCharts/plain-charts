// @ts-check
// Object Manager actions -- the selection/folder mutations and the inline rename widget,
// shared by the panel rows, the layer tabs and the context menus. Function bodies moved
// verbatim from objects.js; the shared panel state now lives in objects-state.js.
import { findNode, removeNode } from './objects-tree-ops.js';
import { state, eng, engineOf, render, closeMenu } from './objects-state.js';

/** @typedef {any} Engine */
/** @typedef {import('./objects-tree-ops.js').TreeNode} TreeNode */

/**
 * @param {string} tag
 * @param {(string|null)=} cls
 * @param {(string|null)=} txt
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/** @param {string} id */
export function startRename(id) {
  closeMenu();
  state.renamingId = id;
  render();
}

// shared inline rename input: commit on Enter/blur, Escape cancels. Callers append the
// returned input and hand it to state.pendingFocus for the after-render focus.
/** @param {string} id @param {string} value @param {(v: string) => void} commitFn */
export function renameInput(id, value, commitFn) {
  const inp = /** @type {HTMLInputElement} */ (el('input', 'obj-name-in'));
  inp.value = value;
  const commit = () => {
    const v = inp.value.trim();
    state.renamingId = null;
    commitFn(v);
  };
  inp.onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Escape') {
      state.renamingId = null;
      render();
    }
  };
  inp.onblur = commit;
  inp.onclick = (ev) => ev.stopPropagation();
  return inp;
}

export function removeSelection() {
  // group the selection by owning engine, then remove folders (dissolving → drawings
  // inside also removed) and drawings on each.
  /** @type {Map<Engine, string[]>} */
  const byEng = new Map();
  [...state.selectedIds].forEach((id) => {
    const e = engineOf(id);
    if (!e) return;
    if (!byEng.has(e)) byEng.set(e, []);
    /** @type {string[]} */ (byEng.get(e)).push(id);
  });
  byEng.forEach((ids, e) => {
    ids.forEach((id) => {
      const r = findNode(e.getTree(), id);
      if (r && r.node.type === 'folder') removeFolderDeep(e, r.node);
      else e.removeDrawing(id);
    });
    e.saveTree();
  });
  state.selectedIds.clear();
}
/** @param {Engine} e @param {TreeNode} folder */
export function removeFolderDeep(e, folder) {
  [...(folder.children || [])].forEach((n) => {
    if (n.type === 'folder') removeFolderDeep(e, n);
    else e.removeDrawing(n.id);
  }); // copy: removeDrawing may prune children
  removeNode(e.getTree(), folder.id);
}

/** @param {string[]} ids @param {Engine=} e */
export function createFolder(ids, e) {
  ids = ids || [];
  e = e || engineOf(ids[0]) || eng();
  if (!e) return;
  const tree = e.getTree();
  const own = ids.filter((id) => findNode(tree, id)); // only nodes that belong to this engine's tree
  const nodes = own.map((id) => removeNode(tree, id)).filter(Boolean); // empty selection -> empty folder
  const fid = 'f' + Date.now().toString(36) + (state.seq++).toString(36);
  tree.unshift({ type: 'folder', id: fid, name: 'New folder', expanded: true, children: nodes });
  state.selectedIds = new Set([fid]);
  state.anchorId = fid;
  e.saveTree();
  startRename(fid);
}
/** @param {string} id @param {Engine=} e */
export function deleteFolder(id, e) {
  // remove the folder, move its contents up in place
  e = e || engineOf(id);
  const tree = e.getTree();
  const r = findNode(tree, id);
  if (!r || r.node.type !== 'folder') return;
  r.list.splice(r.index, 1, ...(r.node.children || []));
  e.saveTree();
}
