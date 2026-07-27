// @ts-check
// Catalog of plus-button actions: id, display name, menu icon, hotkey hint.
// Shared so the settings "default action" picker and the runtime menu stay in sync.
// The actual behavior for each id lives in plus-button.js (_dispatch); this file is
// dependency-free so both the dialog and the button can import it without cycles.
export const PLUS_ACTIONS = [
  { id: 'alert', name: 'Add alert', icon: '◷', hotkey: 'Alt + A' },
  { id: 'hline', name: 'Draw horizontal line', icon: '─', hotkey: 'Alt + H' },
];
