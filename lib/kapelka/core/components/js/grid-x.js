// @ts-check
import Const from '../../stuff/constants.js';
import Utils from '../../stuff/utils.js';

const { TIMESCALES, WEEK, MONTH, YEAR, HOUR, DAY } = Const;

// X-axis (time) tick family, extracted verbatim from grid_maker.js. Given the shared
// grid-build context `G` (the same `self` output bag plus the pane's params), it computes
// the vertical gridline / time-label positions (`self.xs`, `self.t_step`, `self.t_step_time`).
// All state is read/written through the destructured references, so the caller sees the same
// mutated `self` layout object.
/**
 * @param {any} G  shared grid-maker context:
 *   { self, sub, interval, range, $p, ti_map, timezone, master_grid, minLabelPx }
 */
export function createGridX(G) {
  const { self, sub, interval, range, $p, ti_map, timezone, master_grid, minLabelPx } = G;

  // Select nearest good-loking t step (m is target scale)
  function time_step() {
    let k = ti_map.ib ? 60000 : 1;
    let xrange = (range[1] - range[0]) * k;
    let m = xrange * ($p.config.GRIDX / $p.width);
    let s = TIMESCALES;
    // nearest_a returns null only for an empty array; TIMESCALES is a non-empty constant -> number.
    return /** @type {number} */ (Utils.nearest_a(m, s)[1]) / k;
  }

  function grid_x() {
    // If this is a subgrid, no need to calc a timeline,
    // we just borrow it from the master_grid
    if (!master_grid) {
      self.t_step = time_step();
      self.xs = [];
      const dt = range[1] - range[0];
      const r = self.spacex / dt;

      // INDEX-BASED mode: the author's label test (p[0] % t_step) is a BAR-COUNT step, so
      // labels land every N bars (e.g. 25 min on a 5m chart) instead of on round clock times.
      // Pick a nice TIME step (ms) targeting ~GRIDX px, snapped to a whole multiple of the bar
      // interval so bars actually fall on it, and let insert_line label real round times.
      // NB: in IB mode the destructured `interval` is 1 (index step) -- the REAL ms bar interval
      // is ti_map.tf, which is what the round-time math needs.
      self.t_step_time = 0;
      const tf = ti_map && ti_map.tf;
      if (ti_map.ib && tf > 0 && isFinite(r) && r > 0) {
        let target = $p.config.GRIDX * (tf / r); // ms of chart time per GRIDX px
        // nearest_a null only for an empty array; TIMESCALES is non-empty -> number.
        let step = /** @type {number} */ (Utils.nearest_a(target, TIMESCALES)[1]);
        step = Math.max(tf, step);
        if (step % tf !== 0) step = Math.ceil(step / tf) * tf;
        self.t_step_time = step;
        // keep the "too near" filter (below) in sync: its threshold is self.t_step in INDEX
        // units, so set it to the label spacing in BARS (step / tf), or it would drop every
        // round-time label (a huge self.t_step makes every label read as "too near").
        self.t_step = step / tf;
      }

      /* TODO: remove the left-side glitch

            let year_0 = Utils.get_year(sub[0][0])
            for (var t0 = year_0; t0 < range[0]; t0 += self.t_step) {}

            let m0 = Utils.get_month(t0)*/

      for (var i = 0; i < sub.length; i++) {
        let p = sub[i];
        let prev = sub[i - 1] || [];
        let prev_xs = self.xs[self.xs.length - 1] || [0, []];
        let x = Math.floor((p[0] - range[0]) * r);

        insert_line(prev, p, x);

        // Filtering lines that are too near
        let xs = self.xs[self.xs.length - 1] || [0, []];

        if (prev_xs === xs) continue;

        // Drop a label only when it would VISUALLY collide with the previous one -- measured in
        // PIXELS, not bar-index. In index-based mode a packed gap (e.g. the futures maintenance
        // hour) makes two real round-clock ticks adjacent bars, so a bar-index test (t_step*0.8)
        // wrongly dropped the second even when there was screen room. Now a gap-adjacent boundary
        // (18:00 after a 17:00 gap) stays visible -- just tighter than the even cadence.
        if ((xs[1][0] - prev_xs[1][0]) * r < minLabelPx) {
          // prev_xs is a higher "rank" label
          if (xs[2] <= prev_xs[2]) {
            self.xs.pop();
          } else {
            // Otherwise
            self.xs.splice(self.xs.length - 2, 1);
          }
        }
      }

      // TODO: fix grid extension for bigger timeframes
      if (interval < WEEK && r > 0) {
        extend_left(dt, r);
        extend_right(dt, r);
      }
    } else {
      self.t_step = master_grid.t_step;
      self.px_step = master_grid.px_step;
      self.startx = master_grid.startx;
      self.xs = master_grid.xs;
    }
  }

  /**
   * @param {import('../../types.js').Row} prev  previous data row (may be [])
   * @param {import('../../types.js').Row} p      current data row
   * @param {number} x                            pixel x of the current row
   * @param {number} [m0]                          (author param, unused here)
   */
  function insert_line(prev, p, x, m0) {
    let prev_t = ti_map.ib ? ti_map.i2t(prev[0]) : prev[0];
    let p_t = ti_map.ib ? ti_map.i2t(p[0]) : p[0];

    if (ti_map.tf < DAY) {
      prev_t += timezone * HOUR;
      p_t += timezone * HOUR;
    }
    let d = timezone * HOUR;

    // TODO: take this block =========> (see below)
    if ((prev[0] || interval === YEAR) && Utils.get_year(p_t) !== Utils.get_year(prev_t)) {
      self.xs.push([x, p, YEAR]); // [px, [...], rank]
    } else if (prev[0] && Utils.get_month(p_t) !== Utils.get_month(prev_t)) {
      self.xs.push([x, p, MONTH]);
    }
    // A DAY tick on the FIRST bar of a new calendar day (the day CHANGED vs the previous bar,
    // in the display timezone via p_t) -- not only on an exact-midnight bar, so instruments with
    // session gaps (no 00:00 bar) still get a day label.
    else if (prev[0] && Utils.day_start(p_t) !== Utils.day_start(prev_t)) {
      self.xs.push([x, p, DAY]);
    }
    // Intraday minor label. In index-based mode, a tick on the FIRST bar that CROSSES each round
    // clock step (t_step_time), not an exact `% step === 0` hit -- otherwise session-anchored bars
    // that never land on a round time (e.g. RTH futures on :30) get NO labels and the axis shows big
    // blank spans. Crossing = the step-window index changed vs the previous bar; the label still
    // reads the bar's real time (:30 is honest). If no time step could be
    // computed, fall back to the author's bar-index test so labels never vanish.
    else if (
      ti_map.ib
        ? self.t_step_time
          ? prev[0] && Math.floor(p_t / self.t_step_time) !== Math.floor(prev_t / self.t_step_time)
          : p[0] % self.t_step === 0
        : p[0] % self.t_step === 0
    ) {
      self.xs.push([x, p, interval]);
    }
  }

  /**
   * @param {number} dt  visible time span (range[1]-range[0])
   * @param {number} r    px-per-time ratio
   */
  function extend_left(dt, r) {
    if (!self.xs.length || !isFinite(r)) return;

    let t = self.xs[0][1][0];
    while (true) {
      t -= self.t_step;
      let x = Math.floor((t - range[0]) * r);
      if (x < 0) break;
      // TODO: ==========> And insert it here somehow
      if (t % interval === 0) {
        self.xs.unshift([x, [t], interval]);
      }
    }
  }

  /**
   * @param {number} dt  visible time span (range[1]-range[0])
   * @param {number} r    px-per-time ratio
   */
  function extend_right(dt, r) {
    if (!self.xs.length || !isFinite(r)) return;

    let t = self.xs[self.xs.length - 1][1][0];
    while (true) {
      t += self.t_step;
      let x = Math.floor((t - range[0]) * r);
      if (x > self.spacex) break;
      if (t % interval === 0) {
        self.xs.push([x, [t], interval]);
      }
    }
  }

  return { grid_x };
}
