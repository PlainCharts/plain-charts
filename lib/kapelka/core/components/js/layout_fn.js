// @ts-check
// Layout functional interface

import Utils from '../../stuff/utils.js'
import math from '../../stuff/math.js'

/**
 * Attaches the coordinate-mapping closures (t2screen/$2screen/screen2t/screen2$ and the magnets) onto
 * the layout ctx `self`, keyed off the given time `range`. `self` is the author's intricate layout ctx
 * (A/B, spacex, ti_map, grid, candles, master_grid, ...) -- typed `any` at this boundary.
 * @param {any} self  the layout ctx being populated
 * @param {[number, number]} range  [t0, t1] time window in ms
 * @returns {any} the same `self`, with the coordinate closures assigned
 */
export default function(self, range) {

    const ib = self.ti_map.ib
    const dt = range[1] - range[0]
    const r = self.spacex / dt
    const ls = self.grid.logScale || false

    Object.assign(self, {
        // Time to screen coordinates
        /** @param {number} t */
        t2screen: t => {
            if (ib) t = self.ti_map.smth2i(t)
            return Math.floor((t - range[0]) * r) - 0.5
        },
        // $ to screen coordinates
        /** @param {number} y */
        $2screen: y => {
            if (ls) y = math.log(y)
            return Math.floor(y * self.A + self.B) - 0.5
        },
        // Time-axis nearest step
        /** @param {number} t */
        t_magnet: t => {
            if (ib) t = self.ti_map.smth2i(t)
            const cn = self.candles || self.master_grid.candles
            const arr = cn.map((/** @type {any} */ x) => x.raw[0])
            const i = Utils.nearest_a(t, arr)[0]
            if (!cn[i]) return
            return Math.floor(cn[i].x) - 0.5
        },
        // Screen-Y to dollar value (or whatever)
        /** @param {number} y */
        screen2$: y => {
            if (ls) return math.exp((y - self.B) / self.A)
            return (y - self.B) / self.A
        },
        // Screen-X to timestamp
        /** @param {number} x */
        screen2t: x => {
            // TODO: most likely Math.floor not needed
            // return Math.floor(range[0] + x / r)
            return range[0] + x / r
        },
        // $-axis nearest step
        /** @param {number} price */
        $_magnet: price => { },
        // Nearest candlestick
        /** @param {number} t */
        c_magnet: t => {
            const cn = self.candles || self.master_grid.candles
            const arr = cn.map((/** @type {any} */ x) => x.raw[0])
            const i = Utils.nearest_a(t, arr)[0]
            return cn[i]
        },
        // Nearest data points
        /** @param {number} t */
        data_magnet: t => {  /* TODO: implement */ }
    })

    return self

}
