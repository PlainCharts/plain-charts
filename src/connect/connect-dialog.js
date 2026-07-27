// @ts-check
// Connections dialog = Connection Manager + Account Manager.
//  - Connection Manager (top): every saved account with a live status and a
//    Connect/Disconnect button. Connections are global & independent of tabs —
//    you can connect to several brokers at once (one per protocol).
//  - Account Manager (below): create/edit/save an account; each account carries
//    its OWN "auto-connect on startup" flag.
// The form is schema-driven — protocol dropdown from the registry, and the credential/option fields from the
// chosen adapter's declarative `form` (text/password/number/bool/select/note/action). No broker-specific code.
import { broker, listBrokers, bus } from '../../data_engine/index.js';   // facade + engine events (connections:changed / broker:notice)
import * as accounts from './accounts.js';
import { $ } from '../dom.js';
import { makeDraggable } from '../ui/draggable.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup (account names/servers stay user data)

/** @typedef {import('../../data_engine/index.js').BrokerAdapter} BrokerAdapter */
/** @typedef {import('./accounts.js').SavedAccount} SavedAccount */
// The connect-form field shape is THE contract's -- BrokerAdapter carries `form: FormField[]` (single source
// of truth). `key` is optional on the contract type (note fields have none); value fields always have it.
/** @typedef {import('../../data_engine/index.js').FormField} FormField */
// The handler surface an `action` field's run()/status() receive.
/** @typedef {{ status: (msg: string, kind?: string) => void, openUrl: (url: string) => void, account: () => SavedAccount,
 *   promptInput: (opts?: { placeholder?: string, submit?: string }) => Promise<string> }} ActionUi */

export function initConnectDialog() {
  const dlg = /** @type {HTMLElement} */ ($('modal'));
  const box = /** @type {HTMLElement | null} */ (dlg.querySelector('.dialog')), head = /** @type {HTMLElement | null} */ (dlg.querySelector('.conn-head'));
  if (box && head) makeDraggable(box, head);   // drag the dialog by its header
  dlg.classList.add('modal-passthru');   // floating, non-modal: chart stays interactive; no click-away close
  const dlgStatus = /** @type {HTMLElement} */ ($('dlgStatus'));
  const protoSel = /** @type {HTMLSelectElement} */ ($('f-protocol'));
  const fieldsEl = /** @type {HTMLElement} */ ($('f-fields'));
  const listEl = /** @type {HTMLElement} */ ($('conn-list'));
  /** @param {string} [m] @param {boolean} [err] */
  const setDlg = (m, err) => { dlgStatus.textContent = m || ''; dlgStatus.className = 'dlg-status' + (err ? ' err' : ''); };

  /** @param {string} id @returns {BrokerAdapter | undefined} */
  const adapterById = (id) => listBrokers().find((b) => b.id === id);
  /** @returns {BrokerAdapter | null} */
  const currentAdapter = () => adapterById(protoSel.value) || null;   // null when the account's adapter isn't installed
  // (re)build the protocol dropdown from the LOADED adapters. If `want` isn't installed (e.g. a saved account
  // whose adapter folder was removed), add a disabled "(not installed)" option and select it — so the account
  // reads clearly instead of silently falling back to some other adapter's form.
  /** @param {string} [want] */
  const populateProto = (want) => {
    protoSel.innerHTML = '';
    /** @type {Set<string>} */
    const ids = new Set();
    listBrokers().forEach((b) => { ids.add(b.id); const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; protoSel.appendChild(o); });
    if (want && !ids.has(want)) { const o = document.createElement('option'); o.value = want; o.textContent = want + ' ' + t('(not installed)'); o.disabled = true; protoSel.appendChild(o); }
    protoSel.value = want || (listBrokers()[0] ? listBrokers()[0].id : '');
  };

  // eye toggle for password fields (Windows-login style): swaps the input between password/text.
  const EYE = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z"/><circle cx="8" cy="8" r="1.9"/></svg>';
  const EYE_OFF = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z"/><circle cx="8" cy="8" r="1.9"/><line x1="2.3" y1="13.7" x2="13.7" y2="2.3"/></svg>';
  /** @param {HTMLInputElement} inp */
  const withEye = (inp) => {
    const wrap = document.createElement('div'); wrap.className = 'pw-wrap';
    const eye = document.createElement('button'); eye.type = 'button'; eye.className = 'pw-eye'; eye.tabIndex = -1; eye.title = t('Show password'); eye.innerHTML = EYE;
    eye.onclick = () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; eye.innerHTML = show ? EYE_OFF : EYE; eye.title = show ? t('Hide password') : t('Show password'); };
    wrap.append(inp, eye);
    return wrap;
  };

  /** @param {string} label */
  const fieldRow = (label) => {
    const row = document.createElement('div'); row.className = 'row';
    const lbl = document.createElement('label'); lbl.textContent = t(label);
    row.appendChild(lbl);
    return row;
  };

  /** @param {any} o */
  const optVal = (o) => (o && o.value != null) ? o.value : o;
  /** @param {any} o */
  const optLabel = (o) => (o && o.label != null) ? o.label : o;

  // ---- Account Manager: render the active adapter's declarative `form` (no generic template; each adapter
  // declares exactly the fields it needs). Field types: text/password/number/bool/select/note/action.
  /** @param {Record<string, any>} [vals] */
  const renderFields = (vals = {}) => {
    const a = currentAdapter();
    const trading = !!(a && a.capabilities && a.capabilities.trading);
    const atRow = $('f-accttype-row'); if (atRow) atRow.style.display = trading ? '' : 'none';   // account type only for trading adapters
    const sbRow = $('f-startbal-row'); if (sbRow) sbRow.style.display = trading ? '' : 'none';    // starting balance only for trading adapters
    const hdRow = $('f-histdays-row'); if (hdRow) hdRow.style.display = trading ? '' : 'none';    // history-days only for trading adapters
    fieldsEl.innerHTML = '';
    if (!a) { const n = document.createElement('div'); n.className = 'form-note'; n.textContent = t('The') + ' “' + protoSel.value + '” ' + t('adapter is not installed — add it to the adapters folder to use this account.'); fieldsEl.appendChild(n); return; }
    (a.form || []).forEach((f) => {
      if (f.type === 'note') { const n = document.createElement('div'); n.className = 'form-note'; n.textContent = f.label || ''; fieldsEl.appendChild(n); return; }
      if (f.type === 'action') { fieldsEl.appendChild(actionRow(a, f)); return; }
      const key = /** @type {string} */ (f.key);   // note + action are filtered above; value fields always carry a key
      const row = fieldRow(f.label);
      /** @type {HTMLInputElement | HTMLSelectElement} */
      let inp;
      if (f.type === 'select') {
        inp = document.createElement('select');
        (f.options || []).forEach((/** @type {any} */ o) => { const opt = document.createElement('option'); opt.value = optVal(o); opt.textContent = optLabel(o); inp.appendChild(opt); });
        inp.value = vals[key] != null ? vals[key] : (f.default != null ? f.default : (f.options && f.options.length ? optVal(f.options[0]) : ''));
      } else if (f.type === 'bool') {
        inp = document.createElement('input'); inp.type = 'checkbox';
        inp.checked = vals[key] != null ? !!vals[key] : !!f.default;
      } else {
        inp = document.createElement('input');
        inp.type = f.type === 'password' ? 'password' : (f.type === 'number' ? 'number' : 'text');
        inp.autocomplete = 'off';
        if (f.placeholder) inp.placeholder = f.placeholder;
        inp.value = vals[key] != null ? vals[key] : (f.default != null ? f.default : '');
      }
      inp.id = 'f-field-' + key;
      row.appendChild(f.type === 'password' ? withEye(/** @type {HTMLInputElement} */ (inp)) : inp); fieldsEl.appendChild(row);
    });
  };

  // Generic ACTION field: a button + live status line, driving an async flow the adapter supplies (run/status).
  // an OAuth flow is one instance; any adapter can declare its own. The `ui` object gives the handler the
  // status line, a URL opener, the current form values, and a one-shot inline prompt (for the OAuth paste-back).
  /** @param {BrokerAdapter} adapter @param {FormField} f */
  const actionRow = (adapter, f) => {
    const row = fieldRow(f.label);
    const box = document.createElement('div'); box.className = 'oauth-box';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'oauth-btn'; btn.textContent = t(f.button || f.label || 'Run');
    const inp = document.createElement('input'); inp.className = 'oauth-paste'; inp.style.display = 'none';
    const submit = document.createElement('button'); submit.type = 'button'; submit.className = 'oauth-submit'; submit.style.display = 'none';
    const state = document.createElement('div'); state.className = 'oauth-state';
    /** @param {string} [msg] @param {string} [kind] */
    const setState = (msg, kind) => { state.textContent = msg || ''; state.className = 'oauth-state' + (kind ? ' ' + kind : ''); };
    /** @type {ActionUi} */
    const ui = {
      status: setState,
      openUrl: (url) => window.open(url, '_blank', 'noopener'),
      account: () => readForm(),
      promptInput: ({ placeholder, submit: subLabel } = {}) => new Promise((resolve) => {
        inp.placeholder = placeholder ? t(placeholder) : t('Paste here'); inp.value = ''; inp.style.display = '';
        submit.textContent = subLabel ? t(subLabel) : t('Submit'); submit.style.display = '';
        const done = () => { inp.style.display = 'none'; submit.style.display = 'none'; submit.onclick = null; inp.onkeydown = null; resolve(inp.value.trim()); };
        submit.onclick = done;
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } };
      }),
    };
    btn.onclick = () => { try { const r = f.run && f.run(readForm(), ui); if (r && r.catch) r.catch((/** @type {any} */ e) => setState('✗ ' + ((e && e.message) || e), 'err')); } catch (e) { setState('✗ ' + ((e && /** @type {any} */ (e).message) || e), 'err'); } };
    if (f.status) Promise.resolve(f.status(readForm())).then((s) => { if (s) setState(s.text, s.ok ? 'ok' : ''); }).catch(() => {});
    box.append(btn, inp, submit, state);
    row.appendChild(box);
    return row;
  };

  /** @returns {SavedAccount} */
  const readForm = () => {
    const a = currentAdapter();
    /** @type {SavedAccount} */
    const acct = { name: /** @type {HTMLInputElement} */ ($('f-name')).value.trim(), protocol: a ? a.id : protoSel.value, autoConnect: /** @type {HTMLInputElement} */ ($('f-autoconnect')).checked };
    if (a && a.capabilities && a.capabilities.trading) {
      acct.accountType = /** @type {HTMLSelectElement} */ ($('f-accttype')).value || 'netting';   // netting | hedging (gates features)
      const sb = /** @type {HTMLInputElement} */ ($('f-startbal')).value.trim();   // stats origin; blank -> undefined
      if (sb !== '' && !Number.isNaN(Number(sb))) acct.startingBalance = Number(sb); else delete acct.startingBalance;
      const hd = /** @type {HTMLInputElement} */ ($('f-histdays')).value.trim();   // seed pull depth (days); blank -> undefined (default 30)
      if (hd !== '' && Number(hd) > 0) acct.historyDays = Math.round(Number(hd)); else delete acct.historyDays;
    }
    (a ? a.form || [] : []).forEach((f) => {
      if (f.type === 'action' || f.type === 'note') return;   // actions save nothing (tokens live server-side)
      const key = /** @type {string} */ (f.key);   // value fields (not note/action) always carry a key
      const el = /** @type {HTMLInputElement | null} */ ($('f-field-' + key)); if (!el) return;
      if (f.type === 'bool') acct[key] = !!el.checked;
      else if (f.type === 'number') { const v = el.value.trim(); acct[key] = v === '' ? (f.default != null ? f.default : '') : Number(v); }
      else { const v = el.value.trim(); acct[key] = v || (f.default != null ? f.default : ''); }
    });
    return acct;
  };
  /** @param {Partial<SavedAccount> | null | undefined} acct */
  const fillForm = (acct) => {
    /** @type {HTMLInputElement} */ ($('f-name')).value = (acct && acct.name) || '';
    populateProto((acct && acct.protocol) || (listBrokers()[0] && listBrokers()[0].id));
    /** @type {HTMLInputElement} */ ($('f-autoconnect')).checked = !!(acct && acct.autoConnect);
    /** @type {HTMLSelectElement} */ ($('f-accttype')).value = (acct && acct.accountType) || 'netting';
    /** @type {HTMLInputElement} */ ($('f-startbal')).value = (acct && acct.startingBalance != null) ? String(acct.startingBalance) : '';
    /** @type {HTMLInputElement} */ ($('f-histdays')).value = (acct && acct.historyDays != null) ? String(acct.historyDays) : '';
    renderFields(acct || {});
  };

  const refreshSaved = () => {
    const sel = /** @type {HTMLSelectElement} */ ($('f-saved'));
    sel.innerHTML = '<option value="">— new account —</option>';
    accounts.listAccounts().forEach((a) => {
      const o = document.createElement('option');
      o.value = a.name; o.textContent = a.name + '  (' + (a.server || a.protocol) + ')';
      sel.appendChild(o);
    });
  };

  // ---- Connection Manager: a row per saved account with live status ----
  const renderConnList = () => {
    listEl.innerHTML = '';
    const accts = accounts.listAccounts();
    if (!accts.length) { const e = document.createElement('div'); e.className = 'conn-empty'; e.textContent = t('No saved accounts yet — create one below.'); listEl.appendChild(e); return; }
    accts.forEach((a) => {
      const installed = !!adapterById(a.protocol);
      const connected = installed && broker.isConnected(a.protocol);
      const row = document.createElement('div'); row.className = 'conn-row';
      const dot = document.createElement('span'); dot.className = 'conn-dot' + (connected ? ' on' : '');
      const name = document.createElement('div'); name.className = 'conn-name';
      const nm = document.createElement('span'); nm.textContent = a.name;
      const pr = document.createElement('span'); pr.className = 'conn-proto'; pr.textContent = a.protocol;   // just the broker; server (Demo/Practice) is an account detail, not shown here
      name.append(nm, pr);
      // status is the dot's colour; no connected/not-connected text. Only surface the adapter-missing case as
      // a warning, since the dot can't convey it (it would just read as "not connected").
      const btn = document.createElement('button'); btn.className = 'conn-btn' + (connected ? ' disc' : '');
      btn.textContent = connected ? t('Disconnect') : t('Connect');
      if (!installed) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'default'; }
      btn.onclick = () => {
        if (!installed) return;
        if (broker.isConnected(a.protocol)) broker.disconnect(a.protocol);
        else { setDlg(t('Connecting to') + ' ' + a.name + '…'); broker.connect(a); }
      };
      row.append(dot, name);
      if (!installed) { const state = document.createElement('span'); state.className = 'conn-state'; state.textContent = t('not installed'); row.append(state); }
      row.append(btn);
      listEl.appendChild(row);
    });
  };

  // top-bar status: a chip (green dot + account name) per CONNECTED account;
  // nothing listed when not connected to anything.
  const renderTopStatus = () => {
    const c = $('conn'); if (!c) return;
    c.innerHTML = '';
    broker.connections().filter((x) => x.connected).forEach((x) => {
      const chip = document.createElement('span'); chip.className = 'conn-chip';
      const dot = document.createElement('span'); dot.className = 'conn-chip-dot';
      chip.append(dot, document.createTextNode(x.name));
      c.appendChild(chip);
    });
  };

  // re-render statuses whenever any connection changes
  bus.on('connections:changed', () => { renderTopStatus(); if (dlg.classList.contains('open')) renderConnList(); });
  // a broker reporting the OUTCOME of a connect attempt (success or why it failed) --
  // shown in the dialog status line so "Connecting..." always resolves to a real result.
  bus.on('broker:notice', (n) => { if (n && n.message) setDlg(n.message, !!n.error); });
  renderTopStatus();

  const openModal = () => {
    refreshSaved();
    const last = accounts.listAccounts().find((a) => a.name === accounts.lastUsed());
    if (last) { /** @type {HTMLSelectElement} */ ($('f-saved')).value = last.name; fillForm(last); } else fillForm({});
    setDlg('');
    renderConnList();
    dlg.classList.add('open');
  };
  const closeModal = () => dlg.classList.remove('open');

  const bFolder = $('btnAdaptersFolder'); if (bFolder) bFolder.onclick = () => fetch('/api/adapters/open', { method: 'POST' }).catch(() => {});
  /** @type {HTMLElement} */ ($('btnOpenConnect')).onclick = openModal;
  /** @type {HTMLElement} */ ($('btnCancel')).onclick = closeModal;
  /** @type {HTMLElement} */ ($('connClose')).onclick = closeModal;
  protoSel.onchange = () => renderFields({});
  /** @type {HTMLElement} */ ($('f-saved')).onchange = () => { const a = accounts.listAccounts().find((x) => x.name === /** @type {HTMLSelectElement} */ ($('f-saved')).value); fillForm(a || { name: '' }); };

  // required = a value-bearing field with no default and no value (skip actions, notes, bools)
  /** @param {BrokerAdapter | null} a @param {SavedAccount} acct @returns {FormField[]} */
  const missingFields = (a, acct) => ((a && a.form) || []).filter((f) => f.type !== 'action' && f.type !== 'note' && f.type !== 'bool' && f.default == null && !acct[/** @type {string} */ (f.key)]);

  /** @type {HTMLElement} */ ($('btnSave')).onclick = async () => {
    const a = readForm();
    if (!a.name) return setDlg(t('Give the account a name to save it.'), true);
    const missing = missingFields(currentAdapter(), a);
    if (missing.length) return setDlg(t('Enter') + ' ' + missing.map((f) => t(f.label).toLowerCase()).join(', ') + '.', true);
    // name is the account key -- if we're editing an existing account and its name changed, this is a RENAME:
    // drop the old record so we update it in place instead of spawning a duplicate.
    const prevName = /** @type {HTMLSelectElement} */ ($('f-saved')).value;
    if (prevName && prevName !== a.name) accounts.removeAccount(prevName);
    accounts.upsertAccount(a); accounts.setLastUsed(a.name);
    await accounts.saveAccounts();
    refreshSaved(); /** @type {HTMLSelectElement} */ ($('f-saved')).value = a.name; renderConnList();
    setDlg(t('Saved. Connect it below.'));
  };

  /** @type {HTMLElement} */ ($('btnDelete')).onclick = async () => {
    const name = /** @type {HTMLInputElement} */ ($('f-name')).value.trim();
    if (!name) return setDlg(t('Pick a saved account to delete.'), true);
    if (broker.isConnected((readForm()).protocol)) broker.disconnect((readForm()).protocol);
    accounts.removeAccount(name);
    await accounts.saveAccounts();
    refreshSaved(); /** @type {HTMLSelectElement} */ ($('f-saved')).value = ''; fillForm({}); renderConnList();
    setDlg(t('Removed') + ' ' + name + '.');
  };
}
