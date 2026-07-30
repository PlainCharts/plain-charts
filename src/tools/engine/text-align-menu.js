// @ts-check
// Quick text-alignment popup: right-click a drawing's label (the "+ Add text" underlay)
// to get the 3x3 alignment grid right there, instead of opening the full settings dialog.
// Reuses the dialog's grid cell styling (set-align-grid / set-align-cell / set-align-bar).
import { getTool } from '../registry.js';

/** A drawing's text styling (color/size/weight + alignment). */
/** @typedef {{ color?: string, size?: number, bold?: boolean, italic?: boolean, vAlign?: string, hAlign?: string, orientation?: string }} TextStyle */
/** One drawing object, as this menu reads/writes it. */
/** @typedef {{ id: string, tool: string, textStyle?: TextStyle }} Drawing */

/** @type {Record<string, string>} */
const FLEX_V = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
/** @type {Record<string, string>} */
const FLEX_H = { left: 'flex-start', center: 'center', right: 'flex-end' };

/** @type {HTMLElement | null} */
let menu = null;
/** @type {((e: PointerEvent) => void) | null} */
let away = null;

export function closeTextAlignMenu() {
  if (away) {
    document.removeEventListener('pointerdown', away, true);
    away = null;
  }
  if (menu) {
    menu.remove();
    menu = null;
  }
}

/**
 * @param {any} engine   the pane's DrawingEngine (opaque handle; not typed here)
 * @param {string} id
 * @param {number} clientX
 * @param {number} clientY
 */
export function openTextAlignMenu(engine, id, clientX, clientY) {
  closeTextAlignMenu();
  const d = /** @type {Drawing | undefined} */ (engine.get(id));
  if (!d) return;
  // tool carries open, author-defined extras (textEnabled, settings.text, …) beyond the shared ToolDef
  const tool = /** @type {any} */ (getTool(d.tool));
  const cfg = tool && tool.settings && tool.settings.text;
  if (!cfg || (tool.textEnabled && !tool.textEnabled(d))) return;
  if (!d.textStyle) {
    const def = cfg.defaults || {};
    d.textStyle = {
      color: '#787b86',
      size: 14,
      bold: false,
      italic: false,
      vAlign: def.vAlign || 'middle',
      hAlign: def.hAlign || 'center',
    };
  }
  const ts = d.textStyle;
  /** @type {string[]} */
  const vKeys = (cfg.vAlign || []).map((/** @type {{ key: string }} */ o) => o.key);
  /** @type {string[]} */
  const hKeys = (cfg.hAlign || []).map((/** @type {{ key: string }} */ o) => o.key);

  const m = document.createElement('div');
  m.className = 'align-pop';
  menu = m;
  const grid = document.createElement('div');
  grid.className = 'set-align-grid';
  const render = () => {
    grid.innerHTML = '';
    ['top', 'middle', 'bottom'].forEach((v) =>
      ['left', 'center', 'right'].forEach((h) => {
        const cell = document.createElement('button');
        cell.className = 'set-align-cell';
        cell.type = 'button';
        cell.style.justifyContent = FLEX_H[h];
        cell.style.alignItems = FLEX_V[v];
        const bar = document.createElement('span');
        bar.className = 'set-align-bar';
        cell.appendChild(bar);
        if (!vKeys.includes(v) || !hKeys.includes(h)) {
          cell.classList.add('off');
          cell.disabled = true;
        } else {
          if (ts.vAlign === v && ts.hAlign === h) cell.classList.add('on');
          cell.onclick = (e) => {
            e.stopPropagation();
            ts.vAlign = v;
            ts.hAlign = h;
            render();
            engine.persist();
            engine.liveUpdate(d);
            closeTextAlignMenu();
          };
        }
        grid.appendChild(cell);
      }),
    );
  };
  render();
  m.appendChild(grid);
  document.body.appendChild(m);

  const mw = m.offsetWidth,
    mh = m.offsetHeight;
  m.style.left = Math.min(clientX, window.innerWidth - mw - 8) + 'px';
  m.style.top = Math.min(clientY, window.innerHeight - mh - 8) + 'px';
  away = (e) => {
    if (menu && !menu.contains(/** @type {Node | null} */ (e.target))) closeTextAlignMenu();
  };
  setTimeout(() => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (away), true), 0);
}
