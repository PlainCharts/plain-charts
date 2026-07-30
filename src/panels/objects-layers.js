// @ts-check
// Object Manager layer tabs -- the left-edge column of tabs, one per layer of the active
// chart (click switches the active layer, right-click renames / hides / locks / removes,
// "+" adds, and a drag-selection dropped on another tab moves into that layer).
// Shared state lives in objects-state.js.
import { themeIcon } from '../ui/icon.js';
import { state, render } from './objects-state.js';
import { startRename, renameInput } from './objects-actions.js';
import { dropOntoLayer } from './objects-dnd.js';
import { menu } from './objects-menus.js';

/** @typedef {any} Engine */

/**
 * @param {string} tag
 * @param {(string|null)=} cls
 * @param {(string|null)=} txt
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

// count the drawings inside a layer (for the remove-confirm)
/** @param {any} ly */
function layerDrawingCount(ly) {
  let n = 0;
  (
    /** @param {any[]} nodes */ function c(nodes) {
      (nodes || []).forEach((/** @type {any} */ x) => {
        if (x.type === 'folder') c(x.children);
        else n++;
      });
    }
  )(ly.nodes);
  return n;
}

// right-click a layer tab: rename / hide / lock / remove
/** @param {Engine} e @param {any} ly @param {number} x @param {number} y */
function openLayerMenu(e, ly, x, y) {
  menu(x, y, (m, item) => {
    m.appendChild(item('Rename', () => startRename(ly.id)));
    m.appendChild(
      item(ly.hidden ? 'Show layer' : 'Hide layer', () => {
        e.setLayerFlag(ly.id, 'hidden', !ly.hidden);
        render();
      }),
    );
    m.appendChild(
      item(ly.locked ? 'Unlock layer' : 'Lock layer', () => {
        e.setLayerFlag(ly.id, 'locked', !ly.locked);
        render();
      }),
    );
    if (e.layers().list.length > 1) {
      m.appendChild(el('div', 'dwg-div'));
      m.appendChild(
        item('Remove layer & drawings', () => {
          const n = layerDrawingCount(ly);
          if (
            n &&
            !confirm(
              'Remove layer "' + (ly.name || 'Layer') + '" and its ' + n + ' drawing' + (n === 1 ? '' : 's') + '?',
            )
          )
            return;
          e.removeLayer(ly.id);
          render();
        }),
      );
    }
  });
}

// left-edge tabs, one per layer of the active chart. Click switches the active layer (new drawings land
// there); each tab hides/locks the WHOLE layer (own flag) and can be renamed / removed. "+" adds a layer.
/** @param {Engine} e */
export function buildLayerTabs(e) {
  const L = e.layers();
  const col = el('div', 'obj-ltabs');
  L.list.forEach((/** @type {any} */ ly) => {
    const renaming = ly.id === state.renamingId;
    const tab = el(
      'div',
      'obj-ltab' +
        (renaming ? ' renaming' : '') +
        (ly.id === L.active ? ' active' : '') +
        (ly.hidden ? ' hidden' : '') +
        (ly.locked ? ' locked' : ''),
    );
    if (renaming) {
      const inp = renameInput(ly.id, ly.name || 'Layer', (v) => e.renameLayer(ly.id, v || 'Layer'));
      tab.appendChild(inp);
      state.pendingFocus = inp;
    } else {
      // STATE indicator (not an action -- controls live in the right-click menu): hidden takes priority over
      // locked (a hidden layer's lock is moot), so both -> just the hidden icon.
      if (ly.hidden || ly.locked) {
        const st = el('span', 'obj-ltab-state');
        st.title = ly.hidden ? 'Hidden' : 'Locked';
        st.appendChild(themeIcon(ly.hidden ? '/images/invisible.png' : '/images/lock.png', 13));
        tab.appendChild(st);
      }
      tab.appendChild(el('span', 'obj-ltab-name', ly.name || 'Layer'));
      tab.title =
        (ly.name || 'Layer') + ' — click to switch, right-click for options, drop drawings here to move them in';
      tab.onclick = () => {
        e.setActiveLayer(ly.id);
        render();
      };
      tab.ondblclick = (ev) => {
        ev.stopPropagation();
        startRename(ly.id);
      };
      tab.oncontextmenu = (ev) => {
        ev.preventDefault();
        openLayerMenu(e, ly, ev.clientX, ev.clientY);
      };
      // drop a drag-selection of drawings/folders onto another layer's tab -> move them into that layer.
      // Only from the same surface, and only onto a DIFFERENT layer (the active one is where they already are).
      const canDrop = () => state.dragId && state.dragEngine === e && ly.id !== L.active;
      tab.ondragover = (ev) => {
        if (!canDrop()) return;
        ev.preventDefault();
        /** @type {DataTransfer} */ (ev.dataTransfer).dropEffect = 'move';
        tab.classList.add('drop-layer');
      };
      tab.ondragleave = () => tab.classList.remove('drop-layer');
      tab.ondrop = (ev) => {
        if (!canDrop()) return;
        ev.preventDefault();
        ev.stopPropagation();
        tab.classList.remove('drop-layer');
        dropOntoLayer(e, ly.id);
      };
    }
    col.appendChild(tab);
  });
  const add = el('button', 'obj-ltab-add');
  add.textContent = '+';
  add.title = 'New layer';
  add.onclick = () => {
    const ly = e.addLayer();
    startRename(ly.id);
  };
  col.appendChild(add);
  return col;
}
