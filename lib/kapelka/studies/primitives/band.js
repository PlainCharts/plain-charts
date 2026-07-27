// @ts-check
// Study fill layer. A study's calc() can return `fills`: each names two plot keys (a top line and
// a bottom line); the host pairs their data into a band and this primitive paints the filled region
// between them every frame. The channel band indicators map onto (Bollinger, Keltner, the RSI
// overbought/oversold shade, the green envelope in plugin galleries).
//
// Decoupled from any app Pane: takes the engine `chart` + a getBarTimes() accessor for the time
// axis, the host series (for its price scale), and the live band list.
import { timeToX } from './geometry.js';

/** One paired point of a band: an x-anchor time plus the top/bottom price edges to fill between.
 * @typedef {{ time?: number, top?: number, bottom?: number, [k: string]: any }} BandPoint */

/** A gradient fill ANCHORED TO PRICE: `colors` laid across the screen-y of the `at` price levels.
 * @typedef {{ at?: number[], colors?: string[], [k: string]: any }} BandGradient */

/** One band to fill: a run of paired points, plus a solid color or a price-anchored gradient. Open bag.
 * @typedef {{ points?: BandPoint[], color?: string, gradient?: BandGradient, [k: string]: any }} Band */

/**
 * @param {any} chart  the engine chart (drives geometry.timeToX)
 * @param {() => number[]} getBarTimes
 * @param {() => ({ priceToY: (p: number) => number|null } | null | undefined)} getSeries
 * @param {() => Band[]} getBands
 */
export function createBandPrimitive(chart, getBarTimes, getSeries, getBands) {
  /** @type {(() => void) | null} */
  let requestUpdate = null;
  /** @param {number|null|undefined} t */
  const xOf = (t) => (t == null ? null : timeToX(chart, getBarTimes(), t));

  /** @param {CanvasRenderingContext2D} c @param {number} W @param {number} H */
  const paint = (c, W, H) => {
    const series = getSeries();
    if (!series) return;
    getBands().forEach((/** @type {Band} */ band) => {
      const pts = band.points || [];
      if (pts.length < 2) return;
      // Resolve the paint style once per band. A `gradient` is a vertical ramp ANCHORED TO PRICE
      // (not to the band's own extent): its stops sit at the screen-y of the given price levels, so
      // the fade stays locked to those prices as the chart pans/zooms. Falls back to the solid color.
      /** @type {string | CanvasGradient} */
      let fillStyle = band.color || 'rgba(38,166,154,0.15)';
      const g = band.gradient;
      if (g && Array.isArray(g.at) && Array.isArray(g.colors) && g.colors.length && c.createLinearGradient) {
        const yA = series.priceToY(g.at[0]), yB = series.priceToY(g.at[g.at.length - 1]);
        if (yA != null && yB != null && yA !== yB) {
          const gr = c.createLinearGradient(0, yA, 0, yB), n = g.colors.length;
          g.colors.forEach((/** @type {string} */ col, /** @type {number} */ i) => gr.addColorStop(n === 1 ? 0 : i / (n - 1), col));
          if (n === 1) gr.addColorStop(1, g.colors[0]);
          fillStyle = gr;
        }
      }
      // Fill each contiguous run where BOTH edges resolve, so a gap never bridges two stretches.
      /** @type {{ x: number, yTop: number, yBot: number }[]} */
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          c.beginPath();
          for (let i = 0; i < run.length; i++) { const p = run[i]; (i === 0 ? c.moveTo : c.lineTo).call(c, p.x, p.yTop); }
          for (let i = run.length - 1; i >= 0; i--) { const p = run[i]; c.lineTo(p.x, p.yBot); }
          c.closePath();
          c.fillStyle = fillStyle;
          c.fill();
        }
        run = [];
      };
      c.save();
      for (let i = 0; i < pts.length; i++) {
        const x = xOf(pts[i].time);
        const yTop = series.priceToY(/** @type {number} */ (pts[i].top));
        const yBot = series.priceToY(/** @type {number} */ (pts[i].bottom));
        if (x == null || yTop == null || yBot == null) { flush(); continue; }
        run.push({ x, yTop, yBot });
      }
      flush();
      c.restore();
    });
  };

  /** @param {string} zOrder @param {(c: CanvasRenderingContext2D, W: number, H: number) => void} painter */
  const makeView = (zOrder, painter) => ({
    renderer: () => ({
      /** @param {any} target */
      draw(target) {
        target.useMediaCoordinateSpace((/** @type {any} */ scope) => painter(scope.context, scope.mediaSize.width, scope.mediaSize.height));
      },
    }),
    zOrder: () => zOrder,
  });

  return {
    updateAllViews() {},
    paneViews() { return [makeView('bottom', paint)]; },   // behind the plot lines
    /** @param {{ requestUpdate: () => void }} p */
    attached(p) { requestUpdate = p.requestUpdate; },
    detached() { requestUpdate = null; },
    repaint() { if (requestUpdate) requestUpdate(); },
  };
}
