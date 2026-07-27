// @ts-check
// The ENGINE event bus -- the execution engine's own event surface, separate from the app bus (src/bus.js).
// The engine emits its lifecycle events here ('logon', 'connections:changed', 'broker:notice'); app code
// subscribes to THIS bus for engine events and never the other way around. Same tiny EventTarget wrapper
// as the app bus; module identity is the resolved URL, so every window shares one instance per page.
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
