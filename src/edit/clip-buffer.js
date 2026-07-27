// @ts-check
// The drawing CLIPBOARD BUFFER (a leaf). Holds the in-memory copied-drawing payload, serializes drawings from a
// GIVEN engine into it, and shares it across windows over a BroadcastChannel. It is PURE with respect to the chart
// layer -- it takes the engine explicitly and never resolves the active pane, so nothing here imports chart/layout.
// The active-chart orchestration (Ctrl+C/V, paste onto the active pane) lives one layer up in clipboard.js. Splitting
// it out breaks the drawing-menu -> clipboard -> layout -> ... -> drawing-menu import cycle (the DAG is lint-enforced).
import { IPC } from '../ipc-contract.js';
import { getTool } from '../tools/registry.js';

// appearance + geometry + scope; NOT hidden/locked (paste should be visible); z is reassigned to the top on paste.
const FIELDS = ['points', 'style', 'textStyle', 'text', 'name', 'visibility', 'sync'];
/**
 * A copied drawing payload: its tool id plus the serialized appearance/geometry fields listed in FIELDS. Stored
 * in-memory and broadcast across windows.
 * @typedef {{ tool: string, points?: any, [k: string]: any }} ClipEntry
 */
/** @type {ClipEntry[]} */
let clip = [];
// The engine we copied FROM (local reference, never serialized). Paste uses it for the anti-overlap nudge decision:
// pasting back onto the SAME chart nudges; pasting onto ANY other chart lands at the exact coordinates.
/** @type {any} */
let clipSource = null;
/** @type {BroadcastChannel | null} */
let chan = null;

// snapshot the given drawing ids on an engine into the buffer (canvas draw-shapes only)
/** @param {any} e @param {string[]} ids @returns {boolean} */
export function copyIds(e, ids) {
  /** @type {ClipEntry[]} */
  const out = [];
  ids.forEach((id) => {
    const d = e.get(id), tool = d && getTool(d.tool);
    if (!d || !tool || tool.kind !== 'draw' || !d.points) return;
    /** @type {ClipEntry} */
    const o = { tool: d.tool };
    FIELDS.forEach((k) => { if (d[k] !== undefined) o[k] = d[k]; });
    out.push(JSON.parse(JSON.stringify(o)));
  });
  if (!out.length) return false;
  clip = out;
  clipSource = e;                                                  // remember the source chart (nudge decision)
  if (chan) { try { chan.postMessage({ clip }); } catch (_) {} }   // share the buffer with every other window
  return true;
}

// copy specific drawings from a specific engine (canvas right-click, single or multi). The engine is REQUIRED here
// (the caller has it), so this stays pure -- the active-pane fallback lives in clipboard.js.
/** @param {any} engine @param {string[]} ids @returns {boolean} */
export function copyDrawings(engine, ids) {
  if (!engine) return false;
  return copyIds(engine, ids || []);
}

/** @returns {ClipEntry[]} the current buffer */
export const getClip = () => clip;
/** @returns {any} the engine the buffer was copied from (null for a cross-window copy) */
export const getClipSource = () => clipSource;
/** @returns {boolean} whether the buffer holds any copied drawings */
export const hasClip = () => clip.length > 0;

// Cross-window clipboard: a copy is broadcast so every window shares one buffer. A copy from another window arrives
// with no local source engine (clipSource = null), so it always pastes at exact coords. BroadcastChannel does not
// deliver a window its own messages, so the copying window keeps its own clipSource intact.
export function initBuffer() {
  try { chan = new BroadcastChannel(IPC.DRAWING_CLIPBOARD); } catch (_) { chan = null; }
  if (chan) chan.onmessage = (ev) => { const m = ev.data; if (m && Array.isArray(m.clip)) { clip = m.clip; clipSource = null; } };
}
