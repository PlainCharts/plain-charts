// @ts-check
// Drawing -> ORDER handoff. A tool that exposes its ORDER READING (a def-level `orderIntent(d, ctx)`
// returning { side, type, price, stopLoss, takeProfit, qty } -- the Position tool) offers "Create limit
// order" on its right-click menu and the quick editor. The drawing only PROVIDES DATA: the intent
// prefills the order dialog, which owns the whole planning cycle (fields + the on-chart projection
// mirror the tool), and pressing Buy/Sell there is the execution. Desktop only -- the order dialog is a
// standalone OS window; solo/browser mode has none, so the item never shows there.
import { getTool } from '../../tools/registry.js';

/** can this drawing offer "Create limit order"? The tool must expose its order reading and the desktop
 * order-ticket window must exist. @param {any} d @returns {boolean} */
export function drawingOrderAvailable(d) {
  const tool = d && /** @type {any} */ (getTool(d.tool));
  const desk = /** @type {any} */ (typeof window !== 'undefined' ? window : {}).desktop;
  return !!(tool && typeof tool.orderIntent === 'function' && desk && desk.openOrderTicket);
}

/** read the tool's intent for this drawing and open the order dialog from it: the ticket receives the
 * intent in its open payload (same channel as the toolbar/position-row openers) and seeds its own
 * planning cycle -- fields and the on-chart projection both mirror that plan.
 * @param {any} engine  the pane's DrawingEngine @param {string} id */
export function openDrawingOrderTicket(engine, id) {
  const d = engine.get(id);
  const tool = d && /** @type {any} */ (getTool(d.tool));
  if (!d || !tool || typeof tool.orderIntent !== 'function') return;
  const pane = engine.pane || {};
  const intent = tool.orderIntent(d, { tickSize: pane.tickSize, tickValue: pane.tickValue });
  const desk = /** @type {any} */ (window).desktop;
  if (!intent || !desk || !desk.openOrderTicket) return;
  desk.openOrderTicket({
    tab: intent.type === 'stop' ? 'stop' : 'limit',
    symbol: pane.symbol || '',
    broker: pane.broker || '',
    prefill: {
      side: intent.side,
      price: intent.price,
      stopLoss: intent.stopLoss,
      takeProfit: intent.takeProfit,
      qty: intent.qty, // null when the tool can't size -> the dialog keeps its own quantity
    },
  });
}
