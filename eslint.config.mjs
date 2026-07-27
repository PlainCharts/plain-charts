// ESLint flat config -- the QUALITY lens, companion to tsc (the type lens). tsc answers "is this
// correct?"; ESLint answers "is this good?": bug/smell rules tsc doesn't cover (unused vars, unreachable
// code, `==`, empty blocks). ALL formatting/stylistic rules are OFF on purpose -- this codebase's dense
// one-liner style is deliberate; layout is Prettier's job (or no one's), never ESLint's.
//
// Scope matches the type-checker: src/ + adapters/ + addons/. No type-aware rules (fast, no tsconfig
// wiring). `no-undef` is OFF because tsc already resolves every reference (and knows the real imports/
// globals) far better than ESLint could without a globals map.
import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';

export default [
  { ignores: ['**/*.d.ts', 'data_engine/terminal/**'] },   // .d.ts: espree can't parse (type-only). terminal/: a self-contained React+Ink dev tool with its own toolchain, not app/engine source.
  {
    files: ['src/**/*.js', 'data_engine/**/*.js', 'addons/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    plugins: { 'import-x': importX },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',                                                                        // tsc owns reference resolution
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'eqeqeq': ['error', 'smart'],                                                             // require === but allow the intentional `== null`
      'no-constant-condition': ['error', { checkLoops: false }],                                // allow `while (true)`
      'no-empty': ['error', { allowEmptyCatch: true }],                                         // the many `catch (_) {}` are intentional
      // ENFORCE the layered DAG: dependencies point one direction only. A circular STATIC import means two modules
      // are really one responsibility -- fix by extracting the shared piece or inverting via a callback (store.render).
      // Now hard 'error': a new static cycle blocks the build, same automatic guard as tsc. ignoreExternal skips
      // node_modules; unresolvable root-relative ('/src/..') imports are skipped. allowUnsafeDynamicCyclicDependency
      // permits a cycle that routes through a DYNAMIC import -- that is a lazy load (no init-order cycle), the accepted
      // way for a lower module to open an on-demand dialog (layout -> symbol-search / layout-builder).
      'import-x/no-cycle': ['error', { ignoreExternal: true, allowUnsafeDynamicCyclicDependency: true }],
    },
  },
  // THE ENGINE BOUNDARY: app code (src/) and addons reach the engine ONLY through its public entry
  // (data_engine/index.js) -- never its internals. Same rule kapelka enforces via its chart API. The
  // engine's own files and the HTML boot entries (unlinted) are the only places internals may be touched.
  {
    files: ['src/**/*.js', 'addons/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['**/data_engine/**', '!**/data_engine/index.js'],
        message: 'Import the engine through data_engine/index.js (the public API), never its internals.',
      }] }],
    },
  },
  // addon ENTRY files are CommonJS (require / module.exports); an addon's manifest is eval'd as CJS.
  { files: ['addons/**/*.js'], languageOptions: { sourceType: 'commonjs' } },
  // adapter SERVER HOOKS are CommonJS too -- they run in the app's local server process, which
  // mounts data_engine/adapters/<id>/server.js via the generic adapter-hook contract (server/adapter-hooks.js).
  { files: ['data_engine/adapters/*/server.js'], languageOptions: { sourceType: 'commonjs' } },
  // ...but an addon may be SPLIT into ES modules loaded via dynamic import() (order-ticket and position-manager
  // were both refactored this way). Those sibling files use export/import, so they must lint as modules. The CJS
  // entry stays index.js (excluded here).
  {
    files: ['addons/order-ticket/*.js', 'addons/position-manager/*.js', 'addons/pacman/*.js'],
    ignores: ['addons/order-ticket/index.js', 'addons/position-manager/index.js', 'addons/pacman/index.js'],
    languageOptions: { sourceType: 'module' },
  },
];
