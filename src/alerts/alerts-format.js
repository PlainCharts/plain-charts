// @ts-check
// Presentation helpers for the alerts panel — pure derivations from an alert record into display strings:
// the row descriptor, the effective name, the hover-card broker/symbol scope, the status label, a time
// alert's schedule line, and the "last fired" timestamp. Record shape is read only through alert-record.js
// (the schema's one home); these turn those reads into user-facing text. DOM-free and testable in Node.
import { statusOf, sourceOf, applyOf, usesTimeframe } from './alert-record.js';
import { fmtAlertTime } from './alert-display.js';
import { t } from '../i18n/i18n.js';

// condLines / isAny (record-shape reads) live in alert-record.js. statusText maps the pure status KEY to a label.
const STATUS_LABEL = { active: 'Active', triggered: 'Triggered', stopped: 'Stopped' };
/** @param {any} a */
export const statusText = (a) => t(STATUS_LABEL[statusOf(a)]);

/** a time alert's schedule as a one-line label ("Daily 20:10", "Jul 22 20:10"). @param {any} a */
export const timeAlertLine = (a) => {
  const s = (a && a.schedule) || {};
  if (s.kind === 'daily') return t('Daily') + ' ' + (s.time || '');
  if (s.kind === 'weekly') return t('Weekly') + ' ' + (s.time || '');
  if (s.kind === 'once') return fmtAlertTime(s.at);
  return t('Time alert');
};
// strip the exchange/broker prefix from a symbol for display ("BROKER:EURUSD" -> "EURUSD"); leave bare symbols as-is.
export const bareSymbol = (/** @type {any} */ s) => { const str = String(s || ''); const i = str.indexOf(':'); return i >= 0 ? str.slice(i + 1) : str; };
// the ", TF" suffix -- shown ONLY when the condition depends on a timeframe (the Moving family), hidden for
// pure price-level conditions (cross/gt/lt).
export const tfSuffix = (/** @type {any} */ a) => (usesTimeframe(a) && a && a.tf) ? ', ' + a.tf : '';
/** the descriptor shown on a row's sub-line: a price alert's "SYMBOL[, TF]", or a time alert's schedule. @param {any} a */
export const descOf = (a) => (sourceOf(a) === 'time') ? timeAlertLine(a)
  : (applyOf(a).kind === 'watchlist') ? (/** @type {any} */ (applyOf(a)).name + tfSuffix(a))
  : (bareSymbol(a && a.symbol) + tfSuffix(a));
/** the row's effective name (same text as the title): explicit name, else the descriptor. @param {any} a */
export const nameOf = (a) => (a && a.name && String(a.name)) || descOf(a);
// the hover card's Broker/Symbol line: "BROKER:EURUSD" (broker prefix + bare instrument). Unlike the row, the
// popup DOES show the broker. '' for a time alert (no instrument); the list name for a watchlist alert.
export const cardScope = (/** @type {any} */ a) => {
  if (sourceOf(a) === 'time') return '';
  if (applyOf(a).kind === 'watchlist') return /** @type {any} */ (applyOf(a)).name;
  const br = a && a.broker ? String(a.broker).toUpperCase() + ':' : '';
  return br + bareSymbol(a && a.symbol);
};
/** when the alert last fired (epoch ms), 0 if it never has. @param {any} a */
export const firedAt = (a) => (a && a.lastFire && a.lastFire.at) || (a && a.rt && a.rt.lastFireMs) || 0;
