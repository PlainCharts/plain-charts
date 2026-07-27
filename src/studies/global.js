// @ts-check
// Global authoring API for user-written indicators. A user indicator file just
// calls Studies.register({...}) — no imports, no DSL, full JS. This must be set
// before any user file is loaded (imported early from main.js).
import { registerStudy, unregisterStudy } from './registry.js';
import { priceOf, SOURCES } from './util.js';

window.Studies = {
  register: registerStudy,
  unregister: unregisterStudy,
  priceOf,
  SOURCES,
};
