// @ts-check
// Watcher — an automated price-condition executor. A pure, modular rules engine: it watches price
// and, when price REACHES OR PASSES a rule's level on its trigger side, fires ONE immediate MARKET
// order. That is its only output. There are NO resting orders, no OCO. Fully app-automated.
//
// The trigger is a HALF-LINE per rule (dir), with a threshold buffer:
//     dir:'up'   -> fire when  price >= level - threshold   (at/above the level, and everywhere beyond)
//     dir:'down' -> fire when  price <= level + threshold   (at/below the level, and everywhere beyond)
// So a level fires the instant price reaches it AND everywhere past it — a gap or fast move can't skip
// it (which a symmetric "within X" window would). The threshold shifts the trigger a few ticks EARLY;
// it never caps it into a window. threshold is in price units (consumer sets it, e.g. ticks*tickSize).
// The dir is fixed by the level's role (a long stop = 'down', its target = 'up', short mirrored; an
// entry = toward where it sits vs price) — never guessed from live price. No dir -> plain vicinity.
//
// No broker and no DOM live here: the consumer injects execution + live position, so the engine is
// reusable across addons and testable with a mock executor (drive onPrice, assert execute calls).
//
//   const w = createWatcher({ execute, getPosition, threshold });
//     execute({ side:'buy'|'sell', qty })  -> place an immediate MARKET order (the only action)
//     getPosition() -> { side:'long'|'short', qty } | null   (read live at fire time)
//     threshold -> price-units vicinity (default 0 = exact). Change later with w.setThreshold(t).
//
//   const id = w.add({ price, dir:'up'|'down', action });
//     action = { do:'buy',  qty }     buy qty (absolute)
//              { do:'sell', qty }     sell qty (absolute)
//              { do:'close' }         close the full live position (opposite side, live qty)
//              { do:'close', qty }    close qty of the live position (opposite side)
//
//   w.update(id, { price })   // the user dragged the level -> just moves it
//   w.arm(id) / w.disarm(id) / w.remove(id) / w.get(id) / w.rules() / w.clear()
//   w.setThreshold(t) / w.threshold()
//   w.onPrice(px)             // call on every tick; fires any armed rule within threshold of price
//   w.onFire((rule, cmd) => …)   // after a rule fires (UI drops the line, updates status, …)
//
// Position-awareness replaces OCO: a 'close' rule resolves against the LIVE position at fire time, so
// once a close flattens the position, any remaining 'close' rules resolve to nothing (cmd = null).

/**
 * @typedef {{ do: 'buy'|'sell'|'close', qty?: number }} Action
 * @typedef {{ side: 'buy'|'sell', qty: number, close?: boolean, full?: boolean }} Command  close/full tag a position EXIT (vs an entry): the consumer must CLOSE the live position account-aware (hedging closes lots by ticket; netting offsets), not place a raw opposite order
 * @typedef {{ side: 'long'|'short', qty: number }} Position
 * @typedef {{ id: string, price: number, dir: 'up'|'down'|null, action: Action, armed: boolean, fired: boolean }} Rule
 * @typedef {(rule: Rule, cmd: Command|null) => void} FireCb
 * @typedef {{ execute?: (cmd: Command) => void, getPosition?: () => Position|null, threshold?: number }} WatcherOpts
 */

let seq = 0;
/** @param {'long'|'short'} side @returns {'sell'|'buy'} */
const opposite = (side) => (side === 'long' ? 'sell' : 'buy');

/** @param {WatcherOpts} [opts] */
export function createWatcher({ execute, getPosition, threshold = 0 } = {}) {
  /** @type {Map<string, Rule>} */
  const rules = new Map(); // id -> rule
  /** @type {Set<FireCb>} */
  const fireCbs = new Set();
  let thr = Math.abs(Number(threshold)) || 0; // vicinity in PRICE units
  /** @param {Rule} rule @param {Command|null} cmd */
  const notify = (rule, cmd) =>
    fireCbs.forEach((fn) => {
      try {
        fn(rule, cmd);
      } catch (_) {}
    });

  // translate an action into a market command using the LIVE position for closes. null = nothing to do.
  /** @param {Action|null|undefined} action @param {Position|null} pos @returns {Command|null} */
  function resolve(action, pos) {
    if (!action) return null;
    if (action.do === 'buy')
      return /** @type {number} */ (action.qty) > 0 ? { side: 'buy', qty: /** @type {number} */ (action.qty) } : null;
    if (action.do === 'sell')
      return /** @type {number} */ (action.qty) > 0 ? { side: 'sell', qty: /** @type {number} */ (action.qty) } : null;
    if (action.do === 'close') {
      if (!pos || !(pos.qty > 0)) return null; // already flat -> nothing
      const full = action.qty == null; // no qty -> close the whole live position
      const qty = full ? pos.qty : Math.min(/** @type {number} */ (action.qty), pos.qty); // partial or full
      return qty > 0 ? { side: opposite(pos.side), qty, close: true, full } : null; // close: EXIT the position account-aware (not a raw opposite order)
    }
    return null;
  }

  return {
    /** @param {{ price: number|string, dir?: 'up'|'down'|null, action: Action, armed?: boolean }} rule @returns {string} */
    add(rule) {
      const id = 'w' + (++seq).toString(36);
      rules.set(id, {
        id,
        price: Number(rule.price),
        dir: rule.dir || null,
        action: rule.action,
        armed: rule.armed !== false,
        fired: false,
      });
      return id;
    },
    /** @param {string} id @param {{ price?: number|string, dir?: 'up'|'down'|null, action?: Action }} [patch] */
    update(id, patch = {}) {
      const r = rules.get(id);
      if (!r) return;
      if (patch.price != null) r.price = Number(patch.price);
      if (patch.dir !== undefined) r.dir = patch.dir;
      if (patch.action) r.action = patch.action;
    },
    /** @param {string} id */
    arm(id) {
      const r = rules.get(id);
      if (r) {
        r.armed = true;
        r.fired = false;
      }
    },
    /** @param {string} id */
    disarm(id) {
      const r = rules.get(id);
      if (r) r.armed = false;
    },
    /** @param {string} id */
    remove(id) {
      rules.delete(id);
    },
    /** @param {string} id @returns {Rule|null} */
    get(id) {
      return rules.get(id) || null;
    },
    rules() {
      return [...rules.values()];
    },
    /** @param {FireCb} fn @returns {() => boolean} */
    onFire(fn) {
      fireCbs.add(fn);
      return () => fireCbs.delete(fn);
    },
    clear() {
      rules.clear();
    },
    /** @param {number|string} t */
    setThreshold(t) {
      thr = Math.abs(Number(t)) || 0;
    },
    threshold() {
      return thr;
    },

    // fire every armed, un-fired rule that price has REACHED OR PASSED on its trigger side. dir is a
    // HALF-LINE (up = fire at/above the level, down = fire at/below), so a level fires the instant price
    // reaches it AND everywhere beyond it (gaps/fast moves can't skip it). The threshold shifts the
    // trigger a few ticks EARLY; it does not cap it into a window. (No dir -> plain vicinity fallback.)
    /** @param {number|null|undefined} px */
    onPrice(px) {
      if (px == null || !isFinite(px)) return;
      for (const r of rules.values()) {
        if (!r.armed || r.fired || !isFinite(r.price)) continue;
        const hit =
          r.dir === 'up' ? px >= r.price - thr : r.dir === 'down' ? px <= r.price + thr : Math.abs(px - r.price) <= thr;
        if (!hit) continue;
        const cmd = resolve(r.action, getPosition ? getPosition() : null);
        r.fired = true;
        r.armed = false;
        rules.delete(r.id); // one-shot: gone, can never re-fire
        if (cmd && execute) {
          try {
            execute(cmd);
          } catch (_) {}
        }
        notify(r, cmd);
      }
    },
  };
}
