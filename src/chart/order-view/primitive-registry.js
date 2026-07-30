// @ts-check
// Order-primitive registry -- the plug socket (the broker registry pattern, src/data/registry.js). Each
// primitive module self-registers by calling registerPrimitive() when imported; the overlay never references
// a specific primitive, it only asks the registry for the ACTIVE one by id. Unknown/missing id falls back to
// the default (pill -- the one that ships in the distro), so the chart always has a renderer. Other primitives
// (string-beads) are loadable modules under packages/primitives/ and may be absent.
/** @typedef {import('./primitive-contract.js').OrderPrimitive} OrderPrimitive */

export const DEFAULT_PRIMITIVE = 'pill';

/** @type {Map<string, OrderPrimitive>} */
const reg = new Map();

/** @param {OrderPrimitive} p */
export const registerPrimitive = (p) => reg.set(p.id, p);
/** @param {string} [id] @returns {OrderPrimitive | undefined} */
export const getPrimitive = (id) =>
  (id ? reg.get(id) : undefined) || reg.get(DEFAULT_PRIMITIVE) || reg.values().next().value;
/** @returns {OrderPrimitive[]} */
export const listPrimitives = () => [...reg.values()];
