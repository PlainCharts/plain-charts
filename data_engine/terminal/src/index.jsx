import React from 'react';
import { render } from 'ink';
import { App } from './App.jsx';

// Entry: run with `npm start` from data_engine/terminal/.
// Ink owns stdout in a full-screen TUI. The engine echoes diagnostics to console.* for the app's DevTools /
// launcher terminal -- '[app]', '[order-host]', '[cqg] ORDER TRIPWIRE', adapter discovery. In a terminal
// those flood the screen ABOVE the app and can't be cleared. Silence them; the Ink console (platform.console,
// filtered + clearable) IS the display -- genuine events still show there via status.js log() + trade-feed.
for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = () => {};

render(<App />, { patchConsole: false });
