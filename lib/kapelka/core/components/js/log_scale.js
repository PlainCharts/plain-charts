// @ts-check

// Log-scale mode helpers

// TODO: all-negative numbers (sometimes wrong scaling)

import math from '../../stuff/math.js'

export default {

    /**
     * Map an OHLC row to screen coords in log space (the author's internal layout `self` carries the
     * log mapping A/B and px_step; open-shaped, so `any`).
     * @param {any} self  the grid-maker's internal layout object (A, B, px_step, $_hi, $_lo, ...)
     * @param {number} mid  candle mid-x in px
     * @param {import('../../types.js').Row} p  positional OHLC row [t, o, h, l, c, ...]
     * @param {import('../../types.js').CompProps} $p
     * @returns {{ x: number, w: number, o: number, h: number, l: number, c: number, raw: import('../../types.js').Row }}
     */
    candle(self, mid, p, $p) {
        return {
            x: mid,
            w: self.px_step * $p.config.CANDLEW,
            o: Math.floor(math.log(p[1]) * self.A + self.B),
            h: Math.floor(math.log(p[2]) * self.A + self.B),
            l: Math.floor(math.log(p[3]) * self.A + self.B),
            c: Math.floor(math.log(p[4]) * self.A + self.B),
            raw: p
        }
    },

    /**
     * Expand the log-scale range by 10% margins top and bottom (mutates self.$_hi / self.$_lo).
     * @param {any} self  the grid-maker's internal layout object ($_hi, $_lo, ...)
     * @param {number} height
     * @returns {void}
     */
    expand(self, height) {
        // expand log scale
        let A = - height / (math.log(self.$_hi) - math.log(self.$_lo))
        let B = - math.log(self.$_hi) * A

        let top = -height * 0.1
        let bot = height * 1.1

        self.$_hi = math.exp((top - B) / A)
        self.$_lo = math.exp((bot - B) / A)
    }

}
