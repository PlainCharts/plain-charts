// @ts-check
// Grid: the pane's background painter — grid lines, shader pass, overlay z-stack,
// crosshair layer. Interaction lives in the engine shell (core/components/input.js);
// the Vue/hammer-era event half of the author's class was removed as dead code.

// Grid is good.
export default class Grid {
  /**
   * @param {HTMLCanvasElement} canvas  the grid's own canvas
   * @param {import('../../types.js').Comp} comp  the render-input surrogate ($props)
   */
  constructor(canvas, comp) {
    this.canvas = canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    this.$p = comp.$props;
    this.data = this.$p.sub;
    this.range = this.$p.range;
    this.id = this.$p.grid_id;
    this.layout = this.$p.layout.grids[this.id];
    this.interval = this.$p.interval;
    this.cursor = comp.$props.cursor;
    /** @type {any[]} written by the engine shell (overlay z-stack) */
    this.overlays = [];
    /** @type {any} crosshair layer, written by the engine shell */
    this.crosshair = null;
  }

  update() {
    // Update reference to the grid
    // TODO: check what happens if data changes interval
    this.layout = this.$p.layout.grids[this.id];
    this.interval = this.$p.interval;

    if (!this.layout) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.$p.shaders.length) this.apply_shaders();

    this.grid();

    let overlays = [];
    overlays.push(...this.overlays);

    // z-index sorting
    overlays.sort((l1, l2) => l1.z - l2.z);

    overlays.forEach((l) => {
      if (!l.display) return;
      this.ctx.save();
      let r = l.renderer;
      if (r.pre_draw) r.pre_draw(this.ctx);
      r.draw(this.ctx);
      if (r.post_draw) r.post_draw(this.ctx);
      this.ctx.restore();
    });

    if (this.crosshair) {
      this.crosshair.renderer.draw(this.ctx);
    }
  }

  apply_shaders() {
    let layout = this.$p.layout.grids[this.id];
    let props = {
      layout: layout,
      range: this.range,
      interval: this.interval,
      tf: layout.ti_map.tf,
      cursor: this.cursor,
      colors: this.$p.colors,
      sub: this.data,
      font: this.$p.font,
      config: this.$p.config,
      meta: this.$p.meta,
    };
    for (var s of this.$p.shaders) {
      this.ctx.save();
      s.draw(this.ctx, props);
      this.ctx.restore();
    }
  }

  // Actually draws the grid (for real). Vertical and horizontal are drawn in separate
  // passes so each can use its own color (colorsGridVert / colorsGridHorz, fallback to
  // colors.grid) -> the engine hides a direction by passing a transparent color for it.
  grid() {
    const ymax = this.layout.height;

    // vertical lines
    this.ctx.strokeStyle = /** @type {string} */ (this.$p.colors.gridVert || this.$p.colors.grid);
    this.ctx.setLineDash(this.$p.colors.gridDashVert || []);
    this.ctx.beginPath();
    for (var [x, p] of this.layout.xs) {
      this.ctx.moveTo(x - 0.5, 0);
      this.ctx.lineTo(x - 0.5, ymax);
    }
    this.ctx.stroke();

    // horizontal lines
    this.ctx.strokeStyle = /** @type {string} */ (this.$p.colors.gridHorz || this.$p.colors.grid);
    this.ctx.setLineDash(this.$p.colors.gridDashHorz || []);
    this.ctx.beginPath();
    for (var [y, y$] of this.layout.ys) {
      this.ctx.moveTo(0, y - 0.5);
      this.ctx.lineTo(this.layout.width, y - 0.5);
    }
    this.ctx.stroke();

    this.ctx.setLineDash([]); // reset so candles/wicks/etc. aren't dashed

    if (this.$p.grid_id) this.upper_border();
  }

  upper_border() {
    this.ctx.strokeStyle = /** @type {string} */ (this.$p.colors.scale);
    this.ctx.beginPath();
    this.ctx.moveTo(0, 0.5);
    this.ctx.lineTo(this.layout.width, 0.5);
    this.ctx.stroke();
  }
}
