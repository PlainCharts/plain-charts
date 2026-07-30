// @ts-check
// The picker's PALETTE panel -- the palette manager as one unit: the selector button + its switch/create/
// remove menu, the swatch grid with its three click modes (pick / one-shot remove / favorite), the active
// add-row radio, and the "+" that opens the colour creator (Add lands in the selected row). All palette CRUD
// goes through palettes-store; the host picker only supplies pickHex (apply a colour) and currentHex (for
// the selected-swatch outline).
import {
  paletteList,
  activePaletteId,
  getPalette,
  paletteRows,
  paletteFlat,
  setActivePalette,
  createPalette,
  removePalette,
  addColorToPalette,
  addRowToPalette,
  removeColorFromPalette,
  isFavorite,
  toggleFavorite,
} from './palettes-store.js';
import { openCustomCreator } from './color-creator.js';
import { sameHex } from './color-math.js';

/** @param {string} tag @param {string|null} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/**
 * Build the palette panel into `body`.
 * @param {HTMLElement} body the picker's scrollable body
 * @param {{ pickHex: (col: string) => void, currentHex: () => string }} host
 * @returns {{ refreshSel: () => void, closeMenu: () => void }}
 */
export function buildPalettePanel(body, host) {
  let activeSel = activePaletteId();
  if (!getPalette(activeSel)) activeSel = (paletteList()[0] && paletteList()[0].id) || null;

  // one-shot remove mode for palette COLOURS (armed by the grid's "x" button, below).
  let removeMode = false;
  // favorite-toggle mode (armed by the star button): clicking swatches stars/unstars them; stays on.
  let favMode = false;
  // the row that added colours land in (a per-row radio selects it); null -> the last row (see renderGrid).
  /** @type {number|null} */
  let activeRow = null;

  // Palette selector: a button showing the current palette. Clicking it opens a menu to switch palette,
  // create a new one (type a name), or remove one (the "x" on each row) -- richer than a native dropdown.
  const head = document.createElement('div');
  head.className = 'cp-palhead';
  const palBtn = document.createElement('button');
  palBtn.type = 'button';
  palBtn.className = 'cp-palbtn';
  const palName = el('span', 'cp-palbtn-t');
  palBtn.append(palName, el('span', 'cp-palbtn-caret', '▾'));
  head.appendChild(palBtn);
  body.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'cp-grid';
  body.appendChild(grid);

  /** @param {string|null} id @returns {string} */
  const nameOf = (id) =>
    (getPalette(id) && /** @type {import('./palettes-store.js').Palette} */ (getPalette(id)).name) || 'No palette';
  const refreshBtn = () => {
    palName.textContent = nameOf(activeSel);
  };
  // outline the swatch matching the picker's current colour
  const refreshSel = () =>
    grid
      .querySelectorAll('.cp-sw')
      .forEach((/** @type {any} */ b) =>
        b.classList.toggle('sel', /** @type {boolean} */ (b.dataset.c && sameHex(b.dataset.c, host.currentHex()))),
      );

  /** @type {any} */
  let menu = null;
  const closeMenu = () => {
    if (!menu) return;
    document.removeEventListener('pointerdown', menu._out, true);
    menu.remove();
    menu = null;
  };
  /** @param {string} id */
  const selectPalette = (id) => {
    removeMode = false;
    activeRow = null;
    activeSel = id;
    setActivePalette(id);
    refreshBtn();
    renderGrid();
    closeMenu();
  };
  const openPaletteMenu = () => {
    closeMenu();
    menu = el('div', 'cp-palmenu');
    const rebuild = () => {
      menu.innerHTML = '';
      /** @param {string} id @param {boolean} removable */
      const row = (id, removable) => {
        const r = el('div', 'cp-palmenu-row' + (id === activeSel ? ' sel' : ''));
        const nm = el('span', 'cp-palmenu-name', nameOf(id));
        nm.onclick = () => selectPalette(id);
        r.appendChild(nm);
        if (removable) {
          // "x" removes the whole palette; falls back to another (or Standard) if it was active
          const x = document.createElement('button');
          x.type = 'button';
          x.className = 'cp-palmenu-x';
          x.textContent = '×';
          x.title = 'Remove palette';
          x.onclick = (e) => {
            e.stopPropagation();
            removePalette(id);
            if (activeSel === id) activeSel = (paletteList()[0] && paletteList()[0].id) || null;
            refreshBtn();
            rebuild();
            renderGrid();
          };
          r.appendChild(x);
        }
        menu.appendChild(r);
      };
      paletteList().forEach((p) => row(p.id, true));
      const addRow = el('div', 'cp-palmenu-row cp-palmenu-new');
      const inp = /** @type {HTMLInputElement} */ (el('input', 'cp-palmenu-input'));
      inp.placeholder = 'New palette…';
      inp.onclick = (e) => e.stopPropagation();
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const v = inp.value.trim();
          if (v) selectPalette(createPalette(v).id);
        }
      };
      addRow.appendChild(inp);
      menu.appendChild(addRow);
    };
    rebuild();
    /** @type {HTMLElement} */ (body.parentElement || body).appendChild(menu);
    const rc = palBtn.getBoundingClientRect();
    menu.style.left = rc.left + 'px';
    menu.style.top = rc.bottom + 4 + 'px';
    menu.style.minWidth = rc.width + 'px';
    menu._out = (/** @type {PointerEvent} */ e) => {
      if (menu && !menu.contains(e.target) && !palBtn.contains(/** @type {Node} */ (e.target))) closeMenu();
    };
    setTimeout(() => document.addEventListener('pointerdown', menu._out, true), 0);
  };
  palBtn.onclick = () => {
    if (menu) closeMenu();
    else openPaletteMenu();
  };

  // Add targets the active palette; if none exists (user removed them all), create "My Colors" first.
  const ensureUserPalette = () => {
    if (getPalette(activeSel)) return activeSel;
    const first = paletteList()[0];
    const id = first ? first.id : createPalette('My Colors').id;
    activeSel = id;
    setActivePalette(id);
    return id;
  };
  /** @param {HTMLElement} btn */
  const openCreator = (btn) =>
    openCustomCreator(btn, host.currentHex(), {
      onPick: (/** @type {string} */ v) => host.pickHex(v),
      onAdd: (/** @type {string} */ v) => {
        const id = ensureUserPalette();
        activeRow = addColorToPalette(/** @type {string} */ (id), v, activeRow);
        refreshBtn();
        renderGrid();
      },
    });

  /** @param {string} col @param {boolean} removable */
  const swatch = (col, removable) => {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'cp-sw' + (isFavorite(col) ? ' fav' : '');
    s.style.background = col;
    s.dataset.c = col;
    if (removable && removeMode) {
      s.title = 'Click to remove ' + col;
      s.onclick = () => {
        removeColorFromPalette(/** @type {string} */ (activeSel), col);
        removeMode = false;
        renderGrid();
      };
    } else if (removable && favMode) {
      s.title = (isFavorite(col) ? 'Click to unfavorite ' : 'Click to favorite ') + col;
      s.onclick = () => {
        toggleFavorite(col);
        renderGrid();
      }; // stays in favorite mode -- star/unstar several
    } else {
      s.title = col + (removable ? '  (right-click to remove)' : '');
      s.onclick = () => host.pickHex(col);
      if (removable)
        s.oncontextmenu = (e) => {
          e.preventDefault();
          removeColorFromPalette(/** @type {string} */ (activeSel), col);
          renderGrid();
        };
    }
    return s;
  };
  function renderGrid() {
    // a palette is rows of colours; a controls row holds "+", "new row" and "x"
    grid.innerHTML = '';
    const rows = paletteRows(activeSel);
    const flat = paletteFlat(activeSel);
    if (activeRow == null || activeRow < 0 || activeRow >= rows.length) activeRow = rows.length - 1; // clamp -> last row
    const wrap = document.createElement('div');
    wrap.className = 'cp-palgrid' + (removeMode ? ' cp-removing' : '') + (favMode ? ' cp-favoriting' : '');
    rows.forEach((row, i) => {
      const rEl = document.createElement('div');
      rEl.className = 'cp-palrow';
      // radio selects which row added colours land in (only one at a time); shown on every row so the
      // active target is always visible, even with a single row.
      const radio = document.createElement('button');
      radio.type = 'button';
      radio.className = 'cp-palradio' + (i === activeRow ? ' on' : '');
      radio.title = 'Add new colours to this row';
      radio.onclick = () => {
        activeRow = i;
        renderGrid();
      };
      rEl.appendChild(radio);
      row.forEach((col) => rEl.appendChild(swatch(col, true)));
      wrap.appendChild(rEl);
    });
    const ctl = document.createElement('div');
    ctl.className = 'cp-palctl';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'cp-add';
    add.textContent = '+';
    add.title = 'Pick a colour (Add saves it to the selected row)';
    add.onclick = () => {
      removeMode = false;
      favMode = false;
      openCreator(add);
    };
    ctl.appendChild(add);
    if (flat.length) {
      // "new row" starts a fresh row and selects it (added colours land there) -- like Enter
      const nl = document.createElement('button');
      nl.type = 'button';
      nl.className = 'cp-newrow';
      nl.textContent = '↵';
      nl.title = 'New row (start the next colour on a new line)';
      nl.onclick = () => {
        removeMode = false;
        favMode = false;
        addRowToPalette(/** @type {string} */ (activeSel));
        activeRow = paletteRows(activeSel).length - 1;
        renderGrid();
      };
      ctl.appendChild(nl);
      // star arms favorite mode: click swatches to star/unstar them (they get a yellow outline)
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'cp-fav' + (favMode ? ' active' : '');
      star.textContent = '★';
      star.title = favMode ? 'Done favoriting' : 'Favorite colours (then click the ones to star/unstar)';
      star.onclick = () => {
        favMode = !favMode;
        removeMode = false;
        renderGrid();
      };
      ctl.appendChild(star);
      // "x" arms one-shot remove: hover highlights a swatch, click it to delete
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'cp-del' + (removeMode ? ' active' : '');
      del.textContent = '×';
      del.title = removeMode ? 'Cancel remove' : 'Remove a colour (then click the one to delete)';
      del.onclick = () => {
        removeMode = !removeMode;
        favMode = false;
        renderGrid();
      };
      ctl.appendChild(del);
    } else {
      removeMode = false;
      favMode = false;
    }
    wrap.appendChild(ctl);
    grid.appendChild(wrap);
    refreshSel();
  }
  refreshBtn();
  renderGrid();

  return { refreshSel, closeMenu };
}
