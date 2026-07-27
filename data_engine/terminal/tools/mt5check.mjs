// Quick check: does MT5 bind its TCP server now (host shim), or still bail "desktop only"?
// Run: node --import ./boot/register.mjs tools/mt5check.mjs
import { bootEngine } from '../boot/engine.js';
import { loadAccounts } from '../boot/accounts.js';

const e = await bootEngine();
const a = loadAccounts().accounts.find((x) => x.protocol === 'mt5');
console.log('connecting mt5...');
await e.broker.connect(a);
await new Promise((r) => setTimeout(r, 2500));
console.log('MT5_STATUS:', JSON.stringify(e.platform.console.history().slice(-5).map((x) => x.msg)));
console.log('connected:', e.broker.isConnected('mt5'));
process.exit(0);
