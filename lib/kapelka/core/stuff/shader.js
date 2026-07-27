// @ts-check

// Inline shader object, can be used
// to draw stuff on Sidebar, Botbar or Grid

class Shader {
    /**
     * @param {string} target Where to apply ('sidebar|botbar|grid')
     * @param {(ctx: any) => void} draw arrow function ctx => {}
     * @param {string} [name] optional
     */
    constructor(target, draw, name) {
        this.target = target // Where to apply ('sidebar|botbar|grid')
        this.draw = draw // arrow function ctx => {}
        this.name = name // optional
        /** @type {string | null} */
        this.id = null // Generated automatically
        this.zIndex = 0
    }
}

export default Shader
