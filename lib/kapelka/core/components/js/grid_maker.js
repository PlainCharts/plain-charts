// @ts-check
import math from '../../stuff/math.js';

import layout_fn from './layout_fn.js';
import log_scale from './log_scale.js';
import { createGridX } from './grid-x.js';
import { createGridY } from './grid-y.js';

// Min horizontal gap (px) between two axis labels before the lower-rank one is dropped. Enough for an
// "HH:MM" label + padding, so normal (t_step-spaced) labels never collide, but a gap-adjacent boundary
// tick stays visible whenever there is screen room for it.
const MIN_LABEL_PX = 48;

// master_grid - ref to the master grid
/**
 * The author's grid-geometry builder for one pane. Given a pane index, the pane's build `params`
 * (the Layout `specs` surrogate) and the master grid's layout (sub-grids borrow its timeline), it
 * measures the sidebar and returns a builder whose `create()` computes the full grid layout.
 *
 * BOUNDARY `any` on `params` and `master_grid`: `params` is the intricate, dynamically-shaped Layout
 * `specs` bag (sub/range/ctx/$p/layers_meta/ti_map/grid/y_t/timezone/height/interval) and `master_grid`
 * is a peer GridMaker's `self` layout object -- both owned by layout.js, too rich to pin here.
 * @param {number} id
 * @param {any} params
 * @param {any} [master_grid]
 */
function GridMaker(id, params, master_grid = null) {
  let { sub, interval, range, ctx, $p, layers_meta, height, y_t, ti_map, grid, timezone, dayRoll } = params;

  // min gap (px) before two time labels collide -- app-configurable via config.MIN_LABEL_PX (Time scale
  // settings); falls back to the module default.
  const minLabelPx = ($p && $p.config && $p.config.MIN_LABEL_PX) || MIN_LABEL_PX;
  // self accumulates the pane's computed layout dynamically (dozens of fields: $_hi/$_lo, A/B, xs/ys,
  // sb, prec, ...). Typed `any` -- it is the author's open output bag, grown field-by-field below.
  /** @type {any} */
  var self = { ti_map };
  // instrument tick grid for this pane's price labels (main grid only; sub-grids pass no minMove, so
  // study/percentage scales stay free). Read by the sidebar + axis-label formatters.
  self.minMove = grid.minMove || 0;
  self.tickPrec = grid.tickPrec;
  var lm = layers_meta[id];
  /** @type {any} */
  var y_range_fn = null;
  var ls = grid.logScale;

  // Price-scale margins: fraction of the pane height left EMPTY at top/bottom, so
  // the AUTO-FIT data range fills only the middle region [top*H .. (1-bottom)*H]. When set, they REPLACE
  // the default EXPAND padding (they are the padding). mt=mb=0 -> full height (unchanged).
  // A HAND-ZOOMED (manual) price range fills the pane edge-to-edge, exactly as the user dragged it —
  // margins are auto-fit padding only, so a manual scale is never re-shrunk.
  var manualY = !!(y_t && !y_t.auto && y_t.range);
  var mt = manualY ? 0 : grid.marginTop || 0,
    mb = manualY ? 0 : grid.marginBottom || 0;
  var hasMargins = !manualY && (grid.marginTop != null || grid.marginBottom != null);

  // Percentage / Indexed-to-100 scale (price-scale mode 2/3). Both are an AFFINE relabel of the
  // linear price axis, rebased to the first visible value: the candle geometry, A/B and $2screen
  // stay in PRICE space (unchanged from Regular mode) — only the Y gridlines and their labels switch
  // to % (0% = base) or index (100 = base) units. base = first visible primary value (candle close
  // on the main grid, first series value on an offchart). Falls back to Regular if base <= 0.
  var sm = grid.scaleMode || 0;
  // base: first visible primary value the %/index axis is rebased to (null until validated > 0).
  // Typed `any` so the toDisp/fromDisp closures below divide by it without a null-narrowing guard --
  // they only ever run when `pct` (base != null) is true.
  /** @type {any} */
  var base = null;
  if ((sm === 2 || sm === 3) && sub && sub.length) {
    let b = master_grid ? sub[0][1] : sub[0][4] != null ? sub[0][4] : sub[0][1];
    if (b > 0) base = b;
  }
  const pct = base != null; // percentage/indexed active (and base valid)
  const idx = sm === 3; // indexed-to-100 (vs percentage)
  /** @type {(p: number) => number} */
  const toDisp = idx ? (p) => (p / base) * 100 : (p) => (p / base - 1) * 100;
  /** @type {(v: number) => number} */
  const fromDisp = idx ? (v) => (v / 100) * base : (v) => (v / 100 + 1) * base;
  /** @type {(p: number) => string} */
  const fmtDisp = (p) => {
    let v = toDisp(p),
      d = self.disp_prec != null ? self.disp_prec : 2;
    return idx ? v.toFixed(d) : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
  };
  self.disp_prec = 2;

  if (lm && Object.keys(lm).length) {
    // Gets last y_range fn()
    let yrs = Object.values(lm).filter((x) => x.y_range);
    // The first y_range() determines the range
    if (yrs.length) y_range_fn = yrs[0].y_range;
  }

  // The x-axis (time) and y-axis (price) tick families live in their own modules. They share
  // THIS build's mutable state through `G` -- same `self` output bag + params -- so every tick
  // they compute lands on the object the core orchestrator returns. See grid-x.js / grid-y.js.
  /** @type {any} */
  const G = {
    self,
    sub,
    interval,
    range,
    $p,
    height,
    ti_map,
    timezone,
    dayRoll,
    master_grid,
    minLabelPx,
    toDisp,
    fromDisp,
  };
  const gx = createGridX(G);
  const gy = createGridY(G);

  // Calc vertical ($/₿) range
  function calc_$range() {
    if (!master_grid) {
      // Scan the data for hi/lo FIRST — candlestick high/low, or generic values for a non-candle
      // main series (a chart-less study owning pane 0) — THEN let a study `scale` fn shape it. This
      // is the same order offchart panes use, so a scale provider always receives a valid data
      // range (calling it with the uninitialized hi/lo blanked the pane -> NaN).
      ((hi = -Infinity), (lo = Infinity));
      if (sub.length && sub[0].length >= 5) {
        // candlestick main series: high/low. Skip future whitespace rows (null OHLC) -- in JS
        // `null < lo` coerces to `0 < lo` (true for positive prices), so an unskipped null would
        // drag the low toward zero and blow up the auto-scale range.
        for (var i = 0, n = sub.length; i < n; i++) {
          let x = sub[i];
          if (x[2] == null || x[3] == null) continue;
          if (x[2] > hi) hi = x[2];
          if (x[3] < lo) lo = x[3];
        }
      } else {
        // non-candle main series (Line/histogram): scan all values, like an offchart range
        for (var i = 0, n = sub.length; i < n; i++) {
          let x = sub[i];
          for (var j = 1; j < x.length; j++) {
            let v = x[j];
            if (v == null) continue;
            if (v > hi) hi = v;
            if (v < lo) lo = v;
          }
        }
      }
      if (y_range_fn) {
        var [hi, lo, exp] = /** @type {[number, number, any]} */ (y_range_fn(hi, lo));
      }
    } else {
      // Offchart indicator range
      ((hi = -Infinity), (lo = Infinity));
      for (var i = 0; i < sub.length; i++) {
        for (var j = 1; j < sub[i].length; j++) {
          let v = sub[i][j];
          if (v > hi) hi = v;
          if (v < lo) lo = v;
        }
      }
      if (y_range_fn) {
        var [hi, lo, exp] = /** @type {[number, number, any]} */ (y_range_fn(hi, lo));
      }
    }

    // Fixed y-range in non-auto mode
    if (y_t && !y_t.auto && y_t.range) {
      self.$_hi = y_t.range[0];
      self.$_lo = y_t.range[1];
    } else {
      if (!ls) {
        // margins provide the padding, so drop EXPAND when they're set (else double-padded)
        exp = exp === false || hasMargins ? 0 : 1;
        self.$_hi = hi + (hi - lo) * $p.config.EXPAND * exp;
        self.$_lo = lo - (hi - lo) * $p.config.EXPAND * exp;
      } else {
        self.$_hi = hi;
        self.$_lo = lo;
        log_scale.expand(self, height);
      }

      if (self.$_hi === self.$_lo) {
        if (!ls) {
          self.$_hi *= 1.05; // Expand if height range === 0
          self.$_lo *= 0.95;
        } else {
          log_scale.expand(self, height);
        }
      }
    }
  }

  function calc_sidebar() {
    if (sub.length < 2) {
      self.prec = 0;
      self.sb = $p.config.SBMIN;
      return;
    }

    // TODO: improve sidebar width calculation
    // at transition point, when one precision is
    // replaced with another

    // Gets formated levels (their lengths),
    // calculates max and measures the sidebar length
    // from it:

    // TODO: add custom formatter f()

    self.prec = gy.calc_precision(sub);
    let lens = [];
    if (pct) {
      lens.push(fmtDisp(self.$_hi).length);
      lens.push(fmtDisp(self.$_lo).length);
    } else {
      lens.push(self.$_hi.toFixed(self.prec).length);
      lens.push(self.$_lo.toFixed(self.prec).length);
    }
    let str = '0'.repeat(Math.max(...lens)) + '    ';
    self.sb = ctx.measureText(str).width;
    self.sb = Math.max(Math.floor(self.sb), $p.config.SBMIN);
    self.sb = Math.min(self.sb, $p.config.SBMAX);
  }

  function calc_positions() {
    if (sub.length < 2) return;

    let dt = range[1] - range[0];

    // A pixel space available to draw on (x-axis)
    self.spacex = $p.width - self.sb;

    // Candle capacity
    let capacity = dt / interval;
    self.px_step = self.spacex / capacity;

    // px / time ratio
    let r = self.spacex / dt;
    self.startx = (sub[0][0] - range[0]) * r;

    // Candle Y-transform: (A = scale, B = shift). Data maps into the margin region [rTop .. rTop+rH]
    // instead of [0 .. height]: $_hi -> rTop (top margin from the top), $_lo -> rTop+rH. mt=mb=0 ->
    // rTop=0, rH=height -> the original full-height mapping (candles/ys/$2screen all follow A/B).
    var rTop = mt * height,
      rH = height * (1 - mt - mb) || height;
    if (!grid.logScale) {
      self.A = -rH / (self.$_hi - self.$_lo);
      self.B = rTop - self.$_hi * self.A;
    } else {
      self.A = -rH / (math.log(self.$_hi) - math.log(self.$_lo));
      self.B = rTop - math.log(self.$_hi) * self.A;
    }
  }

  function apply_sizes() {
    self.width = $p.width - self.sb;
    self.height = height;
  }

  calc_$range();
  calc_sidebar();

  return {
    // First we need to calculate max sidebar width
    // (among all grids). Then we can actually make
    // them
    create: () => {
      calc_positions();
      gx.grid_x();
      if (grid.logScale) {
        gy.grid_y_log();
      } else if (pct) {
        gy.grid_y_pct();
      } else {
        gy.grid_y();
      }
      // percentage/indexed axis: labels are display units (rebased to `base`), formatted here so
      // the sidebar + cursor panel render "+5.00%" / "103.50" instead of the raw price.
      self.y_format = pct ? fmtDisp : null;
      apply_sizes();

      // Link to the master grid (candlesticks)
      if (master_grid) {
        self.master_grid = master_grid;
      }

      self.grid = grid; // Grid params

      // Here we add some helpful functions for
      // plugin creators
      return layout_fn(self, range);
    },
    get_layout: () => self,
    /** @param {number} v */
    set_sidebar: (v) => (self.sb = v),
    get_sidebar: () => self.sb,
  };
}

export default GridMaker;
