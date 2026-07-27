// @ts-check
// Installs the APP's assistant-order gate into the engine's policy seam (data_engine/policy.js). The engine
// only enforces THAT a gate runs before an assistant order dispatches; this file is WHAT it checks:
//   1. reload settings FRESH (the worker window doesn't auto-sync them, and the user may have just toggled
//      the policy),
//   2. deny unless `execute.orders` is allowed,
//   3. when `execute.confirm` is on, wait for the user to approve the order in a UI window (fail-safe:
//      a timeout denies).
// Imported for its side effect by the order-host entry (order-host.html), next to the worker runtime.
import { setExecGate } from '../../data_engine/index.js';
import { loadSettings } from '../settings/settings.js';
import { assistantAllows } from '../settings/assistant-policy.js';
import { requestOrderConfirm } from './confirm-host.js';

setExecGate(async (method, arg, brokerId) => {
  await loadSettings();   // FRESH read -- honor a policy the user just changed
  if (!assistantAllows('execute.orders')) throw new Error('assistant execution not permitted (Settings > App > Assistant)');
  if (assistantAllows('execute.confirm')) {
    const ok = await requestOrderConfirm(method, arg, brokerId);
    if (!ok) throw new Error('assistant order not approved');
  }
});
