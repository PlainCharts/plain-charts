// @ts-check
// Cross-window study-board sync. A study board is ANCHORED to ONE chart (a pane) inside a Main
// Workspace's layout: linkedTo = that workspace id, linkedPane = the pane index. The board follows
// exactly that chart -- its timeframe AND its visible window -- and nothing else in the layout.
//
// Protocol over BroadcastChannel('ui-bus'):
//   CHART window (not a board) announces PRESENCE on a heartbeat: { ws, panes:[{i, tf, range}] }, and
//   per-pane range/crosshair on user scroll/hover, tagged with the pane index.
//   BOARD window listens for its anchor (ws===linkedTo, pane index===linkedPane):
//     - presence  -> anchor is alive; adopt its timeframe (setBoardTimeframe); on the first sighting,
//                    adopt its window once (initial align). No sighting for STALE_MS -> anchor CLOSED,
//                    emit board:anchor=false so the panes blank (Stage 2b).
//     - range/cross-> apply to every board pane (by time).
//   Bidirectional: the board rebroadcasts its own scroll/hover back to the anchored pane, so scrolling
//   EITHER moves both. setTimeWindow/setCrosshair are silent (no re-emit), so there is no echo/loop.
import { bus } from '../bus.js';
import { bus as engineBus } from '../../data_engine/index.js'; // engine events (logon)
import { IPC } from '../ipc-contract.js'; // cross-window channel names (single source of truth)
import { getAllPanes, getLinkedTo, getLinkedPane, getLink, setBoardTimeframe } from '../chart/layout.js';
import { getActiveWsId } from './tabs.js';

const PRESENCE_MS = 1000; // chart heartbeat cadence
const STALE_MS = 3000; // no anchor presence for this long -> anchor considered closed

/** @type {BroadcastChannel|null} */
let chan = null;
let lastAnchorSeen = 0;
/** @type {boolean|null} */
let anchorAlive = null; // tri-state: null (unknown) | true | false
/** @type {string|null} */
let anchorTf = null; // last timeframe seen on the anchor pane
/** @type {any} */
let anchorRange = null; // last window seen on the anchor pane (for the initial align)

// identity is read fresh every time -- switching tabs in a window changes all of these
const isBoard = () => !!getLinkedTo();
const myWs = () => getActiveWsId();
const paneIdx = (/** @type {any} */ p) => getAllPanes().indexOf(p);
const linkOn = (/** @type {string} */ kind) => {
  const l = /** @type {any} */ (getLink());
  return !l || l[kind] !== false;
}; // the board's own toggle

export function initBoardSync() {
  try {
    chan = new BroadcastChannel(IPC.UI_BUS);
  } catch (_) {
    chan = null;
    return;
  }
  chan.addEventListener('message', (e) => onMsg(e.data));

  // user scrolled/zoomed a pane here
  bus.on('pane:range', (src) => {
    if (!chan || !src || !src.range) return;
    // only a REAL user pan/zoom on the board moves the anchored chart; programmatic range shifts (a study
    // pane's data-feed prepend / seed auto-fit) must NOT push, or they'd zoom the chart on load. And the
    // board must not push AT ALL until the anchor is ready (anchorAlive) and its OWN opening fill is done
    // (!src._openPending) -- otherwise a pan over its thin/NULL sliver would blank the main chart.
    if (isBoard()) {
      if (
        anchorAlive === true &&
        !src._openPending &&
        linkOn('range') &&
        src._userRangeAt &&
        Date.now() - src._userRangeAt < 700
      )
        chan.postMessage({ t: 'sb-brange', to: getLinkedTo(), pane: getLinkedPane(), range: src.range });
    } else chan.postMessage({ t: 'sb-range', ws: myWs(), pane: paneIdx(src), range: src.range });
  });
  // user's crosshair moved (real hover only) here
  bus.on('crosshair', ({ source, time, price }) => {
    if (!chan) return;
    // same readiness gate as range: a not-ready board never reaches back to the anchor.
    if (isBoard()) {
      if (anchorAlive === true && !(source && source._openPending) && linkOn('crosshair'))
        chan.postMessage({ t: 'sb-bcross', to: getLinkedTo(), pane: getLinkedPane(), time, price });
    } else chan.postMessage({ t: 'sb-cross', ws: myWs(), pane: paneIdx(source), time, price });
  });
  // announce presence on the events that change a chart's panes/timeframe (plus the heartbeat)
  engineBus.on('logon', sendPresence);
  bus.on('tf:active', sendPresence);

  setInterval(() => {
    if (isBoard()) checkAnchor();
    else sendPresence();
  }, PRESENCE_MS);
}

// CHART side: tell any board which panes exist here, their timeframe and current window. `ready` is the
// gate: a pane is ready only once its opening fill has finished and framed (_openPending cleared, seeded).
// Until then a board must not adopt its window or subscribe -- see onMsg.
function sendPresence() {
  if (!chan || isBoard()) return;
  const panes = getAllPanes().map((p, i) => ({
    i,
    tf: p.tfId,
    range: p.range || null,
    ready: !p._openPending && !!p.seeded && !p.blanked,
  }));
  chan.postMessage({ t: 'sb-presence', ws: myWs(), panes });
}

/** @param {any} m */
function onMsg(m) {
  if (!m) return;
  if (isBoard()) {
    const aWs = getLinkedTo(),
      aPane = getLinkedPane();
    if (m.t === 'sb-presence' && m.ws === aWs) {
      const pane = (m.panes || []).find((/** @type {any} */ x) => x.i === aPane);
      if (pane) {
        lastAnchorSeen = Date.now(); // anchor is alive (even if not ready) -> not stale
        // Block ALL board activity until the anchor has finished its opening fill and framed. A board
        // synced to a not-yet-ready chart would frame the anchor's full-history window over its own thin
        // sliver -- data-less, zoomed into NULL -- and (boards being bidirectional) a click/scroll on
        // that NULL would broadcast straight back and blank the main chart too. So keep the board fully
        // blank (no subscription, no range/tf adoption) until ready; then bring it up aligned.
        if (!pane.ready) {
          setAlive(false);
          return;
        }
        anchorRange = pane.range || anchorRange;
        const firstAlive = anchorAlive !== true;
        setAlive(true);
        if (pane.tf && pane.tf !== anchorTf) {
          anchorTf = pane.tf;
          setBoardTimeframe(pane.tf);
        }
        if (firstAlive && anchorRange) applyRange(anchorRange); // align once on (re)connect
      }
      return;
    }
    if (m.t === 'sb-range' && m.ws === aWs && m.pane === aPane && m.range && linkOn('range')) {
      anchorRange = m.range;
      applyRange(m.range);
      return;
    }
    if (m.t === 'sb-cross' && m.ws === aWs && m.pane === aPane && linkOn('crosshair')) {
      applyCross(m.time, m.price);
      return;
    }
  } else {
    // CHART side: a board anchored to ME scrolled/hovered -> apply to the anchored pane only
    if (m.t === 'sb-brange' && m.to === myWs() && m.range) {
      const p = getAllPanes()[m.pane];
      if (p && !p._openPending) {
        try {
          p.chart.timeAxis().setTimeWindow(m.range);
        } catch (_) {}
      }
      return;
    } // ignore board moves while the anchor is still opening
    if (m.t === 'sb-bcross' && m.to === myWs()) {
      const p = getAllPanes()[m.pane];
      if (p) {
        try {
          p.setCrosshair(m.time, m.price);
        } catch (_) {}
      }
      return;
    }
  }
}

// Follow the anchor's window AND pull the history to fill it. setTimeWindow is silent (no lazy-load
// event), so without boardEnsureHistory a board following the anchor into older bars would show gaps.
const applyRange = (/** @type {any} */ range) =>
  getAllPanes().forEach((/** @type {any} */ p) => {
    try {
      p.chart.timeAxis().setTimeWindow(range);
    } catch (_) {}
    try {
      if (p.boardEnsureHistory) p.boardEnsureHistory(range);
    } catch (_) {}
  });
const applyCross = (/** @type {any} */ time, /** @type {any} */ price) =>
  getAllPanes().forEach((/** @type {any} */ p) => {
    try {
      p.setCrosshair(time, price);
    } catch (_) {}
  });

/** @param {boolean} v */
function setAlive(v) {
  if (anchorAlive === v) return;
  anchorAlive = v;
  if (!v) {
    anchorTf = null;
    anchorRange = null;
  }
  bus.emit('board:anchor', v); // panes blank (false) / unblank (true) -- Stage 2b
}
function checkAnchor() {
  if (Date.now() - lastAnchorSeen > STALE_MS) setAlive(false);
}
