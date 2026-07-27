import assert from 'node:assert/strict';
import { dispatch } from '../src/commands.js';
import { loadAccounts } from '../boot/accounts.js';

// P2c-1: command layer unit test. Verifies account listing + connect resolution/dispatch against a MOCK
// broker -- no live broker needed. Live connect is verified by running the terminal against a real session.
// Run: npm run test:cmds  (node --import ./boot/register.mjs test/commands.test.jsx)

const lines = [];
const ctx = (engine) => ({
  engine,
  accounts: loadAccounts().accounts,
  print: (x) => lines.push(...(Array.isArray(x) ? x : [x])),
  clear: () => {},
  exit: () => {},
});

// accounts: lists the saved broker accounts from settings/brokers/accounts.json
lines.length = 0;
await dispatch(ctx(null), 'accounts');
assert.ok(lines.some((l) => /cqg/.test(l)), 'accounts should list the cqg account');
assert.ok(lines.some((l) => /mt5/.test(l)), 'accounts should list the mt5 account');

// connect <protocol>: resolves the saved account by protocol and calls broker.connect with it
let captured = null;
const mockEngine = {
  broker: { connect: async (a) => { captured = a; return { id: a.protocol }; }, isConnected: () => false, connections: () => [] },
  listBrokers: () => [{ id: 'cqg' }],
};
lines.length = 0;
await dispatch(ctx(mockEngine), 'connect cqg');
assert.ok(captured, 'broker.connect was not called');
assert.equal(captured.protocol, 'cqg', 'connect resolved the wrong protocol');
assert.equal(captured.name, 'CQG 06.09.26', 'connect resolved the wrong saved account');
assert.ok(lines.some((l) => /connecting CQG/.test(l)), 'no connecting feedback');

// connect with no match: clear message, no dispatch
captured = null; lines.length = 0;
await dispatch(ctx(mockEngine), 'connect nope');
assert.equal(captured, null, 'connect should not dispatch on no match');
assert.ok(lines.some((l) => /no saved account matches/.test(l)), 'missing no-match message');

// unknown command
lines.length = 0;
await dispatch(ctx(mockEngine), 'frobnicate');
assert.ok(lines.some((l) => /unknown command/.test(l)), 'unknown command not handled');

console.log('PASS: command layer (accounts list, connect resolves+dispatches, no-match + unknown handled)');
process.exit(0);
