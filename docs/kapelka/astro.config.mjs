// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The engine lives at lib/kapelka. In DEV we serve its files straight from source at the
// same absolute paths the demos import (/index.js, /core/**, /studies/**, /skin/**, /examples/**), so
// there is nothing to mirror and nothing to go stale. `npm run mirror` still copies into public/ for the
// production BUILD (a one-shot, can't go stale).
const engineRoot = fileURLToPath(new URL('../../lib/kapelka/', import.meta.url));
const ENGINE_PREFIXES = ['/index.js', '/core/', '/studies/', '/skin/', '/examples/'];
const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.map': 'application/json',
};

// Prefix the site base onto every INTERNAL absolute link/image in the markdown body
// (href/src that start with '/'), so pages served under /kapelka/ don't point at the
// domain root. External (http...), protocol-relative (//), hash, and already-based
// links are left alone. Layout .astro links use the withBase() helper instead.
const BASE = '/kapelka';
function rehypeBasePrefix() {
  const fix = (v) =>
    typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith(BASE + '/') && v !== BASE
      ? BASE + v
      : v;
  const walk = (node) => {
    if (node.type === 'element' && node.properties) {
      if (node.tagName === 'a' && node.properties.href) node.properties.href = fix(node.properties.href);
      if ((node.tagName === 'img' || node.tagName === 'source' || node.tagName === 'iframe') && node.properties.src)
        node.properties.src = fix(node.properties.src);
    }
    // Raw HTML embedded in markdown (iframes, license badge) arrives as a 'raw' string node, not an
    // element -- rewrite href/src inside it by hand.
    if (node.type === 'raw' && typeof node.value === 'string') {
      node.value = node.value.replace(/((?:href|src)=["'])(\/[^"']*)(["'])/g, (_, a, url, b) => a + fix(url) + b);
    }
    (node.children || []).forEach(walk);
  };
  return (tree) => {
    walk(tree);
  };
}

function serveEngineFromSource() {
  return {
    name: 'serve-engine-from-source',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!ENGINE_PREFIXES.some((p) => url === p || url.startsWith(p))) return next();
        const file = path.join(engineRoot, decodeURIComponent(url));
        if (!file.startsWith(engineRoot) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  site: 'https://plaincharts.github.io',
  base: '/kapelka/',
  markdown: {
    shikiConfig: {
      theme: 'night-owl-light',
    },
    rehypePlugins: [rehypeBasePrefix],
  },
  vite: {
    plugins: [serveEngineFromSource()],
  },
});
