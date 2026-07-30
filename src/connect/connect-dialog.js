// @ts-check
// Connections dialog = Connection Manager + Account Manager.
//  - Connection Manager (top): every saved account with a live status and a
//    Connect/Disconnect button. Connections are global & independent of tabs —
//    you can connect to several brokers at once (one per protocol).
//  - Account Manager (below): create/edit/save an account; each account carries
//    its OWN "auto-connect on startup" flag.
// The FORM itself is schema-driven and lives in account-form.js (adapter registry -> fields); this dialog owns
// the modal shell, the saved-accounts list, persistence (save / rename / delete) and the connection rows. The
// top-bar status chips are their own module (status-chips.js) — app-lifetime, not dialog code.
import { broker, bus } from '../../data_engine/index.js';   // facade + engine events (connections:changed / broker:notice)
import * as accounts from './accounts.js';
import { $ } from '../dom.js';
import { makeDraggable } from '../ui/draggable.js';
import { createAccountForm } from './account-form.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup (account names/servers stay user data)

export function initConnectDialog() {
  const dlg = /** @type {HTMLElement} */ ($('modal'));
  const box = /** @type {HTMLElement | null} */ (dlg.querySelector('.dialog')), head = /** @type {HTMLElement | null} */ (dlg.querySelector('.conn-head'));
  if (box && head) makeDraggable(box, head);   // drag the dialog by its header
  dlg.classList.add('modal-passthru');   // floating, non-modal: chart stays interactive; no click-away close
  const dlgStatus = /** @type {HTMLElement} */ ($('dlgStatus'));
  const listEl = /** @type {HTMLElement} */ ($('conn-list'));
  /** @param {string} [m] @param {boolean} [err] */
  const setDlg = (m, err) => { dlgStatus.textContent = m || ''; dlgStatus.className = 'dlg-status' + (err ? ' err' : ''); };

  const form = createAccountForm();   // the schema-driven Account Manager form (render/read/fill)

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
      const installed = !!form.adapterById(a.protocol);
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

  // re-render the connection rows whenever any connection changes (only while the dialog is open)
  bus.on('connections:changed', () => { if (dlg.classList.contains('open')) renderConnList(); });
  // a broker reporting the OUTCOME of a connect attempt (success or why it failed) --
  // shown in the dialog status line so "Connecting..." always resolves to a real result.
  bus.on('broker:notice', (n) => { if (n && n.message) setDlg(n.message, !!n.error); });

  const openModal = () => {
    refreshSaved();
    const last = accounts.listAccounts().find((a) => a.name === accounts.lastUsed());
    if (last) { /** @type {HTMLSelectElement} */ ($('f-saved')).value = last.name; form.fillForm(last); } else form.fillForm({});
    setDlg('');
    renderConnList();
    dlg.classList.add('open');
  };
  const closeModal = () => dlg.classList.remove('open');

  const bFolder = $('btnAdaptersFolder'); if (bFolder) bFolder.onclick = () => fetch('/api/adapters/open', { method: 'POST' }).catch(() => {});
  /** @type {HTMLElement} */ ($('btnOpenConnect')).onclick = openModal;
  /** @type {HTMLElement} */ ($('btnCancel')).onclick = closeModal;
  /** @type {HTMLElement} */ ($('connClose')).onclick = closeModal;
  /** @type {HTMLElement} */ ($('f-saved')).onchange = () => { const a = accounts.listAccounts().find((x) => x.name === /** @type {HTMLSelectElement} */ ($('f-saved')).value); form.fillForm(a || { name: '' }); };

  /** @type {HTMLElement} */ ($('btnSave')).onclick = async () => {
    const a = form.readForm();
    if (!a.name) return setDlg(t('Give the account a name to save it.'), true);
    const missing = form.missingFields(a);
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
    if (broker.isConnected((form.readForm()).protocol)) broker.disconnect((form.readForm()).protocol);
    accounts.removeAccount(name);
    await accounts.saveAccounts();
    refreshSaved(); /** @type {HTMLSelectElement} */ ($('f-saved')).value = ''; form.fillForm({}); renderConnList();
    setDlg(t('Removed') + ' ' + name + '.');
  };
}
