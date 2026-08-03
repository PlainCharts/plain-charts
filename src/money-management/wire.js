// @ts-check
// Installs the money-management sizing policy into the order worker. Loaded in the order-host window
// (order-host.html), next to the assistant exec-gate install.
//
// Thin on purpose: keep the MM config warm in this window and answer the worker's accountRisk() with the
// shared resolver (mmSnapshot). The gather + the account join live in resolver.js -- ONE home for every
// consumer -- and the engine decides. No decisions here.
import { setSizingPolicy } from '../../data_engine/index.js';
import { loadMMConfigs } from './config.js';
import { mmSnapshot } from './resolver.js';

// Warm the MM config once; edits from the Money Man tab arrive over the ui-bus broadcast the config store
// listens on (no polling). The connect profile and the fills are live store reads -- always current.
loadMMConfigs().catch(() => {});

// The policy: the engine-dictated risk$ when the order's account is on money management; null otherwise
// (leaving the order's own manual qty / stake).
setSizingPolicy((ctx) => {
  const s = mmSnapshot(ctx);
  return s ? s.risk : null;
});
