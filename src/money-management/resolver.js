// @ts-check
// THE money-management gather -- the single join from an account reference to the engine's sizing snapshot.
// Every consumer (order-worker policy, Money Man tab, order-ticket preview) asks HERE; none re-implements
// the lookup. No decisions live in this file: it gathers warm inputs (connect profile, MM config, closed
// trades) and hands them to the pure engine (mmState). The answer is the engine's.
//
// Identity is the ACCOUNT, not the broker. Trades are filtered by ctx.accountId (falling back to the
// broker's connected account when a caller carries no id -- e.g. a DSL script ctx). The config key + the
// origin come from the profile the protocol CONNECTED with (broker.connections(): name + startingBalance),
// so the join is exact even with many saved profiles on one protocol.
import { platform, broker, computePositions, mmState } from '../../data_engine/index.js';
import { netOf } from '../surface/trade-derive.js';
import { getMMConfig } from './config.js';

/** Closed round-trip nets for ONE account, oldest first -- the MM replay input. Tick specs (stamped on
 *  each fill by the adapter) are required for currency P&L, same as the History surface.
 *  @param {string} brokerId @param {string|number|null|undefined} accountId @returns {number[]} */
export function closedNets(brokerId, accountId) {
  const fills = platform.fills.all();
  /** @type {Map<string, {tickSize?:any, tickValue?:any}>} */
  const tickBySym = new Map();
  for (const s of fills)
    if (s.symbol && !tickBySym.has(s.symbol) && (s.tickValue != null || s.tickSize != null))
      tickBySym.set(s.symbol, { tickSize: s.tickSize, tickValue: s.tickValue });
  const { closed } = computePositions(fills, { contractInfo: (sym) => tickBySym.get(sym) });
  return closed
    .filter(
      (r) =>
        String(r.broker).toLowerCase() === String(brokerId).toLowerCase() &&
        String(r.accountId) === String(accountId),
    )
    .sort((a, b) => (Number(a.exitTime) || 0) - (Number(b.exitTime) || 0))
    .map((r) => netOf(r))
    .filter((n) => n != null)
    .map((n) => Number(n));
}

/**
 * The engine's sizing snapshot for an account on money management, or null (manual account, no connect
 * profile, no origin). ref = { broker, accountId? } -- the same ctx every order command carries.
 * @param {{ broker?: string, accountId?: string|number|null }} ref
 * @returns {(ReturnType<typeof mmState> & { system: 'mm' }) | null}
 */
export function mmSnapshot(ref) {
  const brokerId = ref && ref.broker;
  if (!brokerId) return null;
  const conn = broker
    .connections()
    .find((/** @type {any} */ c) => String(c.id).toLowerCase() === String(brokerId).toLowerCase());
  if (!conn || conn.startingBalance == null) return null; // no connect profile / no origin -> can't size
  const cfg = getMMConfig(conn.name);
  if (cfg.system !== 'mm') return null; // manual account -> the order's own sizing stands
  // The account must EXIST in the live store: a supplied accountId is validated against it (an unknown id
  // must never size -- an empty "history" would read as a fresh account at full risk); a missing one falls
  // back to the broker's connected account.
  const acct = platform.accounts
    .all()
    .find(
      (/** @type {any} */ a) =>
        String(a.broker).toLowerCase() === String(brokerId).toLowerCase() &&
        (ref.accountId == null || String(a.accountId) === String(ref.accountId)),
    );
  if (!acct) return null;
  const accountId = acct.accountId;
  const st = mmState(
    {
      origin: Number(conn.startingBalance),
      increment: cfg.increment,
      maxDd: cfg.maxDd,
      baseMaxPct: cfg.baseMaxPct,
      shotMaxPct: cfg.shotMaxPct,
      beThreshold: cfg.beThreshold,
    },
    closedNets(brokerId, accountId),
  );
  return { ...st, system: 'mm' };
}
