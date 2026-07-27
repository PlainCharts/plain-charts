import assert from 'node:assert/strict';
import { bootEngine } from '../boot/engine.js';

// Milestone 2a: prove the engine boots in a plain Node process (ROLE solo) with the terminal's host
// shims -- adapters discovered + registered, public API present. No broker connection here.
// Run: npm run test:engine  (node --import tsx --import ./boot/register.mjs test/engine-boot.test.jsx)

const engine = await bootEngine();

const ids = engine.listBrokers().map((a) => a.id).sort();
console.log('registered adapters:', ids.join(', ') || '(none)');

assert.ok(ids.length >= 1, 'no adapters registered -- resolver/fetch host shims not working');
assert.ok(ids.includes('cqg'), 'cqg reference adapter missing');
assert.equal(typeof engine.broker, 'object', 'broker facade missing from public API');
assert.equal(typeof engine.platform, 'object', 'platform stores missing from public API');
assert.equal(typeof engine.listBrokers, 'function', 'listBrokers missing from public API');

console.log('PASS: engine boots in-process (solo), adapters registered, public API present');
process.exit(0);
