// @ts-check
// Calculates all necessary s*it to build the chart
// Heights, widths, transforms, ... = everything
// Why such a mess you ask? Well, that's because
// one components size can depend on other component
// data formatting (e.g. grid width depends on sidebar precision)
// So it's better to calc all in one place.

import GridMaker from './grid_maker.js';
import Utils from '../../stuff/utils.js';
import math from '../../stuff/math.js';
import log_scale from './log_scale.js';

/**
 * Builds the full frame layout: splits the height between the main grid and the offchart grids, runs
 * a GridMaker per grid, syncs the shared sidebar width, then attaches candle geometry. `params` is the
 * author's intricate build ctx (chart/sub/offsub/interval/range/ctx/ti_map/$props/y_transforms/...),
 * typed `any` at this boundary; the fields are destructured below.
 * @param {any} params
 * @returns {{ grids: import('../../types.js').GridLayout[], botbar: { width: number, height: number, offset: number, xs: any[] } }}
 */
function Layout(params) {
  let { chart, sub, offsub, interval, range, ctx, layers_meta, ti_map, $props: $p, y_transforms: y_ts } = params;

  let mgrid = chart.grid || {};

  offsub = offsub.filter((/** @type {any} */ x, /** @type {number} */ i) => {
    // Skip offchart overlays with custom grid id,
    // because they will be mergred with the existing grids
    return !(x.grid && x.grid.id);
  });

  // Splits space between main chart
  // and offchart indicator grids
  function grid_hs() {
    const height = $p.height - $p.config.BOTBAR;

    // When at least one height defined (default = 1),
    // Pxs calculated as: (sum of weights) / number
    if (mgrid.height || offsub.find((/** @type {any} */ x) => x.grid.height)) {
      return weighted_hs(mgrid, height);
    }

    const n = offsub.length;
    const off_h = (2 * Math.sqrt(n)) / 7 / (n || 1);

    // Offchart grid height
    const px = Math.floor(height * off_h);

    // Main grid height
    const m = height - px * n;
    return [m].concat(Array(n).fill(px));
  }

  /**
   * @param {any} grid
   * @param {number} height
   */
  function weighted_hs(grid, height) {
    let hs = [{ grid }, ...offsub].map((/** @type {any} */ x) => x.grid.height || 1);
    let sum = hs.reduce((a, b) => a + b, 0);
    hs = hs.map((x) => Math.floor((x / sum) * height));

    // Refine the height if Math.floor decreased px sum
    sum = hs.reduce((a, b) => a + b, 0);
    for (var i = 0; i < height - sum; i++) hs[i % hs.length]++;
    return hs;
  }

  // candle bar geometry only. (Volume is no longer baked in — it's a study on an overlay price
  // scale; the layout's old self.volume computation was removed with the baked-in Volbar.)
  function candles_layout() {
    self.candles = [];

    for (var i = 0; i < sub.length; i++) {
      let p = sub[i];
      // future whitespace point (app-supplied, no OHLC): it owns a time-axis slot so i2t/t2i stay
      // gapless, but paints no candle -- skip it so it never becomes a NaN body.
      if (p[1] == null) continue;
      let mid = self.t2screen(p[0]) + 0.5;
      self.candles.push(
        mgrid.logScale
          ? log_scale.candle(self, mid, p, $p)
          : {
              x: mid,
              w: self.px_step * $p.config.CANDLEW,
              o: Math.floor(p[1] * self.A + self.B),
              h: Math.floor(p[2] * self.A + self.B),
              l: Math.floor(p[3] * self.A + self.B),
              c: Math.floor(p[4] * self.A + self.B),
              raw: p,
            },
      );
    }
  }

  // Main grid
  const hs = grid_hs();
  let specs = {
    sub,
    interval,
    range,
    ctx,
    $p,
    layers_meta,
    ti_map,
    height: hs[0],
    y_t: y_ts[0],
    grid: mgrid,
    timezone: $p.timezone,
  };
  let gms = [new /** @type {any} */ (GridMaker)(0, specs)];

  // Sub grids
  for (var [i, { data, grid }] of offsub.entries()) {
    specs.sub = data;
    specs.height = hs[i + 1];
    specs.y_t = y_ts[i + 1];
    specs.grid = grid || {};
    gms.push(new /** @type {any} */ (GridMaker)(i + 1, specs, gms[0].get_layout()));
  }

  // Max sidebar among all grinds
  let sb = Math.max(...gms.map((x) => x.get_sidebar()));

  let grids = [],
    offset = 0;

  for (i = 0; i < gms.length; i++) {
    gms[i].set_sidebar(sb);
    grids.push(gms[i].create());
    grids[i].id = i;
    grids[i].offset = offset;
    offset += grids[i].height;
  }

  let self = grids[0];

  candles_layout();

  return {
    grids: grids,
    botbar: {
      width: $p.width,
      height: $p.config.BOTBAR,
      offset: offset,
      xs: grids[0] ? grids[0].xs : [],
    },
  };
}

export default Layout;
