// Send a small market BTCUSD order on the MT5 demo and show the console IN/OUT + resulting position.
// Run: node --import ./boot/register.mjs tools/mt5btc.mjs
import { bootEngine } from '../boot/engine.js';
import { loadAccounts } from '../boot/accounts.js';

const e = await bootEngine();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const a = loadAccounts().accounts.find((x) => x.protocol === 'mt5');

console.log('connecting mt5...');
await e.broker.connect(a);
await wait(3000);
console.log('connected:', e.broker.isConnected('mt5'));

console.log('\nplacing MARKET BUY 0.01 BTCUSD...');
console.log('result:', JSON.stringify(await e.command({ type: 'place', ctx: { broker: 'mt5', symbol: 'BTCUSD' }, side: 'buy', qty: 0.01 })));
await wait(3000);

console.log('\n--- console (dir / src / msg) ---');
for (const c of e.platform.console.history().slice(-8)) console.log((c.dir || '  ').toUpperCase().padEnd(3), String(c.src || '').padEnd(4), c.msg);

console.log('\n--- BTCUSD positions ---');
for (const p of e.platform.positions.all().filter((p) => (p.symbol || '').includes('BTC'))) console.log(JSON.stringify({ symbol: p.symbol, side: p.side, qty: p.qty, avgPrice: p.avgPrice }));
process.exit(0);
