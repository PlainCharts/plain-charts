// @ts-check
// History surface -- a table of CLOSED round-trip positions (netting). Each row is one net-0 round-trip
// reconstructed from the fills stream (compute-positions): a position OPENS when net qty leaves 0 and CLOSES
// when it returns to 0. Its identity ("position id") is the ENTRY-time TAG, MMDDYYYY-HHMM -- the same scheme
// the reference position-manager uses for netting accounts. Realized P&L is shown in PRICE units (always);
// currency P&L + running balance follow once per-contract tick value is wired in. Columns are USER-
// CONFIGURABLE (gear -> pick + drag-reorder, persisted), same framework as the Orders/Positions surfaces.
import { platform, bus, computePositions } from '../../data_engine/index.js';
import * as accounts from '../connect/accounts.js';
import { getSetting, setSetting } from '../settings/settings.js';
import { GEAR, openColumnPicker } from './column-picker.js';
import { createTableSort } from './table-sort.js';
import { fmtDeskTime, fmtDeskTag, onDeskConfigChange, getDeskStats, getDeskBeThreshold } from './desk-config.js';
import { createAccountFilter } from './account-filter.js';
import { createDateFilter } from './date-filter.js';
import { netOf, classifyNet, computeRunningBalances, computeTradeStats } from './trade-derive.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup for column labels + status text

/**
 * @typedef {import('../../data_engine/index.js').DerivedPosition} Trade   one closed round-trip
 * @typedef {{ text: string, cls?: string }} Cell
 * @typedef {{ key: string, label: string, align?: string, get: (r: Trade) => Cell }} Column
 */

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => { const d = document.createElement('div'); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };
/** @param {*} v @returns {string} */
const txt = (v) => (v == null || v === '') ? '—' : String(v);
/** @param {*} v @returns {string} */
const fmtNum = (v) => (v == null || v === '' || Number.isNaN(Number(v))) ? '—' : Number(v).toLocaleString('en-US');
/** @param {*} v @param {number} dec @returns {string} */
const fmtPrice = (v, dec) => (v == null || v === '' || Number.isNaN(Number(v))) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
// time columns render in the desk's display timezone (Configure -> Timezone), shared by every desk tab
const fmtTime = fmtDeskTime;
// the position TAG / id: entry time as MMDDYYYY-HHMM (the reference netting scheme), in the desk timezone
const fmtTag = fmtDeskTag;
// duration entry -> exit as "Xd Yh" / "Xh Ym" / "Xm" / "Xs"
/** @param {*} a @param {*} b @returns {string} */
const fmtDur = (a, b) => { if (a == null || b == null) return '—'; let s = Math.max(0, Math.round((Number(b) - Number(a)) / 1000)); const dd = Math.floor(s / 86400); s -= dd * 86400; const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); s -= m * 60; return dd ? dd + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m ? m + 'm ' + s + 's' : s + 's'; };
// a signed money/points value -> { text, cls } with green(+)/red(-) coloring
/** @param {*} v @param {number} [dec] @returns {Cell} */
const signed = (v, dec = 2) => { if (v == null || v === '' || Number.isNaN(Number(v))) return { text: '—' }; const n = Number(v); const s = (n > 0 ? '+' : '') + n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); return { text: s, cls: n > 0 ? 'pos' : n < 0 ? 'neg' : '' }; };
// price decimals for a trade -- from its fills (the adapter stamps priceDecimals on filled records); default 2
/** @param {Trade} r @returns {number} */
const decOf = (r) => { const f = r.fills && r.fills[0]; const d = f && /** @type {any} */ (f).priceDecimals; return (d != null && !Number.isNaN(Number(d))) ? Number(d) : 2; };
// account NAME = the saved connection label, matched by protocol
/** @param {Trade} r @returns {string} */
const acctName = (r) => { const saved = accounts.listAccounts().find((a) => a.protocol === r.broker); return (saved && saved.name) || ''; };
// a closed trade's STATUS (breakeven-zone rule in trade-derive.js), rendered as a colored cell
/** @param {Trade} r @returns {Cell} */
const statusOf = (r) => {
  const n = netOf(r);
  if (n == null) return { text: '—' };
  const c = classifyNet(n, getDeskBeThreshold());
  if (c === 'hit') return { text: t('Hit'), cls: 'pos' };
  if (c === 'miss') return { text: t('Miss'), cls: 'neg' };
  return { text: t('Breakeven'), cls: 'dim' };
};
// running BALANCE per trade -- rebuilt each render (trade-derive.js replay) and read by the Balance
// column. Keys are the fresh DerivedPosition objects compute-positions returns each render, so no stale carry.
/** @type {WeakMap<Trade, number>} */
let balanceByTrade = new WeakMap();

// the column catalog. get(row) returns { text, cls? }.
/** @type {Column[]} */
const CAT = [
  // --- IDENTITY ---
  // Position id: the broker's REAL position id on hedging accounts, else the app's entry-time tag (netting)
  { key: 'tag', label: 'Position', align: 'left', get: (r) => ({ text: r.positionId != null ? String(r.positionId) : fmtTag(r.entryTime) }) },
  { key: 'symbol', label: 'Symbol', align: 'left', get: (r) => ({ text: txt(r.symbol) }) },
  { key: 'side', label: 'Side', align: 'left', get: (r) => ({ text: (r.side || '').toUpperCase() || '—', cls: r.side === 'short' ? 'neg' : r.side === 'long' ? 'pos' : '' }) },
  { key: 'qty', label: 'Qty', align: 'right', get: (r) => ({ text: fmtNum(r.entryQty) }) },
  // --- ENTRY / EXIT ---
  { key: 'avgEntry', label: 'Avg entry', align: 'right', get: (r) => ({ text: fmtPrice(r.avgEntry, decOf(r)) }) },
  { key: 'avgExit', label: 'Avg exit', align: 'right', get: (r) => ({ text: fmtPrice(r.avgExit, decOf(r)) }) },
  { key: 'entryTime', label: 'Opened', align: 'left', get: (r) => ({ text: fmtTime(r.entryTime) }) },
  { key: 'exitTime', label: 'Closed', align: 'left', get: (r) => ({ text: fmtTime(r.exitTime) }) },
  { key: 'duration', label: 'Duration', align: 'right', get: (r) => ({ text: fmtDur(r.entryTime, r.exitTime) }) },
  // --- P&L (Points = avg price move per contract; Gross/Net in account currency via the contract tick value) ---
  { key: 'points', label: 'Points', align: 'right', get: (r) => signed(r.entryQty ? r.realizedPricePnl / r.entryQty : null, decOf(r)) },
  { key: 'gross', label: 'Gross', align: 'right', get: (r) => signed(r.realizedPnl) },
  { key: 'commission', label: 'Comm', align: 'right', get: (r) => ({ text: r.commission ? fmtPrice(r.commission, 2) : '—' }) },
  { key: 'net', label: 'Net', align: 'right', get: (r) => signed(netOf(r)) },
  { key: 'status', label: 'Status', align: 'left', get: (r) => statusOf(r) },
  // running account balance after this trade (anchored to the LIVE account balance; see render)
  { key: 'balance', label: 'Balance', align: 'right', get: (r) => { const b = balanceByTrade.get(r); return b == null ? { text: '—' } : { text: fmtPrice(b, 2) }; } },
  // --- ACCOUNT ---
  { key: 'accountName', label: 'Account name', align: 'left', get: (r) => ({ text: txt(acctName(r)) }) },
  { key: 'account', label: 'Account #', align: 'left', get: (r) => ({ text: txt(r.accountId) }) },
  { key: 'broker', label: 'Broker', align: 'left', get: (r) => ({ text: String(r.broker || '').toUpperCase() || '—' }) },
];
/** @type {Record<string, Column>} */
const BY = Object.fromEntries(CAT.map((c) => /** @type {[string, Column]} */ ([c.key, c])));
const DEFAULT_COLS = ['tag', 'symbol', 'side', 'qty', 'avgEntry', 'points', 'gross', 'commission', 'net', 'status', 'balance', 'exitTime'];
const getCols = () => { const c = getSetting('historyColumns'); return (Array.isArray(c) && c.length ? c : DEFAULT_COLS).filter((k) => BY[k]); };

// raw (unformatted) value per column, for sorting
/** @type {Record<string, (r: Trade) => any>} */
const RAW = {
  tag: (r) => r.entryTime, symbol: (r) => r.symbol, side: (r) => r.side, qty: (r) => r.entryQty,
  avgEntry: (r) => r.avgEntry, avgExit: (r) => r.avgExit, entryTime: (r) => r.entryTime, exitTime: (r) => r.exitTime,
  duration: (r) => (Number(r.exitTime) || 0) - (Number(r.entryTime) || 0),
  points: (r) => (r.entryQty ? r.realizedPricePnl / r.entryQty : null), gross: (r) => r.realizedPnl, commission: (r) => r.commission,
  net: (r) => netOf(r), status: (r) => netOf(r), balance: (r) => { const b = balanceByTrade.get(r); return b == null ? null : b; },
  accountName: (r) => acctName(r), account: (r) => r.accountId, broker: (r) => r.broker,
};

// ---- expandable tree: a round-trip PARENT expands to its constituent FILL children ----
// row identity for expansion state: the bucket key (broker:acct:symbol) is shared across a symbol's
// round-trips, so it is NOT unique -- pair it with the entry time (the first fill, unique per round-trip).
/** @param {Trade} r @returns {string} */
const rowId = (r) => r.key + ':' + r.entryTime;
/** @typedef {import('../../data_engine/index.js').FillLike} FillLike */
// a child (fill) cell for a given column key: fills fill the same columns where they map, blank elsewhere.
// points/gross/net come per fill from the engine (DerivedPosition.fillPnl, the same avg-cost replay that
// builds the round-trip) and are passed on ctx.
/** @param {string} key @param {FillLike} f @param {{ dec: number, isExit: boolean, points: number|null, gross: number|null, net: number|null }} ctx @returns {Cell} */
const fillCell = (key, f, ctx) => {
  const s = /** @type {any} */ (f);
  switch (key) {
    case 'symbol': return { text: txt(s.symbol) };
    case 'side': return { text: (s.side || '').toUpperCase() || '', cls: s.side === 'sell' ? 'neg' : s.side === 'buy' ? 'pos' : '' };
    case 'qty': return { text: fmtNum(s.qty) };
    case 'avgEntry': return { text: fmtPrice(s.price, ctx.dec) };   // the fill price (col doubles as Fill Price on children)
    case 'entryTime': case 'exitTime': return { text: fmtTime(s.time) };
    case 'commission': return { text: s.commission ? fmtPrice(s.commission, 2) : '—' };
    case 'points': case 'gross': case 'net': {
      if (!ctx.isExit) return { text: '' };
      if (key === 'points') return signed(ctx.points, ctx.dec);
      if (key === 'gross') return signed(ctx.gross);
      return signed(ctx.net);
    }
    default: return { text: '' };   // tag / avgExit / duration / balance / account* / broker: parent-only
  }
};

/** @param {HTMLElement} root */
export function mountHistory(root) {
  root.innerHTML = '';
  const wrap = el('surface accounts-view');
  const head = el('acct-head');
  const title = el('acct-title', 'History'); const count = el('acct-count', '');
  const gear = el('acct-gear'); gear.title = t('Configure columns'); gear.innerHTML = GEAR;
  const spacer = el('acct-spacer');
  // account lens FIRST, then the date filter operates within it (both per-tab, next to the gear)
  const acctFilter = createAccountFilter('historyAccountFilter', () => render());
  const dateFilter = createDateFilter('historyRange', () => render());
  head.append(title, count, spacer, acctFilter.btn, dateFilter.btn, gear);
  const listWrap = el('acct-table-wrap');
  const table = document.createElement('table'); table.className = 'acct-table';
  const thead = document.createElement('thead'); const tbody = document.createElement('tbody');
  table.append(thead, tbody); listWrap.appendChild(table);
  const statsBar = el('hist-stats');   // bottom dock: the stats strip (History-only; deals with closed positions)
  wrap.append(head, listWrap, statsBar);
  root.appendChild(wrap);

  let cols = getCols();
  /** @type {Set<string>} */
  const expanded = new Set();   // round-trip rowIds currently expanded to their fills (survives live re-renders)
  // column sort (shared surface rule): default most recently closed first
  const sort = createTableSort({ settingKey: 'historySort', defaultKey: 'exitTime', valueOf: (k, r) => { const acc = RAW[k]; return acc ? acc(r) : undefined; }, onChange: () => render() });

  // ---- bottom Stats strip (History-only): boxes computed from the VISIBLE (filtered) round-trips, in the order
  // and on/off set the user configured in Trade Desk > Configure > Stats. Balance uses the account's starting
  // balance (Connections dialog) -> its live balance, summed over the accounts in the current account-filter scope.
  /** @param {number} v @returns {string} */
  const money0 = (v) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  /** @param {Trade[]} vis */
  const renderStats = (vis) => {
    const scfg = getDeskStats();
    if (!scfg.enabled) { statsBar.style.display = 'none'; statsBar.innerHTML = ''; return; }
    statsBar.style.display = '';

    // aggregates + breakeven-zone classification live in trade-derive.js; this strip just formats them
    const { net, points, comm, wins, losses, bes, trades, hitRate, profitFactor: pf } = computeTradeStats(vis, getDeskBeThreshold());

    // balance: sum start (saved account, by protocol) -> live balance over the accounts in the filter's scope
    let startBal = 0, curBal = 0, haveStart = false, haveCur = false;
    platform.accounts.all().filter((a) => acctFilter.matches(a)).forEach((a) => {
      if (a.balance != null && !Number.isNaN(Number(a.balance))) { curBal += Number(a.balance); haveCur = true; }
      const saved = accounts.listAccounts().find((s) => s.protocol === a.broker);
      if (saved && saved.startingBalance != null) { startBal += Number(saved.startingBalance); haveStart = true; }
    });

    /** @param {number} v */
    const signedMoney = (v) => ({ text: (v > 0 ? '+' : '') + money0(v), cls: v > 0 ? 'pos' : v < 0 ? 'neg' : '' });
    /** @type {Record<string, () => Cell>} */
    const VAL = {
      netProfit: () => trades ? signedMoney(net) : { text: '—' },
      trades: () => ({ text: trades ? trades + ' (' + wins + 'H' + (bes ? '/' + bes + 'BE' : '') + '/' + losses + 'M)' : '0' }),
      hitRate: () => hitRate == null ? { text: '—' } : { text: hitRate.toFixed(0) + '%', cls: hitRate >= 50 ? 'pos' : 'neg' },
      profitFactor: () => pf == null ? { text: '—' } : { text: pf === Infinity ? '∞' : pf.toFixed(2), cls: pf >= 1 ? 'pos' : 'neg' },
      balance: () => (haveStart || haveCur) ? { text: (haveStart ? money0(startBal) : '—') + ' -> ' + (haveCur ? money0(curBal) : '—') } : { text: '—' },
      points: () => trades ? { text: (points > 0 ? '+' : '') + points.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), cls: points > 0 ? 'pos' : points < 0 ? 'neg' : '' } : { text: '—' },
      commission: () => comm ? { text: '-$' + Math.abs(comm).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), cls: 'neg' } : { text: '—' },
    };

    statsBar.innerHTML = '';
    scfg.items.filter((i) => i.on).forEach((i) => {
      const get = VAL[i.key]; const v = get ? get() : { text: '—' };
      const box = el('hist-stat');
      box.appendChild(el('hist-stat-t', i.label));
      box.appendChild(el('hist-stat-v' + (v.cls ? ' ' + v.cls : ''), v.text));
      statsBar.appendChild(box);
    });
    if (!scfg.items.some((i) => i.on)) statsBar.style.display = 'none';   // nothing enabled -> hide the strip
  };

  const render = () => {
    const fills = platform.fills.all();
    // per-symbol tick metadata (the adapter stamps tickSize/tickValue on each fill) -> currency + points P&L
    /** @type {Map<string, { tickSize?: any, tickValue?: any }>} */
    const tickBySym = new Map();
    for (const f of fills) { const s = /** @type {any} */ (f); if (s.symbol && !tickBySym.has(s.symbol) && (s.tickValue != null || s.tickSize != null)) tickBySym.set(s.symbol, { tickSize: s.tickSize, tickValue: s.tickValue }); }
    const { closed } = computePositions(fills, { contractInfo: (sym) => tickBySym.get(sym) });   // net-0 round-trips
    // running Balance per account, anchored to each account's LIVE balance (replay in trade-derive.js)
    balanceByTrade = computeRunningBalances(closed, (k) => { const acct = platform.accounts.get(k); return acct && acct.balance; });
    // balance is replayed over the FULL set above (each trade's ending balance is range-independent); the FILTER
    // only narrows which rows are shown, by the trade's exit (close) time in the selected range.
    const visible = closed.filter((r) => acctFilter.matches(r) && dateFilter.matches(r.exitTime));
    const rows = visible.slice().sort(sort.compare);
    count.textContent = rows.length ? String(rows.length) : '';
    renderStats(visible);   // the bottom stats strip, computed from the same filtered set
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
    if (!rows.length) { const tr = document.createElement('tr'); const tdE = document.createElement('td'); tdE.colSpan = cols.length; tdE.className = 'acct-empty'; tdE.textContent = dateFilter.mode() === 'all' ? t('No closed trades in the loaded history') : t('No closed trades in') + ' ' + dateFilter.label().toLowerCase(); tr.appendChild(tdE); tbody.appendChild(tr); return; }
    rows.forEach((r) => {
      const id = rowId(r), isOpen = expanded.has(id);
      // PARENT row -- the round-trip summary, with a disclosure toggle in the first cell
      const tr = document.createElement('tr'); tr.className = 'hist-parent';
      cols.forEach((k, i) => {
        const col = BY[k], v = col.get(r);
        const td = document.createElement('td'); td.className = 'a-' + (col.align || 'left') + (v.cls ? ' ' + v.cls : '');
        if (i === 0) {
          const tog = el('hist-toggle' + (isOpen ? ' open' : ''));
          tog.onclick = (e) => { e.stopPropagation(); if (expanded.has(id)) expanded.delete(id); else expanded.add(id); render(); };
          td.append(tog, document.createTextNode(v.text));
        } else { td.textContent = v.text; }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      if (!isOpen) return;
      // CHILD rows -- one per fill, entries plain, reduces carrying per-fill P&L (engine's fillPnl,
      // index-aligned with fills)
      const dec = decOf(r);
      (r.fillPnl || []).forEach(({ isExit, points, gross, net }, i) => {
        const f = r.fills[i];
        const ctr = document.createElement('tr'); ctr.className = 'hist-child';
        cols.forEach((k) => {
          const v = fillCell(k, f, { dec, isExit, points, gross, net });
          const td = document.createElement('td'); td.className = 'a-' + (BY[k].align || 'left') + (v.cls ? ' ' + v.cls : '');
          td.textContent = v.text;
          ctr.appendChild(td);
        });
        tbody.appendChild(ctr);
      });
    });
  };

  gear.onclick = () => openColumnPicker(CAT, cols, /** @param {string[]} next */ (next) => { cols = next; setSetting('historyColumns', cols); render(); });

  // the accounts store re-pushes the live balance on a timer on some brokers -- coalesce rebuilds to at most
  // one per 250ms instead of tearing the whole table down per push
  let renTimer = /** @type {any} */ (0); let lastRender = 0;
  const schedule = () => { if (renTimer) return; const due = Math.max(0, 250 - (performance.now() - lastRender)); renTimer = setTimeout(() => { renTimer = 0; lastRender = performance.now(); render(); }, due); };

  render();
  const off1 = platform.fills.subscribe(schedule);          // new fills -> re-derive round-trips
  const off2 = bus.on('connections:changed', schedule);     // saved-connection name/rename -> re-resolve
  const off3 = platform.accounts.subscribe(schedule);       // live balance moved -> re-anchor the Balance column
  const off4 = onDeskConfigChange(schedule);                // desk timezone changed -> re-render times
  return { destroy() { dateFilter.destroy(); acctFilter.destroy(); if (renTimer) clearTimeout(renTimer); [off1, off2, off3, off4].forEach((f) => { try { f(); } catch (_) {} }); root.innerHTML = ''; } };
}
