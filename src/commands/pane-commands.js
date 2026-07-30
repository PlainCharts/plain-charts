// @ts-check
// Pane data-ops as commands -- the actions that mutate a chart pane (add/remove studies, set
// symbol/timeframe, add an alert, add/remove drawings) plus the read-only selection/list probes.
// These are exactly the operations reachable today from BOTH a menu and the AI: registering them
// once here lets the plus-button / context menu and (Phase 5) the assistant all call the same
// command instead of each re-implementing the pane call.
//
// Convention: every handler takes an optional { pane } context (a menu passes the pane it opened
// on; absent -> the active pane) plus the operation's own args. Handlers return the same result
// shapes the assistant expects, so cmd-ui can become a thin executeCommand() pass-through.
import { registerCommand } from './registry.js';
import { getActivePane } from '../chart/layout.js';
import { quickAlertAtPrice } from '../alerts/alert-drawing-sync.js';

/** @param {any} args @returns {any} */
const paneOf = (args) => (args && args.pane) || getActivePane();

export function registerPaneCommands() {
  registerCommand({
    id: 'study.add',
    title: 'Add study',
    category: 'Studies',
    handler: (args) => {
      const p = paneOf(args);
      if (!p) return { error: 'no pane' };
      if (!args || !args.studyId) return { error: 'studyId required' };
      p.studies.add(args.studyId, args.params || {});
      return { ok: true, paneIndex: args.paneIndex, studyId: args.studyId };
    },
  });
  registerCommand({
    id: 'study.remove',
    title: 'Remove study',
    category: 'Studies',
    handler: (args) => {
      const p = paneOf(args);
      if (!p) return { error: 'no pane' };
      if (!args || args.index == null) return { error: 'index required' };
      p.studies.remove(args.index | 0);
      return { ok: true, index: args.index | 0 };
    },
  });
  registerCommand({
    id: 'study.clearAll',
    title: 'Remove all studies',
    category: 'Studies',
    handler: (args) => {
      const p = paneOf(args);
      if (!p) return { error: 'no pane' };
      p.studies.clearAll();
      return { ok: true };
    },
  });
  registerCommand({
    id: 'symbol.set',
    title: 'Set symbol',
    category: 'Chart',
    handler: (args) => {
      const p = paneOf(args);
      if (!p) return { error: 'no pane' };
      if (!args || !args.symbol) return { error: 'symbol required' };
      p.setSource(args.broker || p.broker, args.symbol);
      return { ok: true, symbol: args.symbol };
    },
  });
  registerCommand({
    id: 'tf.set',
    title: 'Set timeframe',
    category: 'Chart',
    handler: (args) => {
      const p = paneOf(args);
      if (!p) return { error: 'no pane' };
      if (!args || !args.tf) return { error: 'tf required' };
      p.setTimeframe(args.tf);
      return { ok: true, tf: args.tf };
    },
  });
  registerCommand({
    id: 'alert.add',
    title: 'Add price alert',
    category: 'Alerts',
    handler: (args) => {
      const p = paneOf(args);
      if (!p || !p.drawings) return { error: 'no pane' };
      const price = +(args && args.price);
      if (isNaN(price)) return { error: 'price required' };
      const ok = quickAlertAtPrice(p, price); // object-less Price-crossing-Value alert, marked by the alert primitive
      return ok ? { ok: true, price, symbol: p.symbol } : { error: 'could not create alert' };
    },
  });
  registerCommand({
    id: 'drawing.add',
    title: 'Add drawing',
    category: 'Drawings',
    handler: (args) => {
      const p = paneOf(args);
      if (!p || !p.drawings) return { error: 'no pane' };
      if (!args || !args.tool || !Array.isArray(args.points) || !args.points.length)
        return { error: 'tool and points required' };
      const d = p.drawings.add(args.tool, {
        points: args.points,
        style: args.style || {},
        sync: args.sync || 'none',
        z: args.z != null ? args.z : p.drawings.nextZ ? p.drawings.nextZ() : undefined,
      });
      return { ok: true, id: d && d.id, tool: args.tool };
    },
  });
  registerCommand({
    id: 'drawing.remove',
    title: 'Remove drawing',
    category: 'Drawings',
    handler: (args) => {
      const p = paneOf(args);
      if (!p || !p.drawings) return { error: 'no pane' };
      if (!args || !args.id) return { error: 'id required' };
      if (p.drawings.removeDrawing) p.drawings.removeDrawing(args.id);
      return { ok: true, id: args.id };
    },
  });
  registerCommand({
    id: 'drawing.removeInView',
    title: 'Remove drawings in view',
    category: 'Drawings',
    handler: (args) => {
      const p = paneOf(args);
      if (!p || !p.drawings) return { error: 'no pane' };
      p.drawings.removeViewDrawings();
      return { ok: true };
    },
  });
  registerCommand({
    id: 'drawing.list',
    title: 'List drawings',
    category: 'Drawings',
    handler: (args) => {
      const p = paneOf(args);
      if (!p) return { error: 'no pane' };
      const all = p.drawings && p.drawings.allItems ? p.drawings.allItems() : [];
      return { drawings: all.map((/** @type {any} */ d) => ({ id: d.id, tool: d.tool, points: d.points })) };
    },
  });
  registerCommand({
    id: 'selection.get',
    title: 'Get chart selection',
    category: 'Chart',
    handler: (args) => {
      const p = paneOf(args);
      if (!p) return { error: 'no pane' };
      // what the user is looking at / has selected on the chart -- the chart analog of a text selection
      const dr = p.drawings || {};
      const ids = dr.selection ? [...dr.selection] : [];
      // dr.get(id) resolves both local (sync:'none') and synced (per-symbol) drawings
      const selectedDrawings = ids
        .map((/** @type {any} */ id) => (dr.get ? dr.get(id) : null))
        .filter(Boolean)
        .map((/** @type {any} */ d) => ({ id: d.id, tool: d.tool, points: d.points, style: d.style }));
      const lb = p.lastBar;
      return {
        symbol: p.symbol,
        tf: p.tfId,
        broker: p.broker,
        visibleRange: p.range || null,
        lastBar: lb
          ? { time: lb.time, open: lb.open, high: lb.high, low: lb.low, close: lb.close, volume: lb.volume }
          : null,
        selectedDrawings,
      };
    },
  });
}
