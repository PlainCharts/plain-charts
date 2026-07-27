// @ts-check
// Settings -> App -> Advanced: the technical, power-user knobs gathered into one section instead of two tiny
// ones. It is pure COMPOSITION -- it renders the two existing domain sections in order, each of which owns its
// own controls and subsection headers:
//   Optimization -> STUDIES (study recompute) + CHART (paint rate)   -- global performance throttles
//   Development  -> DEBUG (DevTools console + remote debugging port) -- Electron-only debug tooling
// Nothing here reaches into either domain; both keep their own module (and their other exports -- e.g.
// applyOptimization -- are imported directly by the code that uses them, not through this shell).
import * as optimization from './optimization.js';
import * as development from './development.js';

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  optimization.render(ctx);   // STUDIES + CHART (performance)
  development.render(ctx);    // DEBUG (tooling)
}
