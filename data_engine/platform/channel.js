// @ts-check
// channel — a cross-window APPEND STREAM. One of the two platform primitives (the other is store()).
//
// A channel is an ordered feed of messages shared across EVERY window (BroadcastChannel), with an optional
// retained ring so a late subscriber sees recent history. Producer-agnostic: the app and any addon post to
// it and subscribe to it through the exact same interface. This is the substrate under the Console and any
// activity/event feed.
//
//   const ch = channel('console', { retain: 2000 });
//   ch.post(msg)                 -> append + fan out to this window AND all others
//   ch.subscribe(onMsg, onReset) -> onMsg(msg) per post; onReset() on clear; returns unsubscribe
//   ch.history()                 -> retained messages (this window)
//   ch.clear()                   -> empty the ring everywhere + fire onReset
//
// Self-contained: no app imports, so it is safe to use from any window role (chart / data-host / addon-host).
/**
 * @template T
 * @typedef {{ onMsg?: (msg: T) => void, onReset?: () => void }} ChannelSub
 */
/**
 * @template T
 * @typedef {Object} Channel
 * @property {(msg: T) => void} post
 * @property {(onMsg?: (msg: T) => void, onReset?: () => void) => (() => void)} subscribe
 * @property {() => T[]} history
 * @property {() => void} clear
 */
import { IPC } from '../ipc.js'; // the engine's cross-window channel names (single source of truth)

/**
 * @template T
 * @param {string} name
 * @param {{ retain?: number }} [opts]
 * @returns {Channel<T>}
 */
export function channel(name, { retain = 0 } = {}) {
  /** @type {T[]} */
  const ring = [];
  /** @type {Set<ChannelSub<T>>} */
  const subs = new Set(); // { onMsg, onReset }
  /** @type {BroadcastChannel | null} */
  let bc = null;
  try {
    bc = new BroadcastChannel(IPC.CHANNEL_PREFIX + name);
  } catch (_) {}

  /** @param {T} msg */
  const fanMsg = (msg) => {
    if (retain > 0) {
      ring.push(msg);
      if (ring.length > retain) ring.shift();
    }
    for (const s of subs) {
      try {
        s.onMsg && s.onMsg(msg);
      } catch (_) {}
    }
  };
  const fanReset = () => {
    ring.length = 0;
    for (const s of subs) {
      try {
        s.onReset && s.onReset();
      } catch (_) {}
    }
  };

  if (bc)
    bc.onmessage = (e) => {
      const d = e && e.data;
      if (!d) return;
      if (d.__reset) fanReset();
      else fanMsg(d.msg);
    };

  return {
    post(msg) {
      fanMsg(msg);
      if (bc) {
        try {
          bc.postMessage({ msg });
        } catch (_) {}
      }
    },
    subscribe(onMsg, onReset) {
      const s = { onMsg, onReset };
      subs.add(s);
      return () => subs.delete(s);
    },
    history() {
      return ring.slice();
    },
    clear() {
      fanReset();
      if (bc) {
        try {
          bc.postMessage({ __reset: true });
        } catch (_) {}
      }
    },
  };
}
