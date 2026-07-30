// @ts-check
// Workspace Manager: a single dialog to CREATE a new workspace (name -> new tab with the default
// layout) or OPEN an existing one (loads its memory into the current tab). Opened by the tab-bar "+"
// button (bus 'workspaces:manage'). Autosave is always on -- there is no manual save. A workspace is
// the durable memory (settings/workspaces/<id>.json); a tab is just a viewport that loads one.
import { bus } from '../bus.js';
import { listWorkspaces, deleteWorkspace, renameWorkspace, copyWorkspace, readWorkspace } from './workspace-store.js';
import { openWorkspace, createWorkspaceTab, createSurfaceTab, getActiveWsId } from './tabs.js';
import { SURFACE_KINDS } from '../surface/index.js';
import { openStudyBoardBuilder } from './study-board-builder.js';
import { boardRowsFromWs } from './study-board.js';
import { themeIcon } from '../ui/icon.js';
import { namePrompt } from '../ui/name-prompt.js';
import { confirmDialog } from '../ui/confirm.js';

/** @param {string} tag @param {string=} cls @param {string=} txt @returns {HTMLElement} */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};
/** @param {number=} ms @returns {string} */
const fmtDate = (ms) => {
  try {
    return ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  } catch (_) {
    return '';
  }
};

// drag the dialog by a handle (its header). Switches the dialog to fixed positioning on first grab
// so it leaves the overlay's flex centering and follows the cursor.
/** @param {HTMLElement} dlg @param {HTMLElement} handle @returns {void} */
function dragByHandle(dlg, handle) {
  handle.style.cursor = 'move';
  handle.onpointerdown = (e) => {
    const et = /** @type {HTMLElement} */ (e.target);
    if (e.button !== 0 || (et.closest && et.closest('.lib-x'))) return; // not the close button
    const r = dlg.getBoundingClientRect();
    dlg.style.position = 'fixed';
    dlg.style.margin = '0';
    dlg.style.left = r.left + 'px';
    dlg.style.top = r.top + 'px';
    const ox = e.clientX - r.left,
      oy = e.clientY - r.top;
    const move = (/** @type {PointerEvent} */ ev) => {
      const x = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - ox));
      const y = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - oy));
      dlg.style.left = x + 'px';
      dlg.style.top = y + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (_) {}
  };
}

/** @type {HTMLElement|null} */
let overlay = null;
export function closeWorkspaceManager() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

export function initWorkspaceManager() {
  bus.on('workspaces:manage', openWorkspaceManager);
}

export async function openWorkspaceManager() {
  closeWorkspaceManager();
  overlay = el('div', 'modal open');
  overlay.style.zIndex = '90';
  const dlg = el('div', 'dialog ws-mgr');

  const head = el('div', 'set-head');
  const x = el('span', 'lib-x', '✕');
  head.append(el('span', 'set-title', 'Workspaces'), x);
  dlg.appendChild(head);

  const body = el('div', 'ws-mgr-body');

  // Create new
  const createBtn = el('button', 'primary ws-create');
  createBtn.textContent = '+  Create new workspace';
  createBtn.onclick = async () => {
    const existing = (await listWorkspaces()).map((w) => w.name);
    const name = await namePrompt({
      title: 'Create new workspace',
      label: 'Workspace name',
      placeholder: 'My workspace',
      save: 'Create',
      existing,
    });
    if (!name) return;
    await createWorkspaceTab(name);
    closeWorkspaceManager();
  };
  body.appendChild(createBtn);

  // Create a chart-less study board (opens the row builder)
  const createBoardBtn = el('button', 'ws-create ws-create-board');
  createBoardBtn.textContent = '+  Create study board';
  createBoardBtn.onclick = () => {
    closeWorkspaceManager();
    openStudyBoardBuilder();
  };
  body.appendChild(createBoardBtn);

  // Open a platform surface tab (Console / Orders / Positions / Accounts). Each is a live view of an app-wide
  // service and can be dragged out to its own window.
  const surfRow = el('div', 'ws-surface-row');
  surfRow.appendChild(el('span', 'ws-surface-lbl', 'Open panel'));
  SURFACE_KINDS.forEach(([kind, label]) => {
    const b = el('button', 'ws-surface-btn', label);
    b.onclick = async () => {
      closeWorkspaceManager();
      await createSurfaceTab(kind, label);
    };
    surfRow.appendChild(b);
  });
  body.appendChild(surfRow);

  const listWrap = el('div', 'ws-list');
  body.appendChild(listWrap);
  dlg.appendChild(body);
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  dragByHandle(dlg, head); // drag the dialog around by its header

  x.onclick = closeWorkspaceManager;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeWorkspaceManager();
  };
  document.addEventListener('keydown', escClose);

  await renderList(listWrap);
}

/** @param {KeyboardEvent} e @returns {void} */
function escClose(e) {
  if (e.key === 'Escape') {
    closeWorkspaceManager();
    document.removeEventListener('keydown', escClose);
  }
}

/** @param {HTMLElement} listWrap @returns {Promise<void>} */
async function renderList(listWrap) {
  const items = await listWorkspaces();
  items.sort((a, b) => (b.updatedMs || 0) - (a.updatedMs || 0));
  const activeId = getActiveWsId();
  listWrap.innerHTML = '';
  if (!items.length) {
    listWrap.appendChild(el('div', 'sd-placeholder', 'No workspaces yet — create one above.'));
    return;
  }
  /** @param {string} label @param {() => void} fn @returns {HTMLElement} */
  const actBtn = (label, fn) => {
    const b = el('button', 'ws-act', label);
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    return b;
  };
  items.forEach((w) => {
    const row = el('div', 'ws-row' + (w.id === activeId ? ' active' : ''));
    const icon = themeIcon(w.isBoard ? '/images/function.png' : '/images/candle.png', 18);
    icon.classList.add('ws-icon');
    icon.title = w.isBoard ? 'Study board' : 'Chart layout';
    row.appendChild(icon);
    const info = el('div', 'ws-row-info');
    const nm = el('div', 'ws-name', w.id === activeId ? (w.name || 'Untitled') + '   (open)' : w.name || 'Untitled');
    const meta = el('div', 'ws-meta', [w.summary, fmtDate(w.updatedMs)].filter(Boolean).join('  ·  '));
    info.append(nm, meta);
    row.appendChild(info);

    if (w.isBoard)
      row.appendChild(
        actBtn('Edit', async () => {
          // reopen the builder to edit rows + re-link
          const rec = await readWorkspace(w.id);
          if (!rec) return;
          openStudyBoardBuilder({
            wsId: w.id,
            name: rec.name || w.name,
            ws: rec.ws,
            rows: boardRowsFromWs(rec.ws),
            linkedTo: rec.ws && rec.ws.linkedTo,
            link: rec.ws && rec.ws.link,
          });
          closeWorkspaceManager();
        }),
      );
    row.appendChild(
      actBtn('Rename', async () => {
        const existing = items.map((i) => i.name).filter((n) => n !== w.name);
        const name = await namePrompt({
          title: 'Rename workspace',
          label: 'Workspace name',
          value: w.name || '',
          save: 'Rename',
          existing,
        });
        if (name) {
          await renameWorkspace(w.id, name);
          await renderList(listWrap);
        }
      }),
    );
    row.appendChild(
      actBtn('Copy', async () => {
        const name = await namePrompt({
          title: 'Copy workspace',
          label: 'New name',
          value: (w.name || 'Untitled') + ' copy',
          save: 'Copy',
        });
        if (name) {
          await copyWorkspace(w.id, name);
          await renderList(listWrap);
        }
      }),
    );
    row.appendChild(
      actBtn('Delete', async () => {
        const ok = await confirmDialog({
          title: 'Delete workspace',
          message: `Delete '${w.name || 'Untitled'}'? This can't be undone.`,
          yes: 'Delete',
        });
        if (ok) {
          await deleteWorkspace(w.id);
          await renderList(listWrap);
        }
      }),
    );

    row.onclick = async () => {
      await openWorkspace(w.id);
      closeWorkspaceManager();
    };
    listWrap.appendChild(row);
  });
}
