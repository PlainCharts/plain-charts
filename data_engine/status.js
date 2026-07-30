// @ts-check
// Engine status reporting -- the engine's own log + connection-state nudge, replacing the app's
// src/dom.js as the target for adapter/bridge status calls. The engine owns the journaling (DevTools
// echo + Console journal); anything DISPLAY-side (the app's status line under the toolbar) is an
// installable sink the app provides -- the engine never touches app DOM.
import { platform } from './platform/index.js';
import { bus } from './bus.js';

/** @type {((msg: string, isErr?: boolean) => void) | null} */
let sink = null;
/** App hook: mirror engine log lines onto an app display (e.g. the status line). @param {(msg: string, isErr?: boolean) => void} fn */
export function setStatusSink(fn) {
  sink = fn;
}

/** Engine log: DevTools echo + Console (Journal) + the app's display sink when installed.
 * @param {string} msg @param {boolean} [isErr] */
export function log(msg, isErr) {
  if (isErr) console.error('[app]', msg);
  else console.log('[app]', msg);
  platform.console.post({ level: isErr ? 'error' : 'info', cat: 'journal', src: 'app', msg }); // Console (Journal)
  if (sink) sink(msg, isErr);
}

// Adapters call this on connect/disconnect/ws-state changes. The top bar shows a live chip per
// CONNECTED account, so we just nudge listeners to re-read the real per-broker state.
/** @param {string} [_text] @param {string} [_color] */
export function setConn(_text, _color) {
  bus.emit('connections:changed');
}
