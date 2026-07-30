// @ts-check
// The Schwab TRADER layer — accounts, positions, working orders, order history, and the OnTrade
// polling loop (Schwab has no push). This is the adapter's execution plane and the home of its
// verification debt: the account leg is PROVEN; the position/order mappers are BLIND / UNVERIFIED
// (Slice 3 Task 8) — mapped against Schwab's DOCUMENTED Trader API shapes, NOT observed (the live
// account is flat with no order history). See .docs/adr for the ledger. Verify the moment a real
// position/order exists. No order is ever placed here. index.js spreads `trader` into the adapter.
import { emitRaw } from '/data_engine/data/raw-tap.js'; // diagnostic tap (Data Interceptor); no-op when unused
import { j, mdFail } from './common.js';

/** @type {Map<Function, any>} */
const tradePollers = new Map(); // subscribeTrade cb -> interval timer (account polling; Schwab has no push)
// disconnect() kills every OnTrade polling loop (the map is this module's own state)
export function stopTradePolling() {
  tradePollers.forEach((t) => clearInterval(t));
  tradePollers.clear();
}

// Map a Schwab securitiesAccount (/trader/v1/accounts) to the neutral Account shape. Realized/unrealized P&L
// are NOT in the balances (they come from positions) -> omitted until positions are observable. Schwab US
// accounts are USD. Extras (buyingPower, longMarketValue, accountType) ride through the open Account shape.
/** @param {any} entry @returns {any} */
function mapAccount(entry) {
  const sa = (entry && entry.securitiesAccount) || {};
  const b = sa.currentBalances || {};
  /** @param {any} v @returns {number|undefined} */
  const n = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    accountId: String(sa.accountNumber || 'schwab'),
    currency: 'USD',
    balance: n(b.cashBalance),
    equity: n(b.liquidationValue),
    marginAvailable: n(b.availableFunds),
    marginUsed: n(b.maintenanceRequirement),
    buyingPower: n(b.buyingPower),
    longMarketValue: n(b.longMarketValue),
    accountType: sa.type,
  };
}

/** @type {Record<string, string>} */
const SCHWAB_OSTATUS = {
  WORKING: 'working',
  QUEUED: 'working',
  ACCEPTED: 'working',
  NEW: 'working',
  PENDING_ACTIVATION: 'working',
  AWAITING_PARENT_ORDER: 'working',
  FILLED: 'filled',
  CANCELED: 'cancelled',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  PENDING_CANCEL: 'in_cancel',
  PENDING_REPLACE: 'in_modify',
  REPLACED: 'replaced',
};
/** @type {Record<string, string>} */
const SCHWAB_OTYPE = { MARKET: 'market', LIMIT: 'limit', STOP: 'stop', STOP_LIMIT: 'stop', TRAILING_STOP: 'stop' };
/** BLIND. @param {any} p @param {any} acctId @returns {any} */
function mapPosition(p, acctId) {
  const long = Number((p && p.longQuantity) || 0),
    short = Number((p && p.shortQuantity) || 0);
  const net = long - short;
  return {
    symbol: (p && p.instrument && p.instrument.symbol) || '',
    qty: Math.abs(net),
    side: net < 0 ? 'short' : 'long',
    avgPrice: p && p.averagePrice != null ? Number(p.averagePrice) : null,
    accountId: String(acctId || ''),
  };
}
/** BLIND. @param {any} o @param {any} acctId @returns {any} */
function mapOrder(o, acctId) {
  const leg = (o && o.orderLegCollection && o.orderLegCollection[0]) || {};
  const instr = String((leg && leg.instruction) || '');
  return {
    id: String(o && o.orderId != null ? o.orderId : ''),
    symbol: (leg.instrument && leg.instrument.symbol) || '',
    side: /^SELL/.test(instr) ? 'sell' : 'buy',
    type: SCHWAB_OTYPE[o && o.orderType] || 'market',
    qty: o && o.quantity != null ? Number(o.quantity) : null,
    price: o && o.price != null ? Number(o.price) : null,
    limitPrice: o && o.price != null ? Number(o.price) : null,
    stopPrice: o && o.stopPrice != null ? Number(o.stopPrice) : null,
    status: SCHWAB_OSTATUS[o && o.status] || 'working',
    time: o && o.enteredTime ? Date.parse(o.enteredTime) : null,
    updateTime: o && o.closeTime ? Date.parse(o.closeTime) : null,
    accountId: String(acctId || ''),
  };
}

export const trader = {
  // account snapshot (/trader/v1/accounts -> currentBalances). One-shot; the live surface polls via subscribeTrade.
  /** @param {(a: any) => void} [cb] */
  getAccount(cb) {
    j('/api/schwab/trader/accounts')
      .then((data) => {
        emitRaw('schwab', 'account', data); // raw /accounts response
        if (!Array.isArray(data)) {
          mdFail('account', data && data.error);
          return cb && cb({ error: (data && data.error) || 'no account' });
        }
        if (!data.length) return cb && cb({ error: 'no accounts' });
        cb && cb(mapAccount(data[0]));
      })
      .catch((e) => cb && cb({ error: String((e && e.message) || e) }));
  },

  // BLIND: current positions across accounts (/trader/v1/accounts?fields=positions). Empty on a flat account.
  /** @param {(ps: any[]) => void} [cb] */
  getPositions(cb) {
    j('/api/schwab/trader/accounts?fields=positions')
      .then((data) => {
        emitRaw('schwab', 'positions', data);
        if (!Array.isArray(data)) return cb && cb([]);
        /** @type {any[]} */
        const out = [];
        for (const entry of data) {
          const sa = entry.securitiesAccount || {};
          for (const p of sa.positions || []) out.push(mapPosition(p, sa.accountNumber));
        }
        cb && cb(out);
      })
      .catch(() => cb && cb([]));
  },
  // BLIND: working orders right now (/trader/v1/orders?status=WORKING).
  /** @param {(os: any[]) => void} [cb] */
  getOrders(cb) {
    j('/api/schwab/trader/orders?status=WORKING&maxResults=200')
      .then((data) => {
        emitRaw('schwab', 'orders', data);
        if (!Array.isArray(data)) return cb && cb([]);
        cb && cb(data.map((/** @type {any} */ o) => mapOrder(o, o.accountNumber)));
      })
      .catch(() => cb && cb([]));
  },
  // BLIND: filled/terminal orders over a past range (/trader/v1/orders with entered-time bounds).
  /** @param {{ fromMs: number, toMs: number }} range @param {(os: any[]) => void} [cb] */
  getHistory({ fromMs, toMs }, cb) {
    const from = new Date(fromMs).toISOString(),
      to = new Date(toMs).toISOString();
    j(
      '/api/schwab/trader/orders?fromEnteredTime=' +
        encodeURIComponent(from) +
        '&toEnteredTime=' +
        encodeURIComponent(to) +
        '&maxResults=1000',
    )
      .then((data) => {
        emitRaw('schwab', 'orders-history', data);
        if (!Array.isArray(data)) return cb && cb([]);
        cb && cb(data.map((/** @type {any} */ o) => mapOrder(o, o.accountNumber)));
      })
      .catch(() => cb && cb([]));
  },

  // OnTrade for Schwab (REST, no push): poll account+positions and working orders, emit on change. The
  // account leg is PROVEN; the position/order legs are BLIND (never observed) -- they surface untested the
  // moment a real position/order exists. No order is ever placed here.
  /** @param {(ev: any) => void} cb */
  subscribeTrade(cb) {
    /** @type {Record<string, string>} */
    const last = {};
    /** @param {string} k @param {any} obj @param {any} ev */
    const emitChange = (k, obj, ev) => {
      const s = JSON.stringify(obj);
      if (last[k] !== s) {
        last[k] = s;
        cb(ev);
      }
    };
    const tick = () => {
      j('/api/schwab/trader/accounts?fields=positions')
        .then((data) => {
          emitRaw('schwab', 'account', data);
          if (!Array.isArray(data)) return;
          for (const entry of data) {
            const sa = entry.securitiesAccount || {};
            emitChange('acct:' + (sa.accountNumber || ''), mapAccount(entry), {
              kind: 'account',
              account: mapAccount(entry),
            });
            for (const p of sa.positions || []) {
              const pos = mapPosition(p, sa.accountNumber);
              emitChange('pos:' + pos.symbol, pos, { kind: 'position', position: pos });
            }
          }
        })
        .catch(() => {});
      j('/api/schwab/trader/orders?status=WORKING&maxResults=200')
        .then((data) => {
          if (!Array.isArray(data)) return;
          for (const o of data) {
            const ord = mapOrder(o, o.accountNumber);
            emitChange('ord:' + ord.id, ord, { kind: 'order', order: ord });
          }
        })
        .catch(() => {});
    };
    tick();
    tradePollers.set(cb, setInterval(tick, 5000));
  },
  /** @param {Function} cb */
  unsubscribeTrade(cb) {
    const t = tradePollers.get(cb);
    if (t) {
      clearInterval(t);
      tradePollers.delete(cb);
    }
  },
};
