// @ts-check
// Chart-side plan sizing -- derives the on-chart PILL's quantity for a money-management account, in THIS
// window, with no order dialog open. The plan store carries INTENT (the stop level); the risk is the shared
// MM resolver's answer for the pane's account (the engine decides), and the qty comes from the same pure rule
// the worker runs at fire-time (sizeFromStake). Derived, never stored: nothing here writes back to the plan,
// so no window ever holds a shadow copy of a computable number.
//
// The snapshot is cached per broker and invalidated by EVENTS -- a fill can close a trade (the ladder moves),
// a config edit can flip the account's system, connect/disconnect changes the account. Never per repaint.
import { platform, sizeFromStake } from '../../../data_engine/index.js';
import { mmSnapshot } from '../../money-management/resolver.js';
import { loadMMConfigs, onMMConfigChange } from '../../money-management/config.js';

loadMMConfigs().catch(() => {}); // warm the MM config in this window (kept fresh by the ui-bus broadcast)

/** @type {Map<string, any>} */
const cache = new Map(); // broker -> mmSnapshot | null (null = manual account / nothing connected)
const bump = () => cache.clear();
platform.fills.subscribe(bump);
platform.accounts.subscribe(bump);
onMMConfigChange(bump);

/** The cached engine snapshot for a broker's connected account. @param {string} broker */
function snapFor(broker) {
  if (!cache.has(broker)) cache.set(broker, mmSnapshot({ broker }));
  return cache.get(broker);
}

/**
 * The engine-sized qty for a planned entry on a money-management account, or null when MM does not apply
 * (manual account, nothing connected) or cannot size yet (no stop / no price / no tick specs / risk too
 * tight for one unit). The caller falls back to the plan's own qty on null.
 * @param {{ broker?: string, entry?: number|null, stop?: number|null, tickSize?: any, tickValue?: any }} p
 * @returns {{ qty: number, risk: number, level: string }|null}
 */
export function mmPlanQty(p) {
  if (!p || !p.broker) return null;
  const s = snapFor(p.broker);
  if (!s) return null;
  const entry = Number(p.entry);
  const stop = Number(p.stop);
  if (!(entry > 0) || !(stop > 0)) return null;
  const r = sizeFromStake({
    risk: Number(s.risk),
    entryPrice: entry,
    stopPrice: stop,
    tickSize: Number(p.tickSize),
    tickValue: Number(p.tickValue),
  });
  return r.qty > 0 ? { qty: r.qty, risk: Number(s.risk), level: s.level } : null;
}
