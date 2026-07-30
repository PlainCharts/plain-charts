// @ts-check
// Drawing-creation gesture (part of the Interaction class, split out as a prototype mixin). Places a
// tool's anchors -- 1-click tools resolve immediately, multi-point tools rubber-band until a second
// click / drag-release (poly: click-by-click, finished on dbl-click / Enter). These methods run with
// `this` bound to the Interaction instance (attached via Object.assign in interaction.js).
import { getTool } from '../../registry.js';
import { setActiveTool } from '../../controller.js';
import { newDrawingSync } from '../../toolbar-store.js';
import { getToolDefaults } from '../../tool-defaults.js';
import { mergeToolStyle } from './tool-style.js';

/** @typedef {import('../interaction.js').Interaction} Ix   the `this` for every method here */
/** @typedef {import('../interaction.js').Anchor} Anchor */
/** @typedef {import('../interaction.js').Tool} Tool */

export const createMethods = {
  /** @this {Ix} @param {Tool} tool @param {number} x @param {number} y @param {PointerEvent} e */
  _beginCreate(tool, x, y, e) {
    const data = this._anchorData(e, null, tool); // first anchor on a bar (magnet -> OHLC price)
    if (data.time == null || data.price == null) return;
    if (tool.points === 1) {
      // a 1-click tool may expand its single anchor into a full points array (e.g.
      // the Level Line auto-places its far end at the first opposing candle).
      const points = typeof tool.onCreate === 'function' ? tool.onCreate(data, this.pane) : [data];
      const d = this.engine.add(tool.id, this._createParams(tool, points));
      this._finishCreate(d.id);
      return;
    }
    // place the first anchor; the last point rubber-bands to the cursor until the
    // second click (or a drag-release) completes it.
    this.mode = 'creating';
    this.creating = { tool, points: [data, { ...data }], downX: x, downY: y };
    this.engine.draft = {
      tool: tool.id,
      points: this.creating.points,
      style: mergeToolStyle(
        /** @type {{ defaultStyle: Record<string, any>, identityStyle?: string[] }} */ (tool),
        (getToolDefaults(tool.id) || {}).style,
      ),
    };
    try {
      this.overlay.setPointerCapture(e.pointerId);
    } catch (_) {}
    this.engine.requestUpdate();
  },

  // create params for a tool, applying its last-used appearance (tool-defaults) over the
  // built-in defaultStyle. Appearance only — geometry comes from `points`.
  /** @this {Ix} @param {Tool} tool @param {Anchor[]} points @returns {Record<string, any>} */
  _createParams(tool, points) {
    const saved = getToolDefaults(tool.id);
    /** @type {Record<string, any>} */
    const p = {
      points,
      style: mergeToolStyle(
        /** @type {{ defaultStyle: Record<string, any>, identityStyle?: string[] }} */ (tool),
        saved && saved.style,
      ),
      z: this.engine.nextZ(),
      sync: newDrawingSync(),
    };
    if (saved && saved.textStyle) p.textStyle = { ...saved.textStyle };
    return p;
  },

  /** @this {Ix} */
  _commitCreate() {
    const cr = /** @type {import('../interaction.js').Creating} */ (this.creating); // called only while creating
    const t = cr.tool;
    const d = this.engine.add(
      t.id,
      this._createParams(
        t,
        cr.points.map((p) => ({ ...p })),
      ),
    );
    this._finishCreate(d.id);
  },

  /** @this {Ix} @param {string | null | undefined} newId */
  _finishCreate(newId) {
    this.mode = 'idle';
    this.creating = null;
    this.engine.draft = null;
    if (newId) this.engine.select(newId);
    setActiveTool('cursor'); // revert to cursor; the new shape is selected
    const t = /** @type {Tool | undefined} */ (
      newId && getTool(/** @type {string} */ ((this.engine.get(newId) || {}).tool))
    );
    if (t && t.editOnCreate) this._autoEditText(/** @type {string} */ (newId)); // text/callout: start typing immediately
  },

  // After a text-first tool is placed, open its in-place editor as soon as the label anchor is painted
  // (engine._textBox is computed on the NEXT render for the selected drawing), so the user can type right
  // away without clicking the box. Retries a few frames until the anchor exists.
  /** @this {Ix} @param {string} id @param {number} [tries] */
  _autoEditText(id, tries) {
    tries = tries || 0;
    const box = this.engine._textBox;
    if (box && box.id === id) {
      this._startTextEdit(id);
      return;
    }
    if (tries < 8) requestAnimationFrame(() => this._autoEditText(id, tries + 1));
  },

  // finish a polyline: drop the trailing rubber vertex + any duplicate the
  // double-click left behind, then commit (or cancel if fewer than 2 vertices).
  /** @this {Ix} */
  _finishPoly() {
    if (this.mode !== 'creating') return;
    const pts = /** @type {import('../interaction.js').Creating} */ (this.creating).points;
    pts.pop(); // trailing rubber vertex
    /** @param {Anchor} a @param {Anchor} b */
    const same = (a, b) => a && b && a.time === b.time && a.price === b.price;
    while (pts.length >= 2 && same(pts[pts.length - 1], pts[pts.length - 2])) pts.pop();
    if (pts.length < 2) {
      this.creating = null;
      this.engine.draft = null;
      this.mode = 'idle';
      this.engine.requestUpdate();
      setActiveTool('cursor');
      this._disable();
      return;
    }
    this._commitCreate();
  },
};
