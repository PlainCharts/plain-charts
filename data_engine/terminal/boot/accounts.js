// Saved broker accounts -- read the SAME file the app uses (settings/brokers/accounts.json), so the
// terminal connects with the credentials already configured. The file is gitignored (secrets); we only
// read it locally. Shape: { accounts: [{ name, protocol, autoConnect, ... }], lastUsed }.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../../../settings/brokers/accounts.json', import.meta.url));

/** @returns {{ accounts: any[], lastUsed: string|null, error?: string }} */
export function loadAccounts() {
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    return { accounts: Array.isArray(data.accounts) ? data.accounts : [], lastUsed: data.lastUsed || null };
  } catch (e) {
    return { accounts: [], lastUsed: null, error: e.message };
  }
}
