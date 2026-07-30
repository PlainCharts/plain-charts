// @ts-check
// Keyboard event handler for overlay

export default class Keys {
  /** @param {any} comp - engine-hub overlay component (cross-engine boundary) */
  constructor(comp) {
    this.comp = comp;
    /** @type {Object<string, Array<(event?: any) => void>>} */
    this.map = {};
    this.listeners = 0;
    /** @type {Object<string, boolean>} */
    this.keymap = {};
  }

  /**
   * @param {string} name
   * @param {(event?: any) => void} handler
   */
  on(name, handler) {
    if (!handler) return;
    this.map[name] = this.map[name] || [];
    this.map[name].push(handler);
    this.listeners++;
  }

  // Called by grid.js
  /**
   * @param {string} name
   * @param {any} [event] - keyboard event (or undefined when re-emitting by key name)
   */
  emit(name, event) {
    if (name in this.map) {
      for (var f of this.map[name]) {
        f(event);
      }
    }
    if (name === 'keydown') {
      if (!this.keymap[event.key]) {
        this.emit(event.key);
      }
      this.keymap[event.key] = true;
    }
    if (name === 'keyup') {
      this.keymap[event.key] = false;
    }
  }

  /**
   * @param {string} key
   * @return {boolean}
   */
  pressed(key) {
    return this.keymap[key];
  }
}
