// @ts-check
// The Stats board editor: a gear-opened dialog with TWO positioned grids -- the inventory (everything not on
// the board, self-sizing) and the board (what the summary shows, bottom row first). Tiles drag between and
// within grids; a drop swaps or moves. Ported from the stats lab; the drag model and reconcile rules are the
// board's (stats-board.js). Every edit commits live: reconcile -> save -> the caller re-renders the summary.
import { reconcile, save, reset as boardReset, byKey, COLS } from './stats-board.js';
import { t } from '../i18n/i18n.js'; // vocabulary lookup

/** @typedef {import('./stats-board.js').Grids} Grids */

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

// Open the editor over the live `grids` (mutated in place so the caller's reference stays valid). getStats
// supplies the current stats for tile PREVIEW values (or null -> blank previews). onChange fires after every
// commit so the caller re-renders the live summary.
/** @param {Grids} grids @param {() => any} getStats @param {() => void} onChange */
export function openStatsEditor(grids, getStats, onChange) {
  const modal = el('stats-modal');
  const dlg = el('stats-dialog');
  dlg.appendChild(Object.assign(document.createElement('h3'), { textContent: t('Configure stats board') }));

  // General hint about the shared breakeven threshold (set in Trade Desk > Configure, not here)
  const hint1 = el('stats-hint', t('Drag tiles between the two grids and into any cell. Drop onto a slot to place or swap.'));

  // inventory section (self-sizing) + board section (bottom row first, capped rows, + row)
  const invSec = el('stats-sec');
  invSec.append(
    document.createTextNode(t('Inventory') + ' '),
    el('stats-subtle', t('(holds everything not on the board -- grows on its own)')),
  );
  const invEditor = el();
  const boardSec = el('stats-sec');
  boardSec.append(document.createTextNode(t('Board') + ' '), el('stats-subtle', t('(bottom row shows first)')));
  const addRowBtn = document.createElement('button');
  addRowBtn.className = 'stats-dbtn addrow';
  addRowBtn.textContent = t('+ row');
  addRowBtn.dataset.grid = 'board';
  boardSec.appendChild(addRowBtn);
  const boardEditor = el();

  // footer: reset + done
  const foot = el('stats-dfoot');
  const resetBtn = document.createElement('button');
  resetBtn.className = 'stats-dbtn';
  resetBtn.textContent = t('Reset to defaults');
  const doneBtn = document.createElement('button');
  doneBtn.className = 'stats-dbtn done';
  doneBtn.textContent = t('Done');
  foot.append(resetBtn, doneBtn);

  dlg.append(hint1, invSec, invEditor, boardSec, boardEditor, foot);
  modal.appendChild(dlg);
  document.body.appendChild(modal);

  // ---- render the two grids ----
  // one tile: value (preview from the current stats) + label; drag source carries its grid + cell coords.
  /** @param {string} key @param {string} which @param {number} r @param {number} c @returns {string} */
  const tileHTML = (key, which, r, c) => {
    const cat = byKey(key);
    if (!cat) return ''; // unknown key -> render nothing (never throw)
    const s = getStats();
    const g = s ? cat.get(s) : { text: '', cls: '' };
    return `<div class="stats-tile" draggable="true" data-key="${key}" data-grid="${which}" data-r="${r}" data-c="${c}"><b class="${g.cls || ''}">${g.text}</b><span>${t(cat.label)}</span></div>`;
  };
  // one renderer for both grids; `reverse` puts row 0 at the bottom (the board matches the live view).
  // `removable` = the board's per-row x; the inventory self-sizes, so it keeps the gutter empty (aligned).
  /** @param {string} which @param {HTMLElement} container @param {boolean} reverse @param {boolean} removable */
  const renderGrid = (which, container, reverse, removable) => {
    const rows = grids[/** @type {'board'|'inv'} */ (which)].map(
      (row, r) =>
        `<div class="stats-brow">${row
          .map(
            (k, c) =>
              `<div class="stats-slot" data-grid="${which}" data-r="${r}" data-c="${c}">${k ? tileHTML(k, which, r, c) : ''}</div>`,
          )
          .join('')}${removable ? `<button class="stats-rowx" data-grid="${which}" data-row="${r}" title="${t('remove row')}">✕</button>` : '<span></span>'}</div>`,
    );
    container.innerHTML = (reverse ? rows.reverse() : rows).join('');
  };
  const renderEditor = () => {
    renderGrid('inv', invEditor, false, false);
    renderGrid('board', boardEditor, true, true);
  };
  // every edit: keep each tile placed once + self-size the inventory, persist, re-render editor + live board
  const commit = () => {
    reconcile(grids);
    save(grids);
    renderEditor();
    onChange();
  };

  // ---- unified drag-and-drop across both grids ----
  /** @type {{ key: string, grid: string, r: number, c: number } | null} */
  let drag = null;
  modal.addEventListener('dragstart', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const tile = target.closest && target.closest('.stats-tile');
    if (!tile) return;
    const d = /** @type {HTMLElement} */ (tile).dataset;
    drag = { key: d.key || '', grid: d.grid || '', r: Number(d.r), c: Number(d.c) };
    tile.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  modal.addEventListener('dragend', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const tile = target.closest && target.closest('.stats-tile');
    if (tile) tile.classList.remove('dragging');
  });
  modal.addEventListener('dragover', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const z = target.closest && target.closest('.stats-slot');
    if (z) {
      e.preventDefault();
      z.classList.add('drop');
    }
  });
  modal.addEventListener('dragleave', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const z = target.closest && target.closest('.stats-slot');
    if (z) z.classList.remove('drop');
  });
  modal.addEventListener('drop', (e) => {
    if (!drag) return;
    const target = /** @type {HTMLElement} */ (e.target);
    const slot = /** @type {HTMLElement|null} */ (target.closest && target.closest('.stats-slot'));
    if (!slot) return;
    e.preventDefault();
    const dst = grids[/** @type {'board'|'inv'} */ (slot.dataset.grid || 'inv')];
    const src = grids[/** @type {'board'|'inv'} */ (drag.grid)];
    const r2 = Number(slot.dataset.r),
      c2 = Number(slot.dataset.c);
    const tmp = dst[r2][c2]; // swap works within a grid, across grids, and onto an empty cell (tmp = null = move)
    dst[r2][c2] = drag.key;
    src[drag.r][drag.c] = tmp;
    drag = null;
    commit();
  });

  // + row (board only, capped) and remove-row; a removed row's tiles fall back to the inventory (reconcile)
  modal.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const add = target.closest && target.closest('.addrow');
    if (add) {
      if (grids.board.length >= 3) return; // board caps at 3 rows -- enough for every stat we have
      grids.board.push(/** @type {(string|null)[]} */ (Array(COLS).fill(null)));
      commit();
      return;
    }
    const x = /** @type {HTMLElement|null} */ (target.closest && target.closest('.stats-rowx'));
    if (x) {
      grids[/** @type {'board'|'inv'} */ (x.dataset.grid || 'board')].splice(Number(x.dataset.row), 1);
      commit();
    }
  });

  const close = () => {
    try {
      modal.remove();
    } catch (_) {}
  };
  resetBtn.onclick = () => {
    const d = boardReset(); // clears the saved layout, returns the defaults
    grids.board = d.board;
    grids.inv = d.inv;
    commit(); // persists the defaults back + re-renders
  };
  doneBtn.onclick = close;
  modal.onclick = (e) => {
    if (e.target === modal) close();
  };

  renderEditor();
  modal.classList.add('open');
  return { close };
}
