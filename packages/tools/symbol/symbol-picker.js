// @ts-check
// Symbol picker — the glyph palette for the Symbol tool. When the
// Symbol tool is activated it opens a scrollable popup of Unicode glyphs grouped into
// sections (Recently Used pinned on top). Picking a glyph stores it as the tool's
// default (tool-defaults) so the next chart click drops it, then closes the palette.
//
// All glyphs are drawn with fillText, so they take the style colour. We force TEXT
// presentation (variation selector U+FE0E) on every glyph so emoji-default characters
// render monochrome and stay recolourable — see renderGlyph().
import { bus } from '../../../src/bus.js';
import { getTool } from '../../../src/tools/registry.js';
import { getActiveTool, setActiveTool } from '../../../src/tools/controller.js';
import { getToolDefaults, saveToolDefaults } from '../../../src/tools/tool-defaults.js';

export const DEFAULT_GLYPH = '★';   // ★
// force text (non-emoji) presentation so the glyph is monochrome + recolourable
/** @param {string} [g] */
export const renderGlyph = (g) => (g || DEFAULT_GLYPH) + '︎';

// curated, monochrome-capable Unicode glyphs (have text glyphs in common system fonts)
const CATEGORIES = [
  { name: 'Shapes', glyphs: ['●', '○', '◉', '◍', '◆', '◇', '■', '□', '▪', '▫', '▲', '△', '▼', '▽', '◀', '▶', '◈', '⬟'] },
  { name: 'Stars & marks', glyphs: ['★', '☆', '✦', '✧', '✱', '✳', '❉', '✓', '✔', '✗', '✘', '☑', '☒', '☐', '⊕', '⊖', '⊗', '⊛'] },
  { name: 'Arrows', glyphs: ['←', '→', '↑', '↓', '↔', '↕', '↖', '↗', '↘', '↙', '⇐', '⇒', '⇑', '⇓', '➤', '➔', '➜', '⟶'] },
  { name: 'Flags & alerts', glyphs: ['⚑', '⚐', '⌖', '⚠', '‼', '⁇', '!', '?', '¡', '¿', '★', 'ⓘ'] },
  { name: 'Currency', glyphs: ['€', '£', '$', '¢', '¥', '₹', '₽', '₩', '₪', '₺', '₴', '฿', '₿'] },
  { name: 'Misc', glyphs: ['☼', '☾', '☽', '♥', '♦', '♠', '♣', '♪', '♫', '⚙', '⚡', '☘', '⚓', '✈', '☂', '⚖', '∞', '§'] },
];

// ---- recently used (per-browser; simple localStorage, capped to ONE row = the grid's 8 columns) ----
const RKEY = 'plainCharts.symbolRecent';
const RECENT_MAX = 8;   // one row; the newest push in, the oldest drop off
/** @returns {string[]} */
function getRecent() { try { return JSON.parse(/** @type {string} */ (localStorage.getItem(RKEY))) || []; } catch (_) { return []; } }
/** @param {string} g */
function pushRecent(g) {
  const r = getRecent().filter((x) => x !== g);
  r.unshift(g);
  try { localStorage.setItem(RKEY, JSON.stringify(r.slice(0, RECENT_MAX))); } catch (_) {}
}

/** @type {HTMLElement | null} */
let picker = null;
/** @type {((e: PointerEvent) => void) | null} */
let away = null;

function closePicker() {
  if (away) { document.removeEventListener('pointerdown', away, true); away = null; }
  if (picker) { picker.remove(); picker = null; }
}

// store the chosen glyph as the Symbol tool's default appearance, remember it, close.
/** @param {string} g */
function choose(g) {
  const tool = getTool('symbol');
  const cur = getToolDefaults('symbol') || {};
  const style = { ...(tool && tool.defaultStyle), ...cur.style, glyph: g };
  saveToolDefaults('symbol', style, cur.textStyle);
  pushRecent(g);
  closePicker();   // tool stays active → next chart click drops the glyph
}

/** @param {string} name @param {string[]} glyphs */
function section(name, glyphs) {
  const wrap = document.createElement('div');
  const head = document.createElement('div'); head.className = 'sym-cat'; head.textContent = name;
  const grid = document.createElement('div'); grid.className = 'sym-grid';
  glyphs.forEach((g) => {
    const cell = document.createElement('button'); cell.className = 'sym-cell'; cell.type = 'button';
    cell.textContent = renderGlyph(g); cell.title = g;
    cell.onclick = () => choose(g);
    grid.appendChild(cell);
  });
  wrap.append(head, grid);
  return wrap;
}

function openPicker() {
  closePicker();
  const p = document.createElement('div'); p.className = 'sym-picker';
  picker = p;

  const recent = getRecent().slice(0, RECENT_MAX);   // one row, even if an older store had more
  if (recent.length) p.appendChild(section('Recently used', recent));
  CATEGORIES.forEach((c) => p.appendChild(section(c.name, c.glyphs)));

  document.body.appendChild(p);

  // anchor next to the Symbol button on the left toolbar (fall back to a fixed spot)
  const btn = document.querySelector('.tool-btn[title="Symbol"]');
  const r = btn ? btn.getBoundingClientRect() : { right: 48, top: 90 };
  p.style.left = (r.right + 8) + 'px';
  p.style.top = Math.max(8, Math.min(r.top, window.innerHeight - p.offsetHeight - 8)) + 'px';

  // click outside (and not on the Symbol button) → dismiss + revert to cursor
  const onAway = (/** @type {PointerEvent} */ e) => {
    const t = /** @type {Node} */ (e.target);
    if (picker && !picker.contains(t) && !(btn && btn.contains(t))) {
      closePicker();
      if (getActiveTool() === 'symbol') setActiveTool('cursor');
    }
  };
  away = onAway;
  setTimeout(() => document.addEventListener('pointerdown', onAway, true), 0);
}

let wired = false;
// Wire the palette to tool activation. Idempotent — safe to call on every module load.
export function initSymbolPicker() {
  if (wired) return;
  wired = true;
  bus.on('tool:active', (id) => { if (id === 'symbol') openPicker(); else closePicker(); });
}
