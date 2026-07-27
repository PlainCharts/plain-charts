// @ts-check
// Study registry — the plug socket. Each study module self-registers on import
// (Studies.register({...})); the library core never names a specific study.
//
// `Studies` is the authoring surface a study file uses (no imports needed if the host
// has exposed it as a global, e.g. window.Studies = Studies). It also re-exports the
// price-source helpers so a calc() can do Studies.priceOf(bar, 'close').
import { priceOf, SOURCES } from './util.js';

/** @type {Map<string, import('./types.js').StudySpecOpen>} */
const reg = new Map();
/** @type {((id: string, s: import('./types.js').StudySpecOpen) => void) | null} */
let onRegister = null;   // loader hook: fires with each id as a file registers it

/** @param {((id: string, s: any) => void) | null} fn */
export const setRegisterHook = (fn) => { onRegister = fn; };
/** @param {import('./types.js').StudySpecOpen} s */
export const registerStudy = (s) => { reg.set(s.id, s); if (onRegister) onRegister(s.id, s); };
/** @param {string} id */
export const unregisterStudy = (id) => reg.delete(id);
/** @param {string} id */
export const getStudy = (id) => reg.get(id);
export const listStudies = () => [...reg.values()];

// the object a study file calls: Studies.register({ id, name, calc, ... })
export const Studies = {
  register: registerStudy,
  unregister: unregisterStudy,
  priceOf,
  SOURCES,
};
