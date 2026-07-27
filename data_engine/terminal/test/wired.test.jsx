import React from 'react';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { App } from '../src/App.jsx';

// The console displays the platform.console stream with IN/OUT direction -- the same stream the app renders,
// the same stream the order worker (dir:'out') and trade-feed (dir:'in') post to. Drive a FAKE engine's
// console and assert the entries render with direction. Run: npm run test:wired

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeEngine() {
  const subs = new Set();
  const consoleStore = {
    history: [],
    post(e) { const full = { t: Date.now(), level: 'info', cat: 'journal', src: '', dir: '', msg: '', ...e }; subs.forEach((s) => s.onMsg && s.onMsg(full)); },
    subscribe(onMsg, onReset) { const s = { onMsg, onReset }; subs.add(s); return () => subs.delete(s); },
    clear() { subs.forEach((s) => s.onReset && s.onReset()); },
  };
  return {
    platform: { console: consoleStore },
    broker: { connections: () => [{ id: 'cqg', connected: true }] },
    bus: { on: () => () => {} },
    listBrokers: () => [{ id: 'cqg' }],
    _console: consoleStore,
  };
}

async function main() {
  const eng = fakeEngine();
  const { lastFrame, stdin, unmount } = render(<App engineBoot={async () => eng} withMcp={false} />);
  await delay(50);

  assert.match(lastFrame(), /engine console/, 'status line missing');
  assert.match(lastFrame(), /session: cqg/, 'connection not reflected');

  // OUT: a command we send the broker (order worker posts these dir:'out')
  eng._console.post({ dir: 'out', src: 'cqg', msg: 'BUY 1 MES' });
  // IN: the broker's reply (trade-feed posts these dir:'in')
  eng._console.post({ dir: 'in', src: 'cqg', msg: 'FILL 1 @ 7568.00' });
  await delay(40);

  const f = lastFrame();
  assert.match(f, /OUT .*cqg .*BUY 1 MES/, 'outbound command not shown with OUT');
  assert.match(f, /IN  .*cqg .*FILL 1 @ 7568\.00/, 'inbound reply not shown with IN');
  assert.match(f, /2 msgs/, 'message count not updated');

  // 'c' clears the console
  stdin.write('c');
  await delay(40);
  assert.doesNotMatch(lastFrame(), /BUY 1 MES/, 'clear did not remove entries');

  unmount();
  console.log('PASS: console renders IN/OUT stream + clears on c');
  process.exit(0);
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
