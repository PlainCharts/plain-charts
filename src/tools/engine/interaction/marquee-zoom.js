// @ts-check
// Rubber-band marquee (Ctrl+drag: select every drawing the box touches) and zoom-to-area (the Zoom
// tool: drag a box, release to fit that time + price range). Both reuse engine.marqueeRect for the
// box rendering. Part of the Interaction class, split out as a prototype mixin -- these methods run
// with `this` bound to the Interaction instance (attached via Object.assign in interaction.js).
import { setActiveTool } from '../../controller.js';
import { getTool } from '../../registry.js';
import { toData, toScreen } from '../geometry.js';

/** @typedef {import('../interaction.js').Interaction} Ix   the `this` for every method here */
/** @typedef {import('../interaction.js').Marquee} Marquee */
/** @typedef {import('../interaction.js').Tool} Tool */
/** @typedef {import('../interaction.js').ScreenPoint} ScreenPoint */

export const marqueeZoomMethods = {
  // ---- rubber-band marquee (Ctrl+drag): select every drawing the box touches ----
  /** @this {Ix} @param {number} x @param {number} y @param {PointerEvent} e */
  _beginMarquee(x, y, e) {
    this.mode = 'marquee';
    // additive: keep whatever was already selected (Ctrl is an "add" gesture)
    this.marquee = { x0: x, y0: y, x1: x, y1: y, base: this.engine.selectedIds() };
    this.engine.marqueeRect = { x0: x, y0: y, x1: x, y1: y };
    try { this.overlay.setPointerCapture(e.pointerId); } catch (_) {}
    this.engine.requestUpdate();
  },
  /** @this {Ix} */
  _applyMarquee() {
    const m = /** @type {Marquee} */ (this.marquee);
    const xlo = Math.min(m.x0, m.x1), xhi = Math.max(m.x0, m.x1);
    const ylo = Math.min(m.y0, m.y1), yhi = Math.max(m.y0, m.y1);
    const ids = new Set(m.base);
    const R = this.overlay.getBoundingClientRect();
    this.engine.canvasItems().forEach((d) => {
      if (d.hidden || this.engine.isLocked(d.id) || !d.points || !d.points.length) return;
      const s = /** @type {ScreenPoint[]} */ (d.points.map((p) => toScreen(this.pane, /** @type {{ time: number, price: number }} */ (p), this.engine.series)).filter(Boolean));
      if (!s.length) return;
      let bx0 = Math.min(...s.map((p) => p.x)), bx1 = Math.max(...s.map((p) => p.x));
      let by0 = Math.min(...s.map((p) => p.y)), by1 = Math.max(...s.map((p) => p.y));
      // full-span single-anchor lines have a degenerate point bbox -> extend to the axis they span, so the
      // marquee selects them whenever it crosses the line (vertical: full height; horizontal: full width).
      const tool = /** @type {Tool|undefined} */ (getTool(d.tool));
      if (tool && tool.timeOnly) { by0 = 0; by1 = R.height; }
      if (tool && tool.priceOnly) { bx0 = 0; bx1 = R.width; }
      if (bx0 <= xhi && bx1 >= xlo && by0 <= yhi && by1 >= ylo) ids.add(d.id);   // bbox overlap
    });
    this.engine.setSelection([...ids]);
  },

  // ---- zoom-to-area (the Zoom tool): drag a box, release to fit that time + price range ----
  /** @this {Ix} @param {number} x @param {number} y @param {PointerEvent} e */
  _beginZoom(x, y, e) {
    this.mode = 'zooming';
    this.marquee = { x0: x, y0: y, x1: x, y1: y };
    this.engine.marqueeRect = { x0: x, y0: y, x1: x, y1: y };   // reuse the marquee rectangle rendering
    try { this.overlay.setPointerCapture(e.pointerId); } catch (_) {}
    this.engine.requestUpdate();
  },
  /** @this {Ix} */
  _applyZoom() {
    const m = this.marquee;
    this.engine.marqueeRect = null; this.mode = 'idle'; this.marquee = null;
    this.engine.requestUpdate();
    let zoomed = false;
    // ignore a tiny/accidental box (a click); otherwise fit the selection's time + price extents
    if (m && Math.abs(m.x1 - m.x0) > 4 && Math.abs(m.y1 - m.y0) > 4) {
      const c1 = toData(this.pane, m.x0, m.y0), c2 = toData(this.pane, m.x1, m.y1);
      if (c1 && c2 && c1.time != null && c2.time != null && c1.price != null && c2.price != null) {
        const from = Math.min(c1.time, c2.time), to = Math.max(c1.time, c2.time);
        const lo = Math.min(c1.price, c2.price), hi = Math.max(c1.price, c2.price);
        try { this.pane.chart.timeAxis().zoomTimeWindow({ from, to }); } catch (_) {}
        try { this.pane.series.priceAxis().configure({ range: [hi, lo] }); } catch (_) {}
        zoomed = true;
      }
    }
    // ONE-SHOT: once a zoom is applied, revert to the cursor. A tiny/accidental box keeps the tool armed.
    if (zoomed) { setActiveTool('cursor'); this._disable(); }
    else this._hover(...(/** @type {[number, number]} */ (this._last ? [this._last.x, this._last.y] : [0, 0])));
  },
};
