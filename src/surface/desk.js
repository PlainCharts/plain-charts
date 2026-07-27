// @ts-check
// Trade Desk — ONE master surface tab that houses internal mini-tabs (Console, Orders, Positions, Accounts,
// …), like an NT8 control center. Add a mini-tab with the "+", remove with its "×"; the active one fills the
// body. Which mini-tabs are open + which is active round-trips in the surface's workspace. Each mini-tab is a
// PANEL — the same view components used elsewhere — mounted lazily and torn down on switch.
import { bus } from '../bus.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup
import { getDeskOffsetMin, setDeskOffsetMin, fmtDeskOffsetLabel, getDeskStats, setDeskStats, getDeskBeThreshold, setDeskBeThreshold, getDeskColors, setDeskColors, DESK_COLOR_DEFAULTS } from './desk-config.js';
import { colorSwatch } from '../ui/colorpicker.js';   // the app's own color picker (not the native swatch)
import { mountConsole } from './console.js';
import { mountOrders } from './orders.js';
import { mountPositions } from './positions.js';
import { mountAccounts } from './accounts.js';
import { mountHistory } from './history.js';

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => { const d = document.createElement('div'); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

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

  let tabs = (Array.isArray(cfg.tabs) ? cfg.tabs : ['console', 'orders', 'positions', 'accounts']).filter((id) => PANEL[id]);
  if (!tabs.length) tabs = ['console'];
  /** @type {string} */
  let active = PANEL[/** @type {string} */ (cfg.active)] && tabs.includes(/** @type {string} */ (cfg.active)) ? /** @type {string} */ (cfg.active) : tabs[0];
  /** @type {{ id: string, handle: PanelHandle | undefined } | null} */
  let mounted = null;   // { id, handle }
  /** @type {HTMLElement | null} */
  let menu = null;

  const mountActive = () => {
    if (mounted && mounted.handle && mounted.handle.destroy) { try { mounted.handle.destroy(); } catch (_) {} }
    mounted = null; bodyEl.innerHTML = '';
    const p = PANEL[active]; if (!p) return;
    /** @type {PanelHandle | undefined} */
    let handle; try { handle = p.mount(bodyEl); } catch (e) { bodyEl.textContent = 'panel error: ' + ((e && /** @type {any} */ (e).message) || e); }
    mounted = { id: active, handle };
  };
  // the open mini-tabs + active one live in the surface workspace; signal a flush whenever they change so the
  // set survives reload (same event layout.js's persist() uses -- tabs.js captures getWorkspace() on it).
  const persist = () => { try { bus.emit('workspace:changed'); } catch (_) {} };
  /** @param {string} id */
  const select = (id) => { if (id === active) return; active = id; renderBar(); mountActive(); persist(); };
  /** @param {string} id */
  const removeTab = (id) => { tabs = tabs.filter((t) => t !== id); if (!tabs.length) tabs = []; if (active === id) active = tabs[0]; renderBar(); mountActive(); persist(); };
  /** @param {string} id */
  const addTab = (id) => { if (!tabs.includes(id)) tabs.push(id); active = id; renderBar(); mountActive(); persist(); };

  // ---- drag-to-reorder the mini-tabs (horizontal; mirrors the watchlist row DnD) ----
  /** @type {string|null} */ let dragId = null;
  /** @type {string|null} */ let dropId = null;
  /** @type {'before'|'after'|null} */ let dropPos = null;
  const clearDrop = () => { bar.querySelectorAll('.desk-drop-before,.desk-drop-after').forEach((t) => t.classList.remove('desk-drop-before', 'desk-drop-after')); dropId = null; dropPos = null; };
  const doDrop = () => {
    const dk = dragId, tk = dropId, pos = dropPos; clearDrop(); dragId = null;
    if (!dk || !tk || dk === tk) return;
    const from = tabs.indexOf(dk); if (from < 0) return;
    tabs.splice(from, 1);
    let to = tabs.indexOf(tk); if (to < 0) { tabs.splice(from, 0, dk); return; }   // target was the moved tab
    if (pos === 'after') to += 1;
    tabs.splice(to, 0, dk);
    renderBar(); persist();   // active tab and its mounted body are untouched -- only the bar order changes
  };
  /** @param {HTMLElement} t @param {string} id */
  const tabDnd = (t, id) => {
    t.draggable = true;
    t.ondragstart = (e) => { dragId = id; const dt = /** @type {DataTransfer} */ (e.dataTransfer); dt.effectAllowed = 'move'; try { dt.setData('text/plain', id); } catch (_) {} t.classList.add('desk-drag'); };
    t.ondragend = () => { t.classList.remove('desk-drag'); clearDrop(); dragId = null; };
    t.ondragover = (e) => {
      if (!dragId || dragId === id) return;
      e.preventDefault(); clearDrop();
      const r = t.getBoundingClientRect();
      dropId = id; dropPos = (e.clientX - r.left) > r.width / 2 ? 'after' : 'before';
      t.classList.add(dropPos === 'after' ? 'desk-drop-after' : 'desk-drop-before');
    };
    t.ondrop = (e) => { e.preventDefault(); doDrop(); };
  };

  const closeMenu = () => { if (menu) { try { menu.remove(); } catch (_) {} menu = null; document.removeEventListener('pointerdown', onAway, true); } };
  /** @param {PointerEvent} e */
  const onAway = (e) => { if (menu && !menu.contains(/** @type {Node} */ (e.target))) closeMenu(); };
  /** @param {HTMLElement} anchor */
  const openMenu = (anchor) => {
    closeMenu();
    const avail = PANELS.filter(([id]) => !tabs.includes(id));
    if (!avail.length) return;
    menu = el('desk-menu');
    avail.forEach(([id, label]) => { const item = el('desk-menu-item', label); item.onclick = () => { closeMenu(); addTab(id); }; /** @type {HTMLElement} */ (menu).appendChild(item); });
    wrap.appendChild(menu);
    const r = anchor.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    menu.style.left = (r.left - wr.left) + 'px'; menu.style.top = (r.bottom - wr.top + 2) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', onAway, true), 0);
  };

  const renderBar = () => {
    bar.innerHTML = '';
    tabs.forEach((id) => {
      const tab = el('desk-tab' + (id === active ? ' active' : ''));
      tab.appendChild(el('desk-tab-label', t(PANEL[id].label)));
      const x = el('desk-tab-x', '×'); x.title = t('Close'); x.onclick = (e) => { e.stopPropagation(); removeTab(id); };
      tab.appendChild(x);
      tab.onclick = () => select(id);
      tabDnd(tab, id);   // drag left/right to reorder
      bar.appendChild(tab);
    });
    const add = el('desk-add', '+'); add.title = t('Add panel'); add.onclick = (e) => { e.stopPropagation(); openMenu(add); };
    bar.appendChild(add);
    // Order ticket -- opens a STANDALONE window (its own OS window, floats free over a docked desk). Desktop only.
    const orderBtn = el('desk-configure desk-order', t('Order')); orderBtn.title = t('Open the order ticket');
    orderBtn.onclick = (e) => { e.stopPropagation(); if (window.desktop && window.desktop.openOrderTicket) window.desktop.openOrderTicket(); };
    bar.appendChild(orderBtn);
    // desk-wide settings (timezone, ...) -- pushed to the far right; separate from the per-tab column gear
    const cfgBtn = el('desk-configure', t('Configure')); cfgBtn.title = t('Trade Desk settings (applies to all tabs)');
    cfgBtn.onclick = (e) => { e.stopPropagation(); openConfig(); };
    bar.appendChild(cfgBtn);
  };

  // The Trade Desk configuration dialog: desk-wide settings that apply to every tab, organised into TABS
  // (General / Stats / Colors). The window is draggable by its header. Changes re-render open tabs live
  // (they subscribe to onDeskConfigChange).
  const openConfig = () => {
    const overlay = document.createElement('div'); overlay.className = 'modal open';
    const dlg = document.createElement('div'); dlg.className = 'dialog desk-config-dlg';
    // drag-by-header: listeners live on the document while open, torn down on close
    let dragging = false, ox = 0, oy = 0;
    /** @param {MouseEvent} e */
    const onMove = (e) => { if (!dragging) return; dlg.style.left = (e.clientX - ox) + 'px'; dlg.style.top = (e.clientY - oy) + 'px'; };
    const onUp = () => { dragging = false; };
    const close = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); overlay.remove(); };
    const head = el('lib-head');
    head.append(Object.assign(document.createElement('h3'), { textContent: t('Trade Desk') }), (() => { const x = el('lib-x', '✕'); x.onclick = close; return x; })());
    head.onmousedown = (e) => {
      if (/** @type {HTMLElement} */ (e.target).classList.contains('lib-x')) return;   // the close button is not a drag handle
      const rc = dlg.getBoundingClientRect(); dragging = true; ox = e.clientX - rc.left; oy = e.clientY - rc.top;
      dlg.style.position = 'fixed'; dlg.style.margin = '0'; dlg.style.left = rc.left + 'px'; dlg.style.top = rc.top + 'px'; e.preventDefault();
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);

    // ---- tab bar + panel switching ----
    const tabsBar = el('desk-config-tabs');
    const panelsWrap = document.createElement('div');
    /** @type {Record<string, HTMLElement>} */ const panels = {};
    /** @type {Record<string, HTMLElement>} */ const tabBtns = {};
    /** @param {string} k */
    const showTab = (k) => Object.keys(panels).forEach((key) => { panels[key].classList.toggle('active', key === k); tabBtns[key].classList.toggle('active', key === k); });
    /** @param {string} key @param {string} label @param {HTMLElement} panel */
    const addTab = (key, label, panel) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'desk-config-tab'; b.textContent = t(label); b.onclick = () => showTab(key);
      tabBtns[key] = b; tabsBar.appendChild(b);
      panel.className = 'desk-config-panel'; panels[key] = panel; panelsWrap.appendChild(panel);
    };

    // ===== GENERAL: display timezone + breakeven threshold =====
    const gen = document.createElement('div');
    const row = el('desk-config-row');
    row.appendChild(el('desk-config-label', t('Timezone')));
    const ctl = el('desk-tz-ctl');
    const minus = document.createElement('button'); minus.className = 'tz-step'; minus.textContent = '−'; minus.title = t('-1 hour');
    const val = el('desk-tz-val');
    const plus = document.createElement('button'); plus.className = 'tz-step'; plus.textContent = '+'; plus.title = t('+1 hour');
    const refresh = () => { val.textContent = fmtDeskOffsetLabel(); };
    minus.onclick = () => { setDeskOffsetMin(getDeskOffsetMin() - 60); refresh(); };
    plus.onclick = () => { setDeskOffsetMin(getDeskOffsetMin() + 60); refresh(); };
    ctl.append(minus, val, plus);
    row.appendChild(ctl);
    gen.appendChild(row);
    refresh();
    // Breakeven threshold: a $ amount away from 0 defining the BE (scratch) zone. Within +/- this = breakeven;
    // above = a hit, below = a miss. Drives the Trades H/BE/M breakdown and (later) per-trade Status.
    const beRow = el('desk-config-row');
    beRow.appendChild(el('desk-config-label', t('Breakeven threshold')));
    const beCtl = el('desk-be-ctl');
    beCtl.appendChild(el('desk-be-prefix', '$'));
    const beIn = document.createElement('input'); beIn.type = 'number'; beIn.className = 'desk-be-in'; beIn.min = '0'; beIn.step = 'any'; beIn.placeholder = '0';
    beIn.value = getDeskBeThreshold() ? String(getDeskBeThreshold()) : '';
    beIn.onchange = () => { setDeskBeThreshold(Number(beIn.value)); beIn.value = getDeskBeThreshold() ? String(getDeskBeThreshold()) : ''; };
    beCtl.appendChild(beIn);
    beRow.appendChild(beCtl);
    gen.appendChild(beRow);
    addTab('general', 'General', gen);

    // ===== STATS: master toggle + a single-column, reorderable, checkable stat list. One row = drag grip +
    // checkbox + label, so the user arranges AND turns stats on/off in one place. =====
    const statsPanel = document.createElement('div');
    const stats = getDeskStats();
    const persistStats = () => setDeskStats({ enabled: stats.enabled, items: stats.items });
    const secHead = el('desk-config-sechead');
    const enCb = document.createElement('input'); enCb.type = 'checkbox'; enCb.checked = stats.enabled;
    secHead.append(enCb, el('desk-config-sectitle', t('Stats bar')));
    statsPanel.appendChild(secHead);
    const list = el('desk-stats-list');
    const setDim = () => { list.style.opacity = stats.enabled ? '' : '.45'; list.style.pointerEvents = stats.enabled ? '' : 'none'; };
    enCb.onchange = () => { stats.enabled = enCb.checked; persistStats(); setDim(); };
    /** @type {string|null} */ let dragKey = null;
    /** @type {string|null} */ let dropKey = null;
    /** @type {'before'|'after'|null} */ let dropPos = null;
    const clearDrop = () => { list.querySelectorAll('.drop-before,.drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after')); dropKey = null; dropPos = null; };
    const doDrop = () => {
      const dk = dragKey, tk = dropKey, pos = dropPos; clearDrop(); dragKey = null;
      if (!dk || !tk || dk === tk) return;
      const from = stats.items.findIndex((i) => i.key === dk); if (from < 0) return;
      const moved = stats.items.splice(from, 1)[0];
      let to = stats.items.findIndex((i) => i.key === tk); if (to < 0) { stats.items.splice(from, 0, moved); return; }
      if (pos === 'after') to += 1;
      stats.items.splice(to, 0, moved);
      persistStats(); renderStats();
    };
    const renderStats = () => {
      list.innerHTML = '';
      stats.items.forEach((it) => {
        const r = el('desk-stats-row');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = it.on;
        cb.onchange = () => { it.on = cb.checked; persistStats(); };
        r.append(el('desk-stats-grip', '⠿'), cb, el('desk-stats-lbl', t(it.label)));
        r.draggable = true;
        r.ondragstart = (e) => { dragKey = it.key; const dt = /** @type {DataTransfer} */ (e.dataTransfer); dt.effectAllowed = 'move'; try { dt.setData('text/plain', it.key); } catch (_) {} r.classList.add('desk-stats-drag'); };
        r.ondragend = () => { r.classList.remove('desk-stats-drag'); clearDrop(); dragKey = null; };
        r.ondragover = (e) => { if (!dragKey || dragKey === it.key) return; e.preventDefault(); clearDrop(); const rc = r.getBoundingClientRect(); dropKey = it.key; dropPos = (e.clientY - rc.top) > rc.height / 2 ? 'after' : 'before'; r.classList.add(dropPos === 'after' ? 'drop-after' : 'drop-before'); };
        r.ondrop = (e) => { e.preventDefault(); doDrop(); };
        list.appendChild(r);
      });
    };
    renderStats(); setDim();
    statsPanel.appendChild(list);
    addTab('stats', 'Stats', statsPanel);

    // ===== COLORS: the Console journal DIRECTION tints -- OUT (app -> broker requests) and IN (broker -> app
    // replies). A native swatch per direction; changes apply live (Console subscribes to onDeskConfigChange). =====
    const colorsPanel = document.createElement('div');
    /** @type {Record<'out'|'in', HTMLButtonElement>} */ const swatch = /** @type {any} */ ({});
    /** @param {'out'|'in'} key @param {string} v @returns {HTMLButtonElement} */
    const mkSwatch = (key, v) => colorSwatch(v, (nv) => setDeskColors({ [key]: nv }));
    /** @param {string} name @param {string} sub @param {'out'|'in'} key */
    const colorRow = (name, sub, key) => {
      const r = el('desk-color-row');
      const meta = el('desk-color-meta'); meta.append(el('desk-color-name', t(name)), el('desk-color-sub', t(sub)));
      const sw = mkSwatch(key, getDeskColors()[key]);
      swatch[key] = sw; r.append(meta, sw); return r;
    };
    colorsPanel.append(
      colorRow('Outgoing', 'App to broker (our requests)', 'out'),
      colorRow('Incoming', 'Broker to us (their replies)', 'in'),
    );
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'desk-color-reset'; reset.textContent = t('Reset to defaults');
    // colorSwatch has no external setter, so rebuild each swatch to reflect the defaults
    reset.onclick = () => {
      setDeskColors({ out: DESK_COLOR_DEFAULTS.out, in: DESK_COLOR_DEFAULTS.in });
      /** @type {Array<'out'|'in'>} */ (['out', 'in']).forEach((key) => {
        const fresh = mkSwatch(key, DESK_COLOR_DEFAULTS[key]);
        swatch[key].replaceWith(fresh); swatch[key] = fresh;
      });
    };
    colorsPanel.appendChild(reset);
    addTab('colors', 'Colors', colorsPanel);

    showTab('general');

    const body = el('desk-config-body'); body.appendChild(panelsWrap);
    dlg.append(head, tabsBar, body);
    overlay.appendChild(dlg);
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.body.appendChild(overlay);
  };

  renderBar();
  mountActive();

  // live vocabulary switch: re-render the tab bar and re-mount the active panel so its words update
  // without a reload (unsubscribed on destroy so a re-mounted desk never stacks listeners)
  const offVocab = bus.on('vocab:changed', () => { renderBar(); mountActive(); });

  return {
    destroy() { offVocab(); closeMenu(); if (mounted && mounted.handle && mounted.handle.destroy) { try { mounted.handle.destroy(); } catch (_) {} } root.innerHTML = ''; },
    state() { return { kind: 'desk', tabs, active }; },
  };
}
