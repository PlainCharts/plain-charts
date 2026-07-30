// @ts-check
// Positions surface -- a live table of CURRENT open positions. The broker's live net (platform.positions) is
// authoritative for qty/side/avg; net-0 reconstruction from the fills stream (compute-positions) ADDS what the
// broker doesn't give -- the position OPEN TIME (first fill of the round-trip) -- and a reconciliation check
// (derived net vs broker net). USER-CONFIGURABLE columns (gear -> pick + drag-reorder, persisted).
import { platform, broker, bus, command, computePositions } from '../../data_engine/index.js';
import * as accounts from '../connect/accounts.js';
import { getSetting, setSetting } from '../settings/settings.js';
import { GEAR, openColumnPicker } from './column-picker.js';
import { createTableSort } from './table-sort.js';
import { fmtDeskTime, onDeskConfigChange } from './desk-config.js';
import { createAccountFilter } from './account-filter.js';
import { unrealizedProfit } from './trade-derive.js';
import { t } from '../i18n/i18n.js'; // vocabulary lookup for column labels

/**
 * @typedef {import('../../data_engine/index.js').StoredPosition} Pos     the stored broker-net position (contract + broker)
 * @typedef {Pos & { _derived: any, _mark?: number|null }} PosRow  a row enriched with its net-0 derived record + live mark
 * @typedef {{ text: string, cls?: string, dot?: string, x?: () => void }} Cell  x = an inline remove button after the value (the S/L, T/P remove)
 * @typedef {{ key: string, label: string, align?: string, get: (r: PosRow) => Cell }} Column
 */

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
// epoch ms -> "MM-DD HH:MM:SS" in the desk's display timezone (Configure -> Timezone), shared by every tab
const fmtTime = fmtDeskTime;
// account NAME = the saved connection label (what the Accounts tab shows), matched by protocol
/** @param {PosRow} r @returns {string} */
const acctName = (r) => {
  const saved = accounts.listAccounts().find((a) => a.protocol === r.broker);
  return (saved && saved.name) || '';
};

// net-0 derived OPEN positions from the fills stream, indexed for lookup against each broker-net row
/** @returns {Map<string, any>} */
function derivedOpenIndex() {
  const { open } = computePositions(platform.fills.all());
  /** @type {Map<string, any>} */
  const byKey = new Map();
  for (const p of open) {
    byKey.set(p.broker + ':' + (p.accountId != null ? p.accountId : '') + ':' + p.symbol, p);
    byKey.set(p.broker + ':' + p.symbol, p); // fallback for a single-account broker (positions keyed broker:symbol)
  }
  return byKey;
}
/** @param {Map<string, any>} idx @param {Pos} r @returns {any} */
const lookupDerived = (idx, r) =>
  idx.get(r.broker + ':' + (r.accountId != null ? r.accountId : '') + ':' + r.symbol) ||
  idx.get(r.broker + ':' + r.symbol) ||
  null;

// --- live MARK (current price) per open position, via the broker's quote stream (same path the watchlist uses:
// resolveSymbol -> subscribeQuotes -> {bid,ask,last}). Keyed broker:symbol. mountPositions keeps the set of
// subscriptions aligned with the open rows and tears them all down on destroy.
/** @typedef {{ contractId: any, mark: number|null, qcb: ((q:any)=>void)|null, broker: string, pending: boolean }} QuoteRec */
/** @type {Map<string, QuoteRec>} */
const quotes = new Map();
/** @param {Pos} r @returns {string} */
const markKey = (r) => r.broker + ':' + r.symbol;
/** @param {Pos} r @returns {number|null} */
const markOf = (r) => {
  const q = quotes.get(markKey(r));
  return q ? q.mark : null;
};
// Change % = signed move from entry, so a winning position always reads positive: long (mark-entry)/entry,
// short inverted. Blank until we have both a mark and an entry.
/** @param {PosRow} r @returns {number|null} */
function changePct(r) {
  const mark = r._mark != null ? r._mark : markOf(r),
    entry = r.avgPrice;
  if (mark == null || entry == null || !Number(entry)) return null;
  const sign = r.side === 'short' ? -1 : 1;
  return ((mark - Number(entry)) / Number(entry)) * 100 * sign;
}
// Unrealized P&L (rule in trade-derive.js); this surface only resolves the mark from its quote feed
/** @param {PosRow} r @returns {{ value: number, currency: boolean }|null} */
const profitOf = (r) => unrealizedProfit(r, r._mark != null ? r._mark : markOf(r));

// reconciliation of the net-0 derived qty vs the broker's authoritative net
/** @param {PosRow} r @returns {Cell} */
function recon(r) {
  const d = r._derived;
  if (!d) return { text: 'no fills', cls: 'dim' }; // position opened before the fills snapshot window
  if (Math.abs(Number(d.qty) - Number(r.qty)) < 1e-9) return { text: 'ok', cls: 'pos' };
  return { text: 'Δ ' + fmtNum(d.qty) + ' vs ' + fmtNum(r.qty), cls: 'neg' };
}

// REMOVE one protective level from a hedging lot (the S/L / T/P cell's inline x): a position modify
// by TICKET with that leg 0 (= the contract's "no level") and the OTHER leg kept at its current price. Routed through the
// order worker like every execution; failures land in the journal (exec logs them).
/** @param {PosRow} r @param {'sl'|'tp'} which */
const removeLevel = (r, which) => {
  command({
    type: 'modifyPosition',
    broker: r.broker,
    ticket: r.ticket,
    stopLoss: which === 'sl' ? 0 : Number(r.stopLoss) || 0,
    takeProfit: which === 'tp' ? 0 : Number(r.takeProfit) || 0,
  }).catch(() => {});
};

// the column catalog. get(row) returns { text, cls?, dot?, x? }. Grows one section at a time.
/** @type {Column[]} */
const CAT = [
  // --- IDENTITY ---
  { key: 'symbol', label: 'Symbol', align: 'left', get: (r) => ({ text: txt(r.symbol) }) },
  { key: 'accountName', label: 'Account name', align: 'left', get: (r) => ({ text: txt(acctName(r)) }) },
  { key: 'account', label: 'Account #', align: 'left', get: (r) => ({ text: txt(r.accountId) }) },
  { key: 'broker', label: 'Broker', align: 'left', get: (r) => ({ text: (r.broker || '').toUpperCase() || '—' }) },
  // Ticket = the broker's own position/deal id. Broker-specific (hedging accounts have a position ticket, forex a deal id);
  // a netting model has no per-position id, so it stays '—' until an adapter puts position.ticket on the row.
  { key: 'ticket', label: 'Position', align: 'left', get: (r) => ({ text: txt(r.ticket) }) }, // the broker position id -- "Position" to match the History tab
  // --- ENTRY (broker net authoritative; open time from net-0) ---
  {
    key: 'side',
    label: 'Side',
    align: 'left',
    get: (r) => ({
      text: (r.side || '').toUpperCase() || '—',
      cls: r.side === 'short' ? 'neg' : r.side === 'long' ? 'pos' : '',
    }),
  },
  { key: 'qty', label: 'Qty', align: 'right', get: (r) => ({ text: fmtNum(r.qty) }) },
  {
    key: 'avgPrice',
    label: 'Avg entry',
    align: 'right',
    get: (r) => ({ text: fmtPrice(r.avgPrice, r.priceDecimals != null ? r.priceDecimals : 2) }),
  },
  {
    key: 'openTime',
    label: 'Open time',
    align: 'left',
    get: (r) => ({ text: fmtTime(r._derived && r._derived.entryTime) }),
  },
  // --- MARK (live) --- current price from the quote stream, and the signed % move from entry
  {
    key: 'mark',
    label: 'Price',
    align: 'right',
    get: (r) => ({ text: fmtPrice(r._mark, r.priceDecimals != null ? r.priceDecimals : 2) }),
  },
  {
    key: 'changePct',
    label: 'Change %',
    align: 'right',
    get: (r) => {
      const p = changePct(r);
      return {
        text: p == null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(2) + '%',
        cls: p == null ? '' : p >= 0 ? 'pos' : 'neg',
      };
    },
  },
  {
    key: 'profit',
    label: 'Profit',
    align: 'right',
    get: (r) => {
      const p = profitOf(r);
      if (!p) return { text: '—' };
      const dec = p.currency ? 2 : r.priceDecimals != null ? r.priceDecimals : 2;
      const s = p.value.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      return { text: (p.value >= 0 ? '+' : '') + s + (p.currency ? '' : ' pts'), cls: p.value >= 0 ? 'pos' : 'neg' };
    },
  },
  // Swap = accrued overnight financing. Adapter-specific: forex/CFD brokers report it; futures have none,
  // so it stays '—' until an adapter puts position.swap on the row.
  {
    key: 'swap',
    label: 'Swap',
    align: 'right',
    get: (r) =>
      r.swap == null
        ? { text: '—' }
        : {
            text:
              (Number(r.swap) >= 0 ? '+' : '') +
              Number(r.swap).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            cls: Number(r.swap) >= 0 ? 'pos' : 'neg',
          },
  },
  { key: 'recon', label: 'Recon', align: 'left', get: (r) => recon(r) },
  // --- RISK (protective) --- placeholders. On a NETTING account there are no linked brackets: S/L and T/P are
  // separate resting orders (Orders tab), not properties of the position, so these stay '—'. A HEDGING adapter
  // links the OCO exits to the position and can populate r.stopLoss / r.takeProfit -- these columns light up then.
  {
    key: 'stopLoss',
    label: 'S/L',
    align: 'right',
    get: (r) => ({
      text: fmtPrice(r.stopLoss, r.priceDecimals != null ? r.priceDecimals : 2),
      cls: r.stopLoss != null ? 'neg' : '',
      x: r.ticket != null && r.stopLoss != null ? () => removeLevel(r, 'sl') : undefined,
    }),
  },
  {
    key: 'takeProfit',
    label: 'T/P',
    align: 'right',
    get: (r) => ({
      text: fmtPrice(r.takeProfit, r.priceDecimals != null ? r.priceDecimals : 2),
      cls: r.takeProfit != null ? 'pos' : '',
      x: r.ticket != null && r.takeProfit != null ? () => removeLevel(r, 'tp') : undefined,
    }),
  },
];
/** @type {Record<string, Column>} */
const BY = Object.fromEntries(CAT.map((c) => /** @type {[string, Column]} */ ([c.key, c])));
const DEFAULT_COLS = ['ticket', 'symbol', 'side', 'qty', 'avgPrice', 'profit', 'stopLoss', 'takeProfit', 'openTime'];
const getCols = () => {
  const c = getSetting('positionsColumns');
  return (Array.isArray(c) && c.length ? c : DEFAULT_COLS).filter((k) => BY[k]);
};

// raw (unformatted) value per column, for sorting (rows are enriched with _derived before sorting)
/** @type {Record<string, (r: PosRow) => any>} */
const RAW = {
  symbol: (r) => r.symbol,
  accountName: (r) => acctName(r),
  account: (r) => r.accountId,
  broker: (r) => r.broker,
  ticket: (r) => r.ticket,
  side: (r) => r.side,
  qty: (r) => r.qty,
  avgPrice: (r) => r.avgPrice,
  openTime: (r) => r._derived && r._derived.entryTime,
  recon: (r) => recon(r).text,
  stopLoss: (r) => r.stopLoss,
  takeProfit: (r) => r.takeProfit,
  mark: (r) => r._mark,
  changePct: (r) => changePct(r),
  profit: (r) => {
    const p = profitOf(r);
    return p ? p.value : null;
  },
  swap: (r) => r.swap,
};

/** @param {HTMLElement} root */
export function mountPositions(root) {
  root.innerHTML = '';
  const wrap = el('surface accounts-view');
  const head = el('acct-head');
  const title = el('acct-title', 'Positions');
  const count = el('acct-count', '');
  const gear = el('acct-gear');
  gear.title = 'Configure columns';
  gear.innerHTML = GEAR;
  const spacer = el('acct-spacer');
  const acctFilter = createAccountFilter('positionsAccountFilter', () => render()); // per-tab account lens
  head.append(title, count, spacer, acctFilter.btn, gear);
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
  // column sort (shared surface rule): default most recent first
  const sort = createTableSort({
    settingKey: 'positionsSort',
    defaultKey: 'openTime',
    valueOf: (k, r) => {
      const acc = RAW[k];
      return acc ? acc(r) : undefined;
    },
    onChange: () => render(),
  });

  // Flatten is an EXECUTION -> route through the order worker (single owner), never call the broker directly. A
  // hedging LOT closes by its own ticket (`closeLot` -- not the whole symbol, that would nuke the other hedges); a
  // net closes by symbol (`closePosition`, the worker's account-type-aware flatten). The surface just sends + reports.
  /** @param {PosRow} r */
  const flatten = (r) => {
    const fail = (/** @type {string} */ msg) =>
      platform.console.post({ level: 'error', cat: 'journal', src: r.broker, msg: 'flatten failed: ' + msg });
    const cmd =
      r.ticket != null
        ? { type: 'closeLot', broker: r.broker, ticket: r.ticket }
        : { type: 'closePosition', broker: r.broker, symbol: r.symbol };
    command(cmd)
      .then((res) => {
        if (res && res.error) fail(res.error);
      })
      .catch((e) => fail((e && /** @type {any} */ (e).message) || String(e)));
  };

  // manual double-click state (last clicked position key + timestamp), shared across re-renders
  let lastTap = { key: '', t: 0 };
  // open the order ticket on the Modify tab, carrying this position's full context
  /** @param {PosRow} r */
  const openModify = (r) => {
    const d = /** @type {any} */ (window).desktop;
    if (!d || !d.openOrderTicket) return;
    d.openOrderTicket({
      tab: 'modify',
      position: {
        broker: r.broker,
        accountId: r.accountId,
        symbol: r.symbol,
        ticket: r.ticket,
        side: r.side,
        qty: r.qty,
        avgPrice: r.avgPrice,
        stopLoss: r.stopLoss,
        takeProfit: r.takeProfit,
        priceDecimals: r.priceDecimals,
        tickSize: r.tickSize,
      },
    });
  };

  // right-click a position row -> a tiny context menu: Modify (opens the ticket) and Close (flattens EXACTLY this
  // row, same routing as the ✕ button -- hedging lot by ticket, netting by symbol).
  /** @type {HTMLElement|null} */
  let rowMenu = null;
  /** @param {PointerEvent} ev */
  const onMenuAway = (ev) => {
    if (rowMenu && !rowMenu.contains(/** @type {Node} */ (ev.target))) closeRowMenu();
  };
  const closeRowMenu = () => {
    if (!rowMenu) return;
    rowMenu.remove();
    rowMenu = null;
    document.removeEventListener('pointerdown', /** @type {any} */ (onMenuAway), true);
  };
  /** @param {number} x @param {number} y @param {PosRow} r */
  const openRowMenu = (x, y, r) => {
    closeRowMenu();
    const m = document.createElement('div');
    m.style.cssText =
      'position:fixed; z-index:9999; background:var(--panel); border:1px solid var(--bd); border-radius:4px; box-shadow:0 6px 18px rgba(0,0,0,.45); padding:4px; min-width:120px;';
    /** @param {string} label @param {() => void} onPick @param {string} [color] */
    const mkItem = (label, onPick, color) => {
      const item = document.createElement('div');
      item.textContent = label;
      item.style.cssText =
        'padding:6px 12px; font-size:13px; color:' + (color || 'var(--tx)') + '; cursor:pointer; border-radius:3px;';
      item.onmouseenter = () => {
        item.style.background = 'var(--hover)';
      };
      item.onmouseleave = () => {
        item.style.background = 'transparent';
      };
      item.onclick = () => {
        closeRowMenu();
        onPick();
      };
      m.appendChild(item);
    };
    mkItem('Modify', () => openModify(r));
    mkItem('Close', () => flatten(r));
    document.body.appendChild(m);
    rowMenu = m;
    m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 6) + 'px';
    m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', /** @type {any} */ (onMenuAway), true), 0);
  };

  // keep quote subscriptions aligned with the open rows; a mark tick re-renders (mirrors the watchlist path)
  /** @param {Pos} r */
  const ensureQuote = (r) => {
    const key = markKey(r);
    if (quotes.has(key)) return;
    const api = broker.for(r.broker);
    if (!api || !api.resolveSymbol || !api.subscribeQuotes) return;
    /** @type {QuoteRec} */
    const rec = { contractId: null, mark: null, qcb: null, broker: r.broker, pending: true };
    quotes.set(key, rec);
    api.resolveSymbol(
      r.symbol,
      /** @param {any} inst */ (inst) => {
        rec.pending = false;
        if (!inst) {
          quotes.delete(key);
          return;
        }
        rec.contractId = inst.id;
        rec.qcb = /** @param {any} q */ (q) => {
          const m = q.last != null ? q.last : q.bid != null && q.ask != null ? (q.bid + q.ask) / 2 : null;
          // a quote tick updates the LIVE cells IN PLACE (Price / Change % / Profit) -- ticks arrive many times a
          // second and a full table rebuild per tick burned CPU and resorted rows under the pointer. Structural
          // changes (store events) still rebuild via schedule().
          if (m != null && m !== rec.mark) {
            rec.mark = m;
            updateLive(key, m);
          }
        };
        api.subscribeQuotes(inst.id, rec.qcb);
      },
    );
  };
  /** @param {Set<string>} activeKeys */
  const pruneQuotes = (activeKeys) => {
    for (const [key, rec] of [...quotes]) {
      if (activeKeys.has(key)) continue;
      if (rec.qcb && rec.contractId != null) {
        try {
          /** @type {any} */ (broker.for(rec.broker)).unsubscribeQuotes(rec.contractId, rec.qcb);
        } catch (_) {}
      }
      quotes.delete(key);
    }
  };

  // LIVE cells (derived from the mark) per markKey -> update them in place on a quote tick, no rebuild
  const LIVE_COLS = new Set(['mark', 'changePct', 'profit']);
  /** @type {Map<string, Array<{ r: any, tds: Record<string, HTMLTableCellElement> }>>} */
  let liveRows = new Map();
  /** @param {string} key @param {number} m */
  const updateLive = (key, m) => {
    const list = liveRows.get(key);
    if (!list) return;
    for (const e of list) {
      e.r._mark = m;
      for (const k of Object.keys(e.tds)) {
        const col = BY[k];
        const v = col.get(e.r);
        const td = e.tds[k];
        td.className = 'a-' + (col.align || 'left') + (v.cls ? ' ' + v.cls : '');
        td.textContent = v.text;
      }
    }
  };
  // STRUCTURAL rebuilds are coalesced: at most one per 250ms (some brokers push lots every 500ms; fills burst on
  // execution -- rebuilding per event tore the table down several times a second)
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

  const render = () => {
    const idx = derivedOpenIndex(); // net-0 open positions from the fills stream (recomputed each render)
    // Hedging brokers stream INDIVIDUAL positionLots (per ticket, with native SL/TP + broker live P&L). Show those;
    // brokers that give only a net (or no lots) fall back to the netted positions store. Both coexist per broker.
    const lots = platform.positionLots.all();
    const lotBrokers = new Set(lots.map((l) => l.broker));
    // lots (per-ticket) and nets (per-symbol) have slightly different shapes -> treat as loose rows
    const base = /** @type {any[]} */ ([...lots, ...platform.positions.all().filter((n) => !lotBrokers.has(n.broker))]);
    const rows = base
      .filter(acctFilter.matches)
      .map((r) => ({ ...r, _derived: lookupDerived(idx, r), _mark: r.price != null ? r.price : markOf(r) }))
      .sort(sort.compare); // account lens -> enrich -> sort
    pruneQuotes(new Set(rows.map(markKey))); // drop feeds for closed positions
    rows.forEach(ensureQuote); // add feeds for newly open ones
    count.textContent = rows.length ? String(rows.length) : '';
    liveRows = new Map();
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
      tdE.textContent = t('Flat — no open positions');
      tr.appendChild(tdE);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      // Double-click a position -> open the order ticket on the Modify tab. Detected MANUALLY by position identity
      // (not the native dblclick) because the tbody is rebuilt on every quote/position tick -- a real double-click
      // spans ~250ms, during which the clicked row can be replaced, so a per-element dblclick is lost. Matching two
      // clicks on the same position key survives the row swap. Clicks on the actions cell (flatten) are ignored.
      tr.onclick = (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('.ord-actions')) return;
        const key = (r.broker || '') + ':' + (r.ticket != null ? r.ticket : r.symbol);
        if (lastTap.key === key && e.timeStamp - lastTap.t < 450) {
          lastTap = { key: '', t: 0 };
          openModify(r);
        } else lastTap = { key, t: e.timeStamp };
      };
      // right-click -> context menu with Modify (routing test, independent of the double-click gesture)
      tr.oncontextmenu = (e) => {
        e.preventDefault();
        openRowMenu(e.clientX, e.clientY, r);
      };
      /** @type {Record<string, HTMLTableCellElement>} */
      const liveTds = {};
      cols.forEach((k) => {
        const col = BY[k],
          v = col.get(r);
        const td = document.createElement('td');
        td.className = 'a-' + (col.align || 'left') + (v.cls ? ' ' + v.cls : '');
        if (v.dot !== undefined) {
          const dot = el('acct-dot' + (v.dot ? ' on' : ''));
          td.append(dot, document.createTextNode(v.text));
        } else td.textContent = v.text;
        // inline REMOVE button after the value (the S/L, T/P remove x). stopPropagation so it never reads as a
        // row click (double-click-to-Modify stays untriggered).
        if (v.x) {
          const xb = document.createElement('button');
          xb.className = 'ord-cancel';
          xb.style.marginLeft = '6px';
          xb.textContent = '✕';
          xb.title = 'Remove level';
          xb.onclick = (e) => {
            e.stopPropagation();
            /** @type {() => void} */ (v.x)();
          };
          td.appendChild(xb);
        }
        if (LIVE_COLS.has(k)) liveTds[k] = td; // quote ticks re-fill these in place
        tr.appendChild(td);
      });
      if (Object.keys(liveTds).length) {
        const mk = markKey(r);
        const list = liveRows.get(mk) || [];
        list.push({ r, tds: liveTds });
        liveRows.set(mk, list);
      }
      const act = document.createElement('td');
      act.className = 'a-right ord-actions';
      const x = document.createElement('button');
      x.className = 'ord-cancel';
      x.textContent = '✕';
      x.title = t('Flatten position');
      x.onclick = () => flatten(r);
      act.appendChild(x);
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
        setSetting('positionsColumns', cols);
        render();
      },
    );

  render();
  const off1 = platform.positions.subscribe(schedule);
  const off2 = bus.on('connections:changed', schedule); // saved-connection name/rename -> re-resolve
  const off3 = platform.fills.subscribe(schedule); // fills change -> re-derive open time + reconciliation
  const off4 = onDeskConfigChange(schedule); // desk timezone changed -> re-render times
  const off5 = platform.positionLots.subscribe(schedule); // individual hedging lots (SL/TP/live P&L per ticket)
  return {
    destroy() {
      closeRowMenu();
      acctFilter.destroy();
      if (renTimer) clearTimeout(renTimer);
      [off1, off2, off3, off4, off5].forEach((f) => {
        try {
          f();
        } catch (_) {}
      });
      pruneQuotes(new Set());
      root.innerHTML = '';
    },
  };
}
