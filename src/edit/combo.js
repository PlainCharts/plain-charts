// @ts-check
// Key-combo helpers -- PURE, no app/window deps. Kept apart from the hotkeys engine (edit/hotkeys.js pulls in the
// command registry + tool system) so a PROXY window (the order-ticket) can record a shortcut chord without importing
// any of that. hotkeys.js re-exports these for its existing callers.

/** A keydown -> a normalized combo string (e.g. "Ctrl+Alt+R"). Ctrl and Meta both fold to "Ctrl". @param {KeyboardEvent} e @returns {string} */
export function comboOf(e) {
  /** @type {string[]} */
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(k);
  return parts.join('+');
}
/** @param {string} key is this key press a bare modifier (not a real chord key yet)? */
export const isModifierKey = (key) => key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta';
/** @param {string} combo a stored combo -> a display string ("Ctrl+Alt+R" -> "Ctrl + Alt + R") */
export const prettyCombo = (combo) => (combo || '').replace(/\+/g, ' + ');
