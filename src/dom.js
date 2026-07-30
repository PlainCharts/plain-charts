// @ts-check
// Small DOM helpers shared across the app.
import { platform } from '../data_engine/index.js';
/** @param {string} id @returns {HTMLElement | null} */
export const $ = (id) => document.getElementById(id);

// App journal line. Echoed to the DevTools console and posted to the Console (Journal) panel, which
// is the durable record -- there is no longer a status bar under the toolbar. The old app.log file
// mirror was removed too: the Console IS the log now.
/** @param {string} msg @param {boolean} [isErr] */
export function log(msg, isErr) {
  if (isErr) console.error('[app]', msg);
  else console.log('[app]', msg);
  platform.console.post({ level: isErr ? 'error' : 'info', cat: 'journal', src: 'app', msg }); // Console (Journal)
}

// (setConn moved to data_engine/status.js -- adapters nudge connection state through the ENGINE, not the app.)
