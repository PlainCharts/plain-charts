// @ts-check
// UI-window side of assistant workspace commands. Maps an assistant op to a registered command and runs
// it against the real panes in THIS window, replying with the result. The command LOGIC now lives in the
// command registry (commands/pane-commands.js, commands/builtin.js) -- this file only resolves the target
// pane and dispatches, so the assistant and the app's own menus/hotkeys share one implementation.
// v1 note: every open UI window executes; the host takes the first reply. Panes are addressed by index
// (see get_workspace); paneIndex defaults to the active pane.
import { IPC } from '../ipc-contract.js';
import { getAllPanes, getActivePane } from '../chart/layout.js';
import { executeCommand } from '../commands/registry.js';

/** @type {any} */
const chan = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(IPC.ASSISTANT_CMD) : null;

// assistant op -> command id. The op names are the assistant's wire protocol; the ids are the registry's.
/** @type {Record<string, string>} */
const OP_TO_CMD = {
  addStudy: 'study.add', setSymbol: 'symbol.set', setTimeframe: 'tf.set', addAlert: 'alert.add',
  addDrawing: 'drawing.add', listDrawings: 'drawing.list', removeDrawing: 'drawing.remove',
  getSelection: 'selection.get', applyTheme: 'theme.apply',
};
// ops that act on a chart pane -- they need pane resolution + window routing. applyTheme is pane-independent
// and always runs (it changes the app theme, not a pane).
/** @type {Record<string, number>} */
const PANE_OPS = { addStudy: 1, setSymbol: 1, setTimeframe: 1, addAlert: 1, addDrawing: 1, getSelection: 1, listDrawings: 1, removeDrawing: 1 };

/** @param {string} op @param {any} args */
function exec(op, args) {
  const id = OP_TO_CMD[op];
  if (!id) return { error: 'unknown command: ' + op };
  if (!PANE_OPS[op]) return executeCommand(id, args);   // pane-independent (applyTheme)
  const panes = getAllPanes() || [];
  const p = (args.paneIndex == null) ? getActivePane() : panes[args.paneIndex | 0];
  if (!p) return { error: 'no pane at index ' + args.paneIndex };
  return executeCommand(id, { ...args, pane: p });
}

// Only the window that actually HOLDS the target pane answers a pane op -- otherwise a paneless window (e.g. a
// detached AI Workspace) races the chart window and replies "no pane" first. Pane-independent ops run anywhere.
if (chan) chan.onmessage = (/** @type {MessageEvent} */ e) => {
  const m = e.data; if (!m || m.type !== 'cmd') return;
  if (PANE_OPS[m.op]) {
    const panes = getAllPanes() || [];
    const p = (m.args && m.args.paneIndex != null) ? panes[m.args.paneIndex | 0] : getActivePane();
    if (!p) return;   // this window can't do it -- let the window with the chart answer
  }
  let result; try { result = exec(m.op, m.args || {}); } catch (/** @type {any} */ err) { result = { error: String((err && err.message) || err) }; }
  try { chan.postMessage({ type: 'reply', id: m.id, result }); } catch (_) {}
};
