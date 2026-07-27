import React from 'react';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { App } from '../src/App.jsx';

// The console shell, no engine (engineBoot=null): just the status line. Run: npm test
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { lastFrame, unmount } = render(<App engineBoot={null} withMcp={false} />);
  await delay(30);
  const f = lastFrame();
  assert.match(f, /engine console/, 'status line missing');
  assert.match(f, /mcp: off/, 'mcp status missing');
  assert.match(f, /0 msgs/, 'message count missing');
  unmount();
  console.log('PASS: console shell renders (no engine)');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
