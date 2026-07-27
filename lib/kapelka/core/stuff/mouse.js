// @ts-check
// Mouse event handler for overlay

/** @typedef {(event: any) => void} MouseHandler */

export default class Mouse {

    /**
     * @param {any} comp owning Chart component (engine hub: $props/cursor/layout)
     */
    constructor(comp) {
        this.comp = comp
        /** @type {Object<string, MouseHandler[]>} */
        this.map = {}
        this.listeners = 0
        this.pressed = false
        this.x = comp.$props.cursor.x
        this.y = comp.$props.cursor.y
        this.t = comp.$props.cursor.t
        this.y$ = comp.$props.cursor.y$
    }

    // You can choose where to place the handler
    // (beginning or end of the queue)
    /**
     * @param {string} name
     * @param {MouseHandler} handler
     * @param {'unshift'|'push'} [dir]
     */
    on(name, handler, dir = "unshift") {
        if (!handler) return
        this.map[name] = this.map[name] || []
        this.map[name][dir](handler)
        this.listeners++
    }

    /**
     * @param {string} name
     * @param {MouseHandler} handler
     */
    off(name, handler) {
        if (!this.map[name]) return
        let i = this.map[name].indexOf(handler)
        if (i < 0) return
        this.map[name].splice(i, 1)
        this.listeners--
    }

    // Called by grid.js
    /**
     * @param {string} name
     * @param {any} event pointer/mouse event (carries non-standard layerX/layerY)
     */
    emit(name, event) {
        const l = this.comp.layout
        if (name in this.map) {
            for (var f of this.map[name]) {
                f(event)
            }
        }
        if (name === 'mousemove') {
            this.x = event.layerX
            this.y = event.layerY
            this.t = l.screen2t(this.x)
            this.y$ = l.screen2$(this.y)
        }
        if (name === 'mousedown') {
            this.pressed = true
        }
        if (name === 'mouseup') {
            this.pressed = false
        }
    }

}
