// Shared store for synced drawings — the single source of truth so a drawing can
// render on every pane showing its symbol (no per-pane copies that drift). Keyed by
// the raw symbol string (pane.symbol).
//   - layout scope  : shared within the current tab/layout; persisted in the tab
//                     workspace (tabs.json) via snapshotLayout()/loadLayout().
//   - global scope  : shared across all tabs; persisted to settings/synced-drawings.json.
// Every mutation emits bus 'sync:changed' so all live engines re-render the same objects.
// @ts-check
import { bus } from '../../bus.js';
import { createStore } from '../../store.js';

// A drawing object (id-keyed recipe with a sync scope); its full shape is defined by the
// engine — here we only touch id + sync, so keep it open.
/** @typedef {{ id: string, sync?: string, [k: string]: any }} Drawing */
// An organization tree node (folder or a drawing-ref leaf).
/** @typedef {{ id: string, type?: string, hidden?: boolean, locked?: boolean, children?: TreeNode[] }} TreeNode */
// One layer: a named container holding its own folder/drawing tree (organization only).
/** @typedef {{ id: string, name: string, hidden: boolean, locked: boolean, nodes: TreeNode[] }} Layer */
// A symbol's layer set: the layers plus which one is active (new drawings land there).
/** @typedef {{ list: Layer[], active: string }} LayerSet */

/** @type {Map<string, Drawing[]>} */
const layout = new Map();   // symbol -> Drawing[]   (current tab)
/** @type {Map<string, Drawing[]>} */
const global = new Map();   // symbol -> Drawing[]   (all tabs)
/** @type {Map<string, LayerSet>} */
const layers = new Map();   // symbol -> { list:[{id,name,hidden,locked,nodes}], active }  (per symbol)
const globalStore = createStore('/api/synced-drawings', {});   // { symbol: Drawing[] }

/** @param {string} scope @returns {Map<string, Drawing[]>} */
const bucket = (scope) => (scope === 'global' ? global : layout);
const emit = () => bus.emit('sync:changed');

// drawings (any scope) that belong to a symbol — rendered alongside a pane's local ones
/** @param {string} symbol @returns {Drawing[]} */
export function forSymbol(symbol) {
  return [...(layout.get(symbol) || []), ...(global.get(symbol) || [])];
}
// just one scope's drawings for a symbol ('layout' | 'global') — for scoped removal
/** @param {string} symbol @param {string} scope @returns {Drawing[]} */
export function forSymbolScope(symbol, scope) {
  return ((scope === 'global' ? global : layout).get(symbol) || []).slice();
}

/** @param {string} id @returns {{ scope: string, symbol: string, d: Drawing }|null} */
export function find(id) {
  for (const scope of ['layout', 'global']) {
    for (const [symbol, arr] of bucket(scope)) {
      const d = arr.find((x) => x.id === id);
      if (d) return { scope, symbol, d };
    }
  }
  return null;
}

/** @param {string} scope @param {string} symbol @param {Drawing} d */
export function add(scope, symbol, d) {
  d.sync = scope;
  const m = bucket(scope);
  if (!m.has(symbol)) m.set(symbol, []);
  (/** @type {Drawing[]} */ (m.get(symbol))).push(d);
  persist(scope, symbol);
  emit();
}

/** @param {string} id @returns {{ scope: string, symbol: string, d: Drawing }|null} */
function detach(id) {
  const f = find(id);
  if (!f) return null;
  bucket(f.scope).set(f.symbol, (bucket(f.scope).get(f.symbol) || []).filter((x) => x.id !== id));
  return f;
}

/** @param {string} id */
export function remove(id) {
  const f = detach(id);
  if (f) { persist(f.scope, f.symbol); emit(); }
  return f;
}

// move a drawing to a new scope (or pull it out for the engine to keep locally)
/** @param {string} id @param {string} newScope @param {string} symbol @returns {Drawing|null} */
export function move(id, newScope, symbol) {
  const f = detach(id);
  if (!f) return null;
  if (f.scope !== newScope) persist(f.scope, f.symbol);   // persist the old bucket's removal
  if (newScope === 'none') { f.d.sync = 'none'; emit(); return f.d; }
  add(newScope, symbol, f.d);
  return f.d;
}

// ---- persistence ----
/** @param {string} scope @param {string} symbol */
function persist(scope, symbol) {
  if (scope === 'global') globalStore.set(symbol, global.get(symbol) || []);
  else bus.emit('workspace:changed');   // tabs.js captures snapshotLayout()
}

// flush the global file for a symbol after an in-place edit (move/restyle) of a
// global drawing — structural changes (add/remove/move) already persist themselves.
/** @param {string} symbol */
export function flushGlobal(symbol) {
  if (global.has(symbol)) globalStore.set(symbol, global.get(symbol) || []);
}

export async function loadGlobal() {
  /** @type {Record<string, Drawing[]>} */
  const data = await globalStore.load();
  global.clear();
  Object.keys(data || {}).forEach((sym) => { if (Array.isArray(data[sym])) global.set(sym, data[sym]); });
  emit();
}

// ---- layers + folder tree, shared per symbol (organization only) ----
// A symbol's drawings are split into LAYERS ({ id, name, hidden, locked, nodes }); each layer
// holds the folder/drawing tree (organization only -- never z-order). One layer is ACTIVE; new
// drawings land there. Shared per symbol like everything here, so organizing on one chart shows
// on all same-symbol charts. Persisted with the tab workspace; references drawings by id.
let lseq = 0;
/** @param {string} [name] @returns {Layer} */
const newLayer = (name) => ({ id: 'ly' + Date.now().toString(36) + (lseq++).toString(36), name: name || 'Layer 1', hidden: false, locked: false, nodes: [] });

/** @param {string} symbol @returns {LayerSet} */
export function getLayers(symbol) {
  let L = layers.get(symbol);
  if (!L) { const first = newLayer('Layer 1'); L = { list: [first], active: first.id }; layers.set(symbol, L); }
  if (!L.list.length) { const first = newLayer('Layer 1'); L.list.push(first); L.active = first.id; }
  if (!L.list.some((x) => x.id === L.active)) L.active = L.list[0].id;
  return L;
}
/** @param {string} symbol @returns {Layer} */
export function activeLayer(symbol) { const L = getLayers(symbol); return L.list.find((x) => x.id === L.active) || L.list[0]; }
/** @param {string} symbol @param {string} id */
export function setActiveLayer(symbol, id) { const L = getLayers(symbol); if (L.list.some((x) => x.id === id)) { L.active = id; bus.emit('workspace:changed'); emit(); } }
/** @param {string} symbol @param {string} [name] @returns {Layer} */
export function addLayer(symbol, name) {
  const L = getLayers(symbol);
  const ly = newLayer(name || ('Layer ' + (L.list.length + 1)));
  L.list.push(ly); L.active = ly.id;
  bus.emit('workspace:changed'); emit();
  return ly;
}
// removes only the layer CONTAINER -- the caller removes the drawings inside first (engine.removeLayer).
/** @param {string} symbol @param {string} id @returns {boolean} */
export function removeLayer(symbol, id) {
  const L = getLayers(symbol);
  if (L.list.length <= 1) return false;   // always keep at least one layer
  L.list = L.list.filter((x) => x.id !== id);
  if (!L.list.some((x) => x.id === L.active)) L.active = L.list[0].id;
  bus.emit('workspace:changed'); emit();
  return true;
}
/** @param {string} symbol @param {string} id @param {string} name */
export function renameLayer(symbol, id, name) {
  const ly = getLayers(symbol).list.find((x) => x.id === id);
  if (ly && name) { ly.name = name; bus.emit('workspace:changed'); emit(); }
}
/** @param {string} symbol @param {string} id @param {string} flag @param {boolean} val */
export function setLayerFlag(symbol, id, flag, val) {
  if (flag !== 'hidden' && flag !== 'locked') return;
  const ly = getLayers(symbol).list.find((x) => x.id === id);
  if (ly) { ly[flag] = !!val; bus.emit('workspace:changed'); emit(); }
}

// getTree returns the ACTIVE layer's nodes -- so every existing folder/tree operation keeps working
// on "the tree" unchanged; it is simply the active layer's tree.
/** @param {string} symbol @returns {TreeNode[]} */
export function getTree(symbol) { return activeLayer(symbol).nodes; }
/** @param {string} symbol @param {TreeNode[]} [tree] */
export function setTree(symbol, tree) {
  const al = activeLayer(symbol);
  if (tree && tree !== al.nodes) { al.nodes.length = 0; al.nodes.push(...(tree || [])); }
  bus.emit('workspace:changed');   // tabs.js captures snapshotLayers()
  emit();                          // re-render every same-symbol pane
}
/** @returns {Record<string, LayerSet>} */
export function snapshotLayers() {
  /** @type {Record<string, LayerSet>} */
  const obj = {};
  for (const [sym, L] of layers) {
    if (L.list.length > 1 || L.list.some((ly) => ly.nodes.length)) obj[sym] = { list: L.list, active: L.active };
  }
  return obj;
}
// obj is untrusted persisted JSON (from the tab workspace) — sanitized here, so typed loose.
/** @param {any} [obj] */
export function loadLayers(obj) {
  layers.clear();
  obj = obj || {};
  Object.keys(obj).forEach((sym) => {
    const L = obj[sym];
    if (!L || !Array.isArray(L.list) || !L.list.length) return;
    L.list.forEach((/** @type {Layer} */ ly) => { ly.hidden = !!ly.hidden; ly.locked = !!ly.locked; if (!Array.isArray(ly.nodes)) ly.nodes = []; });
    layers.set(sym, { list: L.list, active: (L.active && L.list.some((/** @type {Layer} */ x) => x.id === L.active)) ? L.active : L.list[0].id });
  });
}
// replace ONE symbol's whole layer set (used by the drawing-set file load -- the PSD-style
// "load the entire stack"). Sanitizes each layer like loadLayers; leaves other symbols alone.
/** @param {string} symbol @param {LayerSet} L */
export function setLayers(symbol, L) {
  if (!L || !Array.isArray(L.list) || !L.list.length) return;
  L.list.forEach((ly) => { ly.hidden = !!ly.hidden; ly.locked = !!ly.locked; if (!Array.isArray(ly.nodes)) ly.nodes = []; });
  const active = (L.active && L.list.some((x) => x.id === L.active)) ? L.active : L.list[0].id;
  layers.set(symbol, { list: L.list, active });
  bus.emit('workspace:changed');   // tabs.js captures snapshotLayers()
  emit();                          // re-render every same-symbol pane
}

// ---- layout scope <-> tab workspace ----
/** @returns {Record<string, Drawing[]>} */
export function snapshotLayout() {
  /** @type {Record<string, Drawing[]>} */
  const obj = {};
  for (const [sym, arr] of layout) if (arr.length) obj[sym] = arr.map((d) => ({ ...d }));
  return obj;
}
// obj is untrusted persisted JSON (from the tab workspace) — sanitized here, so typed loose.
/** @param {any} [obj] */
export function loadLayout(obj) {
  layout.clear();
  obj = obj || {};
  Object.keys(obj).forEach((sym) => { if (Array.isArray(obj[sym])) layout.set(sym, obj[sym]); });
  emit();
}
