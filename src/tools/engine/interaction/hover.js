// @ts-check
// Capture/hover policy for the interaction overlay: deciding WHEN the transparent div eats the
// pointer (a draw/zoom tool armed, the cursor over a drawing/handle/label, Ctrl for the marquee,
// Shift for the measure) and which cursor it shows -- plus the idle hover handlers that keep the
// chart's crosshair alive and broadcasting while the overlay is capturing. What happens once a
// gesture starts lives in interaction.js. Part of the Interaction class, split out as a prototype
// mixin -- these methods run with `this` bound to the instance.
import { bus } from '../../../bus.js';
import { getActiveTool } from '../../controller.js';
import { getTool } from '../../registry.js';
import { drawingsLocked } from '../../toolbar-store.js';
import { getSetting } from '../../../settings/settings.js';
import { toData } from '../geometry.js';

/** @typedef {import('../interaction.js').Interaction} Ix   the `this` for every method here */
/** @typedef {import('../interaction.js').Tool} Tool */

export const hoverMethods = {
  /** @this {Ix} @param {string} [cursor] */
  _enable(cursor) {
    this.overlay.style.pointerEvents = 'auto';
    this.overlay.style.cursor = cursor || 'crosshair';
  },
  /** @this {Ix} */
  _disable() {
    this.overlay.style.pointerEvents = 'none';
  },
  /** @this {Ix} @returns {Tool|null} */
  _activeDrawTool() {
    const t = /** @type {Tool|undefined} */ (getTool(getActiveTool()));
    return t && t.kind === 'draw' ? t : null;
  },
  /** @this {Ix} @returns {Tool|null} */
  _activeZoomTool() {
    const t = /** @type {Tool|undefined} */ (getTool(getActiveTool()));
    return t && t.kind === 'zoom' ? t : null;
  },

  // over the right price scale or bottom time scale? → let the chart handle it
  // (rescale/scroll), never capture a drawing sitting underneath.
  /** @this {Ix} @param {number} x @param {number} y */
  _overScale(x, y) {
    const r = this.overlay.getBoundingClientRect();
    let pw = 0,
      th = 0;
    try {
      pw = this.pane.chart.priceAxis('right').width();
      th = this.pane.chart.timeAxis().height();
    } catch (_) {}
    const gy = this._gy != null ? this._gy : y; // time axis is at the chart bottom (global y)
    return x > r.width - pw || gy > r.height - th;
  },

  // decide overlay capture by what's under the cursor (when idle)
  /** @this {Ix} @param {number} x @param {number} y */
  _hover(x, y) {
    if (this.mode !== 'idle') return;
    if (this._overScale(x, y)) {
      this._disable();
      return;
    } // price/time scale → chart owns it
    if (this._activeDrawTool()) {
      this._enable('crosshair');
      return;
    }
    if (this._activeZoomTool()) {
      this._enable('crosshair');
      return;
    } // zoom tool → arm the drag-to-zoom box
    const locked = drawingsLocked();
    const hit = locked ? null : this.engine.hitTest(x, y); // an unlocked drawing under the cursor? (locked ones can't move)
    // Shift arms the quick-measure drag -- EXCEPT over an unlocked drawing, where Shift constrains the
    // MOVE instead (fall through to the move-capture below).
    if (this._shiftHeld && !hit && getSetting('measureHotkey') !== false) {
      this._enable('crosshair');
      return;
    }
    if (locked) {
      this._disable();
      return;
    } // locked → don't capture; chart pans through
    // a reshape handle (endpoint) wins over the label box, so the ends stay grabbable;
    // otherwise the selected label's underlay shows the text cursor and edits on click
    if (hit && hit.part === 'point') {
      this._enable('default');
      return;
    }
    if (this._overTextBox(x, y)) {
      this._enable('text');
      return;
    }
    if (hit) {
      this._enable('pointer');
      return;
    } // finger pointer over a drawing's body
    if (this._ctrlHeld) {
      this._enable('crosshair');
      return;
    } // Ctrl → arm marquee from empty space
    this._disable();
  },

  // The clickable "underlay" for a label: a plain rectangle spanning the text (for a
  // sloped trend-line label this is the axis-aligned bbox of the rotated text — generous
  // on purpose so the whole "+ Add text" area is clickable, not just the ends).
  /** @this {Ix} @param {number} x @param {number} y */
  _overTextBox(x, y) {
    const g = this.engine._textBox;
    if (!g) return false;
    // Inset the EDIT region by a margin so the box's outer ring selects/moves the object instead of
    // editing it -- i.e. the grabbable underlay is a bit larger than the text-input box. Skip the inset
    // for a small box (e.g. the empty "+ Add text" placeholder) so it stays easy to click.
    const m = g.x1 - g.x0 > 28 && g.y1 - g.y0 > 22 ? 6 : 0;
    return x >= g.x0 + m && x <= g.x1 - m && y >= g.y0 + m && y <= g.y1 - m;
  },

  /** @this {Ix} @param {PointerEvent} e */
  _onHover(e) {
    const { x, y } = this._localXY(e);
    this._last = { x, y };
    this._ctrlHeld = !!(e.ctrlKey || e.metaKey);
    this._shiftHeld = !!e.shiftKey;
    this._hover(x, y);
    // Whenever the capture overlay is on -- a draw tool is armed OR the cursor is over a drawing --
    // it eats the pointer, so the chart's own crosshair would vanish. Forward it here so the crosshair
    // stays visible while hovering an object (OHLC-snapped only when a draw tool is active).
    if (this.mode === 'idle' && this.overlay.style.pointerEvents === 'auto') {
      const dt = this._activeDrawTool();
      const dd = dt ? this._anchorData(e, null, dt) : toData(this.pane, x, y, this.engine.series);
      this.pane.setCrosshair(dd.time, dd.price, this.engine.series);
      // The chart's own onCursorMove -> bus 'crosshair' does NOT fire while the overlay eats the
      // pointer, so crosshair SYNC (local layout + cross-window study board <-> main) would freeze
      // whenever a draw tool is armed or the cursor is over a drawing. Emit it here so the crosshair
      // keeps broadcasting. Programmatic applies (setCrosshair on the receiving panes) don't re-emit,
      // so there is no loop.
      if (dd.time != null) bus.emit('crosshair', { source: this.pane, time: dd.time, price: dd.price });
    }
  },
  /** @this {Ix} */
  _onLeave() {
    if (this._activeDrawTool() || this.mode === 'creating') {
      this.pane.clearCrosshair();
      bus.emit('crosshair', { source: this.pane, time: null, price: null }); // broadcast the clear to synced panes/windows
    }
  },
};
