// @ts-check
// Sidebar: the pane's price-axis (Y-axis) painter — scale line, tick labels, shader
// pass, cursor price panel. The Y drag-zoom interaction lives in the engine shell
// (core/components/input.js, transcribed from the author's calc_zoom/calc_range);
// the Vue/hammer-era event half of the author's class was removed as dead code.
import { fmtTickPrice } from '../../price-fmt.js';

/** @type {number} */
var PANHEIGHT;

export default class Sidebar {
  /**
   * The author's price-axis (Y-axis) render class.
   * @param {HTMLCanvasElement} canvas
   * @param {import('../../types.js').Comp} comp  the Vue-surrogate component
   * @param {'left'|'right'} [side]
   */
  constructor(canvas, comp, side = 'right') {
    PANHEIGHT = comp.config.PANHEIGHT;

    this.canvas = canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    this.$p = comp.$props;
    this.id = this.$p.grid_id;
    /** @type {any} the author's built grid/layout object (open-shaped: ys, sb, y_format, grid, A/B, ...) */
    this.layout = this.$p.layout.grids[this.id];

    this.side = side;
  }

  // Format a price for a scale label: percentage/indexed panes keep their y_format; otherwise the
  // value is quantized to the instrument tick grid (main scale only) with the instrument decimals.
  /**
   * @param {number} v  price value
   * @returns {string}
   */
  _fmt(v) {
    const L = this.layout;
    if (L.y_format) return L.y_format(v);
    const prec = L.minMove > 0 && L.tickPrec != null ? L.tickPrec : L.prec;
    return fmtTickPrice(v, L.minMove, prec);
  }

  update() {
    // Update reference to the grid
    this.layout = this.$p.layout.grids[this.id];

    var points = this.layout.ys;
    var x,
      y,
      w,
      h,
      side = this.side;
    var sb = this.layout.sb;

    //this.ctx.fillStyle = this.$p.colors.back
    this.ctx.font = this.$p.font;

    switch (side) {
      case 'left':
        x = 0;
        y = 0;
        w = Math.floor(sb);
        h = this.layout.height;

        //this.ctx.fillRect(x, y, w, h)
        this.ctx.clearRect(x, y, w, h);

        this.ctx.strokeStyle = /** @type {string} */ (this.$p.colors.scale);

        this.ctx.beginPath();
        this.ctx.moveTo(x + 0.5, 0);
        this.ctx.lineTo(x + 0.5, h);
        this.ctx.stroke();

        break;
      case 'right':
        x = 0;
        y = 0;
        w = Math.floor(sb);
        h = this.layout.height;
        //this.ctx.fillRect(x, y, w, h)
        this.ctx.clearRect(x, y, w, h);

        this.ctx.strokeStyle = /** @type {string} */ (this.$p.colors.scale);

        this.ctx.beginPath();
        this.ctx.moveTo(x + 0.5, 0);
        this.ctx.lineTo(x + 0.5, h);
        this.ctx.stroke();
        break;
    }

    this.ctx.fillStyle = /** @type {string} */ (this.$p.colors.text);
    this.ctx.beginPath();

    for (var p of points) {
      if (p[0] > this.layout.height) continue;

      var x1 = side === 'left' ? w - 0.5 : x - 0.5;
      var x2 = side === 'left' ? x1 - 4.5 : x1 + 4.5;

      this.ctx.moveTo(x1, p[0] - 0.5);
      this.ctx.lineTo(x2, p[0] - 0.5);

      var offst = side === 'left' ? -10 : 10;
      this.ctx.textAlign = side === 'left' ? 'end' : 'start';
      this.ctx.fillText(this._fmt(p[1]), x1 + offst, p[0] + 4);
    }

    this.ctx.stroke();

    if (this.$p.grid_id) this.upper_border();

    this.apply_shaders();

    if (this.$p.cursor.y && this.$p.cursor.y$) this.panel();
  }

  apply_shaders() {
    let layout = this.$p.layout.grids[this.id];
    let props = {
      layout: layout,
      cursor: this.$p.cursor,
    };
    for (var s of this.$p.shaders) {
      this.ctx.save();
      s.draw(this.ctx, props);
      this.ctx.restore();
    }
  }

  upper_border() {
    this.ctx.strokeStyle = /** @type {string} */ (this.$p.colors.scale);
    this.ctx.beginPath();
    this.ctx.moveTo(0, 0.5);
    this.ctx.lineTo(this.layout.width, 0.5);
    this.ctx.stroke();
  }

  // A gray bar behind the current price
  panel() {
    if (this.$p.cursor.grid_id !== this.layout.id) {
      return;
    }

    let lbl = this._fmt(/** @type {number} */ (this.$p.cursor.y$));
    this.ctx.fillStyle = /** @type {string} */ (this.$p.colors.panel);

    let panwidth = this.layout.sb + 1;

    let x = -0.5;
    let y = /** @type {number} */ (this.$p.cursor.y) - PANHEIGHT * 0.5 - 0.5;
    let a = 7;
    this.ctx.fillRect(x - 0.5, y, panwidth, PANHEIGHT);
    this.ctx.fillStyle = /** @type {string} */ (this.$p.colors.textHL);
    this.ctx.textAlign = 'left';
    this.ctx.fillText(lbl, a, y + 15);
  }
}
