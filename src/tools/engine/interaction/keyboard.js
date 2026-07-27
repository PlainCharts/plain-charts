// @ts-check
// Keyboard commands for the interaction overlay: Enter (finish a poly), Escape (cancel the live
// gesture / disarm the tool / clear the selection), arrow-key nudge of the selected drawing(s)
// (vertical by whole ticks, horizontal by pixels), Delete/Backspace (remove, alerts included), and
// the Ctrl/Shift modifier tracking that arms the marquee / measure capture. Part of the Interaction
// class, split out as a prototype mixin -- these methods run with `this` bound to the instance.
import { removeDrawingsWithAlerts } from '../../../alerts/alert-drawing-sync.js';   // delete a drawing's alert with it
import { getActiveTool, setActiveTool } from '../../controller.js';
import { drawingsLocked } from '../../toolbar-store.js';
import { toData, toScreen } from '../geometry.js';

/** @typedef {import('../interaction.js').Interaction} Ix   the `this` for every method here */

export const keyboardMethods = {
  // Ctrl/Cmd held while idle in cursor mode arms the overlay so a drag on empty
  // space draws a selection marquee (otherwise an empty-space drag pans the chart).
  /** @this {Ix} @param {KeyboardEvent} e */
  _onMod(e) {
    const ctrl = !!(e.ctrlKey || e.metaKey), shift = !!e.shiftKey;
    if (ctrl === this._ctrlHeld && shift === this._shiftHeld) return;
    this._ctrlHeld = ctrl; this._shiftHeld = shift;
    if (this.mode === 'idle' && this._last) this._hover(this._last.x, this._last.y);
  },

  /** @this {Ix} @param {KeyboardEvent} e */
  _onKey(e) {
    if (e.key === 'Enter' && this.mode === 'creating') { e.preventDefault(); this._finishPoly(); return; }
    if (e.key === 'Escape') {
      if (this.mode === 'marquee') { this.engine.marqueeRect = null; this.mode = 'idle'; this.marquee = null; this.engine.requestUpdate(); }
      else if (this.mode === 'zooming') { this.engine.marqueeRect = null; this.mode = 'idle'; this.marquee = null; this.engine.requestUpdate(); setActiveTool('cursor'); this._disable(); }
      else if (this.mode === 'slicing') { this._endSlice(); }
      else if (this.mode === 'creating') { this.creating = null; this.engine.draft = null; this.mode = 'idle'; this.engine.requestUpdate(); setActiveTool('cursor'); this._disable(); }
      else if (this.mode === 'measuring' || this.mode === 'measured') { this._clearMeasure(); }   // drop the ephemeral ruler
      else if (getActiveTool() !== 'cursor') { setActiveTool('cursor'); this._disable(); }   // any armed tool -> cancel, back to cursor
      else if (this.engine.selection.size) this.engine.select(null);
      return;
    }
    // Arrow keys nudge the selected drawing(s) -- a drawing-layer move. Vertical (Up/Down) moves by
    // whole TICKS (1 tick, 10 with Shift) so the drawing stays exactly on the price grid; horizontal
    // (Left/Right) moves by pixels (1px, 10px with Shift). Selection is single across the whole chart,
    // so only the pane holding it acts; the rest fall through.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!this.engine.selection.size) return;
      const a = /** @type {HTMLElement|null} */ (document.activeElement), tag = a && a.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) return;
      if (drawingsLocked()) return;
      const ids = this.engine.selectedIds().filter((id) => { const d = this.engine.get(id); return d && !this.engine.isLocked(id); });
      if (!ids.length) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const horiz = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      const tick = /** @type {number} */ (this.pane.tickSize);   // may be undefined; the `tick > 0` gate handles that
      const ser = this.engine.series;
      ids.forEach((id) => {
        const d = this.engine.get(id); if (!d) return;
        d.points = d.points.map((p) => {
          // Vertical nudge on a known tick grid: move by whole ticks (Up = higher price) so the drawing
          // stays EXACTLY on the grid -- no pixel round-trip, no drift; _snapPrice also pulls a legacy
          // off-tick point onto the grid.
          if (!horiz && tick > 0) {
            const dprice = (e.key === 'ArrowUp' ? 1 : -1) * step * tick;
            return { ...p, price: this._snapPrice(/** @type {number} */ (p.price) + dprice) };
          }
          // Horizontal nudge (time), or vertical with no known tick: pixel delta through the same
          // round-trip (base vs moved), added to the original point. timeToX/priceToY floor to integer
          // pixels, so the direct round-trip snaps -- the difference cancels that, and a zero delta
          // leaves the untouched axis exact (no diagonal drift on a pure vertical/horizontal nudge).
          const s = toScreen(this.pane, /** @type {{ time: number, price: number }} */ (p), ser);
          if (!s) return p;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          const base = toData(this.pane, s.x, s.y, ser);
          const moved = toData(this.pane, s.x + dx, s.y + dy, ser);
          const dtime = (base.time != null && moved.time != null) ? moved.time - base.time : 0;
          const dprice = (base.price != null && moved.price != null) ? moved.price - base.price : 0;
          return { ...p, time: /** @type {number} */ (p.time) + dtime, price: /** @type {number} */ (p.price) + dprice };
        });
        this.engine.liveUpdate(d);
      });
      // coalesce a burst of nudges (incl. key-repeat) into ONE undo step: persist once the keys settle
      clearTimeout(this._nudgeTimer);
      this._nudgeTimer = setTimeout(() => { try { this.engine.persist(); } catch (_) {} }, 350);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.engine.selection.size) {
      const a = /** @type {HTMLElement|null} */ (document.activeElement), tag = a && a.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) return;
      if (drawingsLocked()) return;   // can't delete while locked
      e.preventDefault();
      const ids = this.engine.selectedIds().filter((/** @type {string} */ id) => { const dd = this.engine.get(id); return dd && !this.engine.isLocked(id); });
      removeDrawingsWithAlerts(this.engine, ids);   // deletes any attached alert too (with confirm)
    }
  },
};
