// @ts-check
// Top-bar workspace dropdown. Shows the ACTIVE workspace's name; clicking it opens a list-only
// dropdown of all workspaces. Picking one LOADS IT INTO THE CURRENT TAB (a tab is just a viewport --
// the same tab can show a different workspace). A workspace already open in another tab is shown
// disabled (hard stop -- can't open a second copy; would create sync conflicts). Creating new tabs /
// new workspaces is the "+" button (Workspace Manager); this dropdown never makes tabs.
//
// Export names kept (initSavedLayouts / loadLayouts) so main.js is unchanged. layouts.json is retired.
import { bus } from '../bus.js';
import { $ } from '../dom.js';
import { getActiveWorkspaceName, getActiveWsId, openWsIds, loadWorkspaceHere } from './tabs.js';
import { listWorkspaces } from './workspace-store.js';

/** @returns {Promise<void>} */
export const loadLayouts = async () => {}; // no-op: layouts.json is superseded by the workspace store

/** @type {HTMLElement|null} */ let btn;
/** @type {HTMLElement|null} */ let menu;
/** @type {HTMLElement|null} */ let nameEl;

export function initSavedLayouts() {
  nameEl = $('layoutName');
  btn = $('btnSaved');
  menu = $('savedMenu');
  if (!btn) return;
  btn.title = 'Workspaces';
  const update = () => {
    if (nameEl) nameEl.textContent = getActiveWorkspaceName();
  };
  bus.on('workspace:active', update); // tabs.js emits this on any active-tab change / rename
  update();
  btn.onclick = (e) => {
    e.stopPropagation();
    menu && menu.classList.contains('open') ? close() : open();
  };
  document.addEventListener('click', (e) => {
    const t = /** @type {Node} */ (e.target);
    if (menu && !menu.contains(t) && !(/** @type {HTMLElement} */ (btn).contains(t))) close();
  });
}

function close() {
  if (menu) menu.classList.remove('open');
}

async function open() {
  if (!menu) return;
  const items = (await listWorkspaces()).sort((a, b) => (b.updatedMs || 0) - (a.updatedMs || 0));
  const activeWs = getActiveWsId();
  const openSet = new Set(openWsIds());

  menu.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'menu-header';
  h.textContent = 'WORKSPACES';
  menu.appendChild(h);
  if (!items.length) {
    const e = document.createElement('div');
    e.className = 'menu-empty';
    e.textContent = 'No workspaces yet — use + to create one.';
    menu.appendChild(e);
  }
  items.forEach((w) => {
    const isCurrent = w.id === activeWs;
    const openElsewhere = !isCurrent && openSet.has(w.id);
    const row = document.createElement('div');
    row.className = 'saved-row' + (isCurrent ? ' active' : '') + (openElsewhere ? ' ws-disabled' : '');
    const info = document.createElement('div');
    info.className = 'saved-info';
    const nm = document.createElement('div');
    nm.className = 'saved-name';
    nm.textContent = (w.name || 'Untitled') + (isCurrent ? '   (current)' : openElsewhere ? '   (open)' : '');
    const sub = document.createElement('div');
    sub.className = 'saved-sub';
    sub.textContent = w.summary || '';
    info.append(nm, sub);
    row.appendChild(info);
    row.onclick = () => {
      if (isCurrent || openElsewhere) return;
      loadWorkspaceHere(w.id);
      close();
    };
    /** @type {HTMLElement} */ (menu).appendChild(row);
  });

  const r = /** @type {HTMLElement} */ (btn).getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - 280) + 'px';
  menu.style.top = r.bottom + 4 + 'px';
  menu.classList.add('open');
}
