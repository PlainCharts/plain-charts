// @ts-check
// Hotkeys engine. One global keydown dispatcher -- but it holds NO action logic. A key
// press is just a trigger: it normalizes to a combo, resolves that combo to a command id
// (via the command registry), and fires executeCommand(id). The actions themselves live
// as named commands (commands/builtin.js and, as the pattern spreads, each domain module).
//
// Three trigger kinds resolve to a command:
//   - combos: a specific normalized chord (e.g. 'Alt+R') -> the command whose key is that chord
//   - wildcards: any bare letter / any bare number -> the command tagged wildcard:'letter'|'number'
//     (used by the on-chart change-symbol / change-interval behaviors; the typed char is the seed)
//   - per-tool hotkeys: a chord assigned to a drawing tool selects that tool (toolbar-store)
// Keys typed into inputs/textareas are ignored.
import { registerBuiltinCommands } from '../commands/builtin.js';
import { executeCommand, onDidRegister, getCommand } from '../commands/registry.js';
import { comboBindings, wildcardBindings, onKeybindingsChange } from '../commands/keybindings.js';
import { toolForCombo, toolHotkeys } from '../tools/toolbar-store.js';
import { setActiveTool } from '../tools/controller.js';
import { listTools } from '../tools/registry.js';
import { comboOf, isModifierKey, prettyCombo } from './combo.js';
import { serveAppCombos, publishAppCombos, forwardQuickButton } from './order-hotkeys.js';   // publish this window's combos (so the order ticket's button editor can see them) + forward unclaimed chords to it
export { comboOf, isModifierKey, prettyCombo };   // re-export the pure combo helpers (moved to combo.js so proxy windows can use them without this engine)

// combo -> command id, and the two wildcard slots -> command id. Built from the RESOLVED
// bindings (defaults + user overrides), and rebuilt whenever a command registers or the user
// rebinds a key, so both take effect live.
/** @type {Map<string, string>} */
let comboIndex = new Map();
/** @type {{ letter: string | null, number: string | null }} */
const wildcardIndex = { letter: null, number: null };
function buildIndex() {
  comboIndex = comboBindings();
  const w = wildcardBindings();
  wildcardIndex.letter = w.letter; wildcardIndex.number = w.number;
}

// Reference rows for gestures / shortcuts owned elsewhere (mouse gestures, or handled by the
// engine/clipboard). Not commands in this registry -- listed so the Settings > Hotkeys panel
// can show them. 'measure' carries a toggleKey so it renders as an enable/disable checkbox.
/** @type {Array<{ id: string, label: string, desc: string, toggleKey?: string }>} */
const GESTURES = [
  { id: 'wheelScroll', label: 'Move chart to left/right', desc: 'Shift + Mouse wheel' },
  { id: 'cloneDrawing', label: 'Clone a drawing', desc: 'Ctrl + Drag' },
  { id: 'selectAll', label: 'Select all drawings', desc: 'Ctrl + A' },
  { id: 'measure', label: 'Measure (Date & Price Range)', desc: 'Shift + Drag', toggleKey: 'measureHotkey' },
];

function inField() {
  const a = /** @type {HTMLElement | null} */ (document.activeElement);
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

// The reference gesture/shortcut rows for the Settings > Hotkeys panel. The rebindable command
// rows are built by that panel directly from the command registry (see settings/sections/hotkeys.js).
export function hotkeyCatalog() { return GESTURES.slice(); }

// live (read-only) list of per-tool hotkeys for the Settings > Hotkeys panel
export function toolHotkeyCatalog() {
  const map = toolHotkeys();
  return listTools()
    .filter((t) => map[t.id])
    .map((t) => ({ id: t.id, label: t.name, desc: prettyCombo(map[t.id]) }));
}

// The resolved command + drawing-tool combos this window owns, as the flat list the order ticket's button
// editor consults to refuse a chord that's already taken. Built LIVE on each call so a late-joining window
// (the order ticket asking) always gets the current set.
function collectAppCombos() {
  /** @type {Array<{ combo: string, id: string, label: string, kind: string }>} */
  const out = [];
  for (const [combo, id] of comboBindings()) { const c = getCommand(id); out.push({ combo, id, label: (c && c.title) || id, kind: 'command' }); }
  const th = toolHotkeys();
  for (const id in th) { const tool = listTools().find((t) => t.id === id); out.push({ combo: th[id], id, label: (tool && tool.name) || id, kind: 'tool' }); }
  return out;
}

export function initHotkeys() {
  registerBuiltinCommands();
  buildIndex();
  serveAppCombos(collectAppCombos);   // expose our combos to the order-ticket button editor (cross-window)
  const rewire = () => { buildIndex(); publishAppCombos(); };
  onDidRegister(rewire);      // new commands register -> rewire their keys + re-publish
  onKeybindingsChange(rewire); // user rebinds a key -> take effect live + re-publish

  document.addEventListener('keydown', (e) => {
    if (inField()) return;
    const combo = comboOf(e);
    // a registered combo (with or without modifiers, e.g. Tab) takes priority
    const id = comboIndex.get(combo);
    if (id) { e.preventDefault(); executeCommand(id, e); return; }
    // a per-tool hotkey selects that drawing tool
    const toolId = toolForCombo(combo);
    if (toolId) { e.preventDefault(); setActiveTool(toolId); return; }
    // an unclaimed MODIFIER chord may be an order-ticket quick-button hotkey. That button lives in another
    // window, so forward the chord: if it matches, the order ticket fires it (global reach, even when the
    // chart is focused). Conflict-checking at assignment guarantees it never shadows a command/tool above.
    if (e.ctrlKey || e.metaKey || e.altKey) { forwardQuickButton(combo); return; }
    if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) { if (wildcardIndex.letter) { e.preventDefault(); executeCommand(wildcardIndex.letter, e.key); } return; }
    if (e.key.length === 1 && (/[0-9]/.test(e.key) || e.key === ',')) { if (wildcardIndex.number) { e.preventDefault(); executeCommand(wildcardIndex.number, e.key); } return; }
  });
}
