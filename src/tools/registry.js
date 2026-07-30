// @ts-check
// Tool registry — same plug socket as studies/brokers/addons. Each tool module
// self-registers; the core never names a specific tool. Drop a file, register
// it, and it shows up in the toolbar manager.

// A tool descriptor. Tools self-register with an open, mostly-optional shape (full JS,
// no schema): only id/name are guaranteed, and the index signature keeps every other
// author-defined field (draw/hitTest/marks/timeOnly/priceOnly/settings...) as `any`.
/**
 * @typedef {{ id: string, name: string } & Record<string, any>} ToolDef
 */

/** @type {Map<string, ToolDef>} */
const reg = new Map();
/** @type {((id: string, t: ToolDef) => void) | null} */
let onRegister = null; // loader hook (Phase 3: user-authored tools)

/** @param {((id: string, t: ToolDef) => void) | null} fn */
export const setRegisterHook = (fn) => {
  onRegister = fn;
};
/** @param {ToolDef} t */
export const registerTool = (t) => {
  reg.set(t.id, t);
  if (onRegister) onRegister(t.id, t);
};
/** @param {string} id */
export const unregisterTool = (id) => reg.delete(id);
/** @param {string} id @returns {ToolDef | undefined} */
export const getTool = (id) => reg.get(id);
/** @returns {ToolDef[]} */
export const listTools = () => [...reg.values()];
