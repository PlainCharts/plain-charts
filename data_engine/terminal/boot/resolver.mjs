// Node module hooks that let the engine (plain ESM) and the TUI (JSX) run in one plain Node process.
// Registered from register.mjs via module.register; runs in the loader thread.
//
//   resolve -- teaches Node the browser-absolute specifiers the engine + adapters use
//              ('/data_engine/...', '/src/...', '/lib/...', '/addons/...'). The browser resolves these via
//              its import map + dev server; here we rewrite the leading slash to a real file URL.
//   load    -- .jsx/.tsx: transform with esbuild (the TUI). Engine .js: load as NATIVE ESM. The engine
//              files are valid ES modules but the repo has no package.json "type":"module", so Node would
//              default them to CommonJS and choke on the engine's top-level await (broker-core.js). Forcing
//              format:'module' lets Node evaluate them natively -- top-level await supported, no transpile.
//              node_modules is left alone (React/Ink resolve per their own package.json).
//
// The engine is untouched: this is the Node equivalent of the import map + module types the browser supplies.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = new URL('../../../', import.meta.url);   // data_engine/terminal/boot/ -> repo root
const MAPPED = ['/data_engine/', '/src/', '/lib/', '/addons/'];

/** @param {string} specifier */
export async function resolve(specifier, context, nextResolve) {
  if (specifier[0] === '/' && MAPPED.some((p) => specifier.startsWith(p))) {
    return nextResolve(new URL(specifier.slice(1), ROOT).href, context);   // '/data_engine/x' -> file://<root>/data_engine/x
  }
  return nextResolve(specifier, context);
}

/** @param {string} url */
export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx') || url.endsWith('.tsx')) {
    const raw = await readFile(fileURLToPath(url), 'utf8');
    const { code } = await transform(raw, {
      loader: url.endsWith('.tsx') ? 'tsx' : 'jsx',
      format: 'esm', jsx: 'automatic', target: 'node22', sourcefile: url,
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  if (url.endsWith('.js') && !url.includes('/node_modules/')) {
    return nextLoad(url, { ...context, format: 'module' });   // engine .js: plain ESM, evaluate natively (TLA works)
  }
  return nextLoad(url, context);
}
