// @ts-check
// Neutral timeframe math the ENGINE owns -- the {unit, n} bar-interval spec and its duration. Broker
// adapters map these neutral units to their own wire params; the app's timeframe catalog/UI
// (src/workspace/timeframes.js) layers on top and re-exports barMs for app callers.
// Units: 'm'=minutes, 'h'=hours, 'D'=days, 'W'=weeks, 'M'=months.

// A timeframe spec accepted by the public math (barMs). `unit` is loose (plain string) so
// broker adapters that carry their own {unit:string,n} timeframe types can pass them without a cast.
/** @typedef {{ unit: string, n: number }} TfSpec */

const DAY = 86400000;

/** @param {TfSpec} tf @returns {number} */
export const barMs = (tf) => tf.unit === 'm' ? tf.n * 60000 : tf.unit === 'h' ? tf.n * 3600000
                          : tf.unit === 'D' ? DAY : tf.unit === 'W' ? 7 * DAY : 30 * DAY;
