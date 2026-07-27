// @ts-check
// Broker facade — role switch for the multi-window ecosystem.
//   solo  (browser): the real broker runs in the page (unchanged).
//   host  (Electron headless data host): the real broker + the bridge server.
//   proxy (Electron UI window): a thin proxy that forwards to the host.
// Every consumer imports { broker, listBrokers } from here and is oblivious to the role.
import { ROLE, proxyBroker, startHost } from './broker-bridge.js';
import { broker as coreBroker, listBrokers } from './broker-core.js';
import { startTradeFeed } from './trade-feed.js';

export const broker = ROLE === 'proxy' ? proxyBroker : coreBroker;
if (ROLE === 'host') startHost(coreBroker);
// feed the platform stores (orders/positions/accounts) where the REAL broker lives — host (Electron) or the
// page (browser 'solo'); NEVER the proxy (a UI window reads the broadcast replica, it must not double-feed).
if (ROLE !== 'proxy') startTradeFeed(coreBroker);

export { listBrokers };
