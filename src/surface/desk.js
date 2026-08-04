// @ts-check
// Trade Desk — ONE master surface tab that houses internal mini-tabs (Console, Orders, Positions, Accounts,
// …), like an NT8 control center. Add a mini-tab with the "+", remove with its "×"; the active one fills the
// body. Which mini-tabs are open + which is active round-trips in the surface's workspace. Each mini-tab is a
// PANEL — the same view components used elsewhere — mounted lazily and torn down on switch.
import { bus } from '../bus.js';
import { t } from '../i18n/i18n.js'; // vocabulary lookup
import { openDeskConfigDialog } from './desk-config-dialog.js'; // the desk-wide settings window (General/Stats/Colors)
import { mountConsole } from './console.js';
import { mountOrders } from './orders.js';
import { mountPositions } from './positions.js';
import { mountAccounts } from './accounts.js';
import { mountHistory } from './history.js';
import { mountStats } from './stats.js';

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

// the mount fn for a panel: fills `root`, returns a handle (destroy + optional state)
/** @typedef {{ destroy?: () => void, state?: () => any }} PanelHandle */
/** @typedef {(root: HTMLElement, cfg?: any) => (PanelHandle | undefined)} PanelMount */
/** @typedef {{ id: string, label: string, mount: PanelMount }} Panel */

// the panels a desk can host, in menu order
/** @type {[string, string, PanelMount][]} */
const PANELS = [
  ['console', 'Console', mountConsole],
  ['orders', 'Orders', mountOrders],
  ['positions', 'Positions', mountPositions],
  ['history', 'History', mountHistory],
  ['stats', 'Stats', mountStats],
  ['accounts', 'Accounts', mountAccounts],
];
/** @type {Record<string, Panel>} */
const PANEL = Object.fromEntries(PANELS.map(([id, label, mount]) => [id, { id, label, mount }]));

/** @param {HTMLElement} root @param {{ tabs?: string[], active?: string }} [cfg] */
export function mountDesk(root, cfg = {}) {
  root.innerHTML = '';
  const wrap = el('surface desk');
  const bar = el('desk-tabs');
  const bodyEl = el('desk-body');
  wrap.append(bar, bodyEl);
  root.appendChild(wrap);

  let tabs = (Array.isArray(cfg.tabs) ? cfg.tabs : ['console', 'orders', 'positions', 'accounts']).filter(
    (id) => PANEL[id],
  );
  if (!tabs.length) tabs = ['console'];
  /** @type {string} */
  let active =
    PANEL[/** @type {string} */ (cfg.active)] && tabs.includes(/** @type {string} */ (cfg.active))
      ? /** @type {string} */ (cfg.active)
      : tabs[0];
  /** @type {{ id: string, handle: PanelHandle | undefined } | null} */
  let mounted = null; // { id, handle }
  /** @type {HTMLElement | null} */
  let menu = null;

  const mountActive = () => {
    if (mounted && mounted.handle && mounted.handle.destroy) {
      try {
        mounted.handle.destroy();
      } catch (_) {}
    }
    mounted = null;
    bodyEl.innerHTML = '';
    const p = PANEL[active];
    if (!p) return;
    /** @type {PanelHandle | undefined} */
    let handle;
    try {
      handle = p.mount(bodyEl);
    } catch (e) {
      bodyEl.textContent = 'panel error: ' + ((e && /** @type {any} */ (e).message) || e);
    }
    mounted = { id: active, handle };
  };
  // the open mini-tabs + active one live in the surface workspace; signal a flush whenever they change so the
  // set survives reload (same event layout.js's persist() uses -- tabs.js captures getWorkspace() on it).
  const persist = () => {
    try {
      bus.emit('workspace:changed');
    } catch (_) {}
  };
  /** @param {string} id */
  const select = (id) => {
    if (id === active) return;
    active = id;
    renderBar();
    mountActive();
    persist();
  };
  /** @param {string} id */
  const removeTab = (id) => {
    tabs = tabs.filter((t) => t !== id);
    if (!tabs.length) tabs = [];
    if (active === id) active = tabs[0];
    renderBar();
    mountActive();
    persist();
  };
  /** @param {string} id */
  const addTab = (id) => {
    if (!tabs.includes(id)) tabs.push(id);
    active = id;
    renderBar();
    mountActive();
    persist();
  };

  // ---- drag-to-reorder the mini-tabs (horizontal; mirrors the watchlist row DnD) ----
  /** @type {string|null} */ let dragId = null;
  /** @type {string|null} */ let dropId = null;
  /** @type {'before'|'after'|null} */ let dropPos = null;
  const clearDrop = () => {
    bar
      .querySelectorAll('.desk-drop-before,.desk-drop-after')
      .forEach((t) => t.classList.remove('desk-drop-before', 'desk-drop-after'));
    dropId = null;
    dropPos = null;
  };
  const doDrop = () => {
    const dk = dragId,
      tk = dropId,
      pos = dropPos;
    clearDrop();
    dragId = null;
    if (!dk || !tk || dk === tk) return;
    const from = tabs.indexOf(dk);
    if (from < 0) return;
    tabs.splice(from, 1);
    let to = tabs.indexOf(tk);
    if (to < 0) {
      tabs.splice(from, 0, dk);
      return;
    } // target was the moved tab
    if (pos === 'after') to += 1;
    tabs.splice(to, 0, dk);
    renderBar();
    persist(); // active tab and its mounted body are untouched -- only the bar order changes
  };
  /** @param {HTMLElement} t @param {string} id */
  const tabDnd = (t, id) => {
    t.draggable = true;
    t.ondragstart = (e) => {
      dragId = id;
      const dt = /** @type {DataTransfer} */ (e.dataTransfer);
      dt.effectAllowed = 'move';
      try {
        dt.setData('text/plain', id);
      } catch (_) {}
      t.classList.add('desk-drag');
    };
    t.ondragend = () => {
      t.classList.remove('desk-drag');
      clearDrop();
      dragId = null;
    };
    t.ondragover = (e) => {
      if (!dragId || dragId === id) return;
      e.preventDefault();
      clearDrop();
      const r = t.getBoundingClientRect();
      dropId = id;
      dropPos = e.clientX - r.left > r.width / 2 ? 'after' : 'before';
      t.classList.add(dropPos === 'after' ? 'desk-drop-after' : 'desk-drop-before');
    };
    t.ondrop = (e) => {
      e.preventDefault();
      doDrop();
    };
  };

  const closeMenu = () => {
    if (menu) {
      try {
        menu.remove();
      } catch (_) {}
      menu = null;
      document.removeEventListener('pointerdown', onAway, true);
    }
  };
  /** @param {PointerEvent} e */
  const onAway = (e) => {
    if (menu && !menu.contains(/** @type {Node} */ (e.target))) closeMenu();
  };
  /** @param {HTMLElement} anchor */
  const openMenu = (anchor) => {
    closeMenu();
    const avail = PANELS.filter(([id]) => !tabs.includes(id));
    if (!avail.length) return;
    menu = el('desk-menu');
    avail.forEach(([id, label]) => {
      const item = el('desk-menu-item', label);
      item.onclick = () => {
        closeMenu();
        addTab(id);
      };
      /** @type {HTMLElement} */ (menu).appendChild(item);
    });
    wrap.appendChild(menu);
    const r = anchor.getBoundingClientRect(),
      wr = wrap.getBoundingClientRect();
    menu.style.left = r.left - wr.left + 'px';
    menu.style.top = r.bottom - wr.top + 2 + 'px';
    setTimeout(() => document.addEventListener('pointerdown', onAway, true), 0);
  };

  const renderBar = () => {
    bar.innerHTML = '';
    tabs.forEach((id) => {
      const tab = el('desk-tab' + (id === active ? ' active' : ''));
      tab.appendChild(el('desk-tab-label', t(PANEL[id].label)));
      const x = el('desk-tab-x', '×');
      x.title = t('Close');
      x.onclick = (e) => {
        e.stopPropagation();
        removeTab(id);
      };
      tab.appendChild(x);
      tab.onclick = () => select(id);
      tabDnd(tab, id); // drag left/right to reorder
      bar.appendChild(tab);
    });
    const add = el('desk-add', '+');
    add.title = t('Add panel');
    add.onclick = (e) => {
      e.stopPropagation();
      openMenu(add);
    };
    bar.appendChild(add);
    // Order ticket -- opens a STANDALONE window (its own OS window, floats free over a docked desk). Desktop only.
    const orderBtn = el('desk-configure desk-order', t('Order'));
    orderBtn.title = t('Open the order ticket');
    orderBtn.onclick = (e) => {
      e.stopPropagation();
      if (window.desktop && window.desktop.openOrderTicket) window.desktop.openOrderTicket();
    };
    bar.appendChild(orderBtn);
    // desk-wide settings (timezone, ...) -- pushed to the far right; separate from the per-tab column gear
    const cfgBtn = el('desk-configure', t('Configure'));
    cfgBtn.title = t('Trade Desk settings (applies to all tabs)');
    cfgBtn.onclick = (e) => {
      e.stopPropagation();
      openDeskConfigDialog();
    };
    bar.appendChild(cfgBtn);
  };

  renderBar();
  mountActive();

  // live vocabulary switch: re-render the tab bar and re-mount the active panel so its words update
  // without a reload (unsubscribed on destroy so a re-mounted desk never stacks listeners)
  const offVocab = bus.on('vocab:changed', () => {
    renderBar();
    mountActive();
  });

  return {
    destroy() {
      offVocab();
      closeMenu();
      if (mounted && mounted.handle && mounted.handle.destroy) {
        try {
          mounted.handle.destroy();
        } catch (_) {}
      }
      root.innerHTML = '';
    },
    state() {
      return { kind: 'desk', tabs, active };
    },
  };
}
