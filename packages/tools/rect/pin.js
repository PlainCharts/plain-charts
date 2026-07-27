// @ts-check
// Pin — a self-describing reshape handle (idea borrowed from trading-vue's Pin). Instead
// of a tool hand-coding handles()/hitTest()/reshape() with an index switch, it declares a
// list of pins; each pin knows WHERE it is and HOW a drag updates the drawing.
//
//   pin({ at, drag, show? })
//     at(ctx)     -> { x, y }   screen position           (ctx = { pts, box, d })
//     drag(d, dp) -> mutate d.points for a drag to data point dp = { time, price }
//     show(ctx)   -> optional; pin is hidden/inactive when it returns false

/**
 * @typedef {Object} Pin
 * @property {(ctx: any) => { x: number, y: number }} at   screen position of the handle
 * @property {(d: any, dp: any) => void} [drag]            apply a drag to data point dp = { time, price }
 * @property {(ctx: any) => boolean} [show]                pin is hidden/inactive when this returns false
 */

/** @param {Pin} spec @returns {Pin} */
export const pin = (spec) => spec;

// Build handles()/hitPin()/reshape() from a pins array. Indices are array indices, so the
// index returned by hitPin matches reshape (filtering by show() never shifts them).
/** @param {Pin[]} pins */
export function pinHandles(pins) {
  /** @param {Pin} p @param {any} ctx */
  const shown = (p, ctx) => !p.show || p.show(ctx);
  return {
    /** @param {any} ctx */
    handles(ctx) { return pins.filter((p) => shown(p, ctx)).map((p) => p.at(ctx)); },
    /** @param {any} ctx @param {number} x @param {number} y @param {number} tol */
    hitPin(ctx, x, y, tol) {
      for (let i = 0; i < pins.length; i++) {
        if (!shown(pins[i], ctx)) continue;
        const a = pins[i].at(ctx);
        if (Math.hypot(a.x - x, a.y - y) <= tol + 4) return i;
      }
      return -1;
    },
    /** @param {any} d @param {number} index @param {any} dp */
    reshape(d, index, dp) { const p = pins[index]; if (p && p.drag) p.drag(d, dp); },
  };
}
