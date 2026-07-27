import assert from 'node:assert/strict';
import { bootEngine } from '../boot/engine.js';

// Prove the order worker runs IN-PROCESS: boot registers orders/host.js, and engine.command() dispatches
// to it locally (solo -- no separate order-host). `echo` is the worker's built-in probe; it returns the
// current book sizes. This is the channel MCP will use to drive orders. Run: npm run test:orderworker

const engine = await bootEngine();
assert.equal(typeof engine.command, 'function', 'engine.command missing');

const res = await engine.command({ type: 'echo', ping: 42 });
assert.ok(res, 'no result from command(echo)');
assert.deepEqual(res.echoed, { type: 'echo', ping: 42 }, 'echo did not round-trip the command');
assert.ok(res.book && typeof res.book.positions === 'number' && typeof res.book.orders === 'number', 'worker did not report book sizes');

// an unknown command rejects (handler lookup) -- confirms the worker is really the one answering
await assert.rejects(() => engine.command({ type: 'definitely-not-a-command' }), /unknown order command/);

console.log('PASS: order worker runs in-process; command() -> worker (echo book: ' + JSON.stringify(res.book) + ')');
process.exit(0);
