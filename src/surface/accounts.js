// @ts-check
// Accounts surface — an NT8-style table: one row per live account, with USER-CONFIGURABLE columns. The gear
// opens a column picker (available fields on the left, chosen columns on the right, reorderable). Which
// columns and their order persist in settings. Rows are live accounts (platform.accounts) enriched with the
// connection status / name / server from the saved account. Read-only.
import { platform, broker, bus } from '../../data_engine/index.js';
import * as accounts from '../connect/accounts.js';
import { getSetting, setSetting } from '../settings/settings.js';
import { GEAR, openColumnPicker } from './column-picker.js';
import { createTableSort } from './table-sort.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup for column labels + status text

/**
 * @typedef {import('../../data_engine/index.js').StoredAccount} AcctRow            the live trading account (contract + broker)
 * @typedef {{ connected: boolean, name?: string, server?: string, accountType?: string }} Ctx   saved-connection context
 * @typedef {{ text: string, cls?: string, dot?: string }} Cell
 * @typedef {{ key: string, label: string, align?: string, get: (r: AcctRow, c: Ctx) => Cell }} Column
 */

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => { const d = document.createElement('div'); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };
/** @param {*} v @param {string} [cur] @returns {string} */
const money = (v, cur) => (v == null || v === '' || Number.isNaN(Number(v))) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
/** @param {*} v @returns {string} */
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v))) ? '—' : Number(v).toLocaleString('en-US');

// the full column catalog. get(row, ctx) returns { text, cls?, node? }. Money columns append the currency.
/** @type {Column[]} */
const CAT = [
  { key: 'status', label: 'Status', align: 'left', get: (r, c) => c.connected ? { text: t('connected'), dot: 'on' } : { text: t('not connected'), dot: '' } },
  { key: 'name', label: 'Name', get: (r, c) => ({ text: c.name || String(r.accountId || '') }) },
  { key: 'protocol', label: 'Protocol', get: (r) => ({ text: (r.broker || '').toUpperCase() }) },
  { key: 'accountType', label: 'Type', align: 'left', get: (r, c) => ({ text: (c.accountType || 'netting').replace(/^./, (s) => s.toUpperCase()) }) },
  { key: 'server', label: 'Server', get: (r, c) => ({ text: c.server || '—' }) },
  { key: 'accountId', label: 'Account', get: (r) => ({ text: r.accountId != null ? String(r.accountId) : '—' }) },
  { key: 'balance', label: 'Balance', align: 'right', get: (r) => ({ text: money(r.balance, r.currency) }) },
  { key: 'equity', label: 'Equity', align: 'right', get: (r) => ({ text: money(r.equity, r.currency) }) },
  { key: 'realizedPL', label: 'Realized P/L', align: 'right', get: (r) => pl(r.realizedPL, r.currency) },
  { key: 'unrealizedPL', label: 'Unrealized P/L', align: 'right', get: (r) => pl(r.unrealizedPL, r.currency) },
  { key: 'totalPL', label: 'Total P/L', align: 'right', get: (r) => pl((Number(r.realizedPL) || 0) + (Number(r.unrealizedPL) || 0), r.currency) },
  { key: 'marginUsed', label: 'Margin used', align: 'right', get: (r) => ({ text: money(r.marginUsed, r.currency) }) },
  { key: 'marginAvailable', label: 'Margin avail', align: 'right', get: (r) => ({ text: money(r.marginAvailable, r.currency) }) },
  { key: 'purchasingPower', label: 'Buying power', align: 'right', get: (r) => ({ text: money(r.purchasingPower, r.currency) }) },
  { key: 'positionMargin', label: 'Position margin', align: 'right', get: (r) => ({ text: money(r.positionMargin, r.currency) }) },
  { key: 'mvo', label: 'MVO', align: 'right', get: (r) => ({ text: money(r.mvo, r.currency) }) },
  { key: 'mvf', label: 'MVF', align: 'right', get: (r) => ({ text: money(r.mvf, r.currency) }) },
  { key: 'cashExcess', label: 'Cash excess', align: 'right', get: (r) => ({ text: money(r.cashExcess, r.currency) }) },
  { key: 'yesterdayBalance', label: 'Yesterday bal', align: 'right', get: (r) => ({ text: money(r.yesterdayBalance, r.currency) }) },
  { key: 'workingOrders', label: 'Working orders', align: 'right', get: (r) => ({ text: num(r.workingOrders) }) },
  { key: 'filledOrders', label: 'Filled orders', align: 'right', get: (r) => ({ text: num(r.filledOrders) }) },
  { key: 'currency', label: 'Currency', get: (r) => ({ text: r.currency || '—' }) },
];
/** @type {Record<string, Column>} */
const BY = Object.fromEntries(CAT.map((c) => /** @type {[string, Column]} */ ([c.key, c])));
/** @param {*} v @param {string} [cur] @returns {Cell} */
const pl = (v, cur) => ({ text: money(v, cur), cls: v > 0 ? 'pos' : v < 0 ? 'neg' : '' });
const DEFAULT_COLS = ['status', 'name', 'protocol', 'server', 'balance', 'realizedPL', 'unrealizedPL', 'totalPL'];
const getCols = () => { const c = getSetting('accountsColumns'); return (Array.isArray(c) && c.length ? c : DEFAULT_COLS).filter((k) => BY[k]); };

// raw (unformatted) value per column, for sorting -- takes the row AND its connection context (status/name/etc.)
/** @type {Record<string, (r: AcctRow, c: Ctx) => any>} */
const RAW = {
  status: (r, c) => (c.connected ? 1 : 0), name: (r, c) => c.name || String(r.accountId || ''), protocol: (r) => r.broker,
  accountType: (r, c) => c.accountType || 'netting', server: (r, c) => c.server, accountId: (r) => r.accountId,
  balance: (r) => r.balance, equity: (r) => r.equity, realizedPL: (r) => r.realizedPL, unrealizedPL: (r) => r.unrealizedPL,
  totalPL: (r) => (Number(r.realizedPL) || 0) + (Number(r.unrealizedPL) || 0),
  marginUsed: (r) => r.marginUsed, marginAvailable: (r) => r.marginAvailable, purchasingPower: (r) => r.purchasingPower,
  positionMargin: (r) => r.positionMargin, mvo: (r) => r.mvo, mvf: (r) => r.mvf, cashExcess: (r) => r.cashExcess,
  yesterdayBalance: (r) => r.yesterdayBalance, workingOrders: (r) => r.workingOrders, filledOrders: (r) => r.filledOrders,
  currency: (r) => r.currency,
};

/** @param {HTMLElement} root */
export function mountAccounts(root) {
  root.innerHTML = '';
  const wrap = el('surface accounts-view');
  const head = el('acct-head');
  const title = el('acct-title', 'Accounts'); const count = el('acct-count', '');
  const gear = el('acct-gear'); gear.title = t('Configure columns'); gear.innerHTML = GEAR;
  const spacer = el('acct-spacer');
  head.append(title, count, spacer, gear);
  const listWrap = el('acct-table-wrap');
  const table = document.createElement('table'); table.className = 'acct-table';
  const thead = document.createElement('thead'); const tbody = document.createElement('tbody');
  table.append(thead, tbody); listWrap.appendChild(table);
  wrap.append(head, listWrap);
  root.appendChild(wrap);

  let cols = getCols();
  // enrich a live account row with its saved-connection context (status / name / server)
  /** @param {AcctRow} r @returns {Ctx} */
  const ctxFor = (r) => { const saved = /** @type {Partial<import('../connect/accounts.js').SavedAccount>} */ (accounts.listAccounts().find((a) => a.protocol === r.broker) || {}); return { connected: broker.isConnected(r.broker), name: saved.name, server: saved.server, accountType: saved.accountType }; };

  // column sort (shared surface rule): rows are { r, c } pairs (row + context), default name ascending
  const sort = createTableSort({ settingKey: 'accountsSort', defaultKey: 'name', defaultDir: 'asc', valueOf: (k, A) => { const acc = RAW[k]; return acc ? acc(A.r, A.c) : undefined; }, onChange: () => render() });

  const render = () => {
    const rows = platform.accounts.all().map((r) => ({ r, c: ctxFor(r) })).sort(sort.compare);   // carry context, apply the active sort
    count.textContent = rows.length ? String(rows.length) : '';
    thead.innerHTML = ''; tbody.innerHTML = '';
    const htr = document.createElement('tr');
    cols.forEach((k) => {
      const th = document.createElement('th'); th.className = 'a-' + (BY[k].align || 'left') + ' sortable';
      th.textContent = t(BY[k].label);
      const ar = sort.arrowFor(k); if (ar) th.appendChild(ar);
      th.onclick = () => sort.setSort(k);
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    if (!rows.length) { const tr = document.createElement('tr'); const tdE = document.createElement('td'); tdE.colSpan = cols.length; tdE.className = 'acct-empty'; tdE.textContent = t('No accounts connected'); tr.appendChild(tdE); tbody.appendChild(tr); return; }
    rows.forEach(({ r, c }) => {
      const tr = document.createElement('tr');
      cols.forEach((k) => {
        const col = BY[k], v = col.get(r, c);
        const td = document.createElement('td'); td.className = 'a-' + (col.align || 'left') + (v.cls ? ' ' + v.cls : '');
        if (v.dot !== undefined) { const dot = el('acct-dot' + (v.dot ? ' on' : '')); td.append(dot, document.createTextNode(v.text)); }
        else td.textContent = v.text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  };

  gear.onclick = () => openColumnPicker(CAT, cols, /** @param {string[]} next */ (next) => { cols = next; setSetting('accountsColumns', cols); render(); });

  render();
  const off1 = platform.accounts.subscribe(render);
  const off2 = bus.on('connections:changed', render);
  return { destroy() { try { off1(); } catch (_) {} try { off2(); } catch (_) {} root.innerHTML = ''; } };
}
