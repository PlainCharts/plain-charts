// @ts-check
// Per-pane drawing engine: the store for this pane's own drawings, plus the wiring
// for the render primitive and the interaction overlay. It also RENDERS synced
// drawings owned by the shared sync-store (src/tools/engine/sync-store.js) for the
// pane's symbol — those are the same object on every pane, so editing one updates
// all. Local (sync:'none') drawings persist to pane.settings.drawings; synced ones
// persist in the store (tab workspace / global file).
import { getTool } from '../registry.js';
import { bus } from '../../bus.js';
import { toScreen, snapXToBar, timeToX } from './geometry.js';
import { createDrawingPrimitive } from './primitive.js';
import { hitTestFromMarks } from './generic-hit.js';
import { Interaction } from './interaction.js';
import * as syncStore from './sync-store.js';
import { drawingsHidden } from '../toolbar-store.js';
import { visibleOnTf } from './visibility.js';

/** @typedef {import('./geometry.js').DataPoint} DataPoint */
/** @typedef {import('./geometry.js').ScreenPoint} ScreenPoint */
// Opaque vendored-engine handles at this boundary.
/** @typedef {any} Pane */
/** @typedef {any} Series */
// A registered tool: the open ToolDef plus the duck-typed hooks this engine drives on it
// (draw/marks tools, click-tools' render/remove, snapToBar, hitTest, text hooks). getTool()
// returns the narrow ToolDef; call sites read this richer view.
/**
 * @typedef {import('../registry.js').ToolDef & {
 *   kind?: string, snapToBar?: boolean, spanPanes?: boolean, settings?: any,
 *   render?: (d: Drawing, ctx: any) => any, remove?: (h: any, ctx: any) => void,
 *   marks?: (...a: any[]) => any, hitTest?: (...a: any[]) => any, handles?: (...a: any[]) => any,
 *   textEnabled?: (d: Drawing) => boolean, drawText?: (...a: any[]) => any, textGeom?: (...a: any[]) => any
 * }} Tool
 */
/** @typedef {any} LevelHandle */   // a native price-line handle (addLevel/removeLevel)

// A drawing object: the core recipe. Anchors in data space; style/text/visibility optional.
/**
 * @typedef {Object} Drawing
 * @property {string} id
 * @property {string} tool             the tool id (registry key)
 * @property {DataPoint[]=} points     data-space anchors
 * @property {'none'|'layout'|'global'=} sync   scope: local pane, per-tab, or all tabs
 * @property {number=} z               stacking order (split by the candle plane at 0)
 * @property {boolean=} hidden         eye toggle (own flag)
 * @property {boolean=} locked         lock toggle (own flag)
 * @property {string=} name            object-manager label
 * @property {string=} text            editable text label
 * @property {any=} style              shape style (color/width/lineStyle/priceLabels/…)
 * @property {any=} textStyle          text style (size/bold/align/…)
 * @property {any=} visibility         per-timeframe visibility (see visibility.js)
 */

// Where a drawing was reordered to in the stack.
/** @typedef {'front'|'back'|'forward'|'backward'} ReorderWhere */
// Optional per-engine persistence for isolated sub-panes.
/**
 * @typedef {Object} EngineStore
 * @property {() => Drawing[]} load
 * @property {(list: Drawing[]) => void} save
 * @property {(() => any[])=} loadTree
 * @property {((tree: any[]) => void)=} saveTree
 */

let seq = 0;
const TOL = 6;   // hit-test tolerance (px)

export class DrawingEngine {
  /** @param {Pane} pane @param {Series} [series] @param {{ isolated?: boolean, store?: EngineStore|null, noInteraction?: boolean }} [opts] */
  constructor(pane, series, opts = {}) {
    this.pane = pane;
    this.series = series || pane.series;   // the surface's price scale (main series by default;
                                           // a sub-pane's series when this engine draws on a sub-pane)
    // isolated: a sub-pane surface — its own local drawings only (no shared/synced
    // store). An optional `store` { load(): Drawing[], save(Drawing[]) } persists them
    // (e.g. into pane.settings.compare.drawings); without it, they're transient.
    this.isolated = !!opts.isolated;
    /** @type {EngineStore|null} */
    this.store = opts.store || null;
    /** @type {Drawing[]} */
    this.list = [];                 // this pane's own (sync:'none') drawings
    /** @type {Map<string, LevelHandle>} */
    this.priceLines = new Map();    // id -> price-line handle (click tools)
    /** @type {Map<string, LevelHandle[]>} */
    this.priceLabelLines = new Map(); // id -> [price-line handles] for style.priceLabels
    /** @type {string|null} */
    this.selectedId = null;          // primary (last-clicked) selection
    /** @type {Set<string>} */
    this.selection = new Set();      // full multi-selection (Ctrl+click), includes the primary
    /** @type {Drawing|null} */
    this.draft = null;              // in-progress canvas shape (ghost)
    /** @type {ScreenPoint|null} */
    this.sliceGuide = null;         // {x,y} circle gliding along a line while slicing
    /** @type {(() => void)|null} */
    this._requestUpdate = null;
    this._dead = false;
    // late-bound / interaction-owned members (declared for the checker)
    /** @type {boolean=} */
    this.suppressed;
    /** @type {Interaction=} */
    this.interaction;
    /** @type {number=} */
    this._plotW;
    /** @type {number=} */
    this._plotH;
    /** @type {any[]=} */
    this._tree;
    /** @type {string|null=} */
    this._editingId;
    /** @type {any} */
    this._textBox;
    /** @type {{ x0: number, y0: number, x1: number, y1: number }=} */
    this.marqueeRect;
    /** @type {(() => void)|null} */
    this._off;

    this.primitive = createDrawingPrimitive(this);
    try { this.series.addLayer(this.primitive); } catch (_) {}
    if (!opts.noInteraction) this.interaction = new Interaction(pane, /** @type {any} */ (this));   // sub-panes route through the main interaction
    // re-render when any synced drawing changes (added/moved/removed on any pane)
    this._off = bus.on('sync:changed', () => this.requestUpdate());
  }

  // synced drawings for this pane's symbol (shared objects), and the merged view
  /** @returns {Drawing[]} */
  _synced() { return this.isolated ? [] : /** @type {Drawing[]} */ (syncStore.forSymbol(this.pane.symbol)); }
  /** @returns {Drawing[]} */
  allItems() { return this.list.concat(this._synced()); }

  /** @param {(() => void)|null} fn */
  _setRequestUpdate(fn) { this._requestUpdate = fn; }
  requestUpdate() { if (this._dead) return; this.syncPriceLabels(); if (this._requestUpdate) this._requestUpdate(); }

  // draw price-axis labels for any drawing with style.priceLabels, using native
  // price lines (label only) — they live inside the price scale at axis precision.
  syncPriceLabels() {
    if (drawingsHidden()) { for (const id of [...this.priceLabelLines.keys()]) this._clearPriceLabels(id); return; }
    const tf = this.pane.tf();
    const items = this.allItems();
    const ids = new Set(items.map((d) => d.id));
    // prune labels for drawings no longer here (removed, or symbol changed)
    for (const id of [...this.priceLabelLines.keys()]) if (!ids.has(id)) this._clearPriceLabels(id);
    items.forEach((d) => {
      const tool = /** @type {Tool|undefined} */ (getTool(d.tool));
      const want = tool && tool.kind === 'draw' && !d.hidden && visibleOnTf(d, tf) && d.points && d.style && d.style.priceLabels;
      let handles = this.priceLabelLines.get(d.id);
      if (!want) {
        if (handles) { handles.forEach((h) => { try { this.series.removeLevel(h); } catch (_) {} }); this.priceLabelLines.delete(d.id); }
        return;
      }
      if (!handles) { handles = []; this.priceLabelLines.set(d.id, handles); }
      const pts = /** @type {DataPoint[]} */ (d.points);   // `want` guaranteed d.points above
      pts.forEach((p, i) => {
        const opts = { price: p.price, color: d.style.color, showLine: false, showAxisLabel: true, lineWidth: 1 };
        if (handles[i]) handles[i].configure(opts);
        else handles[i] = this.series.addLevel(opts);
      });
      while (handles.length > pts.length) { const h = handles.pop(); try { this.series.removeLevel(h); } catch (_) {} }
    });
  }

  /** @param {string} id */
  _clearPriceLabels(id) {
    const handles = this.priceLabelLines.get(id);
    if (handles) { handles.forEach((h) => { try { this.series.removeLevel(h); } catch (_) {} }); this.priceLabelLines.delete(id); }
  }
  ctx() { return { pane: this.pane, chart: this.pane.chart, series: this.series }; }

  // drawings rendered by the canvas primitive (kind:'draw', visible) — local + synced,
  // in z-order (low z painted first = bottom). Empty when globally hidden (eye toggle).
  // suppress all rendering/hit-testing for this surface (e.g. a collapsed sub-pane)
  /** @param {boolean} v */
  setSuppressed(v) { this.suppressed = !!v; this.requestUpdate(); }
  /** @returns {Drawing[]} */
  canvasItems() { if (this.suppressed || drawingsHidden()) return []; const tf = this.pane.tf(); const eff = this._effectiveState().hidden; return this.allItems().filter((d) => { const t = /** @type {Tool|undefined} */ (getTool(d.tool)); return t && t.kind === 'draw' && !d.hidden && !eff.has(d.id) && visibleOnTf(d, tf); }).sort((a, b) => (a.z || 0) - (b.z || 0)); }
  // Effective hidden/locked: a drawing inherits `hidden`/`locked` from its ancestor FOLDERS and its LAYER
  // (own-flag, no cascade writes). Returns two Sets of drawing ids. Cheap tree walk; z is never involved.
  /** @returns {{ hidden: Set<string>, locked: Set<string> }} */
  _effectiveState() {
    /** @type {Set<string>} */ const hidden = new Set();
    /** @type {Set<string>} */ const locked = new Set();
    /** @param {any[]|undefined} nodes @param {boolean} h @param {boolean} l */
    const walk = (nodes, h, l) => { for (const n of (nodes || [])) {
      if (n.type === 'folder') walk(n.children, h || !!n.hidden, l || !!n.locked);
      else { if (h) hidden.add(n.id); if (l) locked.add(n.id); }
    } };
    if (this.isolated) walk(this.getTree(), false, false);   // sub-pane: folders only, no layers
    else syncStore.getLayers(this.pane.symbol).list.forEach((ly) => walk(ly.nodes, !!ly.hidden, !!ly.locked));
    return { hidden, locked };
  }
  // a drawing is locked if it, an ancestor folder, or its layer is locked
  /** @param {string} id @returns {boolean} */
  isLocked(id) { const d = this.get(id); if (!d) return false; return d.locked || this._effectiveState().locked.has(id); }
  /** @returns {number} */
  nextZ() { return this.allItems().reduce((m, d) => Math.max(m, d.z || 0), 0) + 1; }

  // stacking order (Visual order): where ∈ 'front' | 'back' | 'forward' | 'backward'.
  // z is split by the candle series at 0 — z >= 0 paints in FRONT of the candles,
  // z < 0 BEHIND them (see primitive.js). Each call first normalizes the whole stack
  // to distinct integers (preserving paint order AND the candle plane), so forward/
  // backward move exactly one layer even when drawings share a default z; crossing 0
  // moves a drawing across the candle plane.
  /** @param {string} id @param {ReorderWhere} where */
  reorder(id, where) {
    const d = this.get(id); if (!d) return;
    const ordered = this.allItems().slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    const behind = ordered.filter((x) => (x.z || 0) < 0);
    behind.forEach((x, i) => { x.z = i - behind.length; });                  // -k … -1 (behind candles)
    ordered.filter((x) => (x.z || 0) >= 0).forEach((x, i) => { x.z = i; });  // 0 … m (in front)
    const idx = ordered.indexOf(d), n = ordered.length;
    // every element got a z above; z reads below are integers.
    if (where === 'front') d.z = /** @type {number} */ (ordered[n - 1].z) + 1;
    else if (where === 'back') d.z = /** @type {number} */ (ordered[0].z) - 1;
    else if (where === 'forward') { if (idx < n - 1) { const nb = ordered[idx + 1], t = d.z; d.z = nb.z; nb.z = t; } else d.z = /** @type {number} */ (d.z) + 1; }
    else if (where === 'backward') { if (idx > 0) { const nb = ordered[idx - 1], t = d.z; d.z = nb.z; nb.z = t; } else d.z = /** @type {number} */ (d.z) - 1; }
    this.persist();
    bus.emit('sync:changed');                       // repaint every pane (z affects synced drawings too)
    this._objectsChanged();
  }

  /** @param {string} toolId @param {Partial<Drawing>} params @returns {Drawing} */
  add(toolId, params) {
    const id = 'd' + Date.now().toString(36) + (seq++).toString(36);
    const tool = getTool(toolId);
    /** @type {Drawing['sync']} */
    let sync = params.sync || 'none';
    if (this.isolated || !tool || tool.kind !== 'draw') sync = 'none';   // sub-pane / non-canvas: always local
    /** @type {Drawing} */
    const d = { id, tool: toolId, ...params, sync };
    if (sync === 'none') { this.list.push(d); this._render(d); this.persist(); }
    else { syncStore.add(sync, this.pane.symbol, d); }   // emits sync:changed -> all panes render it
    this._objectsChanged();
    if (!this.isolated) bus.emit('drawings:committed', this.pane);   // undo boundary (covers the synced path too)
    return d;
  }

  /** @param {Drawing} d */
  _render(d) {
    const tool = /** @type {Tool|undefined} */ (getTool(d.tool));
    if (tool && tool.kind === 'draw') { this.requestUpdate(); return; }
    if (tool && typeof tool.render === 'function') { try { this.priceLines.set(d.id, tool.render(d, this.ctx())); } catch (_) {} }
  }

  // live preview during a drag: a synced drawing must repaint on every pane, a local
  // one only here.
  /** @param {Drawing|null} d */
  liveUpdate(d) { if (d && d.sync && d.sync !== 'none') bus.emit('sync:changed'); else this.requestUpdate(); }

  /** @param {string} id */
  startSlice(id) { if (this.interaction) this.interaction.startSlice(id); }   // from the drawing menu

  // ---- object manager (right panel) ----
  /** @returns {Drawing[]} */
  objects() { return this.allItems(); }   // raw drawings; the object tree provides its own (organizational) order
  // organizational folder tree (pure organization — never affects z-order or visibility).
  // SHARED PER SYMBOL via the sync store, so every same-symbol pane reads/writes the
  // same tree (organize on one chart → shows on all charts of that symbol). Legacy
  // per-pane trees (pane.settings.tree) are migrated into the shared tree once.
  getTree() {
    // isolated sub-pane (study / compare): its OWN folder tree, persisted via the store
    // (store.loadTree/saveTree) — never the shared per-symbol layers. Sub-panes have no layers.
    if (this.isolated) {
      if (!this._tree) this._tree = (this.store && this.store.loadTree && this.store.loadTree()) || [];
      return this._tree;
    }
    return syncStore.getTree(this.pane.symbol);   // the ACTIVE layer's nodes
  }
  // Every node-tree that belongs to this surface: an isolated sub-pane has one; the main chart has
  // one per LAYER. Used to reconcile / map nodes across all layers, not just the active one.
  allTrees() {
    if (this.isolated) return [this.getTree()];
    return syncStore.getLayers(this.pane.symbol).list.map((ly) => ly.nodes);
  }
  // ---- layers (main chart only; isolated sub-panes AND study-board panes have none) ----
  layers() { return (this.isolated || this.pane.board) ? null : syncStore.getLayers(this.pane.symbol); }
  activeLayerId() { return this.isolated ? null : syncStore.getLayers(this.pane.symbol).active; }
  /** @param {string} id */
  setActiveLayer(id) { if (!this.isolated) { syncStore.setActiveLayer(this.pane.symbol, id); this._objectsChanged(); } }
  /** @param {string} [name] */
  addLayer(name) { if (this.isolated) return null; const ly = syncStore.addLayer(this.pane.symbol, name); this._objectsChanged(); return ly; }
  /** @param {string} id @param {string} name */
  renameLayer(id, name) { if (!this.isolated) { syncStore.renameLayer(this.pane.symbol, id, name); this._objectsChanged(); } }
  /** @param {string} id @param {string} flag @param {boolean} val */
  setLayerFlag(id, flag, val) { if (!this.isolated) { syncStore.setLayerFlag(this.pane.symbol, id, flag, val); this._objectsChanged(); this.requestUpdate(); } }
  /** @param {string} id */
  removeLayer(id) {   // removes the layer AND every drawing in it
    if (this.isolated) return;
    const L = syncStore.getLayers(this.pane.symbol);
    const ly = L.list.find((x) => x.id === id); if (!ly || L.list.length <= 1) return;
    /** @type {string[]} */
    const ids = [];
    (/** @param {any[]} nodes */ function collect(nodes) { (nodes || []).forEach((n) => { if (n.type === 'folder') collect(n.children); else ids.push(n.id); }); })(ly.nodes);
    ids.forEach((did) => this.removeDrawing(did));
    syncStore.removeLayer(this.pane.symbol, id);
    this._objectsChanged(); this.requestUpdate();
  }
  // ---- whole-stack save/load (drawing-set file). Serializable snapshot of every layer,
  // or null on surfaces that have no layers (isolated sub-panes / study board). ----
  layersSnapshot() { const L = this.layers(); return L ? { active: L.active, list: L.list } : null; }
  /** @param {import('./sync-store.js').LayerSet} L */
  loadLayerSet(L) { if (this.isolated || this.pane.board) return; syncStore.setLayers(this.pane.symbol, L); this._objectsChanged(); this.requestUpdate(); }
  saveTree() {   // persist + re-render + undo boundary
    if (this.isolated) {
      if (this.store && this.store.saveTree) this.store.saveTree(this._tree || []);
      this._objectsChanged(); bus.emit('drawings:committed', this.pane); return;
    }
    syncStore.setTree(this.pane.symbol, this.getTree()); this._objectsChanged(); bus.emit('drawings:committed', this.pane);
  }
  _objectsChanged() { bus.emit('objects:changed', { pane: this.pane }); }
  /** @param {string} id @param {boolean} v */
  setHidden(id, v) { const d = this.get(id); if (!d) return; d.hidden = !!v; this.persist(); this.liveUpdate(d); this._objectsChanged(); }
  /** @param {string} id @param {boolean} v */
  setLocked(id, v) { const d = this.get(id); if (!d) return; d.locked = !!v; this.persist(); this._objectsChanged(); }
  /** @param {string} id @param {string} name */
  rename(id, name) { const d = this.get(id); if (!d) return; d.name = name || undefined; this.persist(); this._objectsChanged(); }
  /** @param {string} id @returns {Drawing|null} */
  clone(id) {
    const d = this.get(id); if (!d) return null;
    const c = JSON.parse(JSON.stringify({ points: d.points, style: d.style, textStyle: d.textStyle, text: d.text, name: d.name, hidden: d.hidden, locked: d.locked, visibility: d.visibility }));
    const nd = this.add(d.tool, { ...c, sync: d.sync || 'none', z: this.nextZ() });
    this.select(nd.id); this._objectsChanged();
    return nd;
  }

  // Extend (reverse of Slice): delete a line and place a Horizontal Ray at its ORIGIN
  // (the first point) — a single-anchor ray that shoots to the right edge. Reuses the
  // existing hray tool. Keeps style/text/name/sync; selects the new ray.
  /** @param {string} id @returns {Drawing|null} */
  extendToRay(id) {
    const d = this.get(id);
    if (!d || !d.points || !d.points.length) return null;
    const s = d.style || {};
    const style = { color: s.color || '#2962ff', width: s.width || 2, lineStyle: s.lineStyle || 'solid', priceLabels: !!s.priceLabels };
    /** @type {Partial<Drawing>} */
    const params = { points: [{ ...d.points[0] }], style, z: this.nextZ(), sync: d.sync || 'none' };
    if (d.text != null) params.text = d.text;
    if (d.textStyle) params.textStyle = JSON.parse(JSON.stringify(d.textStyle));
    if (d.name) params.name = d.name;
    if (d.visibility) params.visibility = JSON.parse(JSON.stringify(d.visibility));
    this.removeDrawing(id);
    const nd = this.add('hray', params);
    if (nd) this.select(nd.id);
    return nd;
  }

  // single-select (or clear with null). No-op if already the sole selection.
  /** @param {string|null} id */
  select(id) {
    if (id && this.selection.size === 1 && this.selection.has(id)) return;
    if (!id && !this.selection.size) { this.selectedId = null; return; }
    this.selectedId = id || null;
    this.selection = id ? new Set([id]) : new Set();
    this.requestUpdate(); this._objectsChanged();
  }
  // Ctrl+click: add/remove a drawing from the multi-selection
  /** @param {string|null} id */
  toggleSelect(id) {
    if (!id) return;
    if (this.selection.has(id)) {
      this.selection.delete(id);
      if (this.selectedId === id) this.selectedId = [...this.selection].pop() || null;
    } else { this.selection.add(id); this.selectedId = id; }
    this.requestUpdate(); this._objectsChanged();
  }
  // set the selection to an explicit list (used to mirror the object tree)
  /** @param {string[]|null|undefined} ids */
  setSelection(ids) {
    this.selection = new Set(ids || []);
    this.selectedId = [...this.selection].pop() || null;
    this.requestUpdate(); this._objectsChanged();
  }
  /** @param {string} id @returns {boolean} */
  isSelected(id) { return this.selection.has(id); }
  /** @returns {string[]} */
  selectedIds() { return [...this.selection]; }
  /** @param {string} id @returns {Drawing|undefined} */
  get(id) { return this.list.find((d) => d.id === id) || this._synced().find((d) => d.id === id); }

  // change a drawing's sync scope ('none' | 'layout' | 'global'), moving the object
  // between this pane's local list and the shared store.
  /** @param {string} id @param {'none'|'layout'|'global'} scope */
  setSync(id, scope) {
    if (this.isolated) return;   // sub-pane drawings can't sync (no shared store)
    const d = this.get(id);
    if (!d) return;
    const cur = d.sync || 'none';
    if (cur === scope) return;
    if (cur === 'none') {                          // local -> synced
      this.list = this.list.filter((x) => x.id !== id);
      syncStore.add(scope, this.pane.symbol, d);
      this.persist();
    } else if (scope === 'none') {                 // synced -> local
      syncStore.move(id, 'none', this.pane.symbol);
      d.sync = 'none';
      this.list.push(d);
      this.persist();
    } else {                                        // synced -> other synced scope
      syncStore.move(id, scope, this.pane.symbol);
    }
    this.requestUpdate();
  }

  // the render view (data<->screen + plot size) that a tool's marks() expects, so generic
  // hit-testing resolves marks to the SAME pixels the primitive painted this frame.
  _hitView() {
    return {
      width: this._plotW || 0, height: this._plotH || 0, priceDecimals: this.pane.priceDecimals,
      bars: this.pane.barArr || [],
      /** @param {number} t */
      timeToX: (t) => timeToX(this.pane, t),
      /** @param {number} p */
      priceToY: (p) => this.series.priceToY(p),
      /** @param {number} x */
      snapX: (x) => snapXToBar(this.pane, x),
    };
  }

  // top-most canvas drawing under (x,y), or null
  /** @param {number} x @param {number} y @returns {({ id: string } & Record<string, any>)|null} */
  hitTest(x, y) {
    const items = this.canvasItems().slice().reverse();
    for (const d of items) {
      const tool = /** @type {Tool|undefined} */ (getTool(d.tool));
      // a tool interacts via its own hitTest, OR (a pure recipe) is hit-tested from its marks
      const hasMarks = typeof tool?.marks === 'function';
      if (!tool || !d.points || (typeof tool.hitTest !== 'function' && !hasMarks)) continue;
      let pts = d.points.map((p) => toScreen(this.pane, p, this.series));
      if (pts.some((p) => !p)) continue;
      const solid = /** @type {ScreenPoint[]} */ (pts);   // guarded above: none is null
      if (tool.snapToBar) pts = solid.map((p) => ({ ...p, x: snapXToBar(this.pane, p.x) }));
      const h = (typeof tool.hitTest === 'function')
        ? tool.hitTest(/** @type {ScreenPoint[]} */ (pts), x, y, TOL, d)     // d: lets a tool read its cached render geometry
        : hitTestFromMarks(tool, d, /** @type {ScreenPoint[]} */ (pts), x, y, TOL, this._hitView());
      if (h) return { id: d.id, ...h };
    }
    return null;
  }

  /** @param {string} id */
  removeDrawing(id) {
    this._clearPriceLabels(id);
    const local = this.list.find((x) => x.id === id);
    if (local) {
      const tool = /** @type {Tool|undefined} */ (getTool(local.tool));
      if (tool && tool.kind !== 'draw') {
        const h = this.priceLines.get(id);
        if (h != null && tool.remove) { try { tool.remove(h, this.ctx()); } catch (_) {} }
        this.priceLines.delete(id);
      }
      this.list = this.list.filter((x) => x.id !== id);
      this.selection.delete(id); if (this.selectedId === id) this.selectedId = [...this.selection].pop() || null;
      this.persist();
      this.requestUpdate();
      this._objectsChanged();
      bus.emit('drawings:committed', this.pane);
      return;
    }
    if (syncStore.find(id)) {                       // shared drawing — remove everywhere
      syncStore.remove(id);
      this.selection.delete(id); if (this.selectedId === id) this.selectedId = [...this.selection].pop() || null;
      this.requestUpdate();
    }
    this._objectsChanged();
    bus.emit('drawings:committed', this.pane);
  }

  clear() {   // local + synced drawings shown on this pane's symbol
    [...this.list].forEach((d) => this.removeDrawing(d.id));
    syncStore.forSymbol(this.pane.symbol).slice().forEach((d) => this.removeDrawing(d.id));
  }
  clearLocal() { [...this.list].forEach((d) => this.removeDrawing(d.id)); }   // this pane's own drawings only
  localCount() { return this.list.length; }

  // Drawings present in THIS pane's current timeframe VIEW: local + layout-synced for the
  // symbol, selected by their Visibility-on-Timeframe setting (NOT the Hide/Show eye).
  // Global-synced are excluded on purpose — those belong to the toolbar Trash. Used by the
  // chart right-click "Remove N drawings" (a per-chart convenience, not a global wipe).
  /** @returns {Drawing[]} */
  viewDrawings() {
    const tf = this.pane.tf();
    const layout = this.isolated ? [] : /** @type {Drawing[]} */ (syncStore.forSymbolScope(this.pane.symbol, 'layout'));
    return this.list.concat(layout).filter((d) => visibleOnTf(d, tf));
  }
  removeViewDrawings() { this.viewDrawings().slice().forEach((d) => this.removeDrawing(d.id)); }

  persist() {
    if (this.isolated) { if (this.store) this.store.save(this.list.map((d) => ({ ...d }))); this.requestUpdate(); return; }
    this.pane.settings.drawings = this.list.map((d) => ({ ...d }));
    syncStore.flushGlobal(this.pane.symbol);        // in-place edits of global drawings
    bus.emit('pane:changed');                       // -> workspace save (incl. layout-synced)
    bus.emit('drawings:committed', this.pane);      // -> undo/redo snapshot boundary
  }
  restore() {
    if (this.isolated) {
      if (this.store) (this.store.load() || []).forEach((d) => { d.sync = 'none'; this.list.push(d); this._render(d); });
      this.requestUpdate();
      return;
    }
    (this.pane.settings.drawings || []).forEach((/** @type {Drawing} */ d) => { if (!d.sync) d.sync = 'none'; this.list.push(d); this._render(d); });
    this.requestUpdate();
  }

  destroy() {
    this._dead = true;
    if (this._off) { try { this._off(); } catch (_) {} }
    try { if (this.interaction) this.interaction.destroy(); } catch (_) {}
    this.list.forEach((d) => {
      const t = /** @type {Tool|undefined} */ (getTool(d.tool));
      if (t && t.kind !== 'draw') { const h = this.priceLines.get(d.id); if (h != null && t.remove) { try { t.remove(h, this.ctx()); } catch (_) {} } }
    });
    this.priceLines.clear();
    this.priceLabelLines.forEach((hs) => hs.forEach((h) => { try { this.series.removeLevel(h); } catch (_) {} }));
    this.priceLabelLines.clear();
    try { this.series.removeLayer(this.primitive); } catch (_) {}
    this.list = [];
    this._requestUpdate = null;
  }
}
