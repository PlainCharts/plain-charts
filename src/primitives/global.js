// @ts-check
// Global authoring API for CUSTOM RENDER PRIMITIVES (data-fed series). A pack/study file just calls
// Primitives.register('id', view) — no imports, full JS. A `view` is the engine's addCustomPlot
// contract: { draw(scope), priceValues(point), defaultOptions?, isWhitespace?, destroy? }. Once
// registered, any study can select the primitive as a plot `type` (host -> chart.addCustomPlot).
// This is the fourth plug socket, alongside window.Tools / window.Studies. Set before packs load.
import { registerCustomPlot, unregisterCustomPlot, getCustomPlot } from '../../lib/kapelka/studies/channels.js';

/** @type {PrimitivesApi} */
window.Primitives = {
  /** @param {string} id @param {PrimitiveView} view */
  register: (id, view) => registerCustomPlot(id, view),
  /** @param {string} id */
  unregister: (id) => unregisterCustomPlot(id),
  /** @param {string} id */
  get: (id) => getCustomPlot(id),
};
