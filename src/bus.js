// @ts-check
// Tiny event bus so modules can talk without importing each other directly.
const target = new EventTarget();

export const bus = {
  /**
   * Subscribe to an event; returns an unsubscribe fn (callers may ignore it).
   * @param {string} type
   * @param {(detail: any) => void} cb
   * @returns {() => void}
   */
  on: (type, cb) => {
    /** @param {Event} e */
    const h = (e) => cb(/** @type {CustomEvent} */ (e).detail);
    target.addEventListener(type, h);
    return () => target.removeEventListener(type, h);
  },
  /**
   * @param {string} type
   * @param {any} [detail]
   * @returns {boolean}
   */
  emit: (type, detail) => target.dispatchEvent(new CustomEvent(type, { detail })),
};
