// @ts-check
// Keybindings -- the combo <-> command binding layer. A command carries a DEFAULT key; the
// user can override it. Overrides are stored as { [commandId]: combo } in the app-prefs store
// (settings.js), where an empty string means "explicitly unbound" (distinct from "no override,
// use the default"). The hotkey dispatcher builds its lookup from the RESOLVED bindings here,
// so a rebind takes effect live.
//
// This is the same shape as the per-tool hotkey map (toolbar-store), lifted to commands:
// one combo maps to at most one command (assigning a combo clears it from any other command).
import { getSetting, setSetting } from '../settings/settings.js';
import { getCommand, listCommands } from './registry.js';

const KEY = 'commandKeybindings'; // settings.js key: { [commandId]: combo | '' }

/** @type {Set<() => void>} */
const listeners = new Set();
/** Subscribe to binding changes (the dispatcher rebuilds its index on these). @param {() => void} fn */
export function onKeybindingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {}
  });
}

/** @returns {Record<string, string>} */
function overrides() {
  return getSetting(KEY) || {};
}

/**
 * The resolved combo for a command: a user override wins (including '' = unbound); otherwise the
 * command's default key. Returns '' when the command has no binding.
 * @param {string} id @returns {string}
 */
export function keyFor(id) {
  const o = overrides();
  if (Object.prototype.hasOwnProperty.call(o, id)) return o[id]; // '' means the user cleared it
  const c = getCommand(id);
  return (c && c.defaultKey) || '';
}

/**
 * Assign a combo to a command (exclusive: any other command currently on that combo is unbound).
 * Pass a falsy combo to explicitly unbind. @param {string} id @param {string} combo
 */
export function setKeybinding(id, combo) {
  const o = { ...overrides() };
  if (!combo) {
    o[id] = '';
  } else {
    for (const c of listCommands()) {
      if (c.id !== id && keyFor(c.id) === combo) o[c.id] = '';
    }
    o[id] = combo;
  }
  setSetting(KEY, o);
  notify();
}

/** Drop the override for a command, restoring its default binding. @param {string} id */
export function resetKeybinding(id) {
  const o = { ...overrides() };
  delete o[id];
  setSetting(KEY, o);
  notify();
}

/** combo -> command id, for every command with a resolved binding. @returns {Map<string, string>} */
export function comboBindings() {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const c of listCommands()) {
    const k = keyFor(c.id);
    if (k) map.set(k, c.id);
  }
  return map;
}

/** the two wildcard slots -> command id (wildcards are not user-rebindable). */
export function wildcardBindings() {
  /** @type {{ letter: string | null, number: string | null }} */
  const w = { letter: null, number: null };
  for (const c of listCommands()) {
    if (c.wildcard) w[c.wildcard] = c.id;
  }
  return w;
}
