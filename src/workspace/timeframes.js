// @ts-check
// Timeframe catalog (data + math) and the toolbar UI (strip + add/manage dropdown).
// Nothing is hardcoded — the user builds the list; it persists in settings.json.
// Emits 'tf:selected' when the user picks one; listens to 'tf:active' to highlight.
import { bus } from '../bus.js';
import { getSetting, setSetting } from '../settings/settings.js';
import { $ } from '../dom.js';
import { barMs } from '../../data_engine/index.js'; // duration math is ENGINE-owned (adapters use it too)

// A neutral bar unit: 'm'=minutes, 'h'=hours, 'D'=days, 'W'=weeks, 'M'=months.
/** @typedef {'m'|'h'|'D'|'W'|'M'} Unit */
// A timeframe spec accepted by the public math (barMs/lookFor). `unit` is loose (plain string) so
// broker adapters that carry their own {unit:string,n} timeframe types can pass them without a cast.
/** @typedef {{ unit: string, n: number }} TfSpec */
/** @typedef {{ id: string, unit: Unit, n: number }} Interval */
// A canonicalized bar interval with a narrow unit (internal use: normalize/parseId output).
/** @typedef {{ unit: Unit, n: number }} Tf */

const DAY = 86400000;
// Neutral bar units (each broker adapter maps these to its own wire params):
// 'm'=minutes, 'h'=hours, 'D'=days, 'W'=weeks, 'M'=months.
const UNITS = [
  { label: 'Minutes', unit: 'm' },
  { label: 'Hours', unit: 'h' },
  { label: 'Days', unit: 'D' },
  { label: 'Weeks', unit: 'W' },
  { label: 'Months', unit: 'M' },
];
/** @param {TfSpec} tf @returns {boolean} */
const isIntraday = (tf) => tf.unit === 'm' || tf.unit === 'h';

// the duration math is ENGINE-owned (adapters use it too); re-exported here for app callers
export { barMs };
// history window: ~600 bars, capped (intraday ~3mo, daily+ ~2yr)
/** @param {TfSpec} tf @returns {number} */
export const lookFor = (tf) => Math.min(barMs(tf) * 600, isIntraday(tf) ? 80 * DAY : 700 * DAY);
/** @param {Unit} unit @param {number} n @returns {string} */
const makeId = (unit, n) =>
  unit === 'm'
    ? n + 'm'
    : unit === 'h'
      ? n + 'h'
      : unit === 'D'
        ? n === 1
          ? 'D'
          : n + 'D'
        : unit === 'W'
          ? n === 1
            ? 'W'
            : n + 'W'
          : n === 1
            ? 'M'
            : n + 'M';

// 60m == 1h, 120m == 2h … collapse minute multiples of 60 into hours so the app
// never holds two ids for the same interval. (Hours->days is NOT collapsed — a 24h
// bar is not a daily session bar.)
/** @param {Unit} unit @param {number} n @returns {Tf} */
const normalize = (unit, n) => (unit === 'm' && n >= 60 && n % 60 === 0 ? { unit: 'h', n: n / 60 } : { unit, n });
/** @param {string|null=} id @returns {Tf|null} */
const parseId = (id) => {
  const m = /^(\d*)(m|h|D|W|M)$/.exec(String(id || ''));
  return m ? { unit: /** @type {Unit} */ (m[2]), n: m[1] ? parseInt(m[1], 10) : 1 } : null;
};
/** @param {string|null=} id @returns {string|null|undefined} */
const canonId = (id) => {
  const p = parseId(id);
  if (!p) return id;
  const z = normalize(p.unit, p.n);
  return makeId(z.unit, z.n);
};

/** @type {Interval[]} */
let intervals = [];
/** @type {string[]} */
let favs = [];
/** @type {string|null} */
let selectedId = null; // currently highlighted (the active pane's timeframe)
/** @type {HTMLElement} */ let tfbar;
/** @type {HTMLElement} */ let tfAdd;
/** @type {HTMLElement} */ let tfMenu;
let showAddForm = false;

// tolerant: a legacy/equivalent id (e.g. '60m') resolves to its canonical one ('1h')
/** @param {string|null=} id @returns {Interval|undefined} */
export const byId = (id) => intervals.find((t) => t.id === id) || intervals.find((t) => t.id === canonId(id));
/** @returns {string|null} */
export const firstTf = () => favs[0] || (intervals[0] && intervals[0].id) || null;
/** @returns {Interval[]} */
export const listIntervals = () => intervals.slice(); // the user's configured timeframes (for pickers)
/** @returns {Interval[]} */
export const favTimeframes = () => intervals.filter((t) => favs.includes(t.id)); // the toolbar-pinned intervals (segment defaults)
/** @returns {Interval[]} */
const sortIntervals = () => intervals.sort((a, b) => barMs(a) - barMs(b));
const persist = () => {
  setSetting('intervals', intervals);
  setSetting('favoriteTimeframes', favs);
};

// migrate legacy enum intervals ({u}) to neutral ({unit})
/** @type {Record<number, Unit>} */
const U2UNIT = { 8: 'm', 7: 'h', 6: 'D', 5: 'W', 4: 'M' };

export function initTimeframes() {
  /** @type {Record<string, string>} */
  const idMap = {}; // legacy id -> canonical id (for favs / persisted refs)
  /** @type {Set<string>} */
  const seen = new Set();
  intervals = (getSetting('intervals') || [])
    .map(
      /** @param {any} t @returns {Interval|null} */ (t) => {
        if (!t || !t.id || !t.n) return null;
        const u = t.unit || U2UNIT[t.u];
        if (!u) return null;
        const z = normalize(u, t.n);
        const id = makeId(z.unit, z.n);
        idMap[t.id] = id;
        if (seen.has(id)) return null; // drop the duplicate (e.g. 60m when 1h exists)
        seen.add(id);
        return { id, unit: z.unit, n: z.n };
      },
    )
    .filter(Boolean);
  favs = (getSetting('favoriteTimeframes') || [])
    .map(/** @param {string} f */ (f) => idMap[f] || f)
    .filter((/** @type {string} */ f, /** @type {number} */ i, /** @type {string[]} */ a) => a.indexOf(f) === i)
    .filter(byId);
  sortIntervals();
  persist(); // save the cleaned-up list

  tfbar = /** @type {HTMLElement} */ ($('tfbar'));
  tfAdd = /** @type {HTMLElement} */ ($('tfAdd'));
  tfMenu = /** @type {HTMLElement} */ ($('tfMenu'));
  tfAdd.onclick = (e) => {
    e.stopPropagation();
    tfMenu.classList.contains('open') ? closeMenu() : openMenu();
  };
  document.addEventListener('click', (e) => {
    const t = /** @type {Node} */ (e.target);
    if (!tfMenu.contains(t) && e.target !== tfAdd) closeMenu();
  });
  bus.on('tf:active', (id) => {
    selectedId = id;
    renderStrip();
  });
  renderStrip();
}

function renderStrip() {
  tfbar.innerHTML = '';
  intervals
    .filter((t) => favs.includes(t.id))
    .forEach((tf) => {
      const b = document.createElement('button');
      b.textContent = tf.id;
      b.className = 'tf' + (canonId(tf.id) === canonId(selectedId) ? ' active' : '');
      b.onclick = () => bus.emit('tf:selected', tf.id);
      tfbar.appendChild(b);
    });
}

/** @param {string} id @returns {void} */
function toggleFav(id) {
  favs = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
  persist();
  renderStrip();
  renderMenu();
}

/** @param {string} id @returns {void} */
function deleteInterval(id) {
  if (intervals.length <= 1) return;
  intervals = intervals.filter((t) => t.id !== id);
  favs = favs.filter((x) => x !== id);
  persist();
  renderStrip();
  renderMenu();
  bus.emit('tf:deleted', id);
}

/** @param {Unit} unit @param {number} n @returns {string} */
function addCustom(unit, n) {
  if (!Number.isInteger(n) || n < 1) return 'Enter a whole number ≥ 1.';
  ({ unit, n } = normalize(unit, n)); // 60m -> 1h, etc.
  if (unit === 'm' && n > 1440) return 'Minutes must be ≤ 1440.';
  if (unit === 'h' && n > 24) return 'Hours must be ≤ 24.';
  if ((unit === 'D' || unit === 'W' || unit === 'M') && n !== 1) return 'Days/Weeks/Months: only 1 per bar (use 1).';
  const id = makeId(unit, n);
  if (byId(id)) {
    showAddForm = false;
    renderMenu();
    bus.emit('tf:selected', id);
    return '';
  }
  intervals.push({ id, unit, n });
  sortIntervals();
  showAddForm = false;
  persist();
  renderStrip();
  renderMenu();
  return '';
}

function renderMenu() {
  tfMenu.innerHTML = '';
  if (!intervals.length) {
    const hint = document.createElement('div');
    hint.className = 'tf-add-err';
    hint.style.padding = '4px 8px';
    hint.style.color = '#888';
    hint.textContent = 'No intervals yet — add one below.';
    tfMenu.appendChild(hint);
  }
  intervals.forEach((tf) => {
    const row = document.createElement('div');
    row.className = 'tf-row' + (tf.id === selectedId ? ' active' : '');
    const on = favs.includes(tf.id);
    const star = document.createElement('span');
    star.className = 'star' + (on ? ' on' : '');
    star.textContent = on ? '★' : '☆';
    star.title = on ? 'Unpin from toolbar' : 'Pin to toolbar';
    star.onclick = (e) => {
      e.stopPropagation();
      toggleFav(tf.id);
    };
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = tf.id;
    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '✕';
    del.title = 'Delete interval';
    del.onclick = (e) => {
      e.stopPropagation();
      deleteInterval(tf.id);
    };
    row.append(star, lbl, del);
    row.onclick = () => {
      bus.emit('tf:selected', tf.id);
      closeMenu();
    };
    tfMenu.appendChild(row);
  });

  const divider = document.createElement('div');
  divider.className = 'tf-divider';
  tfMenu.appendChild(divider);

  const addRow = document.createElement('div');
  addRow.className = 'tf-add-row';
  addRow.textContent = '+ Add custom interval';
  addRow.onclick = (e) => {
    e.stopPropagation();
    showAddForm = !showAddForm;
    renderMenu();
  };
  tfMenu.appendChild(addRow);

  if (showAddForm) {
    const form = document.createElement('div');
    form.className = 'tf-add-form';
    form.onclick = (e) => e.stopPropagation();
    const num = document.createElement('input');
    num.type = 'number';
    num.min = '1';
    num.value = '7';
    num.className = 'tf-num';
    const sel = document.createElement('select');
    sel.className = 'tf-unit';
    UNITS.forEach((u) => {
      const o = document.createElement('option');
      o.value = u.unit;
      o.textContent = u.label;
      sel.appendChild(o);
    });
    const btn = document.createElement('button');
    btn.textContent = 'Add';
    btn.className = 'tf-add-btn';
    const err = document.createElement('div');
    err.className = 'tf-add-err';
    const submit = () => {
      const m = addCustom(/** @type {Unit} */ (sel.value), parseInt(num.value, 10));
      if (m) err.textContent = m;
    };
    btn.onclick = (e) => {
      e.stopPropagation();
      submit();
    };
    num.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    form.append(num, sel, btn, err);
    tfMenu.appendChild(form);
    num.focus();
  }
}

function openMenu() {
  renderMenu();
  const r = tfAdd.getBoundingClientRect();
  tfMenu.style.left = r.left + 'px';
  tfMenu.style.top = r.bottom + 4 + 'px';
  tfMenu.classList.add('open');
}
function closeMenu() {
  tfMenu.classList.remove('open');
}

// parse "5", "15", "1h", "4h", "d", "w", "mo" -> select that interval (adding it
// if it isn't in the list yet). Returns true on success.
/** @param {string=} text @returns {boolean} */
export function gotoInterval(text) {
  const m = /^(\d*)\s*(mo|mon|m|h|d|w)?$/i.exec(String(text || '').trim());
  if (!m || (!m[1] && !m[2])) return false;
  let n = m[1] ? parseInt(m[1], 10) : 1;
  const u = (m[2] || 'm').toLowerCase();
  /** @type {Unit} */
  let unit = u === 'mo' || u === 'mon' ? 'M' : u === 'h' ? 'h' : u === 'd' ? 'D' : u === 'w' ? 'W' : 'm';
  if (unit !== 'm' && unit !== 'h') n = 1;
  if (!Number.isInteger(n) || n < 1) return false;
  ({ unit, n } = normalize(unit, n)); // 60 -> 1h
  const id = makeId(unit, n);
  if (!byId(id) && addCustom(unit, n)) return false; // addCustom returns an error string on failure
  bus.emit('tf:selected', id);
  return true;
}

// floating input near the TF bar to type an interval (the "change interval" hotkey)
/** @type {HTMLElement|null} */
let qiEl = null;
// Null the ref BEFORE removing: removing a focused input fires its blur synchronously,
// which re-enters closeQuickInput() -- so it must already see qiEl === null (else it
// double-removes the same node -> NotFoundError).
function closeQuickInput() {
  const el = qiEl;
  qiEl = null;
  if (el) {
    try {
      el.remove();
    } catch (_) {}
  }
}
/** @param {string=} seed @returns {void} */
export function openIntervalQuickInput(seed) {
  closeQuickInput();
  if (!tfbar) return;
  const wrap = document.createElement('div');
  wrap.className = 'tf-qi';
  const inp = document.createElement('input');
  inp.className = 'tf-qi-input';
  inp.value = seed || '';
  inp.placeholder = 'e.g. 5, 15, 1h, D';
  wrap.appendChild(inp);
  document.body.appendChild(wrap);
  const r = tfbar.getBoundingClientRect();
  wrap.style.left = r.left + 'px';
  wrap.style.top = r.bottom + 6 + 'px';
  inp.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (gotoInterval(inp.value)) closeQuickInput();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeQuickInput();
    }
  };
  inp.onblur = () => closeQuickInput();
  qiEl = wrap;
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
}
