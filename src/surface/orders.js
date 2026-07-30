// @ts-check
// Orders surface -- the ORDER BOOK: a live table of platform.orders (every order across all connected
// brokers, working AND terminal, retained with final status + times). Positions are accumulations of these.
// USER-CONFIGURABLE columns (same setup as Accounts/Positions: gear -> pick + drag-reorder, persisted).
import { platform, bus, command } from '../../data_engine/index.js'; // stores + engine events + the order command funnel
import * as accounts from '../connect/accounts.js';
import { getSetting, setSetting } from '../settings/settings.js';
import { GEAR, openColumnPicker } from './column-picker.js';
import { createTableSort } from './table-sort.js';
import { fmtDeskTime, onDeskConfigChange } from './desk-config.js';
import { createAccountFilter } from './account-filter.js';
import { createDateFilter } from './date-filter.js';
import { t } from '../i18n/i18n.js'; // vocabulary lookup for column/filter labels

/**
 * @typedef {import('../../data_engine/index.js').StoredOrder} OrderRow   the stored order (contract Order + broker)
 * @typedef {{ text: string, cls?: string }} Cell                  a rendered table cell
 * @typedef {{ key: string, label: string, align?: string, get: (o: OrderRow) => Cell }} Column
 * @typedef {{ key: string, label: string, match: (o: OrderRow) => boolean }} Filter
 */

// only a live WORKING (or suspended) order can be pulled -- not terminal ones, and not transient states already
// in flight (in_transit = still placing, in_cancel = already cancelling, in_modify = being modified).
const CANCELLABLE = new Set(['working', 'suspended']);
/** @param {OrderRow} o */
const cancellable = (o) => CANCELLABLE.has(o.status);

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};
/** @param {*} v @returns {string} */
const txt = (v) => (v == null || v === '' ? '—' : String(v));
/** @param {*} v @returns {string} */
const fmtNum = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('en-US'));
// format a PRICE to the instrument's decimals (index -> 2, forex -> 5); default 2
/** @param {*} v @param {number} dec @returns {string} */
const fmtPrice = (v, dec) =>
  v == null || v === '' || Number.isNaN(Number(v))
    ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
/** @param {OrderRow} o @returns {number} */
const decOf = (o) => (o.priceDecimals != null ? o.priceDecimals : 2);
// epoch ms -> "MM-DD HH:MM:SS" in the desk's display timezone (Configure -> Timezone), shared by every tab
const fmtTime = fmtDeskTime;
/** @param {*} v @returns {string} */
const fmtMoney = (v) =>
  v == null || v === '' || Number.isNaN(Number(v))
    ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// account NAME = the saved connection label (what the Accounts tab shows), matched by protocol
/** @param {OrderRow} r @returns {string} */
const acctName = (r) => {
  const saved = accounts.listAccounts().find((a) => a.protocol === r.broker);
  return (saved && saved.name) || '';
};
// commission is on the FILL for this order (keyed broker:orderId) -- join it in, don't duplicate onto the order
/** @param {OrderRow} o @returns {number|null} */
const commOf = (o) => {
  const f = platform.fills.get(o.broker + ':' + o.id);
  return f && f.commission != null ? f.commission : null;
};
/** @type {Record<string, string>} */
const STATUS_CLS = { filled: 'pos', rejected: 'neg', cancelled: 'dim', expired: 'dim', replaced: 'dim' };

// status buckets for the filter chips. Working = actively live/in-flight (incl. in_cancel/in_modify, still
// live until the transition settles); Inactive = parked (suspended); Cancelled = cancelled/expired/replaced.
const WORKING_ST = new Set(['working', 'in_transit', 'in_modify', 'in_cancel']);
const INACTIVE_ST = new Set(['suspended']);
const CANCELLED_ST = new Set(['cancelled', 'expired', 'replaced']);
/** @type {Filter[]} */
const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'working', label: 'Working', match: (o) => WORKING_ST.has(o.status) },
  { key: 'inactive', label: 'Inactive', match: (o) => INACTIVE_ST.has(o.status) },
  { key: 'filled', label: 'Filled', match: (o) => o.status === 'filled' },
  { key: 'cancelled', label: 'Cancelled', match: (o) => CANCELLED_ST.has(o.status) },
  { key: 'rejected', label: 'Rejected', match: (o) => o.status === 'rejected' },
];

// the column catalog. get(row) returns { text, cls? }.
/** @type {Column[]} */
const CAT = [
  // --- IDENTITY ---
  { key: 'id', label: 'Order #', align: 'left', get: (o) => ({ text: txt(o.id) }) },
  { key: 'symbol', label: 'Symbol', align: 'left', get: (o) => ({ text: txt(o.symbol) }) },
  { key: 'accountName', label: 'Account name', align: 'left', get: (o) => ({ text: txt(acctName(o)) }) },
  { key: 'account', label: 'Account #', align: 'left', get: (o) => ({ text: txt(o.accountId) }) },
  { key: 'broker', label: 'Broker', align: 'left', get: (o) => ({ text: (o.broker || '').toUpperCase() || '—' }) },
  // --- ORDER ---
  {
    key: 'side',
    label: 'Side',
    align: 'left',
    get: (o) => ({
      text: (o.side || '').toUpperCase() || '—',
      cls: o.side === 'sell' ? 'neg' : o.side === 'buy' ? 'pos' : '',
    }),
  },
  { key: 'type', label: 'Type', align: 'left', get: (o) => ({ text: (o.type || '').toUpperCase() || '—' }) },
  { key: 'qty', label: 'Qty', align: 'right', get: (o) => ({ text: fmtNum(o.qty) }) },
  // requested prices (what you WANTED), by order type -- a stop-limit has both; blank when not applicable
  {
    key: 'limitPrice',
    label: 'Limit price',
    align: 'right',
    get: (o) => ({ text: o.limitPrice != null ? fmtPrice(o.limitPrice, decOf(o)) : '—' }),
  },
  {
    key: 'stopPrice',
    label: 'Stop price',
    align: 'right',
    get: (o) => ({ text: o.stopPrice != null ? fmtPrice(o.stopPrice, decOf(o)) : '—' }),
  },
  {
    key: 'avgFillPrice',
    label: 'Fill price',
    align: 'right',
    get: (o) => ({ text: o.avgFillPrice != null ? fmtPrice(o.avgFillPrice, decOf(o)) : '—' }),
  }, // what you GOT
  // protective legs ATTACHED to the order (a pending-order S/L / T/P -- the order carries them natively; they activate on fill)
  {
    key: 'stopLoss',
    label: 'S/L',
    align: 'right',
    get: (o) => ({
      text: o.stopLoss != null ? fmtPrice(o.stopLoss, decOf(o)) : '—',
      cls: o.stopLoss != null ? 'neg' : '',
    }),
  },
  {
    key: 'takeProfit',
    label: 'T/P',
    align: 'right',
    get: (o) => ({
      text: o.takeProfit != null ? fmtPrice(o.takeProfit, decOf(o)) : '—',
      cls: o.takeProfit != null ? 'pos' : '',
    }),
  },
  { key: 'commission', label: 'Commission', align: 'right', get: (o) => ({ text: fmtMoney(commOf(o)) }) },
  { key: 'tif', label: 'TIF', align: 'left', get: (o) => ({ text: (o.tif || '').toUpperCase() || '—' }) },
  {
    key: 'status',
    label: 'Status',
    align: 'left',
    get: (o) => ({ text: txt(o.status), cls: STATUS_CLS[o.status] || '' }),
  },
  // --- TIME ---
  { key: 'time', label: 'Time', align: 'left', get: (o) => ({ text: fmtTime(o.time) }) },
  { key: 'updateTime', label: 'Update time', align: 'left', get: (o) => ({ text: fmtTime(o.updateTime) }) },
  { key: 'expiry', label: 'Expiry', align: 'left', get: (o) => ({ text: fmtTime(o.expiry) }) }, // GTD good-thru time
];
/** @type {Record<string, Column>} */
const BY = Object.fromEntries(CAT.map((c) => /** @type {[string, Column]} */ ([c.key, c])));
const DEFAULT_COLS = [
  'id',
  'symbol',
  'side',
  'qty',
  'limitPrice',
  'stopPrice',
  'stopLoss',
  'takeProfit',
  'avgFillPrice',
  'status',
  'time',
];
const getCols = () => {
  const c = getSetting('ordersColumns');
  return (Array.isArray(c) && c.length ? c : DEFAULT_COLS).filter((k) => BY[k]);
};

// raw (unformatted) value per column, for sorting -- so numbers sort numerically, not by their "1,234.50" text
/** @type {Record<string, (o: OrderRow) => any>} */
const RAW = {
  id: (o) => o.id,
  symbol: (o) => o.symbol,
  accountName: (o) => acctName(o),
  account: (o) => o.accountId,
  broker: (o) => o.broker,
  side: (o) => o.side,
  type: (o) => o.type,
  qty: (o) => o.qty,
  limitPrice: (o) => o.limitPrice,
  stopPrice: (o) => o.stopPrice,
  avgFillPrice: (o) => o.avgFillPrice,
  commission: (o) => commOf(o),
  tif: (o) => o.tif,
  status: (o) => o.status,
  time: (o) => o.time,
  updateTime: (o) => o.updateTime,
  expiry: (o) => o.expiry,
};

/** @param {HTMLElement} root */
export function mountOrders(root) {
  root.innerHTML = '';
  const wrap = el('surface accounts-view');
  const head = el('acct-head');
  const filters = el('ord-filters'); // status filter chips replace the old "ORDERS" label
  const gear = el('acct-gear');
  gear.title = 'Configure columns';
  gear.innerHTML = GEAR;
  const spacer = el('acct-spacer');
  const acctFilter = createAccountFilter('ordersAccountFilter', () => render()); // account lens
  const dateFilter = createDateFilter('ordersRange', () => render()); // date range (by order activity time)
  head.append(filters, spacer, acctFilter.btn, dateFilter.btn, gear);
  const listWrap = el('acct-table-wrap');
  const table = document.createElement('table');
  table.className = 'acct-table';
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  listWrap.appendChild(table);
  wrap.append(head, listWrap);
  root.appendChild(wrap);

  let cols = getCols();
  let filter = 'all';
  // column sort (shared surface rule): default newest first
  const sort = createTableSort({
    settingKey: 'ordersSort',
    defaultKey: 'time',
    valueOf: (k, r) => {
      const acc = RAW[k];
      return acc ? acc(r) : undefined;
    },
    onChange: () => render(),
  });

  // Cancel is an EXECUTION -> route through the order worker (single owner), never call the broker directly. The
  // surface is a dumb sender: it posts the command and only surfaces a failure; the worker journals the action.
  /** @param {OrderRow} o */
  const cancel = (o) => {
    const fail = (/** @type {string} */ msg) =>
      platform.console.post({ level: 'error', cat: 'journal', src: o.broker, msg: 'cancel failed: ' + msg });
    command({ type: 'cancel', broker: o.broker, id: o.id })
      .then((r) => {
        if (r && r.error) fail(r.error);
      })
      .catch((e) => fail((e && /** @type {any} */ (e).message) || String(e)));
  };

  // rebuild the filter chips with live per-bucket counts + active highlight
  /** @param {OrderRow[]} allRows */
  const renderFilters = (allRows) => {
    filters.innerHTML = '';
    FILTERS.forEach((f) => {
      const n = allRows.filter(f.match).length;
      const active = filter === f.key;
      const b = document.createElement('button');
      b.className = 'ord-filter' + (active ? ' active' : '');
      b.appendChild(document.createTextNode(t(f.label)));
      if (f.key === 'all' || n > 0) {
        const c = el('ord-filter-n', String(n));
        b.appendChild(c);
      } // show the count (All always; others only when non-zero)
      b.onclick = () => {
        filter = f.key;
        render();
      };
      filters.appendChild(b);
    });
  };

  const render = () => {
    // account + date lens first; the status chips count within the filtered set. Orders are placed on their
    // update (last status) time, falling back to place time. A LIVE order (working/in-flight) always passes
    // the date lens -- it is current NOW by definition, and an adapter may not supply a setup time at all
    // (a resting order must never vanish behind "Today").
    const all = platform.orders
      .all()
      .filter(
        (o) =>
          acctFilter.matches(o) &&
          (WORKING_ST.has(o.status) || dateFilter.matches(o.updateTime != null ? o.updateTime : o.time)),
      );
    renderFilters(all);
    const match = (FILTERS.find((f) => f.key === filter) || FILTERS[0]).match;
    const rows = all.filter(match).slice().sort(sort.compare); // active sort column + direction
    thead.innerHTML = '';
    tbody.innerHTML = '';
    const htr = document.createElement('tr');
    cols.forEach((k) => {
      const th = document.createElement('th');
      th.className = 'a-' + (BY[k].align || 'left') + ' sortable';
      th.textContent = t(BY[k].label);
      const ar = sort.arrowFor(k);
      if (ar) th.appendChild(ar);
      th.onclick = () => sort.setSort(k);
      htr.appendChild(th);
    });
    htr.appendChild(document.createElement('th')); // actions column (always-on, not configurable)
    thead.appendChild(htr);
    if (!rows.length) {
      const tr = document.createElement('tr');
      const tdE = document.createElement('td');
      tdE.colSpan = cols.length + 1;
      tdE.className = 'acct-empty';
      tdE.textContent = t('No orders');
      tr.appendChild(tdE);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((o) => {
      const tr = document.createElement('tr');
      cols.forEach((k) => {
        const col = BY[k],
          v = col.get(o);
        const td = document.createElement('td');
        td.className = 'a-' + (col.align || 'left') + (v.cls ? ' ' + v.cls : '');
        td.textContent = v.text;
        tr.appendChild(td);
      });
      const act = document.createElement('td');
      act.className = 'a-right ord-actions';
      if (cancellable(o)) {
        const x = document.createElement('button');
        x.className = 'ord-cancel';
        x.textContent = '✕';
        x.title = t('Cancel order');
        x.onclick = () => cancel(o);
        act.appendChild(x);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };

  gear.onclick = () =>
    openColumnPicker(
      CAT,
      cols,
      /** @param {string[]} next */ (next) => {
        cols = next;
        setSetting('ordersColumns', cols);
        render();
      },
    );

  // store events BURST (an execution lands as order+fill+account updates back to back; some brokers re-push on
  // a timer) -- coalesce rebuilds to at most one per 250ms instead of tearing the table down per event
  let renTimer = /** @type {any} */ (0);
  let lastRender = 0;
  const schedule = () => {
    if (renTimer) return;
    const due = Math.max(0, 250 - (performance.now() - lastRender));
    renTimer = setTimeout(() => {
      renTimer = 0;
      lastRender = performance.now();
      render();
    }, due);
  };

  render();
  const off1 = platform.orders.subscribe(schedule);
  const off2 = bus.on('connections:changed', schedule); // saved-connection name/rename -> re-resolve
  const off3 = platform.fills.subscribe(schedule); // commission arrives on the fill -> refresh the join
  const off4 = onDeskConfigChange(schedule); // desk timezone changed -> re-render times
  return {
    destroy() {
      dateFilter.destroy();
      acctFilter.destroy();
      if (renTimer) clearTimeout(renTimer);
      [off1, off2, off3, off4].forEach((f) => {
        try {
          f();
        } catch (_) {}
      });
      root.innerHTML = '';
    },
  };
}
