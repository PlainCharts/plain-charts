// @ts-check
// Ephemeral Shift-measure ruler (Date & Price Range): a one-time tool drawn on engine.draft (never a
// saved drawing). Begins on Shift+drag over empty space, rubber-bands until frozen by a 2nd click /
// drag-release, and is dismissed by the next click. Part of the Interaction class, split out as a
// prototype mixin -- these methods run with `this` bound to the Interaction instance.
import { getTool } from '../../registry.js';
import { getToolDefaults } from '../../tool-defaults.js';
import { mergeToolStyle } from './tool-style.js';

/** @typedef {import('../interaction.js').Interaction} Ix   the `this` for every method here */
/** @typedef {import('../interaction.js').Tool} Tool */

export const measureMethods = {
  // ---- ephemeral Shift measure: a one-time ruler drawn on engine.draft (never a saved drawing) ----
  // begin: first anchor at the click; the ruler rubber-bands until it's frozen by a 2nd click / drag-release.
  /** @this {Ix} @param {PointerEvent} e */
  _beginMeasure(e) {
    this._clearMeasure();                                   // any prior frozen ruler goes first
    const mt = /** @type {Tool|undefined} */ (getTool('priceTimeRange')); if (!mt) return;
    const data = this._anchorData(e, null, mt);
    if (data.time == null || data.price == null) return;
    const { x, y } = this._localXY(e);
    this.measure = { downX: x, downY: y };
    this.engine.draft = { tool: /** @type {string} */ (mt.id), points: [data, { ...data }], style: mergeToolStyle(/** @type {{ defaultStyle: Record<string, any>, identityStyle?: string[] }} */ (mt), (getToolDefaults(mt.id) || {}).style) };
    this.mode = 'measuring';
    this._enable('crosshair');
    try { this.overlay.setPointerCapture(e.pointerId); } catch (_) {}
    this.engine.requestUpdate();
  },
  // freeze: lock the far anchor; the measurement stays displayed until the next click dismisses it.
  /** @this {Ix} @param {PointerEvent | MouseEvent} e */
  _freezeMeasure(e) {
    if (!this.engine.draft) { this.mode = 'idle'; this.measure = null; return; }
    const pts = this.engine.draft.points;
    const data = this._anchorData(e, pts[0], /** @type {Tool|undefined} */ (getTool('priceTimeRange')));
    if (data.time != null && data.price != null) { pts[1] = data; this.engine.draft.points = pts; }
    this.measure = null;
    this.mode = 'measured';
    this.engine.requestUpdate();
  },
  // dismiss: drop the ruler entirely (never persisted).
  /** @this {Ix} */
  _clearMeasure() {
    this.measure = null;
    this.engine.draft = null;
    this.mode = 'idle';
    if (!this._shiftHeld && !this._activeDrawTool()) this._disable();
    this.engine.requestUpdate();
  },
};
