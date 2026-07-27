// @ts-check
// Watchlist NAMED LISTS -- multiple watchlists in one store document (palette-style):
// the header-dropdown menu to switch / create / rename / remove a list, and the list
// lifecycle (stop the old list's live data, swap items, start the new).
// Shared state lives in watchlist-state.js.
import { confirmDialog } from '../ui/confirm.js';
import { state, activeList, newListId, newId, persist, render } from './watchlist-state.js';
import { startAll, stopAll } from './watchlist-live.js';
import { openWatchlistAlertDialog } from '../alerts/create-alert-dialog.js';   // "Add alert on the list" -> a watchlist alert
import { getActivePane } from '../chart/layout.js';   // the active chart supplies the alert's interval/broker
import { t } from '../i18n/i18n.js';   // vocabulary lookup (list names stay user data)

/** @typedef {import('./watchlist-state.js').WatchList} WatchList */

/**
 * @param {string} tag
 * @param {(string|null)=} cls
 * @param {(string|null)=} txt
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

// bell glyph (plain SVG, currentColor so it follows the theme) -- the "Add alert on the list" action, matching
// the app's other create-alert affordances (quick-coords).
const SVG_BELL = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2a4 4 0 0 0-4 4c0 3-1.2 4.2-1.5 4.8a.4.4 0 0 0 .35.6h10.3a.4.4 0 0 0 .35-.6C13.2 10.2 12 9 12 6a4 4 0 0 0-4-4Z"/><path d="M6.6 13.4a1.5 1.5 0 0 0 2.8 0"/></svg>';

export function renderListBtn() { const L = activeList(); if (state.listBtnName) state.listBtnName.textContent = (L && L.name) || 'Watchlist'; }
// switch the active list: stop the old list's live data, swap items, start the new one.
/** @param {string} id */
function switchList(id) {
  if (id === state.activeId) return;
  const target = state.lists.find((l) => l.id === id); if (!target) return;
  stopAll();
  const cur = activeList(); if (cur) cur.items = state.items;   // flush any reassigned items back before swapping
  state.activeId = id; state.items = target.items;
  persist(); renderListBtn(); render(); startAll();
}
/** @param {string} [name] @returns {string} */
function createList(name) {
  stopAll();
  const cur = activeList(); if (cur) cur.items = state.items;
  const id = newListId();
  state.lists.push({ id, name: name || ('List ' + (state.lists.length + 1)), items: [] });
  state.activeId = id; state.items = state.lists[state.lists.length - 1].items;
  persist(); renderListBtn(); render(); startAll();
  return id;
}
/** @param {string} id */
function removeList(id) {
  const wasActive = id === state.activeId;
  if (wasActive) stopAll();
  state.lists = state.lists.filter((l) => l.id !== id);
  if (!state.lists.length) state.lists = [{ id: newListId(), name: 'Watchlist', items: [] }];
  if (wasActive) { state.activeId = state.lists[0].id; state.items = state.lists[0].items; render(); startAll(); }
  persist(); renderListBtn();
}
/** @param {string} id @param {string} name */
function renameList(id, name) { const l = state.lists.find((x) => x.id === id); if (l && name) { l.name = name; persist(); renderListBtn(); } }
// Duplicate a list: deep-copy its items (regenerating section ids so the copy owns its own), name it "<name> copy",
// and drop it right after the original. Does NOT switch the active list. Flush the active list's items first so a
// copy of the ACTIVE list captures the current (possibly reassigned) items, not a stale array.
/** @param {string} id */
function copyList(id) {
  const src = state.lists.find((l) => l.id === id); if (!src) return;
  const cur = activeList(); if (cur) cur.items = state.items;
  const items = (src.items || []).map((it) => it.type === 'section' ? { ...it, id: newId() } : { ...it });
  const idx = state.lists.findIndex((l) => l.id === id);
  state.lists.splice(idx + 1, 0, { id: newListId(), name: src.name + ' ' + t('copy'), items });
  persist(); renderListBtn();
}

// ---- list dropdown menu (mirrors the colour-palette selector) ----
/** @type {HTMLElement|null} */
let listMenu = null;
/** @type {((e: PointerEvent) => void)|null} */
let listMenuAway = null;
function closeListMenu() {
  if (listMenuAway) { document.removeEventListener('pointerdown', /** @type {any} */ (listMenuAway), true); listMenuAway = null; }
  if (listMenu) { listMenu.remove(); listMenu = null; }
}
/** @param {HTMLElement} anchor */
export function toggleListMenu(anchor) { if (listMenu) closeListMenu(); else openListMenu(anchor); }
/** @param {HTMLElement} anchor */
function openListMenu(anchor) {
  closeListMenu();
  const m = el('div', 'wl-listmenu'); listMenu = m;
  const rebuild = () => {
    m.innerHTML = '';
    state.lists.forEach((l) => {
      const r = el('div', 'wl-listmenu-row' + (l.id === state.activeId ? ' sel' : ''));
      const nm = el('span', 'wl-listmenu-name', l.name);
      nm.onclick = () => { switchList(l.id); closeListMenu(); };
      const al = el('button', 'wl-listmenu-edit wl-listmenu-alert'); al.innerHTML = SVG_BELL; al.title = t('Add alert on the list…');
      al.onclick = (e) => { e.stopPropagation(); closeListMenu(); openWatchlistAlertDialog({ id: l.id, name: l.name }, getActivePane()); };
      const ed = el('button', 'wl-listmenu-edit', '✎'); ed.title = t('Rename watchlist');
      ed.onclick = (e) => { e.stopPropagation(); startListRename(r, l, rebuild); };
      const cp = el('button', 'wl-listmenu-copy', '⧉'); cp.title = t('Copy watchlist');
      cp.onclick = (e) => { e.stopPropagation(); copyList(l.id); rebuild(); };
      const x = el('button', 'wl-listmenu-x', '×'); x.title = t('Remove watchlist');
      x.onclick = async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({ title: t('Delete this watchlist?'), message: t('Doing this will permanently delete your watchlist') + ` "${l.name}".`, yes: t('Delete'), no: t('Cancel') });
        if (!ok) return;
        removeList(l.id);
        if (listMenu === m) rebuild();   // rebuild only if the menu is still open (the dialog may have closed it)
      };
      r.append(nm, al, ed, cp, x);
      m.appendChild(r);
    });
    const addRow = el('div', 'wl-listmenu-row wl-listmenu-new');
    const inp = /** @type {HTMLInputElement} */ (el('input', 'wl-listmenu-input')); inp.placeholder = t('New list…');
    inp.onclick = (e) => e.stopPropagation();
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') { const v = inp.value.trim(); if (v) { createList(v); closeListMenu(); } }
      else if (e.key === 'Escape') closeListMenu();
    };
    addRow.appendChild(inp); m.appendChild(addRow);
  };
  rebuild();
  document.body.appendChild(m);
  const rc = anchor.getBoundingClientRect();
  m.style.left = rc.left + 'px'; m.style.top = (rc.bottom + 4) + 'px'; m.style.minWidth = rc.width + 'px';
  listMenuAway = (e) => { if (listMenu && !listMenu.contains(/** @type {Node} */ (e.target)) && !anchor.contains(/** @type {Node} */ (e.target))) closeListMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', /** @type {any} */ (listMenuAway), true), 0);
}
// Inline-rename a list row in place (the pencil): swap the row for an input; commit on Enter/blur, Escape
// cancels. `rebuild` re-renders the menu rows afterwards so it stays open showing the new name.
/** @param {HTMLElement} row @param {WatchList} l @param {() => void} rebuild */
function startListRename(row, l, rebuild) {
  row.innerHTML = '';
  const inp = /** @type {HTMLInputElement} */ (el('input', 'wl-listmenu-input')); inp.value = l.name;
  inp.onclick = (e) => e.stopPropagation();
  let done = false;
  /** @param {boolean} save */
  const finish = (save) => { if (done) return; done = true; if (save) renameList(l.id, inp.value.trim() || l.name); rebuild(); };
  inp.onkeydown = (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
  row.appendChild(inp); inp.focus(); inp.select();
}
