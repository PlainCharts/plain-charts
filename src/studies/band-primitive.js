// @ts-check
// App adapter: the band primitive lives in the library (kapelka), decoupled to take the engine chart
// + a barTimes accessor. This shim adapts the app's Pane-based call signature to it.
import { createBandPrimitive as libBand } from '../../lib/kapelka/studies/primitives/band.js';

/**
 * @param {any} pane   app Pane (chart handle + barTimes accessor; opaque here)
 * @param {any} getSeries
 * @param {any} getBands
 */
export const createBandPrimitive = (pane, getSeries, getBands) =>
  libBand(pane.chart, () => pane.barTimes, getSeries, getBands);
