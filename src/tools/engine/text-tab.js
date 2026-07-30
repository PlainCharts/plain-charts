// @ts-check
// The settings dialog's Text tab: label textarea + font row (color/size/bold/italic), the 3×3
// alignment position grid (only cells the tool supports are enabled), and the optional orientation
// select — all declared by the shape via tool.settings.text. Edits write d.text / d.textStyle and
// call the dialog's preview(); the dialog owns snapshot/OK/Cancel.
import { getTool } from '../registry.js';
import { colorSwatch } from '../../ui/colorpicker.js';

/** A drawing's text styling (color/size/weight + alignment + orientation). */
/** @typedef {{ color?: string, size?: number, bold?: boolean, italic?: boolean, vAlign?: string, hAlign?: string, orientation?: string }} TextStyle */
/** @typedef {{ id: string, tool: string, text?: string, textStyle?: TextStyle }} Drawing */

/**
 * @param {string} tag @param {string | null} [cls] @param {string} [txt]
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/** @param {HTMLElement} body @param {Drawing} d @param {() => void} preview */
export function renderTextTab(body, d, preview) {
  const tool = /** @type {any} */ (getTool(d.tool));
  const cfg = tool.settings && tool.settings.text;
  if (!cfg) {
    body.appendChild(el('div', 'set-soon', 'No text options for this tool.'));
    return;
  }
  if (!d.textStyle) {
    const def = cfg.defaults || {}; // per-tool default alignment
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
  const up = () => preview();

  const row1 = el('div', 'set-text-row');
  row1.appendChild(
    colorSwatch(ts.color, (/** @type {any} */ v) => {
      ts.color = v;
      up();
    }),
  );
  const size = /** @type {HTMLSelectElement} */ (el('select', 'set-fontsize'));
  [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40].forEach((s) => {
    const o = /** @type {HTMLOptionElement} */ (el('option', null, String(s)));
    o.value = /** @type {any} */ (s);
    size.appendChild(o);
  });
  size.value = /** @type {any} */ (ts.size || 14);
  size.onchange = () => {
    ts.size = parseInt(size.value, 10);
    up();
  };
  row1.appendChild(size);
  const bold = /** @type {HTMLButtonElement} */ (el('button', 'set-tbtn' + (ts.bold ? ' on' : '')));
  bold.type = 'button';
  bold.textContent = 'B';
  bold.style.fontWeight = '700';
  bold.onclick = () => {
    ts.bold = !ts.bold;
    bold.classList.toggle('on', ts.bold);
    up();
  };
  const ital = /** @type {HTMLButtonElement} */ (el('button', 'set-tbtn' + (ts.italic ? ' on' : '')));
  ital.type = 'button';
  ital.textContent = 'I';
  ital.style.fontStyle = 'italic';
  ital.onclick = () => {
    ts.italic = !ts.italic;
    ital.classList.toggle('on', ts.italic);
    up();
  };
  row1.append(bold, ital);
  body.appendChild(row1);

  const ta = /** @type {HTMLTextAreaElement} */ (el('textarea', 'set-text-area'));
  ta.value = d.text || '';
  ta.placeholder = 'Text…';
  ta.oninput = () => {
    d.text = ta.value;
    up();
  };
  body.appendChild(ta);

  /** @param {any[]} opts @param {any} val @param {(v: any) => void} onset */
  const sel = (opts, val, onset) => {
    const s = /** @type {HTMLSelectElement} */ (el('select'));
    (opts || []).forEach((/** @type {any} */ o) => {
      const op = /** @type {HTMLOptionElement} */ (el('option', null, o.name));
      op.value = o.key;
      s.appendChild(op);
    });
    s.value = val;
    s.onchange = () => onset(s.value);
    return s;
  };

  // Text alignment as a 3×3 position grid: each cell sets vAlign + hAlign together,
  // with a little bar showing where the text sits. Only cells the tool actually
  // supports (both its vAlign and hAlign keys) are enabled.
  const ar = el('div', 'set-align-row set-align-grid-row');
  ar.appendChild(el('label', null, 'Text alignment'));
  /** @type {string[]} */
  const vKeys = (cfg.vAlign || []).map((/** @type {any} */ o) => o.key);
  /** @type {string[]} */
  const hKeys = (cfg.hAlign || []).map((/** @type {any} */ o) => o.key);
  /** @param {any[]} opts @param {string} k */
  const nameOf = (opts, k) => {
    const o = (opts || []).find((/** @type {any} */ x) => x.key === k);
    return o ? o.name : k;
  };
  /** @type {Record<string, string>} */
  const FLEX_V = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
  /** @type {Record<string, string>} */
  const FLEX_H = { left: 'flex-start', center: 'center', right: 'flex-end' };
  const grid = el('div', 'set-align-grid');
  const renderGrid = () => {
    grid.innerHTML = '';
    ['top', 'middle', 'bottom'].forEach((v) =>
      ['left', 'center', 'right'].forEach((h) => {
        const cell = /** @type {HTMLButtonElement} */ (el('button', 'set-align-cell'));
        cell.type = 'button';
        cell.style.justifyContent = FLEX_H[h];
        cell.style.alignItems = FLEX_V[v];
        cell.appendChild(el('span', 'set-align-bar'));
        if (!vKeys.includes(v) || !hKeys.includes(h)) {
          cell.classList.add('off');
          cell.disabled = true;
        } else {
          cell.title = nameOf(cfg.vAlign, v) + ' / ' + nameOf(cfg.hAlign, h);
          if (ts.vAlign === v && ts.hAlign === h) cell.classList.add('on');
          cell.onclick = () => {
            ts.vAlign = v;
            ts.hAlign = h;
            renderGrid();
            up();
          };
        }
        grid.appendChild(cell);
      }),
    );
  };
  renderGrid();
  ar.appendChild(grid);
  body.appendChild(ar);

  if (cfg.orientation) {
    const orow = el('div', 'set-align-row');
    orow.appendChild(el('label', null, 'Text orientation'));
    const ov = ts.orientation != null ? ts.orientation : cfg.orientationDefault || cfg.orientation[0].key;
    orow.appendChild(
      sel(cfg.orientation, ov, (/** @type {any} */ v) => {
        ts.orientation = v;
        up();
      }),
    );
    body.appendChild(orow);
  }
}
