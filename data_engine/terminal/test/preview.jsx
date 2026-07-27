import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../src/App.jsx';

// Dev helper: render the console with a few sample IN/OUT rows so the layout can be eyeballed. Run: npm run preview
function fakeEngine() {
  const subs = new Set();
  const seed = [
    { t: Date.now(), level: 'info', cat: 'journal', src: 'app', dir: '', msg: 'Opening Demo (wss://demoapi.cqg.com:443)...' },
    { t: Date.now(), level: 'info', cat: 'journal', src: 'app', dir: '', msg: 'Logged on.' },
    { t: Date.now(), level: 'info', cat: 'journal', src: 'cqg', dir: 'out', msg: 'BUY 1 MES' },
    { t: Date.now(), level: 'info', cat: 'journal', src: 'cqg', dir: 'in', msg: 'order 2079464844 accepted' },
    { t: Date.now(), level: 'info', cat: 'journal', src: 'cqg', dir: 'in', msg: 'FILL 1 @ 7568.00' },
    { t: Date.now(), level: 'error', cat: 'journal', src: 'cqg', dir: 'in', msg: 'REJECT -- insufficient margin' },
  ];
  return {
    platform: { console: { history: seed, post() {}, subscribe: () => () => {} } },
    broker: { connections: () => [{ id: 'cqg', connected: true }] },
    bus: { on: () => () => {} },
    listBrokers: () => [{ id: 'cqg' }],
  };
}

const { lastFrame } = render(<App engineBoot={async () => fakeEngine()} withMcp={false} />);
setTimeout(() => { process.stdout.write((lastFrame() || '') + '\n'); process.exit(0); }, 120);
