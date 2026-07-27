// @ts-check
// Price scale modes (label, PriceMode value) shared by the Scales pickers.
// Kept in its own module so the gear menu and the settings dialog can import it
// without pulling in pane.js (which imports the gear menu -> circular).
// All four PriceMode values are supported: Regular, Logarithmic, and the two
// rebased-to-first-visible-value modes Percent (0% = baseline) and Indexed to 100.
/** @type {Array<[string, number]>} */
export const PRICE_SCALE_MODES = [['Regular', 0], ['Logarithmic', 1], ['Percent', 2], ['Indexed to 100', 3]];
