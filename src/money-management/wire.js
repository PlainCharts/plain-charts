// @ts-check
// Installs the money-management sizing policy into the order worker. Loaded in the order-host window
// (order-host.html), next to the assistant exec-gate install.
//
// It only GATHERS: resolve an order's account -> its MM config + starting balance + closed-trade history, then
// hand those to the pure engine (mmState) for the risk. When the account is on money management, that risk
// becomes the order's size at the worker's single 'place' point (host.js), overriding the form's qty/stake.
// No decisions live here -- the engine decides.
import { platform, computePositions, mmState, setSizingPolicy } from '../../data_engine/index.js';
import * as accounts from '../connect/accounts.js';
import { loadMMConfigs, getMMConfig } from './config.js';

// a closed trade's NET in account currency (realized minus commission) -- inlined so the worker doesn't
// depend on a surface module.
const netOf = (/** @type {any} */ r) => (r.realizedPnl != null ? r.realizedPnl - (r.commission || 0) : null);

// Keep the MM config + saved accounts warm in this window; refresh so edits from the Money Man tab propagate.
async function refresh() {
  try {
    await Promise.all([loadMMConfigs(), accounts.loadAccounts()]);
  } catch (_) {}
}
refresh();
setInterval(refresh, 4000);

/** Closed round-trip nets for a broker's connected account, oldest first. @param {string} brokerId */
function tradesFor(brokerId) {
  const conn = platform.accounts.all().find((a) => String(a.broker).toLowerCase() === String(brokerId).toLowerCase());
  if (!conn) return [];
  const fills = platform.fills.all();
  // tick specs (stamped on each fill by the adapter) are required for currency P&L, same as the History surface
  /** @type {Map<string, {tickSize?:any, tickValue?:any}>} */
  const tickBySym = new Map();
  for (const s of fills)
    if (s.symbol && !tickBySym.has(s.symbol) && (s.tickValue != null || s.tickSize != null))
      tickBySym.set(s.symbol, { tickSize: s.tickSize, tickValue: s.tickValue });
  const { closed } = computePositions(fills, { contractInfo: (sym) => tickBySym.get(sym) });
  return closed
    .filter((r) => r.broker === conn.broker && String(r.accountId) === String(conn.accountId))
    .sort((a, b) => (Number(a.exitTime) || 0) - (Number(b.exitTime) || 0))
    .map((r) => netOf(r))
    .filter((n) => n != null)
    .map((n) => Number(n));
}

// The policy: the risk$ for an order on `brokerId` when its account is on money management; null otherwise
// (leaving the order's own manual qty / stake). Sync -- reads the warm config + the live fills.
setSizingPolicy((brokerId) => {
  const saved = accounts
    .listAccounts()
    .find((a) => String(a.protocol).toLowerCase() === String(brokerId).toLowerCase());
  if (!saved || saved.startingBalance == null) return null;
  const cfg = getMMConfig(saved.name);
  if (cfg.system !== 'mm') return null;
  const st = mmState(
    {
      origin: Number(saved.startingBalance),
      increment: cfg.increment,
      maxDd: cfg.maxDd,
      baseMaxPct: cfg.baseMaxPct,
      shotMaxPct: cfg.shotMaxPct,
      beThreshold: cfg.beThreshold,
    },
    tradesFor(brokerId),
  );
  return st.risk;
});
