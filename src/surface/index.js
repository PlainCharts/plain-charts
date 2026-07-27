// @ts-check
// Surface tabs — a tab that hosts an arbitrary UI ("app within an app") instead of a chart. A surface
// tab is a workspace with type:'surface' and a { kind, ...state } spec; layout.js mounts it into the
// chart area and it rides the SAME tab machinery (switch / rename / detach to its own window / persist).
//
// The one surface today is the Trade Desk: ONE master tab that houses internal mini-tabs (Console, Orders,
// Positions, Accounts) which the user adds/removes — an NT8-style control center. The individual views are
// PANELS inside the desk (see desk.js), not top-level surface kinds.
import { mountDesk } from './desk.js';
import { mountAiWorkspace } from './ai-workspace.js';

/** @type {Record<string, (root: HTMLElement, cfg?: any) => ({ destroy?: () => void, state?: () => any } | undefined)>} */
const KINDS = { desk: mountDesk, ai: mountAiWorkspace };
// launchers offered in the Workspace Manager (label shown on the button)
/** @type {[string, string][]} */
export const SURFACE_KINDS = [['desk', 'Trade Desk'], ['ai', 'AI Workspace']];

// the default workspace for a new surface tab of the given kind
/** @param {string} [kind] */
export function surfaceWorkspace(kind = 'desk') { return { type: 'surface', surface: { kind } }; }

// A surface panel is a SINGLETON per kind (one Trade Desk, one AI Workspace) -- it is a tool, not a
// user-curated workspace. So its backing file uses a STABLE id derived from the kind, reused on every
// open instead of minting a new file each time (which piled up "0 panes" junk in the picker). State
// (the desk's mini-tabs, the ai session) persists in that one file and survives restart.
/** @param {string} [kind] @returns {string} */
export function surfaceWsId(kind = 'desk') { return 'ws_surface_' + kind; }

// mount a surface from its workspace into `root`; returns a handle the layout owns (ws() to persist,
// destroy() to tear down when the tab switches away or the window closes).
/** @param {HTMLElement} root @param {{ surface?: { kind?: string } } | null} [ws] */
export function mountSurface(root, ws) {
  const spec = (ws && ws.surface) || {};
  const kind = KINDS[/** @type {string} */ (spec.kind)] ? spec.kind : 'desk';
  const handle = KINDS[/** @type {string} */ (kind)](root, spec) || {};
  return {
    kind,
    ws: () => ({ type: 'surface', surface: { kind, ...(handle.state ? handle.state() : {}) } }),
    destroy: () => { try { handle.destroy && handle.destroy(); } catch (_) {} },
  };
}
