// @ts-check
// The engine's EXECUTION GATE for assistant-originated orders -- an injectable policy seam. The engine
// enforces THAT a gate runs before an assistant order dispatches (exec.js assistantOrder); WHAT the gate
// checks (the user's Assistant policy, per-order confirmation UI) is app business, installed at boot via
// setExecGate. Fail-safe default: with no gate installed, every assistant order is denied.

/** @type {(method: string, arg: any, brokerId: (string|null)) => Promise<void>} */
let gate = async () => {
  throw new Error('assistant execution not permitted (no policy installed)');
};

/** Install the app's gate. It must THROW to deny (message becomes the order error) and resolve to allow.
 * @param {(method: string, arg: any, brokerId: (string|null)) => Promise<void>} fn */
export function setExecGate(fn) {
  gate = fn;
}

/** Run the installed gate; throws to deny. @param {string} method @param {any} arg @param {(string|null)} brokerId */
export function execGate(method, arg, brokerId) {
  return gate(method, arg, brokerId);
}
