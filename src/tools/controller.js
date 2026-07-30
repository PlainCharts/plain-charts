// @ts-check
// Active-tool controller: one active tool across panes. It
// listens for pane clicks (emitted by Pane via onClick) and routes them
// to the active tool's onClick with a context that can create a drawing.
import { bus } from '../bus.js';
import { getTool } from './registry.js';

let activeId = 'cursor';

export const getActiveTool = () => activeId;
/** @param {string} id */
export function setActiveTool(id) {
  activeId = id;
  bus.emit('tool:active', id);
}

export function initToolController() {
  bus.on('pane:click', ({ pane, time, price, x, y }) => {
    const tool = getTool(activeId);
    if (!tool || tool.kind === 'cursor' || typeof tool.onClick !== 'function') return;
    const ctx = { pane, add: (/** @type {any} */ params) => pane.drawings.add(activeId, params) };
    try {
      tool.onClick({ time, price, x, y, pane }, ctx);
    } catch (_) {}
  });
}
