import assert from 'node:assert/strict';
import { loadProtocol, encode } from '/data_engine/adapters/cqg/protocol.js';

// P2c: prove the CQG adapter's protobuf schema loads in a plain Node process -- the terminal supplies the
// global `protobuf` and the on-disk .proto files (boot/protobuf-host.mjs). This is exactly what threw
// "Cannot read properties of undefined (reading 'Root')" on the first live `connect cqg`.
// Run: npm run test:proto

await loadProtocol();
const buf = encode({});
assert.ok(buf instanceof Uint8Array, 'encode did not return bytes -- protobuf schema not loaded');

console.log('PASS: CQG protobuf schema loads headless; encode({}) -> ' + buf.length + ' bytes');
process.exit(0);
