// @ts-check
// Order-ticket TOP widgets -- everything above the tab body: the live mini-table of the
// loaded position or order, the Account dropdown (the connected accounts to EXECUTE on)
// and the Symbol combobox (type a symbol or pick one from the watchlists).
// Shared state lives in ticket-state.js.
import { getJSON } from '../api.js';
import { platform, livePosition } from '../../data_engine/index.js';
import { listAccounts } from '../connect/accounts.js';
import { state } from './ticket-state.js';
import { syncToggle, syncFields } from './ticket-plan-sync.js';
import { syncLsSltp } from './ticket-controls.js';
import { t } from '../i18n/i18n.js'; // vocabulary lookup

// The union of every symbol across every named watchlist (deduped by broker+symbol), the pick-list for the dropdown.
// Watchlists are HTTP-backed (settings/watchlist.json via /api/watchlist), so any window can read them directly.
/** @type {{ broker: string, symbol: string }[]} */
let watchSymbols = [];
async function loadWatchSymbols() {
  const data = await getJSON('/api/watchlist');
  const lists = data && Array.isArray(data.lists) ? data.lists : [];
  const seen = new Set();
  /** @type {{ broker: string, symbol: string }[]} */
  const out = [];
  for (const l of lists) {
    for (const it of l && Array.isArray(l.items) ? l.items : []) {
      if (!it || it.type !== 'symbol' || !it.symbol) continue;
      const key = (it.broker || '') + '|' + it.symbol;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ broker: it.broker || '', symbol: it.symbol });
    }
  }
  out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return out;
}
loadWatchSymbols().then((s) => {
  watchSymbols = s;
});

// One document-level closer for any open combo menu (fields are rebuilt each render, so this stays global).
document.addEventListener('pointerdown', (e) => {
  document.querySelectorAll('.ot-combo-menu').forEach((m) => {
    const combo = /** @type {HTMLElement} */ (m).closest('.ot-combo');
    if (combo && !combo.contains(/** @type {Node} */ (e.target))) /** @type {HTMLElement} */ (m).style.display = 'none';
  });
});

// Mini single-row table of the loaded position (id | symbol | side | qty | open price) -- like the Positions tab,
// headerless. LIVE: re-reads the position from the platform store and repaints on every update (a partial close
// changes qty, etc.), so the user sees exactly what they're controlling even with the Trade Desk closed.
/** @param {HTMLElement} tbl @param {any} p */
function paintPositionTable(tbl, p) {
  const live = livePosition(p),
    src = live || p; // fall back to the opened snapshot once it's gone
  const side = src.side === 'short' ? 'sell' : src.side === 'long' ? 'buy' : src.side || '';
  const dec =
    src.priceDecimals != null ? Number(src.priceDecimals) : p.priceDecimals != null ? Number(p.priceDecimals) : null;
  const price = src.avgPrice != null ? (dec != null ? Number(src.avgPrice).toFixed(dec) : String(src.avgPrice)) : '';
  /** @type {[string, string][]} */
  const cells = [
    ['id', '#' + p.ticket],
    ['sym', src.symbol || p.symbol || ''],
    [side === 'sell' ? 'sell' : 'buy', t(side)],
    ['qty', src.qty != null ? String(src.qty) : ''],
    ['px', price],
  ];
  tbl.innerHTML = '';
  for (const [cls, text] of cells) {
    const c = document.createElement('div');
    c.className = 'ot-pcell ot-pcell-' + cls;
    c.textContent = text;
    c.title = text;
    tbl.appendChild(c);
  }
  tbl.classList.toggle('ot-postable-closed', !live); // fully closed -> dim the row
}
/** @param {any} p @returns {HTMLElement} */
export function buildPositionTable(p) {
  const tbl = document.createElement('div');
  tbl.className = 'ot-postable';
  state.posTableEl = tbl;
  state.repaintTable = () => paintPositionTable(tbl, p);
  paintPositionTable(tbl, p);
  return tbl;
}

// The same headerless mini table, but for a resting ORDER (clicked stop/limit dot on netting): id | symbol | type+side |
// qty | price. LIVE: re-reads the order from the store by id and repaints (a fill/cancel dims the row).
/** @param {HTMLElement} tbl @param {any} o */
function paintOrderTable(tbl, o) {
  const live = /** @type {any[]} */ (platform.orders.all()).find(
    (x) => String(x.id) === String(o.id) && (!o.broker || x.broker === o.broker),
  );
  const src = live || o;
  const type = String(src.type || o.type || '');
  const side = String(src.side || o.side || '');
  const pxRaw =
    src.type === 'stop'
      ? src.stopPrice != null
        ? src.stopPrice
        : src.price
      : src.type === 'limit'
        ? src.limitPrice != null
          ? src.limitPrice
          : src.price
        : src.price != null
          ? src.price
          : o.price;
  const px = pxRaw != null && Number.isFinite(Number(pxRaw)) ? String(Number(Number(pxRaw).toPrecision(12))) : ''; // strip IEEE754 scaling noise (7637.4400000001 -> 7637.44)
  /** @type {[string, string][]} */
  const cells = [
    ['id', '#' + o.id],
    ['sym', src.symbol || o.symbol || ''],
    [side === 'sell' ? 'sell' : 'buy', (t(type) + ' ' + t(side)).trim()],
    ['qty', src.qty != null ? String(src.qty) : ''],
    ['px', px],
  ];
  tbl.innerHTML = '';
  for (const [cls, text] of cells) {
    const c = document.createElement('div');
    c.className = 'ot-pcell ot-pcell-' + cls;
    c.textContent = text;
    c.title = text;
    tbl.appendChild(c);
  }
  tbl.classList.toggle('ot-postable-closed', !live); // filled / canceled -> dim
}
/** @param {any} o @returns {HTMLElement} */
export function buildOrderTable(o) {
  const tbl = document.createElement('div');
  tbl.className = 'ot-postable';
  state.posTableEl = tbl;
  state.repaintTable = () => paintOrderTable(tbl, o);
  paintOrderTable(tbl, o);
  return tbl;
}

// Account dropdown -- the connected accounts to EXECUTE on (each carries its broker + hedging/netting type). The
// selected account drives the execution broker; opening from a position preselects that position's account.
/** @param {HTMLSelectElement} sel */
export function populateAccounts(sel) {
  const accts = /** @type {any[]} */ (platform.accounts.all());
  state.lastAcctKeys = accts.map((a) => a.broker + ':' + a.accountId).join('|');
  sel.innerHTML = '';
  if (!accts.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = t('no account connected');
    sel.appendChild(o);
    sel.disabled = true;
    state.selectedAccount = null;
    return;
  }
  sel.disabled = false;
  // label = the saved connection NAME (Accounts tab); fall back to the broker id if not loaded yet. With MULTIPLE
  // accounts that resolve to the same name (e.g. two on one broker), append the accountId so each is distinct.
  const nameOf = (/** @type {any} */ a) => {
    const c = listAccounts().find((x) => x.protocol === a.broker);
    return (c && c.name) || (a.broker || '').toUpperCase();
  };
  const names = accts.map(nameOf);
  accts.forEach((a, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = names.filter((n) => n === names[i]).length > 1 ? names[i] + ' ' + a.accountId : names[i];
    sel.appendChild(o);
  });
  // preselect: the loaded position's account (or the chart symbol's broker) -> the current selection -> the first
  let idx = 0;
  const wantBroker = (state.context && state.context.broker) || state.symbolBroker;
  const wantAcct = state.context && state.context.accountId;
  if (wantBroker) {
    const j = accts.findIndex(
      (a) => a.broker === wantBroker && (wantAcct == null || String(a.accountId) === String(wantAcct)),
    );
    if (j >= 0) idx = j;
  } else if (state.selectedAccount) {
    const cur = state.selectedAccount;
    const j = accts.findIndex((a) => a.broker === cur.broker && String(a.accountId) === String(cur.accountId));
    if (j >= 0) idx = j;
  }
  sel.value = String(idx);
  const pick = accts[idx];
  state.selectedAccount = { broker: pick.broker, accountId: pick.accountId, hedging: !!pick.hedging };
  sel.onchange = () => {
    const a = accts[Number(sel.value)];
    if (a) state.selectedAccount = { broker: a.broker, accountId: a.accountId, hedging: !!a.hedging };
    syncToggle();
    syncFields();
    syncLsSltp();
  };
}
function buildAccountSelect() {
  const sel = document.createElement('select');
  sel.className = 'ot-input ot-acct-sel';
  sel.title = t('Account to execute on');
  state.accountSelEl = sel;
  populateAccounts(sel);
  return sel;
}
// re-populate the dropdown ONLY when the set of accounts changes (connect/disconnect) -- not on every balance tick,
// so it never steals focus from the symbol field
export function refreshAccounts() {
  if (!state.accountSelEl) return;
  const keys = /** @type {any[]} */ (platform.accounts.all()).map((a) => a.broker + ':' + a.accountId).join('|');
  if (keys !== state.lastAcctKeys) populateAccounts(state.accountSelEl);
}

// Account + Symbol on one row: Account: [dropdown]  Symbol: [combobox]
export function buildAccountSymbolRow() {
  const row = document.createElement('div');
  row.className = 'ot-field ot-acctsym';
  const al = document.createElement('label');
  al.className = 'ot-label';
  al.textContent = t('Account:');
  const sl = document.createElement('label');
  sl.className = 'ot-label';
  sl.textContent = t('Symbol:');
  row.append(al, buildAccountSelect(), sl, buildSymbolCombo());
  return row;
}

// Symbol combobox -- typeable input + a dropdown arrow that lists every watchlist symbol. Dual function:
// TYPE a symbol (or read the inherited one on Modify), or PICK from the watchlists.
function buildSymbolCombo() {
  const combo = document.createElement('div');
  combo.className = 'ot-combo';
  const input = document.createElement('input');
  input.className = 'ot-input';
  input.type = 'text';
  input.placeholder = t('Type or pick');
  input.value = state.symbolValue;
  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'ot-combo-arrow';
  arrow.textContent = '▾';
  arrow.title = t('Pick from watchlists');
  const menu = document.createElement('div');
  menu.className = 'ot-combo-menu';
  menu.style.display = 'none';
  combo.append(input, arrow, menu);

  const isOpen = () => menu.style.display === 'block';
  const close = () => {
    menu.style.display = 'none';
  };
  /** @param {{broker:string,symbol:string}} s */
  const choose = (s) => {
    state.symbolValue = s.symbol;
    state.symbolBroker = s.broker;
    input.value = s.symbol;
    close();
    syncToggle();
  };
  /** @param {string} [filter] */
  const fill = (filter) => {
    menu.innerHTML = '';
    const f = (filter || '').trim().toLowerCase();
    const matches = watchSymbols.filter((s) => !f || s.symbol.toLowerCase().includes(f));
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'ot-combo-empty';
      empty.textContent = watchSymbols.length ? t('No match') : t('No symbols in watchlists');
      menu.appendChild(empty);
      return;
    }
    for (const s of matches) {
      const opt = document.createElement('div');
      opt.className = 'ot-combo-opt';
      const sym = document.createElement('span');
      sym.className = 'ot-combo-sym';
      sym.textContent = s.symbol;
      opt.appendChild(sym);
      if (s.broker) {
        const br = document.createElement('span');
        br.className = 'ot-combo-br';
        br.textContent = s.broker.toUpperCase();
        opt.appendChild(br);
      }
      opt.onmousedown = (e) => {
        e.preventDefault();
        choose(s);
      }; // mousedown beats the input's blur
      menu.appendChild(opt);
    }
  };

  arrow.onclick = async () => {
    if (isOpen()) {
      close();
      return;
    }
    fill('');
    menu.style.display = 'block';
    input.focus();
    watchSymbols = await loadWatchSymbols(); // refresh so newly-added watchlist symbols show
    if (isOpen()) fill('');
  };
  input.oninput = () => {
    state.symbolValue = input.value;
    state.symbolBroker = '';
    fill(input.value);
    menu.style.display = 'block';
  };
  input.onchange = () => {
    state.symbolValue = input.value;
    syncToggle();
  };
  return combo;
}
