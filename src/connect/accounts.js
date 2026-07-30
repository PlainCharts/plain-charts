// @ts-check
// settings/accounts.json: saved broker accounts.
import { getJSON, postJSON } from '../api.js';

// A SAVED account = a stored connection config (distinct from the runtime trading Account in the contract).
// Known fields are typed; adapter form-fields are saved onto it too, hence the open index signature.
/** @typedef {{ name: string, protocol: string, server?: string, username?: string, accountType?: string, startingBalance?: number, historyDays?: number, autoConnect?: boolean, [key: string]: any }} SavedAccount */

/** @type {{ accounts: SavedAccount[], lastUsed: string }} */
let store = { accounts: [], lastUsed: '' };

export async function loadAccounts() {
  const s = await getJSON('/api/accounts');
  store = {
    accounts: Array.isArray(s.accounts) ? s.accounts : [],
    lastUsed: s.lastUsed || '',
  };
  return store;
}

export const listAccounts = () => store.accounts;
export const lastUsed = () => store.lastUsed;

/** @param {SavedAccount} acct */
export function upsertAccount(acct) {
  const i = store.accounts.findIndex((a) => a.name === acct.name);
  if (i >= 0) store.accounts[i] = acct;
  else store.accounts.push(acct);
}

/** @param {string} name */
export function setLastUsed(name) {
  store.lastUsed = name;
}

/** @param {string} name */
export function removeAccount(name) {
  store.accounts = store.accounts.filter((a) => a.name !== name);
  if (store.lastUsed === name) store.lastUsed = '';
}

export const saveAccounts = () => postJSON('/api/accounts', store);
