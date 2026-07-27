// @ts-check
// The assistant enforcement gate. Every operation an AI assistant performs -- via the intended MCP surface --
// runs through here and is checked against the Assistant permission policy (Settings > App > Assistant, see
// assistant-policy.js). This is the app-side boundary the assistant is given; it is NOT the raw internal API.
// The gate is the one place the policy is enforced, so a rule can't be honoured in one call site and forgotten
// in another. A denied capability throws AssistantDenied (an MCP tool turns it into an error result).
import { assistantAllows } from '../settings/assistant-policy.js';

// Thrown when a policy rule forbids the requested capability. Carries the rule key so a caller (an MCP tool
// handler) can report exactly which permission is off.
export class AssistantDenied extends Error {
  /** @param {string} rule */
  constructor(rule) {
    super('assistant: "' + rule + '" is not permitted (Settings > App > Assistant)');
    this.name = 'AssistantDenied';
    /** @type {string} */
    this.rule = rule;
  }
}

// Throw unless the policy currently allows `rule`. Read live each call, so flipping a toggle takes effect
// immediately -- no cached grant outlives the setting.
/** @param {string} rule */
export function requireRule(rule) {
  if (!assistantAllows(rule)) throw new AssistantDenied(rule);
}

// Wrap `fn` so it only runs when `rule` is allowed, throwing AssistantDenied otherwise. The unit the gated
// capability surface (and each MCP tool) is built from.
/** @template {(...a: any[]) => any} F @param {string} rule @param {F} fn @returns {F} */
export function gated(rule, fn) {
  return /** @type {F} */ ((/** @type {any[]} */ ...args) => { requireRule(rule); return fn(...args); });
}
