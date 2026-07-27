// @ts-check
// The Assistant permission policy -- the single source of truth for what an AI assistant may do in the app.
// The Settings -> App -> Assistant UI writes it; the intended MCP surface and the data-host execution
// boundary read it (the check runs where the capability is exercised, not just where it is requested).
// Persisted as the `assistant` object in settings.json. Safe by construction: read + authoring default on,
// order execution defaults OFF and, when enabled, confirms every order.
import { getSetting, setSetting } from './settings.js';

/**
 * A single rule: its stable `key` (persisted + read by enforcement), the `group` (tier) it renders under,
 * the user-facing `label`, and its safe `def`ault.
 * @typedef {{ key: string, group: 'Access'|'Authoring'|'Control'|'Execution', label: string, def: boolean }} AssistantRule
 */

/** @type {AssistantRule[]} */
export const ASSISTANT_RULES = [
  // Access -- read-only state. Safe, default on.
  { key: 'read.market', group: 'Access', label: 'Market data and charts', def: true },
  { key: 'read.account', group: 'Access', label: 'Account, positions and orders', def: true },
  { key: 'read.workspace', group: 'Access', label: 'Workspace, layout and loaded studies', def: true },
  { key: 'read.diagnostics', group: 'Access', label: 'Logs and execution history', def: true },
  // Authoring -- shape your own environment; never touches the market. Default on.
  { key: 'author.studies', group: 'Authoring', label: 'Add, edit and remove studies', def: true },
  { key: 'author.drawings', group: 'Authoring', label: 'Add, edit and remove drawings', def: true },
  { key: 'author.workspace', group: 'Authoring', label: 'Tabs, layout, symbol and timeframe', def: true },
  { key: 'author.appearance', group: 'Authoring', label: 'Themes, templates and vocabulary', def: true },
  { key: 'author.alerts', group: 'Authoring', label: 'Create and edit alerts', def: true },
  // Control -- operational and sensitive, but not order execution. Default off.
  { key: 'control.connections', group: 'Control', label: 'Connect and disconnect brokers and feeds', def: false },
  { key: 'control.addons', group: 'Control', label: 'Install, enable and run addons', def: false },
  // Execution -- orders only; enforced at the data-host boundary. Default off.
  { key: 'execute.orders', group: 'Execution', label: 'Place, modify and cancel orders', def: false },
  { key: 'execute.confirm', group: 'Execution', label: 'Confirm every order before it is sent', def: true },
];

/** @type {Record<string, boolean>} */
const DEFAULTS = Object.fromEntries(ASSISTANT_RULES.map((r) => [r.key, r.def]));

// The full policy: stored values layered over the safe defaults (a missing key falls back to its default).
/** @returns {Record<string, boolean>} */
export function getAssistantPolicy() {
  const saved = /** @type {Record<string, any>} */ (getSetting('assistant')) || {};
  return Object.assign({}, DEFAULTS, saved);
}

// Whether a rule is allowed right now. Any execution sub-action is additionally gated by the master
// `execute` rule -- the enforcement boundary calls this, so the gate lives in one place.
/** @param {string} key @returns {boolean} */
export function assistantAllows(key) {
  const p = getAssistantPolicy();
  if (key === 'execute.confirm') return !!p['execute.orders'] && !!p['execute.confirm'];
  return !!p[key];
}

// Set one rule (read-modify-write the `assistant` object so unrelated rules are preserved).
/** @param {string} key @param {boolean} val */
export function setAssistantRule(key, val) {
  const saved = /** @type {Record<string, any>} */ (getSetting('assistant')) || {};
  saved[key] = !!val;
  setSetting('assistant', saved);
}

// Master switch: whether the MCP server runs at all. Default OFF -- nothing listens on the local port until
// the user opts in, even though every capability is separately gated. Stored alongside the rules.
/** @returns {boolean} */
export function isAssistantServerEnabled() {
  const saved = /** @type {Record<string, any>} */ (getSetting('assistant')) || {};
  return !!saved.serverEnabled;
}
/** @param {boolean} on */
export function setAssistantServerEnabled(on) {
  const saved = /** @type {Record<string, any>} */ (getSetting('assistant')) || {};
  saved.serverEnabled = !!on;
  setSetting('assistant', saved);
}
