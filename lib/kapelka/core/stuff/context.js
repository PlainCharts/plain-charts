// @ts-check

// Canvas context for text measurments

/**
 * Create an off-screen 2D canvas context for text measurements.
 * @param {{ font: string }} $p Provides the font shorthand to apply.
 * @returns {CanvasRenderingContext2D} 2D context configured with `$p.font`.
 */
function Context($p) {

    let el = document.createElement('canvas')
    let ctx = /** @type {CanvasRenderingContext2D} */ (el.getContext("2d"))
    ctx.font = $p.font

    return ctx

}

export default Context
