// @ts-check
// Save / Load the whole drawing set of the active chart (Object-tree toolbar buttons).
// Extracted verbatim from objects.js. Save serializes every drawing on the active chart
// (local + synced) plus the WHOLE layer stack -- every layer, its folder tree, and its
// hidden/locked flags (PSD-style: you save the entire set, not just the active layer). Load
// is a REPLACE: it clears the chart's drawings, recreates the set from the file, and rebuilds
// all layers (ids are remapped so folder structure and layer membership are preserved).
// Indicators are not included. No-layer surfaces (study board / sub-pane) use a single `tree`.
// The Object tree's re-render is passed in as a callback so this module stays free of panel state.
import { getActivePane } from '../chart/layout.js';
import { getTool } from '../tools/registry.js';

/** @typedef {any} Engine */
/** @typedef {any} Drawing */

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
/** @returns {Engine} */
const eng = () => {
  const p = getActivePane();
  return p && p.drawings;
};

const DRAW_FIELDS = [
  'tool',
  'points',
  'style',
  'textStyle',
  'text',
  'name',
  'hidden',
  'locked',
  'z',
  'visibility',
  'sync',
];

export async function saveDrawingSet() {
  const e = eng();
  const p = getActivePane();
  if (!e || !p) return;
  const drawings = e.objects().map((/** @type {Drawing} */ d) => {
    /** @type {any} */
    const o = { id: d.id };
    DRAW_FIELDS.forEach((k) => {
      if (d[k] !== undefined) o[k] = d[k];
    });
    return o;
  });
  const snap = e.layersSnapshot && e.layersSnapshot();
  /** @type {any} */
  const data = { type: 'light-charts/drawings', symbol: p.symbol, savedAt: new Date().toISOString(), drawings };
  if (snap)
    data.layers = {
      active: snap.active,
      list: snap.list.map((/** @type {any} */ ly) => ({
        id: ly.id,
        name: ly.name,
        hidden: !!ly.hidden,
        locked: !!ly.locked,
        nodes: ly.nodes,
      })),
    };
  else data.tree = e.getTree(); // no-layer surface (study board / sub-pane): single tree
  const json = JSON.stringify(data, null, 2);
  const suggested = (p.symbol || 'chart') + '-drawings.json';

  // Preferred: a real "Save As" dialog (user names the file + picks the folder).
  if (/** @type {any} */ (window).showSaveFilePicker) {
    let handle;
    try {
      handle = await /** @type {any} */ (window).showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: 'Drawings set', accept: { 'application/json': ['.json'] } }],
      });
    } catch (err) {
      if (err && /** @type {any} */ (err).name === 'AbortError') return; // user cancelled the dialog
      handle = null; // API unavailable/blocked → fall back
    }
    if (handle) {
      try {
        const w = await handle.createWritable();
        await w.write(json);
        await w.close();
        return;
      } catch (_) {}
    }
  }
  // Fallback (older browsers): trigger a download with a suggested name.
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = /** @type {HTMLAnchorElement} */ (el('a'));
  a.href = url;
  a.download = suggested;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {() => void} render   re-render the Object tree after a load */
export function loadDrawingSet(render) {
  const e = eng();
  if (!e) return;
  const inp = /** @type {HTMLInputElement} */ (el('input'));
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(/** @type {string} */ (reader.result));
      } catch (_) {
        alert('Could not read that file — it is not valid JSON.');
        return;
      }
      if (!data || !Array.isArray(data.drawings)) {
        alert('That file is not a drawings set.');
        return;
      }
      const layerNote =
        data.layers && Array.isArray(data.layers.list) && data.layers.list.length > 1 ? ' and layers' : '';
      if (
        !confirm(
          'Load ' + data.drawings.length + ' drawing(s)? This replaces ALL drawings' + layerNote + ' on this chart.',
        )
      )
        return;
      applyDrawingSet(eng(), data, render);
    };
    reader.readAsText(file);
  };
  inp.click();
}

/** @param {Engine} e @param {any} data @param {() => void} render */
function applyDrawingSet(e, data, render) {
  if (!e) return;
  e.clear(); // wipe the chart's current drawings (local + synced for this symbol)
  /** @type {Record<string, string>} */
  const idMap = {};
  (data.drawings || []).forEach((/** @type {any} */ d) => {
    if (!d || !d.tool || !getTool(d.tool)) return;
    /** @type {any} */
    const params = {};
    DRAW_FIELDS.forEach((k) => {
      if (k !== 'tool' && d[k] !== undefined) params[k] = d[k];
    });
    const nd = e.add(d.tool, params);
    if (nd && d.id) idMap[d.id] = nd.id; // old id -> new id, to rewrite tree refs
  });
  /** @param {any[]} nodes @returns {any[]} */
  const remap = (nodes) =>
    (nodes || [])
      .map((/** @type {any} */ n) => {
        if (n.type === 'folder')
          return {
            type: 'folder',
            id: n.id,
            name: n.name,
            expanded: n.expanded !== false,
            hidden: !!n.hidden,
            locked: !!n.locked,
            children: remap(n.children),
          };
        const nid = idMap[n.id];
        return nid ? { type: 'drawing', id: nid } : null;
      })
      .filter(Boolean);

  const snap = e.layersSnapshot && e.layersSnapshot();
  if (data.layers && snap) {
    // layered surface: rebuild the WHOLE stack, remapping each layer's node ids
    const list = data.layers.list.map((/** @type {any} */ ly) => ({
      id: ly.id,
      name: ly.name,
      hidden: !!ly.hidden,
      locked: !!ly.locked,
      nodes: remap(ly.nodes),
    }));
    e.loadLayerSet({ active: data.layers.active, list });
  } else {
    // no-layer surface (study board / sub-pane): a single tree. A layered file dropped here
    // flattens every layer into that one tree.
    const srcTree =
      data.tree ||
      data.layers.list.reduce((/** @type {any} */ a, /** @type {any} */ ly) => a.concat(ly.nodes || []), []);
    const tree = e.getTree();
    tree.length = 0;
    remap(srcTree).forEach((/** @type {any} */ n) => tree.push(n));
    e.saveTree();
  }
  render();
}
