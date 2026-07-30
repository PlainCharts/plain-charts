// @ts-check
// Command registry -- one named action, many triggers.
//
// A "command" is a single thing the app can do (reset the view, add a study, place an
// order). The trigger -- a hotkey, a menu item, or an AI call -- is just an edge that
// resolves the command's id and fires it. The action's logic lives here once; the
// triggers are dumb pointers. This is the same plug socket as the tool/study/broker
// registries: things self-register by id, the core never names a specific command.
//
// This is the UI-window RUNTIME registry (handlers live here). The cross-process AI edge
// shares command IDENTITY through commands/manifest.js (metadata only, no handlers),
// because a broker/order handler runs in another process and cannot share a function.

/**
 * @typedef {Object} CommandDef
 * @property {string} id                      stable dotted id, e.g. 'pane.resetView'
 * @property {string} title                   human label (Settings list, menus)
 * @property {string} [category]              grouping for the Settings > Hotkeys list
 * @property {string} [defaultKey]            default hotkey combo, e.g. 'Alt+R' (normalized, see comboOf)
 * @property {'letter'|'number'} [wildcard]   bare-key trigger: any letter / any number fires this command
 * @property {(args?: any) => any} handler    the action; sync or async; may return a result
 */

/** @type {Map<string, CommandDef>} */
const reg = new Map();
/** @type {Set<(id: string) => void>} */
const listeners = new Set();

/** Register (or replace) a command by id. @param {CommandDef} def */
export function registerCommand(def) {
  if (!def || !def.id) throw new Error('command needs an id');
  if (typeof def.handler !== 'function') throw new Error('command ' + def.id + ' needs a handler');
  reg.set(def.id, def);
  listeners.forEach((fn) => {
    try {
      fn(def.id);
    } catch (_) {}
  });
}

/** @param {string} id @returns {CommandDef | undefined} */
export const getCommand = (id) => reg.get(id);
/** @returns {CommandDef[]} */
export const listCommands = () => [...reg.values()];
/** @param {string} id */
export const hasCommand = (id) => reg.has(id);

/** Subscribe to registrations (fires with the id). Returns an unsubscribe fn. @param {(id: string) => void} fn */
export function onDidRegister(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Run a command by id. Throws on an unknown id (a trigger pointing at a name that
 * isn't registered is a bug, not a silent no-op). Returns the handler's result.
 * @param {string} id @param {any} [args]
 */
export function executeCommand(id, args) {
  const c = reg.get(id);
  if (!c) throw new Error('unknown command: ' + id);
  return c.handler(args);
}
