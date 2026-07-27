// @ts-check
// Cursor -> coordinate mapping for the interaction overlay (part of the Interaction class, split out
// as a prototype mixin). Turns a pointer event into local surface coords, applies Shift angle-snap
// and magnet (OHLC) snapping, and resolves the final anchor in DATA space (bar-snapped time + price).
// These methods run with `this` bound to the Interaction instance (attached via Object.assign).
import { magnetMode } from '../../toolbar-store.js';
import { toData, toScreen, magnetSnap } from '../geometry.js';

/** @typedef {import('../interaction.js').Interaction} Ix   the `this` for every method here */
/** @typedef {import('../interaction.js').Anchor} Anchor */
/** @typedef {import('../interaction.js').ScreenPoint} ScreenPoint */
/** @typedef {import('../interaction.js').Tool} Tool */

export const coordsMethods = {
  // cursor coords in the ACTIVE surface's local space: x is shared (time axis), y is
  // measured from that surface's top, so it lines up with the surface series' price
  // scale. The surface is chosen by y here, but pinned while a gesture is in progress.
  /** @this {Ix} @param {PointerEvent | MouseEvent} e @returns {ScreenPoint} */
  _localXY(e) {
    const r = this.overlay.getBoundingClientRect();
    const gx = e.clientX - r.left, gy = e.clientY - r.top;
    this._gy = gy;
    // choose the surface under the cursor only while idle — pin it for the duration of
    // a gesture so a drag that crosses the pane boundary doesn't switch surfaces.
    if (this.mode === 'idle' && this.pane.surfaceAt) this._active = this.pane.surfaceAt(gy);
    const off = this._active ? (this._active.yOffset ? this._active.yOffset() : /** @type {() => number} */ (this._active.top)()) : 0;
    return { x: gx, y: gy - off };
  },

  // cursor coords, optionally angle-snapped: when Shift is held and the tool opts in
  // (shiftConstrain:'angle'), snap the line from refDataPoint to the nearest 45°
  // (horizontal / vertical / diagonal), in screen space.
  /** @this {Ix} @param {PointerEvent | MouseEvent} e @param {Anchor | null} refDataPoint @param {Tool | undefined} tool @returns {ScreenPoint} */
  _constrainXY(e, refDataPoint, tool) {
    const p = this._localXY(e);
    if (!e.shiftKey || !tool || tool.shiftConstrain !== 'angle' || !refDataPoint) return p;
    const ref = toScreen(this.pane, /** @type {{ time: number, price: number }} */ (refDataPoint), this.engine.series);
    if (!ref) return p;
    const dx = p.x - ref.x, dy = p.y - ref.y, len = Math.hypot(dx, dy);
    if (len < 1) return p;
    const step = Math.PI / 4;
    const ang = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: ref.x + Math.cos(ang) * len, y: ref.y + Math.sin(ang) * len };
  },

  // final screen coords for an anchor: Shift angle-constraint takes priority,
  // otherwise the magnet (snap to candle OHLC) if enabled, else the raw cursor.
  // returns the snapped screen point; the magnet also carries the EXACT OHLC `price` it locked onto.
  /** @this {Ix} @param {PointerEvent | MouseEvent} e @param {Anchor | null} refDataPoint @param {Tool | undefined} tool @returns {ScreenPoint & { price?: number }} */
  _anchorXY(e, refDataPoint, tool) {
    if (e.shiftKey && tool && tool.shiftConstrain === 'angle' && refDataPoint) return this._constrainXY(e, refDataPoint, tool);
    const p = this._localXY(e);
    const m = magnetMode();
    const bars = this._active && this._active.bars ? this._active.bars() : undefined;
    return m === 'off' ? p : magnetSnap(this.pane, p.x, p.y, m, this.engine.series, bars);
  },

  // Anchor in DATA space {time, price}. Every tool goes through here so it places bar-to-bar like the
  // crosshair. The TIME snaps to the nearest bar in INDEX space -- reading the exact time from barTimes
  // -- NOT by round-tripping a snapped pixel back through xToTime, which lands minutes off at zoom-out
  // (one pixel spans many bars, and t2screen floors to -0.5px). Price comes from the magnet/cursor. Shift
  // angle-constraint stays a free point; a tool may opt out with snapToBar:false.
  /** @this {Ix} @param {PointerEvent | MouseEvent} e @param {Anchor | null} refDataPoint @param {Tool | undefined} tool @returns {Anchor} */
  _anchorData(e, refDataPoint, tool) {
    const a = this._anchorXY(e, refDataPoint, tool);
    const d = toData(this.pane, a.x, a.y, this.engine.series);
    // the magnet carries the EXACT OHLC price it snapped to -- use it directly rather than the pixel
    // round-trip (a.y -> yToPrice), which floors to an integer pixel and lands a tick or two off at
    // forex zoom. Then the tick-snap below is a no-op on it (OHLC values are already on the grid).
    if (a.price != null) d.price = a.price;
    const angle = e.shiftKey && tool && tool.shiftConstrain === 'angle' && refDataPoint;
    if (angle || (tool && tool.snapToBar === false)) return d;
    const t = this._nearestBarTime(a.x);
    return { time: t == null ? d.time : t, price: this._snapPrice(d.price) };
  },
  // Snap a price to the instrument's tick grid (e.g. 0.25 for ES) so a drawing's stored coordinate IS
  // a valid price -- clicking it reads that exact tick, and its label shows it. No-op when the tick is
  // unknown. Magnet OHLC is already tick-aligned, so re-snapping it is a no-op; the free cursor snaps.
  /** @this {Ix} @param {number | null} price @returns {number | null} */
  _snapPrice(price) {
    const tick = this.pane.tickSize;
    if (!tick || !(tick > 0) || price == null) return price;
    const dec = this.pane.priceDecimals != null ? this.pane.priceDecimals : 2;
    return Number((Math.round(price / tick) * tick).toFixed(dec));   // clean float drift to the instrument's decimals
  },
  // exact time of the bar nearest screen x, snapped in index space; null in the whitespace past the data
  // (leave those free so drawings can still extend into the future / before the first bar).
  /** @this {Ix} @param {number} x @returns {number | null} */
  _nearestBarTime(x) {
    const times = this.pane.barTimes;
    if (!times || !times.length) return null;
    const l = this.pane.chart.timeAxis().xToBar(x);
    if (l == null) return null;
    const idx = Math.round(l);
    if (idx < 0 || idx >= times.length) return null;
    return times[idx];
  },
};
