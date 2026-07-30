// @ts-check
// Interaction overlay for a pane. A transparent div over the chart whose
// pointer-events are hover-toggled: it captures pointers only when a draw tool is
// active (to create) or when the cursor is over a drawing/handle (to select/move/
// reshape); otherwise it's transparent so the chart pans/zooms normally.
import { bus } from '../../bus.js';
import { getTool } from '../registry.js';
import { getSetting } from '../../settings/settings.js';
import { toData, toScreen } from './geometry.js';
import { openSettingsDialog, closeSettingsDialog } from './settings-dialog.js';
import { openDrawingMenu, closeDrawingMenu } from './drawing-menu.js';
import { openTextAlignMenu } from './text-align-menu.js';
import { textEditMethods } from './interaction/text-edit.js';
import { sliceMethods } from './interaction/slice.js';
import { createMethods } from './interaction/create.js';
import { marqueeZoomMethods } from './interaction/marquee-zoom.js';
import { measureMethods } from './interaction/measure.js';
import { coordsMethods } from './interaction/coords.js';
import { keyboardMethods } from './interaction/keyboard.js';
import { hoverMethods } from './interaction/hover.js';

// mergeToolStyle (start-style for a NEW drawing) lives in ./interaction/tool-style.js so the create +
// measure mixins can share it without cycling through this file; re-exported to keep the public name.
export { mergeToolStyle } from './interaction/tool-style.js';

// ---- shared shapes for the interaction subsystem (drawing coords, the drawing object, engine/pane
// handles). The mixin files import these via `import('../interaction.js').<Type>` to avoid cycling. ----

// A drawing anchor in DATA space: a time (epoch seconds / bar time) and a price. Both may be null in
// the whitespace past the data (a cursor read that mapped nowhere).
/** @typedef {{ time: number|null, price: number|null }} DataPoint */
// A resolved anchor with concrete numbers (either coordinate may still be null; kept loose on purpose
// so a drawing can extend into the future / before the first bar where one axis is free).
/** @typedef {{ time: number|null, price: number|null } & Record<string, any>} Anchor */
// A point in SCREEN space (CSS px, surface-local): x on the shared time axis, y from the surface top.
/** @typedef {{ x: number, y: number }} ScreenPoint */
// A stored drawing object (points in data space + appearance/text/flags). The engine owns these.
/**
 * @typedef {Object} Drawing
 * @property {string} id
 * @property {string} tool                          registry tool id
 * @property {Anchor[]} points                      anchors in data space
 * @property {Record<string, any>=} style           appearance (color/width/lineStyle/…)
 * @property {Record<string, any>=} textStyle        label appearance
 * @property {string=} text                          label text
 * @property {string=} name
 * @property {string=} sync                          'none' | 'layout' | 'global'
 * @property {number=} z
 * @property {boolean=} hidden @property {boolean=} locked
 * @property {any=} visibility
 */
// A registry tool descriptor as the interaction subsystem reads it. Extends the registry's own
// ToolDef with the extra duck-typed hooks this layer uses (reshape/bodyMove/onCreate/…) which the
// open ToolDef doesn't name. getTool() returns ToolDef; call sites cast to this richer view.
/**
 * @typedef {Omit<import('../registry.js').ToolDef, 'points'> & {
 *   points?: number | 'poly',
 *   timeOnly?: boolean, priceOnly?: boolean,
 *   snapToBar?: boolean,
 *   shiftConstrain?: string,
 *   editOnCreate?: boolean,
 *   reshape?: (d: Drawing, index: number, dp: Anchor) => void,
 *   bodyMove?: (orig: Anchor[], move: (p: Anchor) => Anchor) => Anchor[],
 *   onCreate?: (data: Anchor, pane: Pane) => Anchor[],
 *   textEnabled?: (d: Drawing) => boolean,
 * }} Tool
 */
// The `_textBox` label anchor the primitive publishes on the engine each render (surface-local coords).
// The layout fields vary by tool (a rotated trend-line label adds cx/cy/angle/baseline; a text-box tool
// adds an `editor` descriptor), so the shape is open — the named fields are what the editor reads.
/**
 * @typedef {{
 *   id: string,
 *   x0: number, y0: number, x1: number, y1: number,
 *   ha?: string, va?: string, angle?: number, baseline?: string,
 *   x?: number, yTop?: number, cx?: number, cy?: number,
 *   editor?: { offX: number, offY: number, bg?: string, wrap?: boolean, width?: number },
 * } & Record<string, any>} TextBox
 */
// The per-pane drawing engine (src/tools/engine/engine.js). Typed loose at this boundary — only the
// surface the interaction subsystem drives is named; unlisted members fall through to `any`.
/**
 * @typedef {Object} DrawEngine
 * @property {any} series                            the surface's price scale (candle/plot handle)
 * @property {Set<string>} selection
 * @property {Draft|null} draft                      in-progress ghost shape (no id yet), or a full Drawing
 * @property {ScreenPoint|null} sliceGuide
 * @property {{ x0:number, y0:number, x1:number, y1:number }|null} marqueeRect
 * @property {TextBox|null} _textBox
 * @property {string|null} _editingId
 * @property {(x: number, y: number) => ({ id: string, part?: string, index?: number } & Record<string, any>)|null} hitTest
 * @property {(id: string) => Drawing|undefined} get
 * @property {(toolId: string, params: Record<string, any>) => Drawing} add
 * @property {(id: string) => Drawing|null} clone
 * @property {(id: string|null) => void} select
 * @property {(id: string) => void} toggleSelect
 * @property {(ids: string[]) => void} setSelection
 * @property {(id: string) => boolean} isSelected
 * @property {(id: string) => boolean} isLocked
 * @property {() => string[]} selectedIds
 * @property {() => Drawing[]} canvasItems
 * @property {(id: string) => void} removeDrawing
 * @property {(d: Drawing) => void} liveUpdate
 * @property {() => void} requestUpdate
 * @property {() => void} persist
 * @property {() => number} nextZ
 * @property {any} [k]
 */
// A surface within a pane (the main candle surface or a sub-pane). Typed loose; only what the overlay
// reads is named.
/**
 * @typedef {Object} Surface
 * @property {DrawEngine} engine
 * @property {(() => number)=} yOffset
 * @property {(() => number)=} top
 * @property {(() => any)=} bars
 * @property {any} [k]
 */
// The engine.draft ghost: a shape being placed (create) or the ephemeral measure ruler — a Drawing
// without an id yet, or an already-full Drawing.
/** @typedef {Drawing | { tool: string, points: Anchor[], style?: Record<string, any> }} Draft */

// In-progress gesture states (mode-gated; non-null only while their mode is live).
/** @typedef {{ tool: Tool, points: Anchor[], downX: number, downY: number }} Creating */
/** @typedef {{ x0: number, y0: number, x1: number, y1: number, base?: string[] }} Marquee */
/** @typedef {{ id?: string, index?: number, ids?: string[], clickedId?: string, start?: ScreenPoint, orig?: Record<string, Anchor[]>, moved?: boolean, ctrlClone?: boolean, lockAxis?: 'x'|'y'|null }} Drag */

// The Pane the overlay lives on. Engine handles (`chart`, `series`, axes) are the `any` boundary.
/**
 * @typedef {Object} Pane
 * @property {HTMLElement} el
 * @property {any} chart                             engine chart handle (timeAxis/priceAxis)
 * @property {any} series                            main candle series
 * @property {string} symbol
 * @property {Surface[]=} surfaces
 * @property {((y: number) => Surface|null)=} surfaceAt
 * @property {number[]=} barTimes
 * @property {number=} tickSize
 * @property {number|null=} priceDecimals
 * @property {(time: number|null, price: number|null, series: any) => void} setCrosshair
 * @property {() => void} clearCrosshair
 * @property {any} [k]
 */

export class Interaction {
  /**
   * @param {Pane} pane
   * @param {DrawEngine} engine
   */
  constructor(pane, engine) {
    this.pane = pane;
    this._mainEngine = engine; // default surface engine (the main pane)
    /** @type {Surface|null} */
    this._active = null; // surface under the cursor, set in _localXY (pinned mid-gesture)
    this._gy = 0; // last cursor y in pane-global space (for scale hit-testing)
    /** @type {'idle'|'creating'|'moving'|'reshaping'|'marquee'|'measuring'|'measured'|'zooming'|'slicing'} */
    this.mode = 'idle'; // idle | creating | moving | reshaping | marquee | measuring | measured
    /** @type {{ downX: number, downY: number }|null} */
    this.measure = null; // ephemeral Shift measure: {downX,downY} while placing; the ruler lives on engine.draft
    /** @type {Creating|null} */
    this.creating = null;
    // Both reshape ({id,index}) and move ({ids,clickedId,start,orig,moved,…}) states share this one
    // object; the `mode` gate decides which fields are live, so every field is optional (see Drag).
    /** @type {Drag|null} */
    this.drag = null;
    /** @type {Marquee|null} */
    this.marquee = null;
    this._ctrlHeld = false; // Ctrl/Cmd down → arm rubber-band marquee from empty space
    /** @type {boolean} */
    this._shiftHeld;
    /** @type {ScreenPoint|null} */
    this._last = null; // last cursor pos (so a Ctrl press can re-arm capture in place)
    // ---- late-bound members set by the mixin methods (text-edit / slice / nudge); bare type-only
    //      declarations (no assignment) so the constructor's runtime is unchanged from the original ----
    /** @type {{ id: string, ed: HTMLDivElement }|null} */
    this._textEdit;
    /** @type {string} */
    this._editOrig;
    /** @type {{ id: string }|null} */
    this.slicing;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    this._nudgeTimer;

    // ---- mixin methods (attached to the prototype via Object.assign at the bottom of this file).
    // Declared here so the class type — which is also the mixins' `this` type — knows their shapes.
    // These bare declarations are type-only (the assignment below defines the real methods). ----
    // coords.js:
    /** @type {(e: PointerEvent | MouseEvent) => ScreenPoint} */ this._localXY;
    /** @type {(e: PointerEvent | MouseEvent, refDataPoint: Anchor | null, tool: Tool | undefined) => ScreenPoint} */ this
      ._constrainXY;
    /** @type {(e: PointerEvent | MouseEvent, refDataPoint: Anchor | null, tool: Tool | undefined) => ScreenPoint & { price?: number }} */ this
      ._anchorXY;
    /** @type {(e: PointerEvent | MouseEvent, refDataPoint: Anchor | null, tool: Tool | undefined) => Anchor} */ this
      ._anchorData;
    /** @type {(price: number | null) => number | null} */ this._snapPrice;
    /** @type {(x: number) => number | null} */ this._nearestBarTime;
    // text-edit.js:
    /** @type {(id: string) => void} */ this._startTextEdit;
    /** @type {() => void} */ this._commitTextEdit;
    /** @type {() => void} */ this._cancelTextEdit;
    /** @type {() => void} */ this._closeTextEdit;
    // slice.js:
    /** @type {(id: string) => void} */ this.startSlice;
    /** @type {(d: Drawing, t: number) => number} */ this._linePriceAt;
    /** @type {(e: PointerEvent | MouseEvent) => Anchor | null} */ this._slicePoint;
    /** @type {(e: PointerEvent | MouseEvent) => void} */ this._updateSliceGuide;
    /** @type {(e: PointerEvent | MouseEvent) => void} */ this._commitSlice;
    /** @type {() => void} */ this._endSlice;
    // create.js:
    /** @type {(tool: Tool, x: number, y: number, e: PointerEvent) => void} */ this._beginCreate;
    /** @type {(tool: Tool, points: Anchor[]) => Record<string, any>} */ this._createParams;
    /** @type {() => void} */ this._commitCreate;
    /** @type {(newId: string | null | undefined) => void} */ this._finishCreate;
    /** @type {(id: string, tries?: number) => void} */ this._autoEditText;
    /** @type {() => void} */ this._finishPoly;
    // marquee-zoom.js:
    /** @type {(x: number, y: number, e: PointerEvent) => void} */ this._beginMarquee;
    /** @type {() => void} */ this._applyMarquee;
    /** @type {(x: number, y: number, e: PointerEvent) => void} */ this._beginZoom;
    /** @type {() => void} */ this._applyZoom;
    // measure.js:
    /** @type {(e: PointerEvent) => void} */ this._beginMeasure;
    /** @type {(e: PointerEvent | MouseEvent) => void} */ this._freezeMeasure;
    /** @type {() => void} */ this._clearMeasure;
    // keyboard.js:
    /** @type {(e: KeyboardEvent) => void} */ this._onKey;
    /** @type {(e: KeyboardEvent) => void} */ this._onMod;
    // hover.js:
    /** @type {(cursor?: string) => void} */ this._enable;
    /** @type {() => void} */ this._disable;
    /** @type {() => Tool|null} */ this._activeDrawTool;
    /** @type {() => Tool|null} */ this._activeZoomTool;
    /** @type {(x: number, y: number) => boolean} */ this._overScale;
    /** @type {(x: number, y: number) => void} */ this._hover;
    /** @type {(x: number, y: number) => boolean} */ this._overTextBox;
    /** @type {(e: PointerEvent) => void} */ this._onHover;
    /** @type {() => void} */ this._onLeave;

    this.overlay = document.createElement('div');
    this.overlay.className = 'draw-overlay';
    pane.el.appendChild(this.overlay);

    this._onHover = this._onHover.bind(this);
    this._onPaneDown = this._onPaneDown.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onDbl = this._onDbl.bind(this);
    this._onContext = this._onContext.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onMod = this._onMod.bind(this);

    pane.el.addEventListener('pointermove', this._onHover);
    pane.el.addEventListener('pointerleave', this._onLeave);
    pane.el.addEventListener('pointerdown', this._onPaneDown, true); // capture: deselect on empty click
    this.overlay.addEventListener('pointerdown', this._onDown);
    this.overlay.addEventListener('pointermove', this._onMove);
    this.overlay.addEventListener('pointerup', this._onUp);
    this.overlay.addEventListener('dblclick', this._onDbl);
    this.overlay.addEventListener('contextmenu', this._onContext);
    // The overlay captures pointer events while Ctrl is held (to arm the marquee) or a draw tool is
    // active -- which SWALLOWS the wheel before it reaches the chart, so Ctrl+wheel zoom (and any
    // wheel) dies whenever Ctrl is down. The overlay has no use for the wheel: forward it to the
    // chart canvas beneath so every wheel gesture (bar-spacing, Ctrl 2D-zoom) works uniformly.
    this.overlay.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault(); // we forward to the chart; never let the browser page-zoom (Ctrl+wheel)
        const pe = this.overlay.style.pointerEvents;
        this.overlay.style.pointerEvents = 'none';
        const below = document.elementFromPoint(e.clientX, e.clientY);
        this.overlay.style.pointerEvents = pe;
        if (below && below !== this.overlay) {
          below.dispatchEvent(
            new WheelEvent('wheel', {
              deltaX: e.deltaX,
              deltaY: e.deltaY,
              deltaZ: e.deltaZ,
              deltaMode: e.deltaMode,
              clientX: e.clientX,
              clientY: e.clientY,
              screenX: e.screenX,
              screenY: e.screenY,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
              metaKey: e.metaKey,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      },
      { passive: false },
    );
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('keydown', this._onMod);
    document.addEventListener('keyup', this._onMod);
    // Touch has no hover to arm the capture overlay, so a draw tool would never receive the finger
    // (it'd hit the chart and pan). Arm/disarm the overlay the moment the active tool changes.
    /** @type {(() => void)|null} */
    this._offTool = bus.on('tool:active', () => {
      if (this.mode !== 'idle') return;
      if (this._activeDrawTool() || this._activeZoomTool()) this._enable('crosshair');
      else if (this._last) this._hover(this._last.x, this._last.y);
      else this._disable();
    });
  }

  // the engine for the surface the cursor is currently over (main pane by default)
  get engine() {
    return (this._active && this._active.engine) || this._mainEngine;
  }

  // The capture/hover policy (_enable/_disable, _activeDrawTool/_activeZoomTool, _overScale, _hover,
  // _overTextBox, _onHover, _onLeave) lives in ./interaction/hover.js as a prototype mixin.

  // Forward the crosshair while a gesture holds the pointer capture (the chart's own onCursorMove is
  // starved), and broadcast it for sync. Both anchors non-null only; partial coords stay local.
  /** @param {number|null} time @param {number|null} price */
  _syncCrosshair(time, price) {
    if (time == null || price == null) return;
    this.pane.setCrosshair(time, price, this.engine.series);
    bus.emit('crosshair', { source: this.pane, time, price });
  }

  // clear selection on every OTHER surface (single selection across the whole chart)
  _clearOtherSurfaces() {
    (this.pane.surfaces || []).forEach((s) => {
      if (s.engine !== this.engine && s.engine.selection && s.engine.selection.size) s.engine.select(null);
    });
  }
  // capture-phase on the pane: clear selection when clicking empty space (doesn't
  // block the chart's pan). Runs before the overlay's own pointerdown.
  /** @param {PointerEvent} e */
  _onPaneDown(e) {
    if (this.mode !== 'idle' || this._activeDrawTool()) return;
    if (e.ctrlKey || e.metaKey) return; // Ctrl → toggle / marquee owns the selection
    const { x, y } = this._localXY(e);
    if (this._overTextBox(x, y)) return; // clicking the text/"+ Add text" keeps the selection
    if (this.engine.selection.size && !this.engine.hitTest(x, y)) this.engine.select(null);
  }

  /** @param {PointerEvent} e */
  _onDown(e) {
    if (e.button !== undefined && e.button !== 0) return; // ignore right/middle (right-click → context menu)
    if (this.mode === 'slicing') {
      this._commitSlice(e);
      return;
    }
    const { x, y } = this._localXY(e);

    // ephemeral Shift measure: a frozen ruler is dismissed by the next click anywhere; while placing it,
    // this click drops the second anchor and freezes the measurement in place.
    if (this.mode === 'measured') {
      this._clearMeasure();
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) this._beginMeasure(e);
      return;
    }
    if (this.mode === 'measuring') {
      this._freezeMeasure(e);
      return;
    }

    // next click of a multi-point shape → drop the point (poly: keep going; else finish)
    if (this.mode === 'creating') {
      const cr = /** @type {Creating} */ (this.creating); // mode==='creating' ⇒ non-null
      const pts = cr.points;
      const data = this._anchorData(e, pts[pts.length - 2], cr.tool);
      if (data.time != null && data.price != null) {
        pts[pts.length - 1] = data;
        if (cr.tool.points === 'poly') {
          pts.push({ ...data });
          this.engine.requestUpdate();
        } // new rubber vertex
        else this._commitCreate();
      }
      return;
    }

    if (this._activeZoomTool()) {
      this._beginZoom(x, y, e);
      return;
    } // zoom tool: drag a box, then zoom to it
    const tool = this._activeDrawTool();
    if (tool) {
      this._beginCreate(tool, x, y, e);
      return;
    }

    // cursor mode: select / move / reshape. Interacting with one surface clears the
    // selection on the others, so only one drawing is ever "selected" across the chart.
    const hit = this.engine.hitTest(x, y);

    // Shift+drag on EMPTY space (or a locked drawing) → ephemeral "measure" ruler (Date & Price Range):
    // a one-time tool that freezes on the second anchor and is dismissed by the next click; never saved
    // (lives on engine.draft). Shift+drag on an UNLOCKED drawing moves it instead, constrained to one axis
    // (see the 'moving' handler). Ctrl still owns marquee/clone, so this is Shift-only.
    const willMoveDrawing = !!(
      hit &&
      (() => {
        const d = this.engine.get(hit.id);
        return d && !this.engine.isLocked(hit.id);
      })()
    );
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !willMoveDrawing && getSetting('measureHotkey') !== false) {
      this._beginMeasure(e);
      return;
    }
    // the label box yields to endpoint handles (so the ends stay grabbable); otherwise
    // clicking the text label / "+ Add text" edits it in place on the canvas
    if ((!hit || hit.part !== 'point') && this._overTextBox(x, y)) {
      this._startTextEdit(/** @type {TextBox} */ (this.engine._textBox).id);
      return;
    }

    this._clearOtherSurfaces();
    if (!hit) {
      // Ctrl/Cmd + drag on empty space → rubber-band marquee (adds to the selection)
      if (e.ctrlKey || e.metaKey) {
        this._beginMarquee(x, y, e);
        return;
      }
      this.engine.select(null);
      this._disable();
      return;
    }

    // Ctrl/Cmd over a drawing: a plain click toggles it in the selection, but a DRAG
    // clones it and drags the copy (decided on first move in _onMove). Locked shapes
    // can't be cloned/moved → just toggle.
    if (e.ctrlKey || e.metaKey) {
      const cd = this.engine.get(hit.id);
      if (!cd || this.engine.isLocked(hit.id)) {
        this.engine.toggleSelect(hit.id);
        return;
      }
      this.overlay.setPointerCapture(e.pointerId);
      this.mode = 'moving';
      this.drag = {
        ids: [hit.id],
        clickedId: hit.id,
        start: { x, y },
        orig: { [hit.id]: cd.points.map((p) => ({ ...p })) },
        moved: false,
        ctrlClone: true,
      };
      return;
    }

    // plain click on a drawing already in a multi-selection keeps the whole set
    // (so you can drag them together); otherwise it becomes the sole selection.
    const alreadyMulti = this.engine.selection.size > 1 && this.engine.isSelected(hit.id);
    if (!alreadyMulti) this.engine.select(hit.id);

    const d = this.engine.get(hit.id);
    if (!d || this.engine.isLocked(hit.id)) return;
    this.overlay.setPointerCapture(e.pointerId);
    if (hit.part === 'point' && !alreadyMulti) {
      this.mode = 'reshaping';
      this.drag = { id: hit.id, index: hit.index };
    } else {
      // move every selected (unlocked) drawing together; remember the clicked id so
      // a no-drag click can collapse the multi-selection down to just it.
      this.mode = 'moving';
      const ids = this.engine.selectedIds().filter((id) => {
        const dd = this.engine.get(id);
        return dd && !this.engine.isLocked(id);
      });
      /** @type {Record<string, Anchor[]>} */
      const orig = {};
      // ids are pre-filtered to drawings that exist, so get(id) is non-null here.
      ids.forEach((id) => {
        orig[id] = /** @type {Drawing} */ (this.engine.get(id)).points.map((p) => ({ ...p }));
      });
      this.drag = { ids, clickedId: hit.id, start: { x, y }, orig, moved: false };
    }
  }

  /** @param {PointerEvent} e */
  _onMove(e) {
    const { x, y } = this._localXY(e);
    if (this.mode === 'marquee') {
      const mq = /** @type {Marquee} */ (this.marquee); // mode gate ⇒ non-null
      mq.x1 = x;
      mq.y1 = y;
      this.engine.marqueeRect = { x0: mq.x0, y0: mq.y0, x1: x, y1: y };
      this._applyMarquee(); // live: highlight shapes as the box sweeps over them
      this.engine.requestUpdate();
      return;
    }
    if (this.mode === 'slicing') {
      this._updateSliceGuide(e);
      return;
    }
    if (this.mode === 'zooming') {
      const mq = /** @type {Marquee} */ (this.marquee);
      mq.x1 = x;
      mq.y1 = y;
      this.engine.marqueeRect = { x0: mq.x0, y0: mq.y0, x1: x, y1: y };
      this.engine.requestUpdate();
      return;
    }
    if (this.mode === 'measuring') {
      const draft = /** @type {Drawing} */ (this.engine.draft); // the ephemeral ruler
      const pts = draft.points;
      const data = this._anchorData(e, pts[0], /** @type {Tool|undefined} */ (getTool('priceTimeRange')));
      if (data.time == null || data.price == null) return;
      pts[1] = data;
      draft.points = pts; // rubber-band the far anchor
      this._syncCrosshair(data.time, data.price);
      this.engine.requestUpdate();
      return;
    }
    if (this.mode === 'creating') {
      const cr = /** @type {Creating} */ (this.creating);
      const pts = cr.points;
      const data = this._anchorData(e, pts[pts.length - 2], cr.tool);
      if (data.time == null || data.price == null) return;
      pts[pts.length - 1] = data; // rubber-band the last anchor
      /** @type {Drawing} */ (this.engine.draft).points = pts;
      this._syncCrosshair(data.time, data.price); // keep the crosshair on the (snapped) anchor + sync alive while drawing
      this.engine.requestUpdate();
      return;
    }
    if (this.mode === 'reshaping') {
      const drag = /** @type {Drag} */ (this.drag);
      const d = this.engine.get(/** @type {string} */ (drag.id));
      if (d) {
        const tool = /** @type {Tool} */ (getTool(d.tool));
        const idx = /** @type {number} */ (drag.index);
        const ref = !tool.reshape && d.points.length === 2 ? d.points[idx === 0 ? 1 : 0] : null;
        const dp = this._anchorData(e, ref, tool);
        if (tool.reshape) tool.reshape(d, idx, dp);
        else d.points[idx] = dp;
        // keep the crosshair alive on the dragged point (overlay captures the pointer,
        // so the chart's own crosshair would otherwise vanish — same as during create)
        this._syncCrosshair(dp.time, dp.price);
        this.engine.liveUpdate(d);
      }
      return;
    }
    if (this.mode === 'moving') {
      this._moveSelection(x, y);
      return;
    }
    this._hover(x, y); // idle hover on the overlay (crosshair handled in _onHover)
  }

  // Translate the dragged selection: shift axis-lock, Ctrl clone-on-first-move, then per-point translation
  // with tick + bar snapping (or the tool's own bodyMove for a lone drag).
  /** @param {number} x @param {number} y */
  _moveSelection(x, y) {
    const drag = /** @type {Drag} */ (this.drag);
    const start = /** @type {ScreenPoint} */ (drag.start);
    let dx = x - start.x,
      dy = y - start.y;
    // Shift locks the move to one axis -- a straight-line drag / alignment for ANY drawing (slide a
    // rectangle left/right keeping its price, align an arrow). The axis is fixed from the INITIAL
    // dominant direction and held for the rest of the drag (no switching mid-move, even if you drift).
    // Releasing Shift frees both axes; pressing it again re-establishes from the current direction.
    if (this._shiftHeld) {
      if (!drag.lockAxis && (Math.abs(dx) > 2 || Math.abs(dy) > 2))
        drag.lockAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (drag.lockAxis === 'x') dy = 0;
      else if (drag.lockAxis === 'y') dx = 0;
    } else {
      drag.lockAxis = null;
    }
    if (!drag.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      drag.moved = true;
      if (drag.ctrlClone) {
        // Ctrl+drag → clone in place, then drag the copy
        const nd = this.engine.clone(/** @type {string} */ (drag.clickedId));
        if (nd) {
          drag.ids = [nd.id];
          drag.clickedId = nd.id;
          drag.orig = { [nd.id]: nd.points.map((p) => ({ ...p })) };
        }
        drag.ctrlClone = false;
      }
    }
    const dragIds = /** @type {string[]} */ (drag.ids);
    const dragOrig = /** @type {Record<string, Anchor[]>} */ (drag.orig);
    const single = dragIds.length === 1;
    dragIds.forEach((id) => {
      const d = this.engine.get(id);
      if (!d) return;
      const orig = dragOrig[id];
      // a tool can redefine how a lone body-drag translates its points (e.g. the callout keeps its
      // attachment tip fixed and moves only the box). A group move always translates every point.
      const tool = /** @type {Tool|undefined} */ (getTool(d.tool));
      const snapBar = !(tool && tool.snapToBar === false);
      /** @param {Anchor} p @returns {Anchor} */
      const move = (p) => {
        const s = toScreen(this.pane, /** @type {{ time: number, price: number }} */ (p), this.engine.series);
        if (!s) return p;
        const nd = toData(this.pane, s.x + dx, s.y + dy, this.engine.series);
        nd.price = this._snapPrice(nd.price); // keep the moved drawing on the instrument's tick grid
        // ...and snap time to the BAR grid (index space), exactly like create/reshape -- a body-drag
        // must step bar-to-bar, not slide continuously through time. null in whitespace past the data
        // leaves the free time so a drawing can still be dragged into the future / before the first bar.
        if (snapBar) {
          const t = this._nearestBarTime(s.x + dx);
          if (t != null) nd.time = t;
        }
        return nd;
      };
      d.points = single && tool && typeof tool.bodyMove === 'function' ? tool.bodyMove(orig, move) : orig.map(move);
      this.engine.liveUpdate(d);
    });
    const cd = toData(this.pane, x, y, this.engine.series); // keep crosshair on the cursor
    this._syncCrosshair(cd.time, cd.price);
  }

  /** @param {PointerEvent} e */
  _onUp(e) {
    if (this.mode === 'marquee') {
      this._applyMarquee();
      this.engine.marqueeRect = null;
      this.mode = 'idle';
      this.marquee = null;
      this.engine.requestUpdate();
      this._hover(.../** @type {[number, number]} */ (this._last ? [this._last.x, this._last.y] : [0, 0]));
      return;
    }
    if (this.mode === 'zooming') {
      this._applyZoom();
      return;
    }
    if (this.mode === 'measuring') {
      // a drag-release freezes the ruler; a plain click waits for the 2nd click
      const { x, y } = this._localXY(e);
      if (this.measure && Math.hypot(x - this.measure.downX, y - this.measure.downY) > 4) this._freezeMeasure(e);
      return;
    }
    if (this.mode === 'creating') {
      const cr = /** @type {Creating} */ (this.creating);
      if (cr.tool.points === 'poly') return; // poly is click-by-click; finish on dbl-click/Enter
      // a press-drag-release completes the segment; a plain click waits for the
      // second click (handled in _onDown).
      const { x, y } = this._localXY(e);
      if (Math.hypot(x - cr.downX, y - cr.downY) > 4) {
        const pts = cr.points;
        const data = this._anchorData(e, pts[pts.length - 2], cr.tool);
        if (data.time != null && data.price != null) pts[pts.length - 1] = data;
        this._commitCreate();
      }
      return;
    }
    if (this.mode === 'moving') {
      const drag = /** @type {Drag} */ (this.drag);
      if (drag.moved) this.engine.persist();
      // Ctrl+click with no drag → toggle the drawing in the selection (clone was armed
      // but never triggered).
      else if (drag.ctrlClone) this.engine.toggleSelect(/** @type {string} */ (drag.clickedId));
      // a click (no drag) on one of several selected drawings collapses the
      // selection to just the clicked one.
      else if (/** @type {string[]} */ (drag.ids).length > 1)
        this.engine.select(/** @type {string} */ (drag.clickedId));
      this.mode = 'idle';
      this.drag = null;
      return;
    }
    if (this.mode === 'reshaping') {
      this.engine.persist();
      this.mode = 'idle';
      this.drag = null;
    }
  }

  /** @param {MouseEvent} e */
  _onDbl(e) {
    if (this.mode === 'creating') {
      this._finishPoly();
      return;
    }
    const { x, y } = this._localXY(e);
    if (this._textEdit || this._overTextBox(x, y)) return; // text is edited in place, not via the dialog
    const hit = this.engine.hitTest(x, y);
    if (!hit) return;
    this.engine.select(hit.id);
    // double-click a drawing that can carry text → jump straight to the Text tab to
    // add/edit it; other shapes open on Style as before.
    const d = this.engine.get(hit.id);
    const tool = d && getTool(d.tool);
    const tab = tool && tool.settings && tool.settings.text ? 'Text' : 'Style';
    openSettingsDialog(this.engine, hit.id, tab);
  }

  // right-click a drawing → its context menu (sync state, settings, remove). When
  // not over a drawing the event bubbles to the pane's chart context menu instead.
  /** @param {MouseEvent} e */
  _onContext(e) {
    const { x, y } = this._localXY(e);
    // right-click on the label underlay → quick 3x3 text-alignment grid for that drawing
    const tb = this.engine._textBox;
    if (tb && this._overTextBox(x, y)) {
      const d = this.engine.get(tb.id),
        tool = d && getTool(d.tool);
      if (d && tool && tool.settings && tool.settings.text) {
        e.preventDefault();
        e.stopPropagation();
        openTextAlignMenu(this.engine, tb.id, e.clientX, e.clientY);
        return;
      }
    }
    const hit = this.engine.hitTest(x, y);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    // keep an existing multi-selection if the right-clicked drawing is part of it,
    // so the menu can act on all of them; otherwise select just this one.
    if (!this.engine.isSelected(hit.id)) this.engine.select(hit.id);
    openDrawingMenu(this.engine, hit.id, e.clientX, e.clientY);
  }

  destroy() {
    this._closeTextEdit();
    closeSettingsDialog();
    closeDrawingMenu();
    this.pane.el.removeEventListener('pointermove', this._onHover);
    this.pane.el.removeEventListener('pointerleave', this._onLeave);
    this.pane.el.removeEventListener('pointerdown', this._onPaneDown, true);
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('keydown', this._onMod);
    document.removeEventListener('keyup', this._onMod);
    if (this._offTool) {
      this._offTool();
      this._offTool = null;
    }
    this.overlay.remove();
  }
}

// Feature groups split out into ./interaction/*.js as prototype mixins -- each is a plain object of
// methods that run with `this` bound to the Interaction instance. Object.assign puts them on the
// prototype, so `this` and every cross-method call behave exactly as when they were inline.
Object.assign(
  Interaction.prototype,
  textEditMethods,
  sliceMethods,
  createMethods,
  marqueeZoomMethods,
  measureMethods,
  coordsMethods,
  keyboardMethods,
  hoverMethods,
);
