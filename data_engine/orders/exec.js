// @ts-check
// The DSL EXECUTOR -- runs a PARSED op-list against the live book + broker. This is the order BUSINESS LOGIC:
// account-type aware (hedging OCO vs netting separate stop/limit), book aware (net vs per-ticket lots, freshest
// resting stop), unit-agnostic distances. It imports the broker proxy + platform stores; it runs in the ORDER-HOST
// worker (the single owner), driven by the `script` command. The PARSER (parseScript, dsl.js) is pure and shared
// for client-side validation; THIS file is the impure half and must not be imported by a surface.
import { broker } from '../data/broker.js';
import { platform } from '../platform/index.js';
import { isTerminal } from '../data/adapter-contract.js';
import { currentPosition, exitSide, freshestExitOrder } from './book-read.js';   // book-read business logic (position + exit-side + live resting exit) lives in one place
import { sizeFromStake } from './sizing.js';   // pure position-sizing rule (risk + stop + instrument specs -> qty)
import { execGate } from '../policy.js';   // injectable assistant-order gate (the app installs its policy; default denies)

// every jlog line is the APP talking to the broker (a request we send, or our note about one) -> direction 'out'.
/** @param {string} src @param {string} msg @param {boolean} [err] */
const jlog = (src, msg, err) => platform.console.post({ level: err ? 'error' : 'info', cat: 'journal', src: src || 'app', dir: 'out', msg });
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** @param {any} v @param {any} dec */
const fmtPx = (v, dec) => (v == null || Number.isNaN(Number(v))) ? '0' : (dec != null ? Number(v).toFixed(Number(dec)) : String(v));

// price move per 1 unit. pips = forex (0.0001, or 0.01 on 3-digit JPY); points = 1.0 (index/futures).
// no explicit unit -> pips when the instrument has >=3 decimals, else points.
/** @param {any} decimals @param {string} [unit] @returns {number} */
export function unitSize(decimals, unit) {
  const d = Number(decimals);
  if (unit === 'points') return 1;
  if (unit === 'pips' || (!unit && d >= 3)) return d >= 4 ? 1e-4 : 1e-2;
  return 1;
}

// resolve the instrument (id + priceDecimals + tickSize)
/** @param {string} brokerId @param {string} symbol @returns {Promise<any>} */
function resolveInst(brokerId, symbol) {
  return new Promise((resolve, reject) => {
    const a = /** @type {any} */ (broker.for(brokerId));
    if (!a || !a.resolveSymbol) { reject(new Error('cannot resolve ' + symbol)); return; }
    let done = false; const to = setTimeout(() => { if (!done) { done = true; reject(new Error('symbol ' + symbol + ' not resolved (3s)')); } }, 3000);
    a.resolveSymbol(symbol, /** @param {any} inst */ (inst) => { if (done) return; done = true; clearTimeout(to); if (!inst) reject(new Error('symbol not found: ' + symbol)); else resolve(inst); });
  });
}
// first live quote (bid/ask) for an instrument -- the entry estimate for a market bracket
/** @param {string} brokerId @param {any} inst @returns {Promise<{bid:number, ask:number}>} */
function firstQuote(brokerId, inst) {
  return new Promise((resolve, reject) => {
    const a = /** @type {any} */ (broker.for(brokerId));
    if (!a || !a.subscribeQuotes) { reject(new Error('no quotes')); return; }
    let done = false;
    /** @type {any} */
    let cb = null;
    const to = setTimeout(() => { if (!done) { done = true; if (cb) try { a.unsubscribeQuotes(inst.id, cb); } catch (_) {} reject(new Error('no quote (3s)')); } }, 3000);
    cb = (/** @type {any} */ q) => { if (done) return; const bid = Number(q.bid), ask = Number(q.ask); if (isFinite(bid) && isFinite(ask)) { done = true; clearTimeout(to); try { a.unsubscribeQuotes(inst.id, cb); } catch (_) {} resolve({ bid, ask }); } };
    a.subscribeQuotes(inst.id, cb);
  });
}
// Resolve a STAKE (a risk amount) into a tradeable qty using the instrument contract. This is the order-side of the
// Stake feature: the UI carries the INTENT ({ risk, stop }), the worker turns it into a number here -- business logic
// stays off the UI. entry is the fill estimate: a resting order's own price, or (market) the live quote per side.
// tickValue/volumeStep/minVolume/maxVolume come straight off the instrument the adapter resolved; the arithmetic in
// sizeFromStake is asset-agnostic. Returns { qty, error } -- qty 0 carries the sizing reason as a readable error.
/** @param {string} brokerId @param {{symbol:string}} ctx @param {'buy'|'sell'} side @param {{risk:number, stop:number}} sizing @param {number|null} entry @param {any} inst @returns {Promise<{qty:number, error:string|null}>} */
async function sizeStakeQty(brokerId, ctx, side, sizing, entry, inst) {
  if (!inst) inst = await resolveInst(brokerId, ctx.symbol);
  if (entry == null) { const q = await firstQuote(brokerId, inst); entry = side === 'buy' ? q.ask : q.bid; }
  const r = sizeFromStake({ risk: Number(sizing.risk), entryPrice: Number(entry), stopPrice: Number(sizing.stop), tickSize: Number(inst.tickSize), tickValue: Number(inst.tickValue), volumeStep: inst.volumeStep, minVolume: inst.minVolume, maxVolume: inst.maxVolume });
  if (!r.qty) return { qty: 0, error: 'cannot size stake: ' + (r.reason || 'unknown') };
  jlog(brokerId, 'STAKE ' + sizing.risk + ' @ entry ' + fmtPx(entry, inst.priceDecimals) + ' stop ' + fmtPx(sizing.stop, inst.priceDecimals) + ' -> ' + r.qty + ' ' + ctx.symbol + ' (' + fmtPx(r.riskPerUnit, 2) + '/unit)');
  return { qty: r.qty, error: null };
}

// place an order, resolve on ack, reject on a broker error (readable via the adapter's retcode decoder)
/** @param {string} brokerId @param {any} order @returns {Promise<any>} */
function placeOrderP(brokerId, order) {
  return new Promise((resolve, reject) => {
    const a = /** @type {any} */ (broker.for(brokerId));
    if (!a || !a.placeOrder) { reject(new Error('no order routing on ' + brokerId)); return; }
    a.placeOrder(order, /** @param {any} r */ (r) => { if (r && r.error) reject(new Error(r.error)); else resolve(r || {}); });
  });
}
// modify a position/order, resolve on ack, reject on a broker error
/** @param {string} brokerId @param {any} mod @returns {Promise<any>} */
function modifyP(brokerId, mod) {
  return new Promise((resolve, reject) => {
    const a = /** @type {any} */ (broker.for(brokerId));
    if (!a || !a.modifyOrder) { reject(new Error('no modify on ' + brokerId)); return; }
    a.modifyOrder(mod, /** @param {any} r */ (r) => { if (r && r.error) reject(new Error(r.error)); else resolve(r || {}); });
  });
}
// (currentPosition moved to book-read.js -- the single home for reading positions/exits from the book)

// SL/TP absolute prices from an entry + the bracket ops (stop below/above per side), rounded to the tick
/** @param {string} side @param {number} entry @param {any} inst @param {any[]} brk @returns {{ sl: number, tp: number }} */
function bracketPrices(side, entry, inst, brk) {
  const dec = inst.priceDecimals != null ? Number(inst.priceDecimals) : null;
  const tick = Number(inst.tickSize) || 0;
  const rnd = (/** @type {number} */ p) => tick ? Math.round(p / tick) * tick : (dec != null ? Number(p.toFixed(dec)) : p);
  let sl = 0, tp = 0;
  for (const b of brk) {
    const size = unitSize(dec, b.unit);
    if (b.op === 'setStop') sl = rnd(side === 'buy' ? entry - b.value * size : entry + b.value * size);
    else tp = rnd(side === 'buy' ? entry + b.value * size : entry - b.value * size);
  }
  return { sl, tp };
}

// Place a MARKET order with an ABSOLUTE-price bracket. sl/tp are absolute prices (0 = that leg omitted). ONE neutral
// bracket order -- the ADAPTER realizes it natively: MT5 attaches SL/TP to the position (native OCO), CQG places a
// SERVER-SIDE compound OCO (OPO entry -> OCO { stop, limit }, broker-managed, resilient). No app-side leg management
// and no account-type branching -- the contract abstracts the broker's mechanism. Shared by the DSL market op
// (distance-derived sl/tp) and the dialog's `place` command (form-entered sl/tp).
/** @param {string} brokerId @param {any} ctx @param {'buy'|'sell'} side @param {number} qty @param {number} sl @param {number} tp @param {any} inst */
async function placeMarketBracket(brokerId, ctx, side, qty, sl, tp, inst) {
  const dec = inst ? inst.priceDecimals : null;
  jlog(brokerId, side.toUpperCase() + ' ' + qty + ' ' + ctx.symbol + '  SL ' + fmtPx(sl, dec) + ' TP ' + fmtPx(tp, dec) + ' (bracket)');
  await placeOrderP(brokerId, { symbol: ctx.symbol, side, qty, type: 'market', bracket: { stopLoss: sl || 0, takeProfit: tp || 0 } });
}

// The dialog's Buy/Sell: a MARKET order at `qty`, with an OPTIONAL absolute-price bracket (Stop Loss / Take Profit
// from the form). Account-type aware via placeMarketBracket. Validates + returns { ok, error? } for the ack.
/** @param {{broker:string, symbol:string, hedging?:boolean}} ctx @param {'buy'|'sell'} side @param {number} qty @param {{stopLoss?:number, takeProfit?:number}|null} [bracket] @param {{risk:number, stop:number}|null} [sizing] @param {(s:string)=>void} [onStatus] @returns {Promise<{ok:boolean, error?:string, qty?:number}>} */
export async function placeMarket(ctx, side, qty, bracket, sizing, onStatus = () => {}) {
  const brokerId = ctx.broker || '';
  if (!brokerId || !ctx.symbol) return { ok: false, error: side + ' needs an account + symbol' };
  const sl = bracket && Number(bracket.stopLoss) > 0 ? Number(bracket.stopLoss) : 0;
  const tp = bracket && Number(bracket.takeProfit) > 0 ? Number(bracket.takeProfit) : 0;
  /** @type {any} */ let inst = null;
  try {
    // STAKE mode: the qty is COMPUTED from the risk amount + stop against the live market entry (per side). Resolve the
    // instrument once here and reuse it for the bracket below. Sized qty overrides the form's Volume.
    if (sizing && Number(sizing.risk) > 0) {
      inst = await resolveInst(brokerId, ctx.symbol);
      const s = await sizeStakeQty(brokerId, ctx, side, sizing, null, inst);
      if (s.error) return { ok: false, error: s.error };
      qty = s.qty;
    }
    if (!(Number(qty) > 0)) return { ok: false, error: 'quantity required' };
    onStatus(side + ' ' + qty + ((sl || tp) ? ' + bracket' : '') + '…');
    if (!sl && !tp) { jlog(brokerId, side.toUpperCase() + ' ' + qty + ' ' + ctx.symbol); await placeOrderP(brokerId, { symbol: ctx.symbol, side, qty: Number(qty), type: 'market' }); }
    else { if (!inst) inst = await resolveInst(brokerId, ctx.symbol); await placeMarketBracket(brokerId, ctx, side, Number(qty), sl, tp, inst); }
    return { ok: true, qty: Number(qty) };
  } catch (e) { return { ok: false, error: (e && /** @type {any} */ (e).message) || String(e) }; }
}

// The dialog's Limit/Stop tab: a single RESTING order (limit or stop) at `price`, with time-in-force. GTD carries a
// good-thru epoch ms (the adapter resolves it to the trade date). An optional BRACKET (hedging accounts) rides ON the
// pending order -- the adapter attaches SL/TP natively (MT5) so they activate with the fill; 0/absent legs are
// omitted per the contract. Validates + returns { ok, error? } for the ack.
/** @param {{broker:string, symbol:string}} ctx @param {'buy'|'sell'} side @param {number} qty @param {'limit'|'stop'} orderType @param {number} price @param {string} tif @param {number|null} [goodThru] @param {{stopLoss?: number, takeProfit?: number}|null} [bracket] @param {{risk:number, stop:number}|null} [sizing] @param {(s:string)=>void} [onStatus] @returns {Promise<{ok:boolean, error?:string, qty?:number}>} */
export async function placeResting(ctx, side, qty, orderType, price, tif, goodThru, bracket, sizing, onStatus = () => {}) {
  const brokerId = ctx.broker || '';
  if (!brokerId || !ctx.symbol) return { ok: false, error: side + ' needs an account + symbol' };
  if (!(Number(price) > 0)) return { ok: false, error: orderType + ' needs a price' };
  try {
    // STAKE mode: the resting order's OWN price is the entry estimate -- no quote needed. Sized qty overrides the form's Volume.
    if (sizing && Number(sizing.risk) > 0) {
      const s = await sizeStakeQty(brokerId, ctx, side, sizing, Number(price), null);
      if (s.error) return { ok: false, error: s.error };
      qty = s.qty;
    }
    if (!(Number(qty) > 0)) return { ok: false, error: 'quantity required' };
    const t = String(tif || 'gtc').toLowerCase();
    /** @type {any} */
    const order = { symbol: ctx.symbol, side, qty: Number(qty), type: orderType, price: Number(price), tif: t };
    if (t === 'gtd') { if (!(Number(goodThru) > 0)) return { ok: false, error: 'GTD needs an expiry date' }; order.goodThru = Number(goodThru); }
    const sl = bracket && Number(bracket.stopLoss) > 0 ? Number(bracket.stopLoss) : 0;
    const tp = bracket && Number(bracket.takeProfit) > 0 ? Number(bracket.takeProfit) : 0;
    if (sl || tp) order.bracket = { stopLoss: sl, takeProfit: tp };
    onStatus(side + ' ' + orderType + ' ' + Number(qty) + ' @ ' + price + '…');
    jlog(brokerId, side.toUpperCase() + ' ' + orderType.toUpperCase() + ' ' + Number(qty) + ' ' + ctx.symbol + ' @ ' + price + ' (' + t.toUpperCase() + ')' + ((sl || tp) ? '  SL ' + (sl || '-') + ' TP ' + (tp || '-') : ''));
    await placeOrderP(brokerId, order);
    return { ok: true, qty: Number(qty) };
  } catch (e) { return { ok: false, error: (e && /** @type {any} */ (e).message) || String(e) }; }
}

/**
 * Execute a PARSED op-list against the live context. Reports progress via onStatus; returns the outcome (never
 * throws -- a failed op is caught, journaled, and returned as { ok:false, error }).
 * @param {any[]} ops @param {{broker:string, symbol:string, ticket?:any, hedging?:boolean}} ctx
 * @param {(msg: string, err?: boolean) => void} [onStatus]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function execScript(ops, ctx, onStatus = () => {}) {
  const brokerId = ctx.broker || '';
  try {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.op === 'market') {
        // a bare "buy"/"sell" TRIGGER is resolved by the ticket UI (it fires the tab's form); it never reaches the worker
        // through the ticket path. If one arrives here (e.g. an alert/assistant script), there is no form to read -> reject.
        if (op.trigger) throw new Error('a bare "' + op.side + '" fires the order ticket tab -- it only runs from the ticket, give a quantity for a headless order (e.g. "' + op.side + ' 1")');
        if (!brokerId || !ctx.symbol) throw new Error(op.side + ' needs an account + symbol');
        // gather the DISTANCE exits (set stop/target N) that immediately follow this order -> they bracket THIS
        // entry. be/% forms are position-modify only (no range at a fresh entry) and are left to run standalone.
        /** @type {any[]} */ const brk = [];
        while (i + 1 < ops.length && ((ops[i + 1].op === 'setStop' && ops[i + 1].mode === 'dist') || ops[i + 1].op === 'setTarget')) { brk.push(ops[i + 1]); i++; }
        const isStake = Number(op.stake) > 0;   // "buy stake N": qty sized from the risk amount + the stop
        if (!brk.length) {
          if (isStake) throw new Error('stake needs a stop -- add "set stop N", e.g. "' + op.side + ' stake ' + op.stake + ' and set stop 20"');
          onStatus(op.side + ' ' + op.qty + '…');
          const r = await placeMarket(ctx, op.side, op.qty, null);   // the ONE market implementation (shared with the dialog's place)
          if (!r.ok) throw new Error(r.error);
        } else {
          // The reference is the CURRENT MARKET PRICE at button-press -- one quote, computed once for BOTH account
          // types (that's all "N points/pips away" needs). No waiting for a fill.
          const inst = await resolveInst(brokerId, ctx.symbol);
          const q = await firstQuote(brokerId, inst);
          const entry = op.side === 'buy' ? q.ask : q.bid;
          const { sl, tp } = bracketPrices(op.side, entry, inst, brk);
          // STAKE: size the qty from the risk amount against the just-computed stop (the SAME sizeFromStake rule the
          // dialog uses). The stop is the risk basis, so a stake with only a target (no stop) is rejected.
          let qty = op.qty;
          if (isStake) {
            if (!(sl > 0)) throw new Error('stake needs a stop -- "set target" alone has no risk basis; add "set stop N"');
            onStatus(op.side + ' stake ' + op.stake + ' + bracket…');
            const s = await sizeStakeQty(brokerId, ctx, op.side, { risk: Number(op.stake), stop: sl }, entry, inst);
            if (s.error) throw new Error(s.error);
            qty = s.qty;
          } else {
            onStatus(op.side + ' ' + op.qty + ' + bracket…');
          }
          await placeMarketBracket(brokerId, ctx, op.side, Number(qty), sl, tp, inst);   // ONE bracket order; the adapter realizes it (MT5 position SL/TP, CQG server-side OCO)
        }
      } else if (op.op === 'setTarget') {
        throw new Error('set target must follow a buy/sell in the same script');
      } else if (op.op === 'setStop' || op.op === 'moveStop') {
        // MODIFY the current open position's protective stop. Two verbs share this path:
        //   set stop N   (setStop/dist) -- place the stop N away from ENTRY (pips/pts)
        //   move stop be (moveStop/be)  -- break-even: stop = entry
        //   move stop N  (moveStop/by)  -- nudge the existing stop N (pips/pts) toward entry (and beyond -> profit lock)
        // Account-type aware: hedging moves the position SL; netting replaces the resting stop order.
        const verb = op.op === 'moveStop' ? 'move stop' : 'set stop';
        if (!brokerId || !ctx.symbol) throw new Error(verb + ' needs an account + symbol');
        const posn = currentPosition(ctx);
        if (!posn) throw new Error('no open position on ' + ctx.symbol + ' to ' + verb);
        const inst = await resolveInst(brokerId, ctx.symbol);
        const dec = inst.priceDecimals != null ? Number(inst.priceDecimals) : null;
        const tick = Number(inst.tickSize) || 0;
        const rnd = (/** @type {number} */ p) => tick ? Math.round(p / tick) * tick : (dec != null ? Number(p.toFixed(dec)) : p);
        const isLong = posn.side === 'long';
        const exit = isLong ? 'sell' : 'buy';
        // the current protective stop (an INPUT to the pct/by price maths): hedging = the position SL; netting = the
        // live resting stop (freshestExitOrder -- the shared ghost-aware lookup).
        const liveStop = posn.net ? freshestExitOrder(brokerId, ctx.symbol, 'stop', exit) : null;
        const curStop = posn.net
          ? (liveStop ? Number(liveStop.stopPrice != null ? liveStop.stopPrice : liveStop.price) : null)
          : (posn.stopLoss != null ? Number(posn.stopLoss) : null);
        let stop;
        if (op.mode === 'be') { const buf = op.buffer ? (isLong ? 1 : -1) * op.buffer * unitSize(dec, op.unit) : 0; stop = rnd(posn.entry + buf); }   // buffer in the profit direction
        else if (op.mode === 'by') {
          if (curStop == null || !isFinite(curStop)) throw new Error('move stop N needs an existing stop to move -- set one first (e.g. "set stop 10")');
          stop = rnd(curStop + (isLong ? 1 : -1) * op.value * unitSize(dec, op.unit));   // nudge the stop N toward entry (and beyond -> profit lock)
        } else { const size = unitSize(dec, op.unit); stop = rnd(isLong ? posn.entry - op.value * size : posn.entry + op.value * size); }
        const label = op.mode === 'be' ? ('BE' + (op.buffer ? (op.buffer > 0 ? '+' : '') + op.buffer : '')) : String(op.value);
        onStatus(verb + ' ' + label + '…');
        // the DSL only COMPUTES the price; applying it is the ONE implementation (setStopPrice: hedging position SL /
        // netting modify-by-id of the OCO leg / standalone stop), shared with the chart drag and the dialog.
        const r = await setStopPrice(ctx, /** @type {number} */ (stop), verb.toUpperCase() + ' ' + label);
        if (!r.ok) throw new Error(r.error);
      } else if (op.op === 'close') {
        const a = /** @type {any} */ (broker.for(ctx.broker));
        if (!a) throw new Error('close needs a connected broker');
        if (op.what === 'all') {
          // FLATTEN the account: first CANCEL every working order (else the resting stop/limit legs orphan -- the
          // pile-up we hit), then CLOSE every open position. Account-scoped when ctx.broker is set. Each order/
          // position goes through the shared verb implementations (cancelById / closeLotById / closePositionSym),
          // fire-and-forget per item as before -- a single refusal must not strand the rest of the flatten.
          const working = /** @type {any[]} */ (platform.orders.all()).filter((o) => (!ctx.broker || o.broker === ctx.broker) && !isTerminal(o.status));
          if (working.length) { jlog(ctx.broker || 'app', 'CANCEL ' + working.length + ' working order' + (working.length === 1 ? '' : 's')); working.forEach((o) => { cancelById(o.broker, o.id); }); }
          const lots = /** @type {any[]} */ (platform.positionLots.all()).filter((l) => !ctx.broker || l.broker === ctx.broker);
          const nets = /** @type {any[]} */ (platform.positions.all()).filter((p) => (!ctx.broker || p.broker === ctx.broker) && Number(p.qty) > 0 && !lots.some((l) => l.broker === p.broker && l.symbol === p.symbol));
          const targets = [...lots, ...nets];
          jlog(ctx.broker || 'app', 'CLOSE ALL -- ' + targets.length + ' position' + (targets.length === 1 ? '' : 's'));
          targets.forEach((t) => { if (t.ticket != null) closeLotById(t.broker, t.ticket); else closePositionSym(t.broker, t.symbol); });
        } else {
          if (!ctx.symbol) throw new Error('close ' + op.what + ' needs a symbol');
          // ACCOUNT-TYPE AWARE. Hedging streams per-ticket lots (close by ticket); netting streams a single net
          // position (no lots, no closeLot) -- there a side/partial close is an OPPOSING market order that reduces
          // the net. Discriminate by what the broker actually streams for THIS symbol.
          const lots = /** @type {any[]} */ (platform.positionLots.all()).filter((l) => (!ctx.broker || l.broker === ctx.broker) && l.symbol === ctx.symbol && Number(l.qty) > 0);
          const net = /** @type {any[]} */ (platform.positions.all()).find((/** @type {any} */ p) => (!ctx.broker || p.broker === ctx.broker) && p.symbol === ctx.symbol && Number(p.qty) > 0);
          const hedging = lots.length > 0;
          if (op.what === 'symbol') {
            // the ONE flatten-by-symbol implementation (account-type aware), shared with the closePosition verb
            const r = await closePositionSym(ctx.broker, ctx.symbol);
            if (!r.ok) throw new Error(r.error);
          } else if (op.what === 'buy' || op.what === 'sell') {
            const side = op.what === 'buy' ? 'long' : 'short';
            if (hedging) {
              const match = lots.filter((l) => l.side === side);
              if (!match.length) throw new Error('no ' + op.what + ' position on ' + ctx.symbol);
              if (!a.closeLot) throw new Error('broker cannot close one side');
              jlog(ctx.broker, 'CLOSE ' + op.what.toUpperCase() + ' ' + ctx.symbol + ' -- ' + match.length);
              match.forEach((l) => closeLotById(ctx.broker, l.ticket));   // per-lot via the shared verb (fire-and-forget, as before)
            } else {
              // NETTING: the net has one side; close it only when it matches, via an opposing market order
              if (!net || net.side !== side) throw new Error('no ' + op.what + ' position on ' + ctx.symbol);
              const exit = op.what === 'buy' ? 'sell' : 'buy';
              jlog(ctx.broker, 'CLOSE ' + op.what.toUpperCase() + ' ' + ctx.symbol + ' -- ' + net.qty);
              await placeOrderP(ctx.broker, { symbol: ctx.symbol, side: exit, qty: Number(net.qty), type: 'market' });
            }
          } else if (op.what === 'partial') {
            // Close N (lots / contracts / shares) off the CURRENT position. currentPosition resolves the single position;
            // with SEVERAL on the symbol and no ticket to pin one it throws "open the ticket on the one to modify".
            const posn = currentPosition(ctx);
            if (!posn) throw new Error('no position on ' + ctx.symbol + ' to partial-close');
            const cur = Number(posn.qty);
            const amount = Math.min(Number(op.qty), cur);
            jlog(ctx.broker, 'PARTIAL CLOSE ' + amount + ' ' + ctx.symbol + (amount < Number(op.qty) ? ' (capped from ' + op.qty + ')' : ''));
            if (posn.net) {
              await placeOrderP(ctx.broker, { symbol: ctx.symbol, side: exitSide(posn.side), qty: amount, type: 'market' });   // netting: opposing market order
            } else {
              if (!a.closeLotPartial || !a.closeLot) throw new Error('broker cannot partial-close');
              closeLotById(ctx.broker, posn.ticket, amount >= cur ? undefined : amount);   // hedging: partial-close THIS position (whole = undefined)
            }
          }
        }
      }
      await sleep(0);
    }
    onStatus('done', false);
    return { ok: true };
  } catch (e) {
    const msg = /** @type {any} */ (e).message || String(e);
    onStatus(msg, true);
    jlog(ctx.broker || 'app', 'SCRIPT stopped: ' + msg, true);
    return { ok: false, error: msg };
  }
}

// ---- ATOMIC ops for the chart interaction bridge (drag a dot -> an ABSOLUTE price) --------------------------------
// These are the same order business logic as the DSL `set stop`/`set target`, but the price is GIVEN (the dragged
// value) rather than computed from a distance. Account-type aware. Return { ok, error? } like execScript.

/** @param {any} inst @returns {(p:number)=>number} tick-rounder for the instrument */
function rounder(inst) {
  const dec = inst && inst.priceDecimals != null ? Number(inst.priceDecimals) : null;
  const tick = Number(inst && inst.tickSize) || 0;
  return (/** @type {number} */ p) => tick ? Math.round(p / tick) * tick : (dec != null ? Number(p.toFixed(dec)) : p);
}

/** Set the position's protective STOP to an ABSOLUTE price. Hedging: move the position SL; netting: replace the
 * freshest resting stop. THE one apply-a-stop implementation -- the DSL's set/move stop computes its price and
 * delegates here (note carries its verb+label for the journal, e.g. "MOVE STOP BE").
 * @param {{broker:string, symbol:string, ticket?:any}} ctx @param {number} price @param {string} [note] */
export async function setStopPrice(ctx, price, note) {
  const brokerId = ctx.broker || '';
  const verb = note || (Number(price) > 0 ? 'SET STOP' : 'REMOVE STOP');   // 0 = strip the level (hedging position modify)
  try {
    const posn = currentPosition(ctx);
    if (!posn) throw new Error('no open position on ' + ctx.symbol + ' to set a stop');
    const inst = await resolveInst(brokerId, ctx.symbol);
    const dec = inst.priceDecimals != null ? Number(inst.priceDecimals) : null;
    const stop = rounder(inst)(Number(price));
    const exit = exitSide(posn.side);
    if (!posn.net) {
      jlog(brokerId, verb + ' #' + posn.ticket + ' ' + ctx.symbol + ' @ ' + fmtPx(stop, dec));
      await modifyP(brokerId, { id: posn.ticket, stopLoss: stop, takeProfit: posn.takeProfit || 0 });
    } else {
      const liveStop = freshestExitOrder(brokerId, ctx.symbol, 'stop', exit);
      if (liveStop) {
        // MODIFY the resting stop by order_id -- it is a compound (OCO) leg; cancel+replace would orphan the sibling.
        jlog(brokerId, verb + ' ' + ctx.symbol + ' @ ' + fmtPx(stop, dec) + ' (modify #' + liveStop.id + ')');
        await modifyP(brokerId, { orderId: liveStop.id, price: stop });
      } else {
        jlog(brokerId, verb + ' ' + ctx.symbol + ' @ ' + fmtPx(stop, dec));
        await placeOrderP(brokerId, { symbol: ctx.symbol, side: exit, qty: posn.qty, type: 'stop', price: stop });
      }
    }
    return { ok: true };
  } catch (e) { const msg = /** @type {any} */ (e).message || String(e); jlog(brokerId, verb + ' failed: ' + msg, true); return { ok: false, error: msg }; }
}

/** Set the position's TARGET to an ABSOLUTE price. Hedging: move the position TP; netting: replace the freshest
 * resting limit. @param {{broker:string, symbol:string, ticket?:any}} ctx @param {number} price */
export async function setTargetPrice(ctx, price) {
  const brokerId = ctx.broker || '';
  const verb = Number(price) > 0 ? 'SET TARGET' : 'REMOVE TARGET';   // 0 = strip the level (hedging position modify)
  try {
    const posn = currentPosition(ctx);
    if (!posn) throw new Error('no open position on ' + ctx.symbol + ' to set a target');
    const inst = await resolveInst(brokerId, ctx.symbol);
    const dec = inst.priceDecimals != null ? Number(inst.priceDecimals) : null;
    const tgt = rounder(inst)(Number(price));
    const exit = exitSide(posn.side);
    if (!posn.net) {
      jlog(brokerId, verb + ' #' + posn.ticket + ' ' + ctx.symbol + ' @ ' + fmtPx(tgt, dec));
      await modifyP(brokerId, { id: posn.ticket, takeProfit: tgt, stopLoss: posn.stopLoss || 0 });
    } else {
      const liveLimit = freshestExitOrder(brokerId, ctx.symbol, 'limit', exit);
      if (liveLimit) {
        // MODIFY the resting limit by order_id -- it is a compound (OCO) leg; cancel+replace would orphan the sibling.
        jlog(brokerId, verb + ' ' + ctx.symbol + ' @ ' + fmtPx(tgt, dec) + ' (modify #' + liveLimit.id + ')');
        await modifyP(brokerId, { orderId: liveLimit.id, price: tgt });
      } else {
        jlog(brokerId, verb + ' ' + ctx.symbol + ' @ ' + fmtPx(tgt, dec));
        await placeOrderP(brokerId, { symbol: ctx.symbol, side: exit, qty: posn.qty, type: 'limit', price: tgt });
      }
    }
    return { ok: true };
  } catch (e) { const msg = /** @type {any} */ (e).message || String(e); jlog(brokerId, verb + ' failed: ' + msg, true); return { ok: false, error: msg }; }
}

/** Modify a resting order's PRICE (and optionally QTY) by id -- for a CQG server-side OCO leg, this MOVES the order
 * while KEEPING the OCO bond (a modify preserves the link; a cancel+replace would break it -- validated in the CQG lab).
 * @param {string} brokerId @param {any} id @param {number} [price] @param {number} [qty] @param {number} [stopLoss] @param {number} [takeProfit] */
export async function modifyOrderPrice(brokerId, id, price, qty, stopLoss, takeProfit) {
  try {
    const a = /** @type {any} */ (broker.for(brokerId));
    if (!a || !a.modifyOrder) throw new Error('no modify on ' + brokerId);
    /** @type {{ orderId: any, price?: number, qty?: number, stopLoss?: number, takeProfit?: number }} */
    const mod = { orderId: id };
    if (price != null) mod.price = Number(price);
    if (qty != null && Number(qty) > 0) mod.qty = Math.abs(Number(qty));   // fractional lots (MT5 0.5) preserved -- don't round to whole units; the broker validates the volume step
    if (stopLoss != null) mod.stopLoss = Number(stopLoss);       // a resting hedging order's protective SL/TP (MT5); 0 = keep existing (the EA preserves it)
    if (takeProfit != null) mod.takeProfit = Number(takeProfit);
    jlog(brokerId, 'MODIFY #' + id + (mod.qty != null ? ' qty ' + mod.qty : '') + (mod.price != null ? ' @ ' + mod.price : '') + (mod.stopLoss ? ' SL ' + mod.stopLoss : '') + (mod.takeProfit ? ' TP ' + mod.takeProfit : ''));
    await new Promise((resolve, reject) => a.modifyOrder(mod, (/** @type {any} */ r) => (r && r.error) ? reject(new Error(r.error)) : resolve(r)));
    return { ok: true };
  } catch (e) { const msg = /** @type {any} */ (e).message || String(e); jlog(brokerId, 'MODIFY #' + id + ' failed: ' + msg, true); return { ok: false, error: msg }; }
}

/** Modify an OPEN POSITION's protective SL/TP together, by ticket (hedging: SL/TP are position attributes).
 * @param {string} brokerId @param {any} ticket @param {number} [stopLoss] @param {number} [takeProfit] */
export async function modifyPosition(brokerId, ticket, stopLoss, takeProfit) {
  try {
    const a = /** @type {any} */ (broker.for(brokerId));
    if (!a || !a.modifyOrder) throw new Error('no modify on ' + brokerId);
    jlog(brokerId, 'MODIFY #' + ticket + ' SL ' + (stopLoss || '-') + ' TP ' + (takeProfit || '-'));
    await new Promise((resolve, reject) => a.modifyOrder({ id: ticket, stopLoss: Number(stopLoss) || 0, takeProfit: Number(takeProfit) || 0 }, (/** @type {any} */ r) => (r && r.error) ? reject(new Error(r.error)) : resolve(r)));
    return { ok: true };
  } catch (e) { const msg = /** @type {any} */ (e).message || String(e); jlog(brokerId, 'MODIFY #' + ticket + ' failed: ' + msg, true); return { ok: false, error: msg }; }
}

/** Close ONE open position by ticket (hedging lot). @param {string} brokerId @param {any} ticket @param {number} [qty] partial qty; whole lot when omitted */
export async function closeLotById(brokerId, ticket, qty) {
  try {
    const a = /** @type {any} */ (broker.for(brokerId));
    const partial = qty != null && Number(qty) > 0;
    if (!a || (partial ? !a.closeLotPartial : !a.closeLot)) throw new Error('cannot close on ' + brokerId);
    jlog(brokerId, (partial ? 'PARTIAL CLOSE ' + Number(qty) + ' #' : 'CLOSE #') + ticket);   // fractional lots (MT5 0.5) -- NEVER round to whole units; the broker validates the volume step
    await new Promise((resolve, reject) => {
      const cb = (/** @type {any} */ r) => (r && r.error) ? reject(new Error(r.error)) : resolve(r);
      if (partial) a.closeLotPartial(ticket, Number(qty), cb); else a.closeLot(ticket, cb);
    });
    return { ok: true };
  } catch (e) { const msg = /** @type {any} */ (e).message || String(e); jlog(brokerId, 'CLOSE #' + ticket + ' failed: ' + msg, true); return { ok: false, error: msg }; }
}

/** Flatten a position by SYMBOL (account-type aware -- the structured twin of the DSL `close symbol`). Hedging:
 * close every open lot on the symbol (closeLot per ticket). Netting: the broker's offsetting closePosition. This is
 * the single-owner home for "flatten this symbol"; surfaces (Positions tab, Assistant) route here instead of calling
 * the broker directly. @param {string} brokerId @param {string} symbol */
export async function closePositionSym(brokerId, symbol) {
  try {
    const a = /** @type {any} */ (broker.for(brokerId));
    if (!a) throw new Error('close needs a connected broker on ' + brokerId);
    const lots = /** @type {any[]} */ (platform.positionLots.all()).filter((l) => l.broker === brokerId && l.symbol === symbol && Number(l.qty) > 0);
    const net = /** @type {any} */ (/** @type {any[]} */ (platform.positions.all()).find((p) => p.broker === brokerId && p.symbol === symbol && Number(p.qty) > 0));
    if (lots.length) {
      if (!a.closeLot) throw new Error('broker cannot close lots on ' + brokerId);
      jlog(brokerId, 'CLOSE ' + symbol + ' -- ' + lots.length + ' lot' + (lots.length === 1 ? '' : 's'));
      await Promise.all(lots.map((l) => new Promise((resolve, reject) => a.closeLot(l.ticket, (/** @type {any} */ r) => (r && r.error) ? reject(new Error(r.error)) : resolve(r)))));
    } else if (net) {
      if (!a.closePosition) throw new Error('broker cannot close ' + symbol);
      jlog(brokerId, 'CLOSE ' + symbol + ' -- ' + net.qty);
      await new Promise((resolve, reject) => a.closePosition(symbol, (/** @type {any} */ r) => (r && r.error) ? reject(new Error(r.error)) : resolve(r)));
    } else {
      throw new Error('no open position on ' + symbol);
    }
    return { ok: true };
  } catch (e) { const msg = /** @type {any} */ (e).message || String(e); jlog(brokerId, 'CLOSE ' + symbol + ' failed: ' + msg, true); return { ok: false, error: msg }; }
}

// The four broker trade methods an assistant may invoke (mirrors the contract's execution surface).
/** @type {Record<string, number>} */
const ASSISTANT_TRADE = { placeOrder: 1, modifyOrder: 1, cancelOrder: 1, closePosition: 1 };

/** Execute an ASSISTANT-originated order THROUGH the worker -- the worker is now the SINGLE enforcement point (this
 * check moved here from the data-host backstop). The AI reaches this only via the gated MCP surface -> the order bus;
 * the order-host is a separate process it cannot post to directly, so this IS the trusted boundary. Steps:
 *   1. run the app-installed exec gate (fresh policy read + optional per-order user confirm; it THROWS to deny,
 *      and with no gate installed the engine default denies everything -- see data_engine/policy.js),
 *   2. dispatch on the ACTIVE broker (the assistant addresses the active connection), promisified.
 * Returns { ok, result?/error? } like the other executors. @param {string} method @param {any[]} args */
export async function assistantOrder(method, args) {
  const arg = args && args[0];
  const a = /** @type {any} */ (broker.active());
  const brokerId = (a && a.id) || null;
  try {
    if (!ASSISTANT_TRADE[method]) throw new Error('not an order method: ' + method);
    await execGate(method, arg, brokerId);   // policy + per-order confirm -- app business, injected at boot
    if (!a || typeof a[method] !== 'function') throw new Error('no active broker for ' + method);
    jlog(brokerId || 'assistant', 'ASSISTANT ' + method.toUpperCase() + ' ' + (arg && typeof arg === 'object' ? JSON.stringify(arg) : String(arg)));
    const result = await new Promise((resolve, reject) => a[method](arg, (/** @type {any} */ r) => (r && r.error) ? reject(new Error(r.error)) : resolve(r)));
    return { ok: true, result };
  } catch (e) { const msg = /** @type {any} */ (e).message || String(e); jlog(brokerId || 'assistant', 'ASSISTANT ' + method + ' failed: ' + msg, true); return { ok: false, error: msg }; }
}

/** Cancel a single resting order by id. @param {string} brokerId @param {any} id */
export async function cancelById(brokerId, id) {
  try {
    const a = /** @type {any} */ (broker.for(brokerId));
    if (!a || !a.cancelOrder) throw new Error('no cancel on ' + brokerId);
    jlog(brokerId, 'CANCEL #' + id);
    await new Promise((resolve, reject) => a.cancelOrder(id, (/** @type {any} */ r) => (r && r.error) ? reject(new Error(r.error)) : resolve(r)));
    return { ok: true };
  } catch (e) { const msg = /** @type {any} */ (e).message || String(e); return { ok: false, error: msg }; }
}
