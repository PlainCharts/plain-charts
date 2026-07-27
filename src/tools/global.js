// @ts-check
// Global authoring API for tools — a tool file just calls Tools.register({...}),
// no imports, full JS. Set before any tool module loads.
import { registerTool, unregisterTool, getTool } from './registry.js';
import { geom } from './engine/geometry.js';

// `Tools` is an author-facing global; the DOM lib has no type for it, so widen window.
/** @type {any} */ (window).Tools = {
  register: registerTool,
  unregister: unregisterTool,
  get: getTool,                 // look up another registered tool (for delegation)
  geom,                         // hit-test helpers for shape files (no imports needed)
  // canvas dash pattern for a line style ('solid'|'dashed'|'dotted'; legacy 1/2)
  /** @param {string | number} s */
  dash: (s) => (s === 'dashed' || s === 2) ? [6, 4] : (s === 'dotted' || s === 1) ? [2, 3] : [],
};
