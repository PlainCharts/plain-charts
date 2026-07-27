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
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
	'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.map': 'application/json' };

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
	markdown: {
		shikiConfig: {
			theme: 'night-owl-light',
		},
	},
	vite: {
		plugins: [serveEngineFromSource()],
	},
});
