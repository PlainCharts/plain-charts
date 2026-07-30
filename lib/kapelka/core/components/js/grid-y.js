// @ts-check
import Const from '../../stuff/constants.js';
import Utils from '../../stuff/utils.js';
import math from '../../stuff/math.js';

const { $SCALES } = Const;
const MAX_INT = Number.MAX_SAFE_INTEGER;

// Y-axis (price) tick family, extracted verbatim from grid_maker.js. Given the shared
// grid-build context `G` (the same `self` output bag plus the pane's params), it computes the
// horizontal gridline / price-label positions for the three axis modes -- linear (`grid_y`),
// percentage/indexed (`grid_y_pct`) and log (`grid_y_log`) -- plus the price-precision helper
// the sidebar sizing reads (`calc_precision`). All state is read/written through the
// destructured references, so the caller sees the same mutated `self` layout object.
/**
 * @param {any} G  shared grid-maker context: { self, sub, $p, height, toDisp, fromDisp }
 */
export function createGridY(G) {
  const { self, sub, $p, height, toDisp, fromDisp } = G;

  // Calculate $ precision for the Y-axis
  /** @param {import('../../types.js').Row[]} data */
  function calc_precision(data) {
    var max_r = 0,
      max_l = 0;

    let min = Infinity;
    let max = -Infinity;

    // Speed UP
    for (var i = 0, n = data.length; i < n; i++) {
      let x = data[i];
      if (x[1] > max) max = x[1];
      else if (x[1] < min) min = x[1];
    }
    // Get max lengths of integer and fractional parts
    [min, max].forEach((x) => {
      // Fix undefined bug
      var str = x != null ? x.toString() : '';
      if (x < 0.000001) {
        // Parsing the exponential form. Gosh this
        // smells trickily
        var [ls, rs] = str.split('e-');
        var [l, r] = ls.split('.');
        if (!r) r = '';
        // AUTHOR QUIRK (not a bug): `r` starts as a string (a split part) but here is reassigned
        // to a bare { length } stand-in -- only `.length` is read afterward, so it works. Cast to
        // any so the string var can hold the object without a type clash.
        r = /** @type {any} */ ({ length: r.length + parseInt(rs) || 0 });
      } else {
        var [l, r] = str.split('.');
      }
      if (r && r.length > max_r) {
        max_r = r.length;
      }
      if (l && l.length > max_l) {
        max_l = l.length;
      }
    });

    // Select precision scheme depending
    // on the left and right part lengths
    //
    let even = max_r - (max_r % 2) + 2;

    if (max_l === 1) {
      return Math.min(8, Math.max(2, even));
    }
    if (max_l <= 2) {
      return Math.min(4, Math.max(2, even));
    }

    return 2;
  }

  // Select nearest good-loking $ step (m is target scale)
  function dollar_step() {
    let yrange = self.$_hi - self.$_lo;
    let m = yrange * ($p.config.GRIDY / height);
    let p = parseInt(yrange.toExponential().split('e')[1]);
    let d = Math.pow(10, p);
    let s = $SCALES.map((x) => x * d);

    // TODO: center the range (look at RSI for example,
    // it looks ugly when "80" is near the top)
    // nearest_a null only for an empty array; `s` is $SCALES*d (non-empty) -> number.
    return Utils.strip(/** @type {number} */ (Utils.nearest_a(m, s)[1]));
  }

  function dollar_mult() {
    let mult_hi = dollar_mult_hi();
    let mult_lo = dollar_mult_lo();
    return Math.max(mult_hi, mult_lo);
  }

  // Price step multiplier (for the log-scale mode)
  function dollar_mult_hi() {
    let h = Math.min(self.B, height);
    if (h < $p.config.GRIDY) return 1;
    let n = h / $p.config.GRIDY; // target grid N
    let yrange = self.$_hi;
    if (self.$_lo > 0) {
      var yratio = self.$_hi / self.$_lo;
    } else {
      yratio = self.$_hi / 1; // TODO: small values
    }
    let m = yrange * ($p.config.GRIDY / h);
    let p = parseInt(yrange.toExponential().split('e')[1]);
    return Math.pow(yratio, 1 / n);
  }

  function dollar_mult_lo() {
    let h = Math.min(height - self.B, height);
    if (h < $p.config.GRIDY) return 1;
    let n = h / $p.config.GRIDY; // target grid N
    let yrange = Math.abs(self.$_lo);
    if (self.$_hi < 0 && self.$_lo < 0) {
      var yratio = Math.abs(self.$_lo / self.$_hi);
    } else {
      yratio = Math.abs(self.$_lo) / 1;
    }
    let m = yrange * ($p.config.GRIDY / h);
    let p = parseInt(yrange.toExponential().split('e')[1]);
    return Math.pow(yratio, 1 / n);
  }

  function grid_y() {
    // Prevent duplicate levels
    let m = Math.pow(10, -self.prec);
    self.$_step = Math.max(m, dollar_step());
    self.ys = [];

    let y1 = self.$_lo - (self.$_lo % self.$_step);

    for (var y$ = y1; y$ <= self.$_hi; y$ += self.$_step) {
      let y = Math.floor(y$ * self.A + self.B);
      if (y > height) continue;
      self.ys.push([y, Utils.strip(y$)]);
    }
  }

  // Percentage / Indexed-to-100 gridlines: pick a nice step in DISPLAY units (% or index), then
  // map each level back to price for its pixel via the normal linear A/B. Same nice-step logic as
  // dollar_step(), just run in display space so the axis reads +5.00% / +10.00% (not raw prices).
  function grid_y_pct() {
    self.ys = [];
    let dHi = toDisp(self.$_hi),
      dLo = toDisp(self.$_lo);
    if (dHi < dLo) {
      let t = dHi;
      dHi = dLo;
      dLo = t;
    } // base>0 keeps order, but be safe
    let yrange = dHi - dLo;
    if (!(yrange > 0)) return;
    let m = yrange * ($p.config.GRIDY / height);
    let p = parseInt(yrange.toExponential().split('e')[1]);
    let d = Math.pow(10, p);
    let s = $SCALES.map((x) => x * d);
    // nearest_a null only for an empty array; `s` is $SCALES*d (non-empty) -> number.
    let step = Utils.strip(/** @type {number} */ (Utils.nearest_a(m, s)[1]));
    if (!(step > 0)) return;
    // decimals needed to render the step exactly (so a 2.5% step reads "2.5%", not a rounded "3%")
    let ss = step.toString(),
      dot = ss.indexOf('.');
    self.disp_prec = dot < 0 ? 0 : Math.min(6, ss.length - dot - 1);
    let v1 = dLo - (dLo % step); // first level at/above dLo (matches grid_y)
    for (let v = v1; v <= dHi + step * 0.5; v += step) {
      let y = Math.floor(fromDisp(v) * self.A + self.B);
      if (y > height || y < 0) continue;
      self.ys.push([y, fromDisp(v)]); // store PRICE; sidebar formats via y_format
    }
  }

  // Log gridlines. The author's geometric scheme (grid_y_log_geo) assumes values >> 1 spanning a
  // WIDE ratio (stocks/crypto). For a NARROW ratio (forex ~0.57, or any zoomed-in view) it degenerates:
  // log_rounder snaps sub-1 prices to the next 0.1 (0.567 -> 0.6) and the near-1 multiplier yields only
  // off-screen / negative junk, leaving the axis blank. But over a narrow ratio the symmetric-log axis
  // is essentially linear, so there we lay nice LINEAR steps and map each through the SAME math.log the
  // candles use (so gridlines stay aligned). Threshold uses (v+1) because math.log is log(|x|+1).
  function grid_y_log() {
    if (self.$_lo > 0 && self.$_hi > 0 && (self.$_hi + 1) / (self.$_lo + 1) < 2) grid_y_log_lin();
    else grid_y_log_geo();
  }

  // Narrow-ratio log axis: nice linear price steps, positioned via the log transform.
  function grid_y_log_lin() {
    self.ys = [];
    let m = Math.pow(10, -self.prec);
    self.$_step = Math.max(m, dollar_step());
    let y1 = self.$_lo - (self.$_lo % self.$_step);
    for (var y$ = y1; y$ <= self.$_hi; y$ += self.$_step) {
      if (y$ <= 0) continue;
      let y = Math.floor(math.log(y$) * self.A + self.B);
      if (y < 0 || y > height) continue;
      self.ys.push([y, Utils.strip(y$)]);
    }
  }

  function grid_y_log_geo() {
    // TODO: Prevent duplicate levels, is this even
    // a problem here ?
    self.$_mult = dollar_mult();
    self.ys = [];

    if (!sub.length) return;

    let v = Math.abs(sub[sub.length - 1][1] || 1);
    let y1 = search_start_pos(v);
    let y2 = search_start_neg(-v);
    let yp = -Infinity; // Previous y value
    let n = height / $p.config.GRIDY; // target grid N

    let q = 1 + (self.$_mult - 1) / 2;

    // Over 0
    for (var y$ = y1; y$ > 0; y$ /= self.$_mult) {
      y$ = log_rounder(y$, q);
      let y = Math.floor(math.log(y$) * self.A + self.B);
      self.ys.push([y, Utils.strip(y$)]);
      if (y > height) break;
      if (y - yp < $p.config.GRIDY * 0.7) break;
      if (self.ys.length > n + 1) break;
      yp = y;
    }

    // Under 0
    yp = Infinity;
    for (var y$ = y2; y$ < 0; y$ /= self.$_mult) {
      y$ = log_rounder(y$, q);
      let y = Math.floor(math.log(y$) * self.A + self.B);
      if (yp - y < $p.config.GRIDY * 0.7) break;
      self.ys.push([y, Utils.strip(y$)]);
      if (y < 0) break;
      if (self.ys.length > n * 3 + 1) break;
      yp = y;
    }

    // TODO: remove lines near to 0
  }

  // Search a start for the top grid so that
  // the fixed value always included
  /** @param {number} value */
  function search_start_pos(value) {
    let N = height / $p.config.GRIDY; // target grid N
    var y = Infinity,
      y$ = value,
      count = 0;
    while (y > 0) {
      y = Math.floor(math.log(y$) * self.A + self.B);
      y$ *= self.$_mult;
      if (count++ > N * 3) return 0; // Prevents deadloops
    }
    return y$;
  }

  /** @param {number} value */
  function search_start_neg(value) {
    let N = height / $p.config.GRIDY; // target grid N
    var y = -Infinity,
      y$ = value,
      count = 0;
    while (y < height) {
      y = Math.floor(math.log(y$) * self.A + self.B);
      y$ *= self.$_mult;
      if (count++ > N * 3) break; // Prevents deadloops
    }
    return y$;
  }

  // Make log scale levels look great again
  /**
   * @param {number} x
   * @param {number} quality
   * @returns {number}
   */
  function log_rounder(x, quality) {
    let s = Math.sign(x);
    x = Math.abs(x);
    if (x > 10) {
      for (var div = 10; div < MAX_INT; div *= 10) {
        let nice = Math.floor(x / div) * div;
        if (x / nice > quality) {
          // More than 10% off
          break;
        }
      }
      div /= 10;
      return s * Math.floor(x / div) * div;
    } else if (x < 1) {
      for (var ro = 10; ro >= 1; ro--) {
        let nice = Utils.round(x, ro);
        if (x / nice > quality) {
          // More than 10% off
          break;
        }
      }
      return s * Utils.round(x, ro + 1);
    } else {
      return s * Math.floor(x);
    }
  }

  return { grid_y, grid_y_pct, grid_y_log, calc_precision };
}
