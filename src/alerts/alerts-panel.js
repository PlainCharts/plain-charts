// @ts-check
// Alerts manager — a right-rail panel listing every alert in the engine's store (read from the alert-host
// mirror, alertMirror()). Each row shows "SYMBOL, TF" + an Active/Stopped status dot, with play/pause (toggle)
// and delete controls; mutations go through the command funnel (the panel never writes the store). Hovering a
// row for 1s opens a detail card (conditions, symbol/tf/status, created date).
import * as rp from '../panels/rightpanel.js';
import { bus } from '../bus.js';
import { themeIcon } from '../ui/icon.js';
import { alertMirror } from './store.js';
import { alertLogMirror } from './log-store.js';   // the read-only mirror of the fire LOG (the mailbox)
import { lastSeenLogAt, markLogSeen, unseenCount } from './alert-badge.js';   // unseen-fires badge (derived from the Log)
import { alertCommand } from './funnel.js';
import { condLines, isAny, restartPatch, sourceOf, alertType } from './alert-record.js';   // pure record accessors (schema's one home)
import { statusText, timeAlertLine, tfSuffix, descOf, nameOf, cardScope, firedAt } from './alerts-format.js';   // pure display derivations (row descriptor, name, card scope, status, last-fired)
import { SORT_GROUPS, cmpOf } from './alerts-sort.js';   // the toolbar sort model (comparator groups + key->comparator)
import { menuRows } from './alerts-menu.js';   // shared dwg-menu row builders (item/check/combo/opt/pref) for the ⋯ menus
import { openCreateAlertDialog, openValueAlertDialog } from './create-alert-dialog.js';   // opens prefilled (edit mode) for an existing alert
import { openCreateTimeAlertDialog } from './create-time-alert-dialog.js';   // the small time-alert dialog (Time tab "+")
import { removeAlertAndDrawing } from './alert-drawing-sync.js';   // shared "delete alert + its drawing" cascade
import { fmtAlertTime, alertShowName, alertShowMessage, alertShowLastTriggered, alertTzOffsetMin, alertHours24, logShowName, logShowMessage, logTypePrice, logTypeTime, logTypeWatchlist } from './alert-display.js';   // alert-owned display prefs (timestamp + row columns)
import { strftime, fmtTime } from '../chart/pane-format.js';   // pure tz-shifted date/time formatting (Log day headers + row time)
import { openChartSettings } from '../settings/chart-dialog.js';   // "Alerts settings…" opens Settings → Alerts
import { getAllPanes, getActivePane } from '../chart/layout.js';    // find the pane that owns the alert's drawing / the active chart
import { confirmDialog } from '../ui/confirm.js';                   // confirm before deleting an alert
import { t } from '../i18n/i18n.js';

/** @param {string} tag @param {string} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

// Open the edit dialog for an alert. A Value-based alert (no chart object) opens the Value dialog prefilled,
// using the active chart for decimals/settings. A drawing alert finds the open pane that owns its drawing.
/** @param {any} a */
function editAlert(a) {
  if (!a.objectId) { openValueAlertDialog(getActivePane ? getActivePane() : null, a); return; }
  const panes = getAllPanes ? getAllPanes() : [];
  const owns = (/** @type {any} */ p) => p && p.drawings && p.drawings.get && p.drawings.get(a.objectId);
  const target = panes.find((/** @type {any} */ p) => p.symbol === a.symbol && owns(p)) || panes.find(owns);
  if (target && target.drawings) openCreateAlertDialog(target.drawings, a.objectId);
}

export function initAlertsPanel() {
  const panel = el('div', 'al-panel');

  // Three producer-agnostic tabs: Price (price-source alerts) · Time (time-source alerts) · Log (the mailbox).
  const tabs = el('div', 'al-tabs');
  const tabPrice = el('button', 'al-tab active', t('Price')); tabPrice.setAttribute('data-i18n', 'Price');
  const tabTime = el('button', 'al-tab', t('Time')); tabTime.setAttribute('data-i18n', 'Time');
  const tabLog = el('button', 'al-tab', t('Log')); tabLog.setAttribute('data-i18n', 'Log');
  tabs.append(tabPrice, tabTime, tabLog);

  // toolbar: "+" adds a new Value-based alert (no chart object — Price crossing a literal Value); the sort
  // button (right) opens a dropdown to reorder the list.
  const toolbar = el('div', 'al-toolbar');
  const addBtn = el('button', 'al-add', '+'); addBtn.title = t('Create alert');
  // "+" is producer-aware: on the Time tab it opens the small time-alert dialog; elsewhere the price dialog.
  addBtn.onclick = () => { if (tab === 'time') openCreateTimeAlertDialog(); else openValueAlertDialog(getActivePane ? getActivePane() : null); };
  const sortBtn = el('button', 'al-add al-sort', '⇅'); sortBtn.title = t('Sort alerts'); sortBtn.style.marginLeft = 'auto';
  const moreBtn = el('button', 'al-add al-more', '⋯'); moreBtn.title = t('More actions');
  toolbar.append(addBtn, sortBtn, moreBtn);

  const body = el('div', 'al-body');
  panel.append(tabs, toolbar, body);

  let tab = 'price';
  let sortKey = 'created-desc';   // default = newest created first (matches the previous fixed order)
  let showFilter = 'all';         // which alerts the list shows: all | active | inactive
  // symbol/interval scoping (the FILTER ALERTS section). Two ways to set each axis, mutually exclusive:
  // "current" (track the active chart) OR an explicit pick from the values present in the list.
  let curSym = false, bySym = '';   // symbol axis: active-chart symbol, or a chosen symbol ('' = any)
  let curTf = false, byTf = '';     // interval axis: active-chart tf, or a chosen tf ('' = any)
  // The Log tab's OWN symbol/interval filter (independent of the Price tab), same two-axis model over log entries.
  let logCurSym = false, logBySym = '';
  let logCurTf = false, logByTf = '';
  let logExpandSym = false, logExpandTf = false;   // whether the Log menu's By-symbol / By-interval picker is open
  /** @param {string} tb */
  const setTab = (tb) => {
    tab = tb;
    if (tb === 'log') markLogSeen();   // visiting the Log clears the unseen-fires badge (stamps lastSeenLogAt = now)
    tabPrice.classList.toggle('active', tb === 'price');
    tabTime.classList.toggle('active', tb === 'time');
    tabLog.classList.toggle('active', tb === 'log');
    // Price: full toolbar (+ / sort / ⋯). Time: just "+". Log: just the ⋯ (Clear log / filter / customize).
    toolbar.style.display = 'flex';
    addBtn.style.display = (tb === 'price' || tb === 'time') ? '' : 'none';
    sortBtn.style.display = tb === 'price' ? '' : 'none';
    moreBtn.style.display = (tb === 'price' || tb === 'log') ? '' : 'none';
    moreBtn.style.marginLeft = tb === 'price' ? '' : 'auto';   // right-align the lone ⋯ on the Log tab
    render();
  };
  tabPrice.onclick = () => setTab('price');
  tabTime.onclick = () => setTab('time');
  tabLog.onclick = () => setTab('log');

  // --- hover detail card (opens after a 1s hold) ---
  /** @type {HTMLElement|null} */
  let card = null;
  /** @type {any} */
  let hoverTimer = null;
  const hideCard = () => { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } if (card) { card.remove(); card = null; } };
  /** @param {any} a @param {HTMLElement} row */
  const showCard = (a, row) => {
    hideCard();
    const c = el('div', 'al-card');
    const isTime = sourceOf(a) === 'time';
    // Order: 1 Name  2 Message  3 Condition  4 Broker/Symbol • Status  5 Created  6 Last triggered.
    if (a.name) c.appendChild(el('div', 'al-card-title', String(a.name)));
    if (a.message) c.appendChild(el('div', 'al-card-msg', '"' + String(a.message) + '"'));
    if (isTime) {
      c.appendChild(el('div', 'al-card-cond', timeAlertLine(a)));   // a time alert's "what" is its schedule
    } else {
      const lines = condLines(a);
      const conn = isAny(a) ? ' ' + t('OR') + ' ' : ' ' + t('AND') + ' ';
      if (lines.length) {
        lines.forEach((/** @type {string} */ ln, /** @type {number} */ i) => c.appendChild(el('div', 'al-card-cond', (i ? conn.trim() + ' ' : '') + ln)));
      } else {
        c.appendChild(el('div', 'al-card-cond', t('No conditions set')));
      }
    }
    const scope = cardScope(a);
    c.appendChild(el('div', 'al-card-meta', (scope ? scope + tfSuffix(a) + ' • ' : '') + statusText(a)));
    c.appendChild(el('div', 'al-card-meta', t('Created') + ': ' + fmtAlertTime(a.createdAt)));
    const fa = firedAt(a);
    if (fa) c.appendChild(el('div', 'al-card-meta', t('Last triggered') + ': ' + fmtAlertTime(fa)));
    document.body.appendChild(c);
    // place to the LEFT of the row (the panel is on the right rail); clamp on screen
    const r = row.getBoundingClientRect();
    const w = c.offsetWidth, h = c.offsetHeight;
    let left = r.left - w - 8; if (left < 8) left = r.right + 8;
    let top = r.top; if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
    c.style.left = Math.max(8, left) + 'px'; c.style.top = Math.max(8, top) + 'px';
    card = c;
  };

  // The Log tab: render the mailbox newest-first, grouped under day headers ("JULY 22"). Each entry is one
  // fire; its display (name / symbol / message) is looked up LIVE from the alert via alertId -- the crosslink.
  // Filtering by symbol/interval also reads the linked alert. Hovering a row opens that alert's card.
  /** @param {any} e  the alert this log entry belongs to (undefined only during a transient mirror sync) */
  const alertOf = (e) => alertMirror().get(e.alertId);
  const renderLog = () => {
    const total = alertLogMirror().size();
    let entries = alertLogMirror().recent();
    // symbol / interval scope: "current" resolves against the active chart, else the explicit pick -- both
    // matched against the LINKED alert (the entry itself carries no symbol/tf).
    const active = getActivePane ? getActivePane() : null;
    const symWanted = logCurSym ? (active && active.symbol) : (logBySym || null);
    const tfWanted = logCurTf ? (active && active.tfId) : (logByTf || null);
    if (symWanted) entries = entries.filter((/** @type {any} */ e) => { const a = alertOf(e); return (e.symbol || (a && a.symbol)) === symWanted; });
    if (tfWanted) entries = entries.filter((/** @type {any} */ e) => { const a = alertOf(e); return a && a.tf === tfWanted; });
    // "Show events by type": hide the unchecked producer types (an orphan entry with no linked alert stays visible).
    const typeOn = { price: logTypePrice(), time: logTypeTime(), watchlist: logTypeWatchlist() };
    if (!(typeOn.price && typeOn.time && typeOn.watchlist)) {
      entries = entries.filter((/** @type {any} */ e) => { const a = alertOf(e); return a ? typeOn[alertType(a)] !== false : true; });
    }
    if (!entries.length) { body.appendChild(el('div', 'al-empty', total ? t('No log entries match the filter.') : t('No alert log yet.'))); return; }
    let lastDay = '';
    entries.forEach((/** @type {any} */ e) => {
      const a = alertOf(e);   // the crosslink: everything but time+price comes from the live alert
      const shifted = new Date(Number(e.at) + alertTzOffsetMin() * 60000);   // tz-shifted; strftime/fmtTime read UTC parts
      const dayKey = strftime(shifted, '%Y-%m-%d');
      if (dayKey !== lastDay) { lastDay = dayKey; body.appendChild(el('div', 'al-logday', strftime(shifted, '%B %-d').toUpperCase())); }
      const row = el('div', 'al-row');
      const col = el('div', 'al-col');
      const sym = e.symbol || (a && a.symbol) || '';   // a watchlist fire carries its own symbol; else the alert's
      if (logShowName()) col.appendChild(el('div', 'al-title', (a && a.name && String(a.name)) || sym || t('Alert')));
      if (logShowMessage() && a && a.message) col.appendChild(el('div', 'al-msg', String(a.message)));
      const time = fmtTime(shifted, alertHours24(), false);   // minute precision, matching fmtAlertTime
      col.appendChild(el('div', 'al-sub', sym ? (sym + (e.price != null ? ' @ ' + e.price : '')) + ' • ' + time : time));
      // trash: delete THIS log entry only -- the alert is untouched. Routes through the host (it owns the log).
      const ctrls = el('div', 'al-ctrls');
      const del = el('span', 'al-ctrl al-del', '🗑'); del.title = t('Remove log entry');
      del.onclick = (ev) => { ev.stopPropagation(); hideCard(); alertCommand('log-remove', { id: e.id }).catch(() => {}); };
      ctrls.append(del);
      row.append(col, ctrls);
      // crosslink: hover a log row to open the SAME card the Price tab shows for its alert (1s hold).
      if (a) {
        row.addEventListener('mouseenter', () => { hoverTimer = setTimeout(() => showCard(a, row), 1000); });
        row.addEventListener('mouseleave', hideCard);
      }
      body.appendChild(row);
    });
  };

  const render = () => {
    hideCard();
    body.innerHTML = '';
    if (tab === 'log') { renderLog(); return; }

    // Price + Time tabs both list rules from the store, split by `source` (a missing source = legacy price).
    const full = alertMirror().all().filter((/** @type {any} */ a) => (a.source || 'price') === (tab === 'time' ? 'time' : 'price'));
    let list = full;
    if (showFilter === 'active') list = list.filter((/** @type {any} */ a) => a.enabled);
    else if (showFilter === 'inactive') list = list.filter((/** @type {any} */ a) => !a.enabled);
    // symbol / interval scope: "current" resolves against the active chart, else the explicit pick.
    const active = getActivePane ? getActivePane() : null;
    const symWanted = curSym ? (active && active.symbol) : (bySym || null);
    const tfWanted = curTf ? (active && active.tfId) : (byTf || null);
    if (symWanted) list = list.filter((/** @type {any} */ a) => a.symbol === symWanted);
    if (tfWanted) list = list.filter((/** @type {any} */ a) => a.tf === tfWanted);
    const alerts = list.slice().sort(cmpOf(sortKey));
    body.appendChild(el('div', 'al-count', alerts.length + ' ' + (alerts.length === 1 ? t('alert') : t('alerts'))));
    if (!alerts.length) {
      const emptyMsg = tab === 'time'
        ? t('No time alerts yet.')
        : t('No alerts yet. Right-click a drawing → Create alert, or use the bell in the bottom bar.');
      const msg = full.length ? t('No alerts match the filter.') : emptyMsg;
      body.appendChild(el('div', 'al-empty', msg)); return;
    }

    alerts.forEach((/** @type {any} */ a) => {
      const row = el('div', 'al-row');

      const col = el('div', 'al-col');
      if (alertShowName()) col.appendChild(el('div', 'al-title', nameOf(a)));
      if (alertShowMessage() && a.message) col.appendChild(el('div', 'al-msg', String(a.message)));
      const sub = el('div', 'al-sub');
      const dot = el('span', 'al-dot' + (a.enabled ? ' on' : ''));
      const fa = firedAt(a);
      const showLT = alertShowLastTriggered() && fa;
      const line = descOf(a) + ' • ' + statusText(a) + (showLT ? ' • ' + fmtAlertTime(fa) : '');
      sub.append(dot, document.createTextNode(line));
      col.append(sub);

      // controls: play/pause + delete
      const ctrls = el('div', 'al-ctrls');
      const pp = el('span', 'al-ctrl', a.enabled ? '⏸' : '▶');
      pp.title = a.enabled ? t('Stop alert') : t('Start alert');
      pp.onclick = (e) => { e.stopPropagation(); alertCommand('toggle', { id: a.id }).catch(() => {}); };
      ctrls.append(pp);
      // The gear edits the alert: a time alert opens its own small dialog; a price alert the price dialog.
      const edit = el('span', 'al-ctrl', '⚙');
      edit.title = t('Edit alert');
      edit.onclick = (e) => { e.stopPropagation(); if (sourceOf(a) === 'time') openCreateTimeAlertDialog(a); else editAlert(a); };
      ctrls.append(edit);
      const del = el('span', 'al-ctrl al-del', '🗑');
      del.title = t('Remove alert');
      del.onclick = async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({ title: t('Delete this alert?'), message: t('This permanently deletes') + ` "${nameOf(a)}".`, yes: t('Delete'), no: t('Cancel') });
        if (!ok) return;
        removeAlertAndDrawing(a, getAllPanes());   // alert + its drawing are one unit (the shared cascade helper)
      };
      ctrls.append(del);

      row.append(col, ctrls);
      row.addEventListener('mouseenter', () => { hoverTimer = setTimeout(() => showCard(a, row), 1000); });
      row.addEventListener('mouseleave', hideCard);
      body.appendChild(row);
    });
  };

  // --- sort dropdown: a grouped menu (reuses the shared dwg-menu styling); pick a comparator, re-render ---
  /** @type {HTMLElement|null} */ let sortMenu = null;
  /** @type {((e: PointerEvent) => void)|null} */ let sortAway = null;
  const closeSortMenu = () => { if (sortAway) { document.removeEventListener('pointerdown', sortAway, true); sortAway = null; } if (sortMenu) { sortMenu.remove(); sortMenu = null; } };
  const openSortMenu = () => {
    closeSortMenu();
    const m = el('div', 'dwg-menu'); sortMenu = m;
    SORT_GROUPS.forEach((group, gi) => {
      if (gi) m.appendChild(el('div', 'dwg-div'));   // divider between groups
      group.forEach((o) => {
        const item = el('div', 'dwg-item' + (o.key === sortKey ? ' sel' : ''));
        item.append(el('span', 'dwg-check', o.key === sortKey ? '✓' : ''), el('span', 'dwg-label', (o.dir === 'asc' ? '↑' : '↓') + '  ' + t(o.label)));
        item.onclick = () => { sortKey = o.key; closeSortMenu(); render(); };
        m.appendChild(item);
      });
    });
    document.body.appendChild(m);
    const r = sortBtn.getBoundingClientRect();
    m.style.left = Math.max(6, r.right - m.offsetWidth) + 'px';   // right-align to the button (opens leftward from the rail)
    m.style.top = (r.bottom + 4) + 'px';
    sortAway = (e) => { if (sortMenu && !sortMenu.contains(/** @type {Node} */ (e.target)) && !sortBtn.contains(/** @type {Node} */ (e.target))) closeSortMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (sortAway), true), 0);
  };
  sortBtn.onclick = () => { if (sortMenu) closeSortMenu(); else openSortMenu(); };

  // --- more-actions dropdown: bulk operations over the whole list ------------------------------------
  // "Active" = enabled (the dot is on); "inactive" = the rest (paused or a spent Once-only). Each action
  // just gathers the matching alerts and dispatches per-alert commands -- the host is the only mutator.
  const inactiveAlerts = () => alertMirror().all().filter((/** @type {any} */ a) => !a.enabled);
  const activeAlerts = () => alertMirror().all().filter((/** @type {any} */ a) => a.enabled);
  // Restart: re-enable + clear the fired latch (restartPatch, the record's one home) so each re-arms fresh.
  const restartAllInactive = () => inactiveAlerts().forEach((a) => alertCommand('update', { id: a.id, patch: restartPatch() }).catch(() => {}));
  // Stop all: force every armed alert off (explicit enabled:false, not a flip).
  const stopAll = () => activeAlerts().forEach((a) => alertCommand('toggle', { id: a.id, enabled: false }).catch(() => {}));
  // Delete all inactive: destructive -> confirm once, then the shared alert+drawing cascade per alert.
  const deleteAllInactive = async () => {
    const list = inactiveAlerts();
    if (!list.length) return;
    const n = list.length + ' ' + (list.length === 1 ? t('alert') : t('alerts'));
    const ok = await confirmDialog({ title: t('Delete all inactive alerts?'), message: t('This permanently deletes') + ` ${n}.`, yes: t('Delete'), no: t('Cancel') });
    if (!ok) return;
    const panes = getAllPanes();
    list.forEach((a) => removeAlertAndDrawing(a, panes));   // alert + its drawing are one unit
  };

  /** @type {HTMLElement|null} */ let moreMenu = null;
  /** @type {((e: PointerEvent) => void)|null} */ let moreAway = null;
  const closeMoreMenu = () => { if (moreAway) { document.removeEventListener('pointerdown', moreAway, true); moreAway = null; } if (moreMenu) { moreMenu.remove(); moreMenu = null; } };
  let expandSym = false, expandTf = false;   // whether a By-symbol / By-interval picker is expanded inline
  const uniq = (/** @type {any[]} */ arr) => Array.from(new Set(arr.filter(Boolean)));
  const openMoreMenu = () => {
    closeMoreMenu();
    const m = el('div', 'dwg-menu'); moreMenu = m;
    const { item, check, combo, opt, pref } = menuRows(m, { render, rerender: () => build(), close: closeMoreMenu });
    /** a filter radio row: glyph + label + count on the right; picking it re-filters the list (menu stays open).
     * @param {string} key @param {string} label @param {number} count */
    const radio = (key, label, count) => {
      const it = el('div', 'dwg-item');
      it.append(el('span', 'dwg-check', showFilter === key ? '◉' : '○'), el('span', 'dwg-label', t(label)), el('span', 'dwg-arrow', String(count)));
      it.onclick = () => { showFilter = key; render(); build(); };
      m.appendChild(it);
    };
    const build = () => {
      m.innerHTML = '';
      const all = alertMirror().all(), activeN = all.filter((/** @type {any} */ a) => a.enabled).length, inactiveN = all.length - activeN;
      item('▶', 'Restart all inactive', inactiveN > 0, restartAllInactive);
      item('⏸', 'Stop all', activeN > 0, stopAll);
      item('🗑', 'Delete all inactive', inactiveN > 0, deleteAllInactive);
      m.appendChild(el('div', 'dwg-div'));
      m.appendChild(el('div', 'dwg-head', t('Show alerts')));
      radio('all', 'All', all.length);
      radio('active', 'Active only', activeN);
      radio('inactive', 'Inactive only', inactiveN);
      m.appendChild(el('div', 'dwg-div'));
      m.appendChild(el('div', 'dwg-head', t('Filter alerts')));
      // symbol axis: "Current symbol" checkbox + a "By symbol" custom dropdown (search input + present symbols).
      check(curSym, 'Current symbol', () => { curSym = !curSym; if (curSym) bySym = ''; });
      combo('By symbol', bySym, expandSym, () => { expandSym = !expandSym; if (expandSym) expandTf = false; build(); });
      if (expandSym) {
        const inp = /** @type {HTMLInputElement} */ (el('input', 'dwg-inp')); inp.placeholder = t('Search symbol…');
        inp.onclick = (e) => e.stopPropagation();
        const box = el('div', 'dwg-optbox');
        const renderSyms = () => {
          box.innerHTML = '';
          const q = inp.value.trim().toLowerCase();
          opt(t('Any symbol'), !bySym, () => { bySym = ''; render(); build(); }, box);
          uniq(all.map((/** @type {any} */ a) => a.symbol)).filter((/** @type {string} */ s) => !q || s.toLowerCase().includes(q)).sort()
            .forEach((/** @type {string} */ s) => opt(s, s === bySym, () => { bySym = s; curSym = false; render(); build(); }, box));
        };
        inp.oninput = renderSyms;
        m.append(inp, box); renderSyms();
        setTimeout(() => inp.focus(), 0);
      }
      // interval axis: "Current time interval" checkbox + a "By interval" dropdown of only the tfs present.
      check(curTf, 'Current time interval', () => { curTf = !curTf; if (curTf) byTf = ''; });
      combo('By interval', byTf, expandTf, () => { expandTf = !expandTf; if (expandTf) expandSym = false; build(); });
      if (expandTf) {
        opt(t('Any interval'), !byTf, () => { byTf = ''; render(); build(); });
        uniq(all.map((/** @type {any} */ a) => a.tf)).forEach((/** @type {string} */ tf) => opt(tf, tf === byTf, () => { byTf = tf; curTf = false; render(); build(); }));
      }
      // which columns each row shows -- persisted prefs; the 'alerts:display-changed' bus event re-renders the list.
      m.appendChild(el('div', 'dwg-div'));
      m.appendChild(el('div', 'dwg-head', t('Customize list')));
      pref('Name', alertShowName, 'showName');
      pref('Message', alertShowMessage, 'showMessage');
      pref('Last triggered', alertShowLastTriggered, 'showLastTriggered');
      m.appendChild(el('div', 'dwg-div'));
      const settings = el('div', 'dwg-item');
      settings.append(el('span', 'dwg-check', '⚙'), el('span', 'dwg-label', t('Alerts settings…')));
      settings.onclick = () => { closeMoreMenu(); openChartSettings('Alerts'); };
      m.appendChild(settings);
      place();
    };
    // right-align to the button, clamp on-screen (the menu grows/shrinks as pickers expand).
    const place = () => {
      if (!m.isConnected) return;
      const r = moreBtn.getBoundingClientRect();
      m.style.left = Math.max(6, r.right - m.offsetWidth) + 'px';
      m.style.top = Math.max(6, Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 6)) + 'px';
    };
    build();
    document.body.appendChild(m);
    place();
    moreAway = (e) => { if (moreMenu && !moreMenu.contains(/** @type {Node} */ (e.target)) && !moreBtn.contains(/** @type {Node} */ (e.target))) closeMoreMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (moreAway), true), 0);
  };
  // The Log tab's ⋯ menu: "Clear log" + a CUSTOMIZE LIST section (Name / Message toggles for the log rows).
  // The mailbox is host-owned, so clearing goes through the command funnel (log-clear) -- the window never
  // writes the store/log directly. Toggling a pref re-renders both the menu (checkbox) and the list (via bus).
  const openLogMenu = () => {
    closeMoreMenu();
    const m = el('div', 'dwg-menu'); moreMenu = m;
    const { check, combo, opt, pref } = menuRows(m, { render, rerender: () => build(), close: closeMoreMenu });
    const place = () => { if (!m.isConnected) return; const r = moreBtn.getBoundingClientRect(); m.style.left = Math.max(6, r.right - m.offsetWidth) + 'px'; m.style.top = (r.bottom + 4) + 'px'; };
    const build = () => {
      m.innerHTML = '';
      const has = alertLogMirror().size() > 0;
      const clr = el('div', 'dwg-item' + (has ? '' : ' disabled'));
      clr.append(el('span', 'dwg-check', '🗑'), el('span', 'dwg-label', t('Clear log')));
      if (has) clr.onclick = async () => {
        closeMoreMenu();
        const ok = await confirmDialog({ title: t('Clear the alert log?'), message: t('This permanently deletes all log entries.'), yes: t('Clear'), no: t('Cancel') });
        if (!ok) return;
        alertCommand('log-clear', {}).catch(() => {});
      };
      m.appendChild(clr);
      // --- FILTER ALERTS: the two-axis symbol/interval filter, matched against the entries' LINKED alerts ---
      const linked = alertLogMirror().recent().map((/** @type {any} */ e) => alertOf(e)).filter(Boolean);
      m.appendChild(el('div', 'dwg-div'));
      m.appendChild(el('div', 'dwg-head', t('Filter alerts')));
      check(logCurSym, 'Current symbol', () => { logCurSym = !logCurSym; if (logCurSym) logBySym = ''; });
      combo('By symbol', logBySym, logExpandSym, () => { logExpandSym = !logExpandSym; if (logExpandSym) logExpandTf = false; build(); });
      if (logExpandSym) {
        const inp = /** @type {HTMLInputElement} */ (el('input', 'dwg-inp')); inp.placeholder = t('Search symbol…');
        inp.onclick = (ev) => ev.stopPropagation();
        const box = el('div', 'dwg-optbox');
        const renderSyms = () => {
          box.innerHTML = '';
          const q = inp.value.trim().toLowerCase();
          opt(t('Any symbol'), !logBySym, () => { logBySym = ''; render(); build(); }, box);
          uniq(linked.map((/** @type {any} */ a) => a.symbol)).filter((/** @type {string} */ s) => !q || s.toLowerCase().includes(q)).sort()
            .forEach((/** @type {string} */ s) => opt(s, s === logBySym, () => { logBySym = s; logCurSym = false; render(); build(); }, box));
        };
        inp.oninput = renderSyms;
        m.append(inp, box); renderSyms();
        setTimeout(() => inp.focus(), 0);
      }
      check(logCurTf, 'Current time interval', () => { logCurTf = !logCurTf; if (logCurTf) logByTf = ''; });
      combo('By interval', logByTf, logExpandTf, () => { logExpandTf = !logExpandTf; if (logExpandTf) logExpandSym = false; build(); });
      if (logExpandTf) {
        opt(t('Any interval'), !logByTf, () => { logByTf = ''; render(); build(); });
        uniq(linked.map((/** @type {any} */ a) => a.tf)).forEach((/** @type {string} */ tf) => opt(tf, tf === logByTf, () => { logByTf = tf; logCurTf = false; render(); build(); }));
      }
      m.appendChild(el('div', 'dwg-div'));
      m.appendChild(el('div', 'dwg-head', t('Show events by type')));
      pref('Price', logTypePrice, 'logTypePrice');
      pref('Time', logTypeTime, 'logTypeTime');
      pref('Watchlist', logTypeWatchlist, 'logTypeWatchlist');
      m.appendChild(el('div', 'dwg-div'));
      m.appendChild(el('div', 'dwg-head', t('Customize list')));
      pref('Name', logShowName, 'logShowName');
      pref('Message', logShowMessage, 'logShowMessage');
      place();
    };
    build();
    document.body.appendChild(m);
    place();
    moreAway = (e) => { if (moreMenu && !moreMenu.contains(/** @type {Node} */ (e.target)) && !moreBtn.contains(/** @type {Node} */ (e.target))) closeMoreMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (moreAway), true), 0);
  };
  moreBtn.onclick = () => { if (moreMenu) { closeMoreMenu(); return; } if (tab === 'log') openLogMenu(); else openMoreMenu(); };

  const railIcon = themeIcon('/images/clock.png', 18);
  rp.addView({ id: 'alerts', icon: railIcon, title: t('Alerts'), content: panel, width: 300 });
  bus.on('rightpanel:shown', (id) => { if (id === 'alerts') render(); });
  bus.on('vocab:changed', () => { if (rp.isShown && rp.isShown('alerts')) render(); });   // live vocabulary switch
  bus.on('alerts:display-changed', () => { if (rp.isShown && rp.isShown('alerts')) render(); });   // date/time/tz pref change
  // live: re-render whenever the engine's alert store changes (create / toggle / remove / fire)
  alertMirror().subscribe(() => { if (rp.isShown && rp.isShown('alerts')) render(); });
  // The unseen-fires badge on the alert rail icon: count of Log entries newer than the last Log visit.
  const updateBadge = () => { const n = unseenCount(alertLogMirror().recent(), lastSeenLogAt()); rp.setRailBadge('alerts', n > 99 ? '99+' : n); };
  bus.on('alerts:log-seen', updateBadge);   // markLogSeen() (Log tab opened) -> badge re-derives to 0
  // live: re-render the Log tab as fires land in / clear from the mailbox; keep the badge in sync always. While the
  // Log tab is being viewed, a fresh fire is seen on arrival -- stamp it seen so the badge stays clear.
  alertLogMirror().subscribe(() => {
    const onLog = rp.isShown && rp.isShown('alerts') && tab === 'log';
    if (onLog) { markLogSeen(); render(); } else updateBadge();
  });
  updateBadge();
  render();
}
