// @ts-check

/** The author's Crosshair render class: draws the cross over the active grid, reading the shared
 * cursor + resolved colors off the component surrogate's `$props`. */
export default class Crosshair {
  /** @param {import('../../types.js').Comp} comp */
  constructor(comp) {
    this.comp = comp;
    this.$p = comp.$props;
    this.data = this.$p.sub;
    this._visible = false;
    this.locked = false;
    this.layout = this.$p.layout;
  }

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    // Update reference to the grid
    this.layout = this.$p.layout;

    const cursor = /** @type {any} */ (this.comp.$props.cursor);
    if (!this.visible && cursor.mode === 'explore') return;

    this.x = /** @type {number} */ (this.$p.cursor.x);
    this.y = /** @type {number} */ (this.$p.cursor.y);

    ctx.save();
    ctx.strokeStyle = /** @type {string} */ (this.$p.colors.cross);
    ctx.lineWidth = this.$p.colors.crossWidth || 1;
    ctx.beginPath();
    ctx.setLineDash(this.$p.colors.crossDash || [5]);

    // H
    if (this.$p.cursor.grid_id === this.layout.id) {
      ctx.moveTo(0, this.y);
      ctx.lineTo(this.layout.width - 0.5, this.y);
    }

    // V
    ctx.moveTo(this.x, 0);
    ctx.lineTo(this.x, this.layout.height);
    ctx.stroke();
    ctx.restore();
  }

  hide() {
    this.visible = false;
    this.x = undefined;
    this.y = undefined;
  }

  get visible() {
    return this._visible;
  }

  set visible(val) {
    this._visible = val;
  }
}
