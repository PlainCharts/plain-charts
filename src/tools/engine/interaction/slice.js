// @ts-check
// Slice gesture (part of the Interaction class, split out as a prototype mixin). A guide circle
// glides along a line; a click cuts it, replacing the line with a Trend Line from the old start to
// the slice point -- carrying the source's style, price label AND text/label. These methods run with
// `this` bound to the Interaction instance (attached via Object.assign in interaction.js).
import { bus } from '../../../bus.js';
import { toData, toScreen } from '../geometry.js';

/** @typedef {import('../interaction.js').Interaction} Ix   the `this` for every method here */
/** @typedef {import('../interaction.js').Drawing} Drawing */
/** @typedef {import('../interaction.js').Anchor} Anchor */

export const sliceMethods = {
  // ---- Slice: a guide circle glides along a line; click cuts it, replacing it with a Trend Line from the
  // old start to the slice point -- carrying the source's style, price label AND text/label. ----
  /** @this {Ix} @param {string} id */
  startSlice(id) {
    const d = this.engine.get(id);
    if (!d || !d.points || d.points.length < 1) return;
    this.mode = 'slicing';
    this.slicing = { id };
    this._enable('crosshair');
    this.engine.requestUpdate();
  },
  /** @this {Ix} @param {Drawing} d @param {number} t @returns {number} */
  _linePriceAt(d, t) {
    if (d.points.length < 2) return /** @type {number} */ (d.points[0].price); // pure ray (one point) = horizontal
    const A = d.points[0],
      B = d.points[1];
    const at = /** @type {number} */ (A.time),
      bt = /** @type {number} */ (B.time),
      ap = /** @type {number} */ (A.price),
      bp = /** @type {number} */ (B.price);
    const dt = bt - at;
    return dt !== 0 ? ap + ((bp - ap) * (t - at)) / dt : ap;
  },
  /** @this {Ix} @param {PointerEvent | MouseEvent} e @returns {Anchor | null} */
  _slicePoint(e) {
    const d = this.engine.get(/** @type {{ id: string }} */ (this.slicing).id);
    if (!d) return null;
    const { x, y } = this._localXY(e);
    const data = toData(this.pane, x, y, this.engine.series); // candle time under the cursor
    if (data.time == null) return null;
    return { time: data.time, price: this._linePriceAt(d, data.time) }; // point on the line at that candle
  },
  /** @this {Ix} @param {PointerEvent | MouseEvent} e */
  _updateSliceGuide(e) {
    const sp = this._slicePoint(e);
    if (!sp) return;
    this.engine.sliceGuide = toScreen(
      this.pane,
      /** @type {{ time: number, price: number }} */ (sp),
      this.engine.series,
    );
    this.pane.setCrosshair(sp.time, sp.price, this.engine.series);
    bus.emit('crosshair', { source: this.pane, time: sp.time, price: sp.price }); // keep sync alive during the slice gesture
    this.engine.requestUpdate();
  },
  /** @this {Ix} @param {PointerEvent | MouseEvent} e */
  _commitSlice(e) {
    const d = this.engine.get(/** @type {{ id: string }} */ (this.slicing).id);
    const sp = this._slicePoint(e);
    if (d && sp) {
      const start = { ...d.points[0] },
        s = d.style || {},
        sync = d.sync;
      this.engine.removeDrawing(/** @type {{ id: string }} */ (this.slicing).id);
      // becomes a TREND LINE (the general 2-point line; a Level Line is just a trend line with a horizontal
      // auto-placement the slice doesn't use). Finite segment (extend:none), source style + label preserved.
      /** @type {Record<string, any>} */
      const params = {
        points: [start, sp],
        style: {
          color: s.color || '#2962ff',
          width: s.width || 2,
          lineStyle: s.lineStyle || 'solid',
          priceLabels: !!s.priceLabels,
          extend: 'none',
          arrows: s.arrows || 'none',
          midPoint: !!s.midPoint,
        },
        z: this.engine.nextZ(),
        sync,
      };
      if (d.text != null) params.text = d.text; // carry end-of-line text through the slice
      if (d.textStyle) params.textStyle = { ...d.textStyle };
      if (d.name != null) params.name = d.name;
      const nd = this.engine.add('trendline', params);
      this.engine.select(nd.id);
    }
    this._endSlice();
  },
  /** @this {Ix} */
  _endSlice() {
    this.engine.sliceGuide = null;
    this.mode = 'idle';
    this.slicing = null;
    this.pane.clearCrosshair();
    this._disable();
    this.engine.requestUpdate();
  },
};
