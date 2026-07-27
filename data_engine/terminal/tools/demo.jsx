import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../src/App.jsx';
import { bootEngine } from '../boot/engine.js';
import { loadAccounts } from '../boot/accounts.js';

// Render the REAL terminal console with live data and print the actual frame. Boot -> connect -> send a
// command -> capture the screen. Run: node --import ./boot/register.mjs tools/demo.jsx
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let eng;
const boot = async () => { eng = await bootEngine(); return eng; };

const { lastFrame } = render(<App engineBoot={boot} withMcp={false} />);

for (let i = 0; i < 60 && !eng; i++) await wait(50);
const acct = loadAccounts().accounts.find((a) => a.protocol === 'cqg');
await eng.broker.connect(acct);
await wait(3000);
await eng.command({ type: 'place', orderType: 'limit', ctx: { broker: 'cqg', symbol: 'EP' }, side: 'buy', qty: 1, price: 7000, tif: 'day' });
await wait(2500);

process.stdout.write('\n========== TERMINAL CONSOLE (live) ==========\n' + (lastFrame() || '') + '\n=============================================\n');
process.exit(0);
