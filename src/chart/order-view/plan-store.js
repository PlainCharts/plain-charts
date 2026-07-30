// @ts-check
// Shared PLAN state for on-chart order planning (the gray projection dot today; bracket levels next). UI-only -- it is
// NOT the order book and never touches a broker; it just records "the user is planning on this instrument". Held in
// memory and synced across windows over the ORDER_PLAN BroadcastChannel, so a plan set by a CONTROL window (the Order
// dialog) is drawn by every chart of that (broker, symbol) and OUTLIVES the control window: closing the Order dialog
// does NOT erase a plan the chart is showing. A window that opens late QUERIES for a snapshot so its UI reflects
// reality. PERSISTED to settings/trading/order-plan.json (via /api/order-plan): a toggle survives an app restart --
// it stays until you untoggle it. Keyed by broker:symbol; an empty broker is a broker-agnostic plan (matches any pane
// of the symbol).
import { IPC } from '../../ipc-contract.js';
import { getJSON, postJSON } from '../../api.js';
import { stopDragFlip } from './plan-rules.js';

/** @param {string} broker @param {string} symbol */
const keyOf = (broker, symbol) => (broker || '') + ':' + symbol;

/** @typedef {{ stop?: number|null, target?: number|null, qty?: number|null }} PlanLevel  one rung of the plan ladder (a stop and/or a target, plus the rung's exit qty) */
/** @typedef {{ entry?: boolean, stop?: boolean, target?: boolean }} PlanVis  per-category dot visibility (absent/true = shown) */
/** @typedef {{ project?: boolean, bracket?: boolean, armed?: boolean, ref?: number|null, levels?: PlanLevel[], dir?: string|null, anchor?: number|null, activeIdx?: number|null, vis?: PlanVis|null, qty?: number|null, orderType?: string|null, side?: string|null, owner?: string|null, sizing?: { risk: number, stop: number }|null }} Plan
 *  levels[] is the bracket LADDER: level 0 is the app's own bracket (the dialog SL/TP + the on-chart bracket); levels 1+
 *  are EXTRA rungs a multi-level caller (the automation addon) adds. Numbered on screen when there is more than one.
 *  armed marks the plan LIVE (session-only): the automation switched from planning to live -- its entry is a real
 *  watcher trigger now. The overlay draws an armed bracket in the LIVE colours; a plain (unarmed) bracket stays a plan.
 *  activeIdx is the LIVE ladder progress (session-only): which rung the automation is currently working; rungs below it
 *  are done. null/absent means not applicable (no live ladder).
 *  vis is per-category dot VISIBILITY (session-only, pure show/hide -- never affects orders): entry / stop / target,
 *  absent or true = shown. The overlay filters its dots by it; the automation's Visibility toggles + Hide-on-entry
 *  write it.
 *  qty is the planned ENTRY volume (session-only, synced): ONE shared value behind every control surface -- the
 *  dialog's Volume field and the on-chart pill's qty cell edit the same number; each mirrors the other. In Stake mode
 *  it MIRRORS the computed stake volume (the Volume box's live preview), so the pill never shows a stale/own number.
 *  sizing is the STAKE intent ({ risk, stop }, session-only): set while the dialog is in Stake mode. When present, the
 *  pill's V places via the SAME worker sizing the dialog's Buy/Sell uses -- so both paths size identically (qty is only
 *  the display). null in Units mode (qty is authoritative there).
 *  orderType is the planned entry's TYPE ('market'|'limit'|'stop', session-only, synced): the pill's type cell
 *  and the dialog's Market/Limit/Stop tabs are two views of it -- picking on one switches the other.
 *  side is the planned entry's SIDE ('buy'|'sell', session-only, synced, default buy): the pill's B/S cell picks
 *  it; the confirm (V) places with it. The dialog has no persistent side control -- its Buy/Sell buttons ARE the
 *  action -- so nothing mirrors there.
 *  owner marks WHICH surface owns the current plan (an addon id like 'order-ticket'; absent/null = the app).
 *  Owner-aware behavior: the pill controller's V ARMS an owned plan (setArmed) instead of placing directly --
 *  the owner reacts to the shared flags (armed on -> its Arm; project off -> its pending clears). Cleared with
 *  the projection. */
/** @type {Map<string, Plan>} */
const state = new Map();
/** @type {Set<() => void>} */
const subs = new Set();
const ch = new BroadcastChannel(IPC.ORDER_PLAN);
const notify = () =>
  subs.forEach((f) => {
    try {
      f();
    } catch (_) {}
  });

ch.onmessage = (/** @type {MessageEvent} */ e) => {
  const m = e.data;
  if (!m || !m.op) return;
  if (m.op === 'set') {
    const cur = state.get(m.key) || {};
    state.set(m.key, { ...cur, ...m.patch });
    notify();
  } else if (m.op === 'query') {
    try {
      ch.postMessage({ op: 'snapshot', entries: [...state.entries()] });
    } catch (_) {}
  } else if (m.op === 'snapshot' && Array.isArray(m.entries)) {
    let changed = false;
    for (const [k, v] of m.entries) {
      if (!state.has(k)) {
        state.set(k, v);
        changed = true;
      }
    } // fill only gaps; a local opinion wins
    if (changed) notify();
  }
};
// HYDRATE from disk (the persisted plan), then ask any already-open window for in-session changes. Disk load lets a
// projection survive an app restart; the snapshot query catches a mid-session window up to unsaved-but-live changes.
getJSON('/api/order-plan')
  .then((saved) => {
    let changed = false;
    if (saved && typeof saved === 'object')
      for (const k of Object.keys(saved)) {
        if (!state.has(k)) {
          state.set(k, saved[k]);
          changed = true;
        }
      }
    if (changed) notify();
  })
  .catch(() => {});
try {
  ch.postMessage({ op: 'query' });
} catch (_) {}

// SAVE the plan to disk (only the ACTIVE entries -- an untoggled instrument is dropped, so the file stays clean).
// Written immediately on a local change so a toggle isn't lost if the window closes right after (no debounce race).
// ONLY the Project flag persists -- Bracket is deliberately session-only, so it RESETS to off on every app restart
// (levels re-seed anyway). bracket => project, so a saved entry always means a projection.
function persist() {
  /** @type {Record<string, { project?: boolean }>} */
  const obj = {};
  for (const [k, v] of state) {
    if (v && v.project) obj[k] = { project: true };
  }
  try {
    postJSON('/api/order-plan', obj);
  } catch (_) {}
}

/** local write + broadcast, optionally persist @param {string} broker @param {string} symbol @param {Plan} patch @param {boolean} [doPersist] */
function set(broker, symbol, patch, doPersist) {
  if (!symbol) return;
  const key = keyOf(broker, symbol);
  const cur = state.get(key) || {};
  state.set(key, { ...cur, ...patch });
  notify();
  try {
    ch.postMessage({ op: 'set', key, patch });
  } catch (_) {}
  if (doPersist) persist(); // only flag changes hit disk; level drags just sync in memory
}

/** @param {Plan|undefined} v @param {'project'|'bracket'|'armed'} flag */
const flagOn = (v, flag) => !!(v && v[flag]);
/** is (broker, symbol)'s <flag> on? a broker-agnostic (empty-broker) plan matches any broker. @param {string} broker @param {string} symbol @param {'project'|'bracket'|'armed'} flag */
function isFlag(broker, symbol, flag) {
  if (!symbol) return false;
  return flagOn(state.get(keyOf(broker, symbol)), flag) || flagOn(state.get(keyOf('', symbol)), flag);
}

/** @param {string} broker @param {string} symbol */
export function isProjecting(broker, symbol) {
  return isFlag(broker, symbol, 'project');
}
/** bracket is an EXTENSION of project: it only counts while projecting, so a stale bracket-without-project reads as off. @param {string} broker @param {string} symbol */
export function isBracket(broker, symbol) {
  return isFlag(broker, symbol, 'bracket') && isProjecting(broker, symbol);
}
/** armed is an EXTENSION of bracket: the plan went LIVE. Only counts while a bracket is projected. @param {string} broker @param {string} symbol */
export function isArmed(broker, symbol) {
  return isFlag(broker, symbol, 'armed') && isBracket(broker, symbol);
}
/** the full plan for (broker, symbol): empty-broker base merged with the exact entry. @param {string} broker @param {string} symbol @returns {Plan} */
export function getPlan(broker, symbol) {
  if (!symbol) return {};
  return { ...(state.get(keyOf('', symbol)) || {}), ...(state.get(keyOf(broker, symbol)) || {}) };
}

// Bracket is an EXTENSION of Project (Project = the entry dot; Bracket adds the stop/target dots). The invariant is
// bracket => project: you cannot have a bracket without a projection. These two setters keep it true from any caller
// (dialog, chart, assistant), so the state can never be bracket-without-project.
/** turning Project OFF also drops the bracket (its extension), the armed flag and the seeded levels. @param {string} broker @param {string} symbol @param {boolean} on */
export function setProjecting(broker, symbol, on) {
  set(
    broker,
    symbol,
    on
      ? { project: true, anchor: null }
      : {
          project: false,
          bracket: false,
          armed: false,
          ref: null,
          levels: [],
          dir: null,
          anchor: null,
          activeIdx: null,
          qty: null,
          orderType: null,
          side: null,
          owner: null,
          sizing: null,
        },
    true,
  );
}
/** turning Bracket ON implies Project ON; turning it OFF clears the armed flag + the seeded levels (Project stays). @param {string} broker @param {string} symbol @param {boolean} on */
export function setBracket(broker, symbol, on) {
  set(
    broker,
    symbol,
    on
      ? { project: true, bracket: true }
      : { bracket: false, armed: false, ref: null, levels: [], dir: null, activeIdx: null },
    true,
  );
}
/** ARM/disarm the projected bracket (session-only): flips the plan LIVE without touching the levels. @param {string} broker @param {string} symbol @param {boolean} on */
export function setArmed(broker, symbol, on) {
  set(broker, symbol, { armed: !!on }, false);
}
/** update the plan's non-rung fields (ref / dir / anchor) -- in-memory + synced, NOT persisted. @param {string} broker @param {string} symbol @param {Plan} patch */
export function setLevels(broker, symbol, patch) {
  set(broker, symbol, patch, false);
}
/** set ONE ladder rung's stop/target by index (grows the ladder as needed). @param {string} broker @param {string} symbol @param {number} i @param {PlanLevel} patch */
export function setLevel(broker, symbol, i, patch) {
  if (!symbol || !(i >= 0)) return;
  const cur = state.get(keyOf(broker, symbol)) || {};
  const levels = Array.isArray(cur.levels) ? cur.levels.slice() : [];
  while (levels.length <= i) levels.push({});
  levels[i] = { ...levels[i], ...patch };
  set(broker, symbol, { levels }, false);
}
/** REPLACE the whole ladder (all rungs at once) -- for a multi-level caller pushing its N levels. @param {string} broker @param {string} symbol @param {PlanLevel[]} levels */
export function setLadder(broker, symbol, levels) {
  set(broker, symbol, { levels: Array.isArray(levels) ? levels.slice() : [] }, false);
}
/** merge a per-category dot VISIBILITY patch (session-only, synced): { entry?, stop?, target? } booleans.
 *  @param {string} broker @param {string} symbol @param {PlanVis} patch */
export function setVis(broker, symbol, patch) {
  if (!symbol || !patch) return;
  const cur = state.get(keyOf(broker, symbol)) || {};
  set(broker, symbol, { vis: { ...(cur.vis || {}), ...patch } }, false);
}
/** Commit a STOP price (drag or typed) -- THE one writer for stop edits, shared by every input surface (chart drag,
 *  levels table). Rung 0 with flip allowed (caller asserts pre-fill): the stop's side vs the entry pivot sets the
 *  direction -- crossing the pivot flips long<->short and mirrors the target to the profit side (the reference addon's
 *  reflectDir). Rungs 1+, flip disallowed (position open) or no pivot: plain reprice.
 *  @param {string} broker @param {string} symbol @param {number} i @param {number} stop
 *  @param {{ flip?: boolean, snap?: (v: number) => number, pivot?: number|null }} [opts]
 *    flip: rung-0 direction inference allowed; snap: tick quantizer for the mirrored target; pivot: entry fallback
 *    when the plan has no ref yet. */
export function commitStop(broker, symbol, i, stop, opts = {}) {
  if (!symbol || !(i >= 0) || stop == null || !isFinite(stop)) return;
  const p = getPlan(broker, symbol);
  const ref = p.ref != null ? Number(p.ref) : opts.pivot != null ? Number(opts.pivot) : null;
  if (i > 0 || !opts.flip || ref == null) {
    setLevel(broker, symbol, i, { stop });
    return;
  }
  const l0 = (Array.isArray(p.levels) && p.levels[0]) || {};
  const q = typeof opts.snap === 'function' ? opts.snap : (/** @type {number} */ v) => v;
  const r = stopDragFlip(stop, ref, p.dir, l0.target);
  setLevel(broker, symbol, 0, { stop: r.stop, target: r.target != null ? q(r.target) : r.target });
  // the stop's side vs the pivot IS the direction -- sync the planned SIDE with it, so the pill controller
  // flips B<->S (and recolours) when a stop drag/detach crosses the pivot, exactly like the beads' dir flip
  setLevels(broker, symbol, { dir: r.dir, side: r.dir === 'short' ? 'sell' : 'buy' });
}
/** subscribe to any plan change (returns an unsubscribe). @param {() => void} fn @returns {() => void} */
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
