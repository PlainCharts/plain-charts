// @ts-check
// Loader for LOADABLE order primitives. The shipped default (pill) is statically imported by the overlay; every
// OTHER primitive is installable content under packages/primitives/<id>/index.js that self-registers (registerPrimitive)
// when imported -- the broker-adapter discovery pattern (server.js /api/user-order-primitives). This does ONE GET per
// window to list them, then dynamic-imports each. A missing/failed module is skipped -- the chart still has pill.
import { getPrimitive } from './primitive-registry.js';

/** @type {Promise<void> | undefined} */
let done; // memoized: one discovery + load per window, shared by every pane's overlay

/** Discover and import every loadable order primitive. Resolves once all are loaded (or skipped). @returns {Promise<void>} */
export function loadPrimitiveModules() {
  if (done) return done;
  done = fetch('/api/user-order-primitives')
    .then((r) => r.json())
    .then((d) =>
      Promise.all(
        (d.primitives || []).map(
          async (/** @type {{ id: string, url: string, name?: string, description?: string }} */ p) => {
            try {
              await import(p.url);
            } catch (e) {
              console.error('[order-primitive] load failed:', p.id, e);
              return;
            }
            // name/description come ONLY from the package's meta.json (carried on the discovery list) -- never the code.
            const reg = /** @type {any} */ (getPrimitive(p.id));
            if (reg) {
              reg.name = p.name || '';
              reg.description = p.description || '';
            }
          },
        ),
      ),
    )
    .then(() => {})
    .catch(() => {});
  return done;
}
