// @ts-check
// Light/Dark theme modes. Each mode selects an APP theme (chrome -- propagates to every window via
// theme.js's ui-bus). A rail toggle (by the camera) flips modes. Config lives in settings.json
// (themeModes + themeMode). Configured in Settings > Global > Theme (the grid above the editor).
// Chart appearance is a SEPARATE concern (personal chart templates); it is not touched here.
import { getSetting, setSetting } from './settings.js';
import { selectTheme } from './theme.js';
import { addRailAction } from '../panels/rightpanel.js';
import { themeIcon } from '../ui/icon.js';

/**
 * One theme mode's config: an app theme name.
 * @typedef {{ app: string }} ModeConfig
 */
/** @typedef {'light' | 'dark'} ModeKey */

const DEFAULTS = { light: { app: 'Light' }, dark: { app: 'Dark' } };

/** @returns {{ light: ModeConfig, dark: ModeConfig }} */
export function getThemeModes() {
  const m = getSetting('themeModes') || {};
  return { light: { ...DEFAULTS.light, ...(m.light || {}) }, dark: { ...DEFAULTS.dark, ...(m.dark || {}) } };
}
/** @param {ModeKey} mode @param {'app'} field @param {string} value */
export function setThemeModeField(mode, field, value) {
  const modes = getThemeModes(); modes[mode][field] = value; setSetting('themeModes', modes);
}
export const getActiveMode = () => (getSetting('themeMode') === 'dark' ? 'dark' : 'light');

/** @param {ModeKey} mode */
export function applyThemeMode(mode) {
  const cfg = getThemeModes()[mode]; if (!cfg) return;
  setSetting('themeMode', mode);
  if (cfg.app) selectTheme(cfg.app);   // app chrome -> propagates to all windows via theme.js's ui-bus
}
/** @returns {ModeKey} */
export function toggleThemeMode() { const next = getActiveMode() === 'light' ? 'dark' : 'light'; applyThemeMode(next); return next; }

// ---- rail toggle button (bottom cluster, by the camera/gear) ----
/** @param {ModeKey} mode */
const iconEl = (mode) => themeIcon(mode === 'dark' ? '/images/moon.png' : '/images/sun.png', 16);

export function initThemeModes() {
  /** @type {HTMLElement | null} */
  let btn = null;
  /** @param {ModeKey} mode */
  const paint = (mode) => {
    if (!btn) return;
    btn.innerHTML = ''; btn.appendChild(iconEl(mode));
    btn.title = mode === 'dark' ? 'Dark theme (click for light)' : 'Light theme (click for dark)';
  };
  btn = addRailAction({ icon: iconEl(getActiveMode()), title: 'Theme mode', bottom: true, onClick: () => paint(toggleThemeMode()) });
  paint(getActiveMode());
}
