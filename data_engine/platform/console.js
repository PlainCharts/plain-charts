// @ts-check
// The CONSOLE platform service — an app-wide log stream (Journal + Addons), built on channel().
// Both the app and any addon write to it and read from it through this one interface; the Console surface
// tab is just a view. Categories: 'journal' (app/server events) and 'addon' (addon activity).
import { channel } from './channel.js';

// a resolved log line as it rides the channel (all fields present). `dir` is the message DIRECTION for the journal:
// 'out' = the app sent this to the broker (a request); 'in' = the broker sent this back (a reply); '' = neither
// (app-derived/system). The Console colours by it so who-sent-what is visible at a glance.
/**
 * @typedef {{ t: number, level: string, cat: string, src: string, dir: ''|'out'|'in', msg: string }} ConsoleEntry
 */
// what a caller may pass to post(): any subset, plus a msg of any shape (stringified via asText)
/**
 * @typedef {{ t?: number, level?: string, cat?: string, src?: string, dir?: ''|'out'|'in', msg?: * }} ConsolePost
 */

const WIN = (() => { try { return new URLSearchParams(location.search).get('win') || 'w'; } catch (_) { return 'w'; } })();
const now = () => { try { return Date.now(); } catch (_) { return 0; } };
/** @param {*} m @returns {string} */
const asText = (m) => (typeof m === 'string' ? m : (() => { try { return JSON.stringify(m); } catch (_) { return String(m); } })());

export function makeConsole() {
  /** @type {import('./channel.js').Channel<ConsoleEntry>} */
  const ch = channel('console', { retain: 2000 });
  /** @param {ConsolePost} [e] */
  const post = (e = {}) => ch.post({ t: e.t || now(), level: e.level || 'info', cat: e.cat || 'journal', src: e.src || WIN, dir: e.dir === 'out' || e.dir === 'in' ? e.dir : '', msg: e.msg == null ? '' : asText(e.msg) });

  // a scoped writer bound to a source + category — e.g. platform.console.scoped('order-ticket', 'addon')
  /** @param {string} src @param {string} [cat] */
  const scoped = (src, cat = 'addon') => {
    /** @param {string} level */
    const w = (level) => /** @param {...*} m */ (...m) => post({ level, cat, src, msg: m.map(asText).join(' ') });
    return { log: w('info'), info: w('info'), warn: w('warn'), error: w('error') };
  };

  return {
    post,                          // low-level: post({ level, cat, src, msg })
    scoped,                        // scoped writer for a producer
    subscribe: ch.subscribe,       // (onMsg, onReset) -> unsubscribe
    history: ch.history,           // retained entries (this window)
    clear: ch.clear,               // wipe everywhere
  };
}
