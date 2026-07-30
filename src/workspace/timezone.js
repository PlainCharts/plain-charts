// @ts-check
// The DEFAULT display offset a NEW chart starts at (minutes east of UTC). Data stays UTC; each chart
// then owns its own per-pane offset (pane.settings.tzOffsetMin, edited via Settings > Time or the
// bottom-bar picker). Seeded once at startup from settings, falling back to the OS local offset --
// there is no longer a live app-wide timezone.
import { getSetting } from '../settings/settings.js';

let offsetMin = 0;

/** @returns {number} */
export function loadTimezone() {
  const v = getSetting('tzOffsetMin');
  offsetMin = typeof v === 'number' ? v : -new Date().getTimezoneOffset(); // default: local
  return offsetMin;
}

/** The default offset a new chart inherits until it sets its own. @returns {number} */
export const getOffsetMin = () => offsetMin;
