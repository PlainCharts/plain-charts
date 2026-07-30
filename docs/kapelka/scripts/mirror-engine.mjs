// Mirror the kapelka/dubhe engine into public/ so the docs' live example pages can import it.
// The engine sits one level up (lib/dubhe); Astro's public/ can't reach outside itself, so we copy the
// runtime dirs in. Examples under public/examples import '../index.js' etc., which then resolve.
// The copied paths are gitignored (derived from the engine); run before dev and build.
import { cp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // docs/kapelka/scripts
const engine = resolve(here, '../../../lib/kapelka'); // the vendored engine
const pub = resolve(here, '../public'); // docs/kapelka/public

const parts = ['index.js', 'core', 'studies', 'skin', 'examples'];
for (const part of parts) {
  const src = resolve(engine, part);
  const dst = resolve(pub, part);
  if (!existsSync(src)) {
    console.warn('[mirror] missing:', src);
    continue;
  }
  await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true });
}
console.log('[mirror] engine -> public/ (' + parts.join(', ') + ')');

// Generate the changelog page from the engine's canonical CHANGELOG.md so the docs never carry a
// hand-maintained copy. The Astro layout frontmatter is prepended; the body is verbatim from the
// single source. The generated page is gitignored, like the mirrored public/ dirs.
const changelogSrc = resolve(engine, 'CHANGELOG.md');
const changelogDst = resolve(here, '../src/pages/docs/changelog.md');
if (existsSync(changelogSrc)) {
  const front = '---\nlayout: ../../layouts/DocsLayout.astro\ntitle: Changelog\n---\n\n';
  await writeFile(changelogDst, front + (await readFile(changelogSrc, 'utf8')));
  console.log('[mirror] CHANGELOG.md -> src/pages/docs/changelog.md');
} else {
  console.warn('[mirror] missing engine CHANGELOG.md:', changelogSrc);
}
