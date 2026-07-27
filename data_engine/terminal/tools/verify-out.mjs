// Prove the console shows IN and OUT for a real command: on the DEMO account, place a buy limit far below
// market (rests, never fills) -> OUT (place) + IN (working), then cancel it -> OUT (cancel) + IN (cancelled).
// Fully reversible. Run: node --import ./boot/register.mjs tools/verify-out.mjs
import { bootEngine } from '../boot/engine.js';
import { loadAccounts } from '../boot/accounts.js';

const engine = await bootEngine();
const acct = loadAccounts().accounts.find((a) => a.protocol === 'cqg');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (label) => {
  console.log('\n--- console after ' + label + ' ---');
  for (const e of engine.platform.console.history().slice(-6)) {
    console.log((e.dir || '  ').toUpperCase().padEnd(3), String(e.src || '').padEnd(5), e.msg);
  }
};

console.log('connecting cqg...');
await engine.broker.connect(acct);
await wait(3000);
console.log('connected:', engine.broker.isConnected());

console.log('\nplacing BUY LIMIT 1 EP @ 7000 (far below market, will rest)...');
console.log('result:', JSON.stringify(await engine.command({ type: 'place', orderType: 'limit', ctx: { broker: 'cqg', symbol: 'EP' }, side: 'buy', qty: 1, price: 7000, tif: 'day' })));
await wait(2500);
show('PLACE');

console.log('\ncancelling working orders on EP...');
console.log('result:', JSON.stringify(await engine.command({ type: 'cancelWorking', broker: 'cqg', symbol: 'EP' })));
await wait(2500);
show('CANCEL');

console.log('\nworking orders left on EP:', engine.platform.orders.all().filter((o) => o.symbol && o.symbol.includes('EP') && o.status && !['filled', 'cancelled', 'canceled', 'rejected'].includes(o.status)).length);
process.exit(0);
