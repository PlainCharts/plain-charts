// @ts-check
// ACCOUNT filter dropdown for the Trade Desk tabs (Orders / Positions / History). The app can connect to several
// accounts across brokers at once, so a plain table mixes them into nonsense; this narrows a tab to one account
// (or All accounts). The selection is PER TAB -- each tab keeps its own choice under its own settings key, so you
// can watch Positions on one account while History shows All. On History it sits FIRST (left of the date filter),
// so the date filter operates within the chosen account.
import { platform, bus } from '../../data_engine/index.js';
import * as accounts from '../connect/accounts.js';
import { getSetting, setSetting } from '../settings/settings.js';
import { t as tr } from '../i18n/i18n.js'; // imported as tr -- local `t` (event target) below

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

// currently connected accounts as { key:'broker:accountId', label }. Label is the saved connection name when
// known (what the Accounts tab shows), else the raw account id.
/** @returns {{ key: string, label: string }[]} */
function connectedAccounts() {
  return platform.accounts.all().map((a) => {
    const saved = accounts.listAccounts().find((s) => s.protocol === a.broker);
    const id = a.accountId != null ? a.accountId : '';
    return { key: a.broker + ':' + id, label: (saved && saved.name) || String(id || a.broker) };
  });
}

// Build a per-tab account-filter dropdown. `settingsKey` persists this tab's choice; `onChange` re-renders the
// tab. Returns the button to place in the header, a `matches(row)` predicate bound to THIS tab's selection, and
// a destroy.
/** @param {string} settingsKey @param {() => void} onChange @returns {{ btn: HTMLElement, matches: (r: { broker?: any, accountId?: any }) => boolean, destroy: () => void }} */
export function createAccountFilter(settingsKey, onChange) {
  let sel = getSetting(settingsKey) || 'all';
  // A saved selection may point to an account that isn't connected (yet / anymore) -- e.g. a filter set to one broker
  // while only another is up. Treat that as 'all' so the tab isn't SILENTLY emptied under a misleading "All accounts" label
  // (the label already reads "All accounts" in that case, so this just makes behaviour match it). Once the account
  // connects, connections:changed re-renders the tab and the filter engages.
  const effectiveSel = () => (!sel || sel === 'all' || !connectedAccounts().some((a) => a.key === sel) ? 'all' : sel);
  const label = () => {
    const s = effectiveSel();
    if (s === 'all') return tr('All accounts');
    const f = connectedAccounts().find((a) => a.key === s);
    return f ? f.label : tr('All accounts');
  };

  const btn = el('desk-filt acct-filt');
  btn.title = tr('Filter by account');
  const lbl = el('desk-filt-t', label());
  btn.append(lbl, el('desk-filt-caret', '▾'));

  const apply = (/** @type {string} */ v) => {
    sel = v;
    setSetting(settingsKey, v);
    lbl.textContent = label();
    try {
      onChange();
    } catch (_) {}
  };

  /** @type {HTMLElement | null} */
  let menu = null;
  const close = () => {
    if (menu) {
      try {
        menu.remove();
      } catch (_) {}
      menu = null;
      document.removeEventListener('pointerdown', away, true);
    }
  };
  /** @param {PointerEvent} e */
  const away = (e) => {
    const t = /** @type {Node} */ (e.target);
    if (menu && !menu.contains(t) && !btn.contains(t)) close();
  };
  const open = () => {
    close();
    const m = el('wl-listmenu desk-filt-menu');
    menu = m;
    /** @type {{ key: string, label: string }[]} */
    const rows = [{ key: 'all', label: tr('All accounts') }, ...connectedAccounts()];
    rows.forEach(({ key, label: lab }) => {
      const row = el('wl-listmenu-row' + (sel === key ? ' sel' : ''), lab);
      row.onclick = () => {
        apply(key);
        close();
      };
      m.appendChild(row);
    });
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 236)) + 'px';
    m.style.top = r.bottom + 4 + 'px';
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  };
  btn.onclick = () => (menu ? close() : open());

  // refresh the label if the selected account's name resolves later / it (dis)connects
  const off = bus.on('connections:changed', () => {
    lbl.textContent = label();
  });
  // an account (dis)connecting flips effectiveSel (engage a filter once its account is up; fall back to 'all' when
  // it drops), so re-label AND re-render the tab -- this is what fixes a saved filter showing empty at startup.
  const offAcc = platform.accounts.subscribe(() => {
    lbl.textContent = label();
    try {
      onChange();
    } catch (_) {}
  });

  /** @param {{ broker?: any, accountId?: any }} r */
  const matches = (r) => {
    const s = effectiveSel();
    return s === 'all' ? true : r.broker + ':' + (r.accountId != null ? r.accountId : '') === s;
  };

  return {
    btn,
    matches,
    destroy() {
      close();
      try {
        off();
      } catch (_) {}
      try {
        offAcc();
      } catch (_) {}
    },
  };
}
