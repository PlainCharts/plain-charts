// @ts-check
// Pure operations on an Object-tree folder structure (arrays of TreeNode). No module state,
// no DOM -- given a tree and an id they find/remove/test nodes. Extracted verbatim from
// objects.js so the tree logic can be reasoned about (and reused) on its own.

// A folder tree node: either a folder (with children) or a drawing reference (by id).
/** @typedef {{ type: string, id: string, name?: string, expanded?: boolean, hidden?: boolean, locked?: boolean, children?: TreeNode[] }} TreeNode */

/**
 * @param {TreeNode[]} list
 * @param {string} id
 * @returns {{ node: TreeNode, list: TreeNode[], index: number }|null}
 */
export function findNode(list, id) {
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (n.id === id) return { node: n, list, index: i };
    if (n.type === 'folder') {
      const r = findNode(n.children || [], id);
      if (r) return r;
    }
  }
  return null;
}
/** @param {TreeNode[]} tree @param {string} id */
export function removeNode(tree, id) {
  const r = findNode(tree, id);
  if (!r) return null;
  r.list.splice(r.index, 1);
  return r.node;
}
/** @param {TreeNode} folder @param {string} id */
export function inSubtree(folder, id) {
  return !!findNode(folder.children || [], id);
}
// all drawing ids inside a folder (recursively)
/** @param {TreeNode} node @param {string[]=} out @returns {string[]} */
export function folderDrawingIds(node, out = []) {
  (node.children || []).forEach((n) => {
    if (n.type === 'folder') folderDrawingIds(n, out);
    else out.push(n.id);
  });
  return out;
}
