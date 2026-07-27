// Host shims for running the engine in a plain Node process. Loaded via `node --import ./boot/register.mjs`
// BEFORE the entry, so both are in place before the engine's top-level `await loadAdapters()` runs.
//
//   1. resolve hook  -- maps browser-absolute specifiers ('/data_engine/...') to files (see resolver.mjs).
//   2. /api/adapters -- the engine discovers adapters by fetching this endpoint (served by the app's HTTP
//      server). There is no server here, so we answer it locally with a manifest of the on-disk adapters,
//      pointing at the same '/data_engine/adapters/<id>/index.js' URLs the resolver understands. All other
//      fetches pass through to the real implementation (adapters may hit broker REST APIs).
//
// The engine itself is unchanged -- this is the Node equivalent of the import map + server the browser gives it.

import { register, createRequire } from 'node:module';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setupProtobuf } from './protobuf-host.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));   // data_engine/terminal/boot/ -> repo root

register('./resolver.mjs', import.meta.url);

// The MT5 adapter opens a raw TCP server (the EA dials in) and gets Node's `net` via `globalThis.require`
// (the Electron nodeIntegration idiom); in plain Node that global is absent, so it bails "desktop only".
// Provide it -- now MT5 can bind (0.0.0.0:7892 by default) and the EA can connect. cwd -> repo root so
// protobufjs (which now finds `fs` through this require) reads the CQG .proto files by their relative paths.
if (typeof globalThis.require === 'undefined') globalThis.require = createRequire(import.meta.url);
try { process.chdir(ROOT); } catch (_) {}

// The CQG adapter needs the global `protobuf` + its .proto schema on disk (see protobuf-host.mjs). Set this
// up before any adapter connects.
setupProtobuf();

// Minimal browser-global stubs. The engine reads a few browser globals to detect its ROLE and window id;
// some reads are unguarded (e.g. orders/index.js `location.search`). With no window/desktop present the
// engine resolves ROLE 'solo' -- broker runs in this process, no BroadcastChannel, no proxying. We supply
// just enough of the browser surface for those reads; we are the host, exactly as the browser/Electron are.
if (typeof globalThis.location === 'undefined') globalThis.location = { search: '', href: '', pathname: '/' };

const ADAPTERS_DIR = fileURLToPath(new URL('../../adapters/', import.meta.url));   // data_engine/adapters/
function discoverAdapters() {
  try {
    return readdirSync(ADAPTERS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(new URL('../../adapters/' + e.name + '/index.js', import.meta.url)))
      .map((e) => ({ id: e.name, url: '/data_engine/adapters/' + e.name + '/index.js' }));
  } catch { return []; }
}

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url === '/api/adapters') {
    const adapters = discoverAdapters();
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ adapters }) });
  }
  if (typeof url === 'string' && url[0] === '/') {
    // an app-relative fetch with no server behind it -- fail loudly rather than hang
    return Promise.reject(new Error('engine-terminal: no server for app-relative fetch ' + url));
  }
  return realFetch(input, init);
};
