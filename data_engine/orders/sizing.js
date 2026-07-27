// @ts-check
// Position sizing -- a PURE business rule. No broker, no store, no DOM, no async. Given a risk amount, an entry
// and a stop, plus the instrument's tick + volume specs, it answers ONE question: how many units to trade.
//
// It is asset- and broker-agnostic on purpose: the math never asks what the instrument is. Everything specific
// (tick size/value, lot step) arrives as numbers off the Instrument contract, which each adapter fills. A future,
// a forex pair, a CFD and a share all flow through the same arithmetic -- only the contract's numbers differ.
//
//   stopDist    = |entry - stop|                    price points
//   riskPerUnit = (stopDist / tickSize) * tickValue account currency lost per 1 unit if the stop is hit
//   qty         = floorToStep(risk / riskPerUnit)   clamped to [minVolume, maxVolume]
//
// tickValue MUST be in the account's currency. MT5 SYMBOL_TRADE_TICK_VALUE is; CQG contract tickValue is. FX for an
// instrument quoted in a non-account currency is a later concern (belongs on the contract, not here).

// Floor a value to a volume step (0.01 lots, 1 contract, ...) without float drift (0.1+0.2 style noise).
/** @param {number} v @param {number} step @returns {number} */
function floorToStep(v, step) {
  const n = Math.floor(v / step + 1e-9);
  const dec = (String(step).split('.')[1] || '').length;   // step's decimal places
  return Number((n * step).toFixed(dec));
}

/**
 * Size a stake (a currency risk amount) into a tradeable quantity.
 * @param {Object} p
 * @param {number} p.risk         risk amount in the ACCOUNT's currency (> 0)
 * @param {number} p.entryPrice   entry price -- a resting order's own price, or the live quote for a market order
 * @param {number} p.stopPrice    the protective stop price
 * @param {number} p.tickSize     min price increment (> 0)
 * @param {number} p.tickValue    account-currency value of one tickSize move, per 1 unit (> 0)
 * @param {number} [p.volumeStep] tradeable quantity increment (default 1 -> whole contracts/shares)
 * @param {number} [p.minVolume]  smallest tradeable quantity (default = volumeStep)
 * @param {number} [p.maxVolume]  largest tradeable quantity (no cap if absent)
 * @returns {{ qty: number, riskPerUnit: number|null, reason: string|null }} qty 0 with a reason = cannot size
 */
export function sizeFromStake(p) {
  const step = p.volumeStep && p.volumeStep > 0 ? p.volumeStep : 1;
  const min = p.minVolume && p.minVolume > 0 ? p.minVolume : step;
  const max = p.maxVolume && p.maxVolume > 0 ? p.maxVolume : Infinity;
  if (!(p.risk > 0)) return { qty: 0, riskPerUnit: null, reason: 'no risk amount' };
  if (!(p.tickSize > 0) || !(p.tickValue > 0)) return { qty: 0, riskPerUnit: null, reason: 'instrument has no tick value' };
  if (!(p.entryPrice > 0) || !(p.stopPrice > 0)) return { qty: 0, riskPerUnit: null, reason: 'need an entry and a stop' };
  const stopDist = Math.abs(p.entryPrice - p.stopPrice);
  if (stopDist < p.tickSize / 2) return { qty: 0, riskPerUnit: null, reason: 'stop is at the entry' };
  const riskPerUnit = (stopDist / p.tickSize) * p.tickValue;
  if (!(riskPerUnit > 0)) return { qty: 0, riskPerUnit, reason: 'stop is at the entry' };
  let qty = floorToStep(p.risk / riskPerUnit, step);
  if (qty > max) qty = floorToStep(max, step);
  if (qty < min) return { qty: 0, riskPerUnit, reason: 'risk too small for the minimum size' };
  return { qty, riskPerUnit, reason: null };
}
