// @ts-check
// Broker registry — the plug socket. Each protocol module self-registers by
// calling registerBroker() when imported. The core never references a specific
// protocol; it only ever asks the registry for one by id.
/** @typedef {import('./adapter-contract.js').BrokerAdapter} BrokerAdapter */

/** @type {Map<string, BrokerAdapter>} */
const reg = new Map();

/** @param {BrokerAdapter} adapter */
export const registerBroker = (adapter) => reg.set(adapter.id, adapter);
/** @param {string} id @returns {BrokerAdapter | undefined} */
export const getBroker = (id) => reg.get(id) || reg.values().next().value;
/** @returns {BrokerAdapter[]} */
export const listBrokers = () => [...reg.values()];
