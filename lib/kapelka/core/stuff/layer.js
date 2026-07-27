// @ts-check

// Layer constructor, helper class

class Layer {
    /**
     * @param {string} name Layer id.
     * @param {number} z z-index / draw order.
     * @param {any} renderer Either a `draw` function or a renderer object
     *   (`{ draw, ... }`). Renderer shapes are owned across the engine.
     */
    constructor(name, z, renderer) {
        if (typeof renderer === 'function') {
            this.renderer = {
                draw: renderer
            }
        } else {
            this.renderer = renderer
        }
        this.name = name
        this.z = z
        this.display = true
    }
}

export default Layer
