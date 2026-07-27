// @ts-check
// Built-in chart/navigation commands. These are the cross-cutting actions that used to
// live as inline closures in the hotkey dispatcher. Registering them here gives each a
// stable id + default key + label, so hotkeys, the Settings list, and (later) the AI edge
// all refer to the same named action. Domain-specific commands (studies, drawings, broker)
// self-register from their own modules as this pattern spreads.
import { registerCommand } from './registry.js';
import { registerPaneCommands } from './pane-commands.js';
import { openSymbolSearch } from '../market/symbol-search.js';
import { openIntervalQuickInput } from '../workspace/timeframes.js';
import { cyclePane, getActivePane } from '../chart/layout.js';
import { selectTheme } from '../settings/theme.js';
import { bus } from '../bus.js';

export function registerBuiltinCommands() {
  registerPaneCommands();   // pane data-ops (studies/symbol/tf/alerts/drawings) shared by menus + AI
  registerCommand({
    id: 'pane.next', title: 'Next chart', category: 'Chart', defaultKey: 'Tab',
    handler: () => cyclePane(1),
  });
  registerCommand({
    id: 'pane.prev', title: 'Previous chart', category: 'Chart', defaultKey: 'Shift+Tab',
    handler: () => cyclePane(-1),
  });
  // pane-acting commands take an optional { pane } context (a menu passes the pane it opened on);
  // when absent -- e.g. fired from a hotkey -- they act on the active pane.
  registerCommand({
    id: 'pane.resetView', title: 'Reset chart view', category: 'Chart', defaultKey: 'Alt+R',
    handler: (args) => { const p = (args && args.pane) || getActivePane(); if (p) p.resetView(); },
  });
  registerCommand({
    id: 'pane.maximize', title: 'Toggle maximize chart', category: 'Chart', defaultKey: 'Alt+Enter',
    handler: (args) => { const p = (args && args.pane) || getActivePane(); if (p) bus.emit('pane:maximize', p); },
  });
  // wildcard triggers: a bare letter opens symbol search, a bare number opens the interval
  // quick-input. The typed character is passed to the handler as the seed.
  registerCommand({
    id: 'symbol.search', title: 'Change symbol', category: 'Chart', wildcard: 'letter',
    handler: (/** @type {string} */ ch) => openSymbolSearch(undefined, ch),
  });
  registerCommand({
    id: 'interval.quickInput', title: 'Change interval', category: 'Chart', wildcard: 'number',
    handler: (/** @type {string} */ ch) => openIntervalQuickInput(ch === ',' ? '' : ch),
  });
  // pane-independent: applies an app theme by name (shared by the assistant's apply_theme)
  registerCommand({
    id: 'theme.apply', title: 'Apply theme', category: 'Appearance',
    handler: (args) => { if (!args || !args.name) return { error: 'name required' }; selectTheme(args.name); return { ok: true, theme: args.name }; },
  });
}
