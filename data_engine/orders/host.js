// @ts-check
// THE ORDER WORKER runtime -- boots in the dedicated order-host window (role=orders). It is the single owner of all
// order BUSINESS LOGIC. As a proxy consumer it READS the authoritative book (platform stores, synced from the
// data-host) and (from T3) receives commands from every surface, executing them via the broker proxy -> data-host
// adapters. Never touches a broker socket; a fault here is an ORDER-logic fault, never a data-host one.
//
// T1: boot + confirm this window joined the bridge and can see the book. Command handling arrives in T3.
import { platform } from '../platform/index.js';
import { ROLE } from '../data/broker-bridge.js';
import { register } from './index.js';
import { parseScript } from './dsl.js';
import { accountRisk } from './sizing/index.js';
import {
  execScript,
  placeMarket,
  placeResting,
  setStopPrice,
  setTargetPrice,
  modifyOrderPrice,
  cancelById,
  modifyPosition,
  closeLotById,
  closePositionSym,
  assistantOrder,
} from './exec.js';
import { startReconcile, cancelWorkingSym } from './reconcile.js';

const log = (/** @type {string} */ msg) => console.log('[order-host]', msg);
log('ready (role=' + ROLE + ')');

// The book-keeper: OCO-on-flat (cancel leftover working legs when a position closes) + stop auto-size (netting
// protective stops track the net). Book-driven, once, here -- moved out of the addon (position-exits.js). CQG's
// server-side OCO was verified in the lab (a compound tree cancels its own sibling), so the flat pass no-ops on
// those legs; this covers INDEPENDENTLY placed legs (the addon's bracket, exit proposals) on any broker.
startReconcile();

// diagnostic: prove the command channel round-trips (surface -> order-host -> ack).
register('echo', (/** @type {any} */ cmd) => {
  log('echo ' + JSON.stringify(cmd));
  return { echoed: cmd, book: { positions: platform.positions.size(), orders: platform.orders.size() } };
});

// T4: the DSL `script` command -- parse (validate) here, then run the shared executor IN the worker (the single
// owner of order logic). ctx = { broker, symbol, ticket?, hedging? }. Progress goes to the shared console journal;
// the ack carries the final outcome { ok, error? }.
register('script', async (/** @type {any} */ cmd) => {
  let ops;
  try {
    ops = parseScript(cmd.script);
  } catch (e) {
    return { ok: false, error: /** @type {any} */ (e).message };
  }
  return execScript(ops, cmd.ctx || {});
});

// T6: atomic ops for the chart interaction bridge -- dragging a dot yields an ABSOLUTE price. The surface (the
// on-chart overlay) sends these; the worker applies them account-type aware. The book then confirms and the dot
// settles from it.
// the dialog's Buy/Sell. Market tab -> a MARKET order + optional absolute-price bracket (account-type aware). Limit/Stop
// tab -> a single RESTING order at a price with time-in-force. Discriminated by cmd.orderType.
register('place', (/** @type {any} */ cmd) => {
  // Per-account sizing policy: an MM account sizes every order from its zone/ladder risk (the engine),
  // overriding the form's qty/stake. This ONE point covers the ticket AND on-chart primitives -- both send
  // 'place'. No policy installed -> null -> the order's own sizing stands. The stop (risk basis) comes from
  // the order's bracket, same as a stake order. The ctx keys the policy by ACCOUNT (broker + accountId).
  const mmRisk = accountRisk(cmd.ctx || {});
  if (mmRisk != null) {
    const stop = cmd.bracket && Number(cmd.bracket.stopLoss) > 0 ? Number(cmd.bracket.stopLoss) : 0;
    cmd.sizing = { risk: mmRisk, stop };
  }
  return cmd.orderType === 'limit' || cmd.orderType === 'stop'
    ? placeResting(
        cmd.ctx || {},
        cmd.side,
        cmd.qty,
        cmd.orderType,
        cmd.price,
        cmd.tif,
        cmd.goodThru,
        cmd.bracket || null,
        cmd.sizing || null,
      )
    : placeMarket(cmd.ctx || {}, cmd.side, cmd.qty, cmd.bracket || null, cmd.sizing || null);
});
register('setStop', (/** @type {any} */ cmd) => setStopPrice(cmd.ctx || {}, cmd.price));
register('setTarget', (/** @type {any} */ cmd) => setTargetPrice(cmd.ctx || {}, cmd.price));
register('modifyOrder', (/** @type {any} */ cmd) =>
  modifyOrderPrice(cmd.broker, cmd.id, cmd.price, cmd.qty, cmd.stopLoss, cmd.takeProfit),
); // move/resize a specific resting order by id (keeps a server-side OCO bond); SL/TP for a hedging pending order
register('cancel', (/** @type {any} */ cmd) => cancelById(cmd.broker, cmd.id));
register('modifyPosition', (/** @type {any} */ cmd) =>
  modifyPosition(cmd.broker, cmd.ticket, cmd.stopLoss, cmd.takeProfit),
); // hedging position SL/TP together, by ticket
register('closeLot', (/** @type {any} */ cmd) => closeLotById(cmd.broker, cmd.ticket, cmd.qty)); // close ONE position by ticket (qty = partial)
register('closePosition', (/** @type {any} */ cmd) => closePositionSym(cmd.broker, cmd.symbol)); // flatten a whole symbol (hedging: all lots; netting: offsetting close)
register('cancelWorking', (/** @type {any} */ cmd) => cancelWorkingSym(cmd.broker, cmd.symbol, 'command')); // cancel EVERY working order for a symbol (the addon's Close All; also covers orphans with no flat edge)
register('assistantOrder', (/** @type {any} */ cmd) => assistantOrder(cmd.method, cmd.args || [])); // assistant order: policy + per-order confirm enforced HERE, then dispatched on the active broker

// prove the book is reachable here -- log a snapshot on any change (coalesced), so we can verify the order-host
// mirrors the data-host's authoritative positions/orders. Purely diagnostic for T1.
let raf = 0;
const snapshot = () => {
  raf = 0;
  log(
    'book: ' +
      platform.positions.size() +
      ' positions, ' +
      platform.orders.size() +
      ' orders, ' +
      platform.positionLots.size() +
      ' lots',
  );
};
const nudge = () => {
  if (!raf) raf = requestAnimationFrame(snapshot);
};
platform.positions.subscribe(nudge);
platform.orders.subscribe(nudge);
platform.positionLots.subscribe(nudge);
