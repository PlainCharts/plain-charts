// Mirror the kapelka/dubhe engine into public/ so the docs' live example pages can import it.
// The engine sits one level up (lib/dubhe); Astro's public/ can't reach outside itself, so we copy the
// runtime dirs in. Examples under public/examples import '../index.js' etc., which then resolve.
// The copied paths are gitignored (derived from the engine); run before dev and build.
import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));   // docs/kapelka/scripts
const engine = resolve(here, '../../../lib/kapelka');   // the vendored engine
const pub = resolve(here, '../public');                 // docs/kapelka/public

const parts = ['index.js', 'core', 'studies', 'skin', 'examples'];
for (const part of parts) {
  const src = resolve(engine, part);
  const dst = resolve(pub, part);
  if (!existsSync(src)) { console.warn('[mirror] missing:', src); continue; }
  await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true });
}
console.log('[mirror] engine -> public/ (' + parts.join(', ') + ')');
