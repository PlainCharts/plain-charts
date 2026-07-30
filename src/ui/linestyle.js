// @ts-check
// Reusable line-style picker: Solid / Dashed / Dotted with line previews. Use
// lineStyleControl(value, onChange) anywhere a stroke style is edited. Values are
// 'solid' | 'dashed' | 'dotted' (legacy numbers 1=dotted, 2=dashed are accepted).
const STYLES = [
  { key: 'solid', name: 'Solid' },
  { key: 'dashed', name: 'Dashed' },
  { key: 'dotted', name: 'Dotted' },
];
/** @param {string|number} [v] @returns {'solid'|'dashed'|'dotted'} */
const norm = (v) => (v === 'dashed' || v === 2 ? 'dashed' : v === 'dotted' || v === 1 ? 'dotted' : 'solid');

/** @type {any} */
let menu = null;
/** @returns {void} */
export function closeLineStyleMenu() {
  if (!menu) return;
  document.removeEventListener('pointerdown', /** @type {any} */ (menu)._out, true);
  menu.remove();
  menu = null;
}

/** @param {string|number} value @param {(k: string) => void} onChange @returns {HTMLButtonElement} */
export function lineStyleControl(value, onChange) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ls-btn';
  const prev = document.createElement('span');
  prev.className = 'ls-prev ' + norm(value);
  const caret = document.createElement('span');
  caret.className = 'ls-caret';
  caret.textContent = '▾';
  btn.append(prev, caret);
  btn.onclick = () =>
    openMenu(btn, norm(prev.dataset.k || value), (k) => {
      prev.className = 'ls-prev ' + k;
      prev.dataset.k = k;
      onChange(k);
    });
  prev.dataset.k = norm(value);
  return btn;
}

/** @param {HTMLElement} anchor @param {string} cur @param {(k: string) => void} onPick @returns {void} */
function openMenu(anchor, cur, onPick) {
  closeLineStyleMenu();
  menu = document.createElement('div');
  menu.className = 'ls-menu';
  STYLES.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'ls-row' + (s.key === cur ? ' sel' : '');
    const p = document.createElement('span');
    p.className = 'ls-prev ' + s.key;
    const n = document.createElement('span');
    n.className = 'ls-name';
    n.textContent = s.name;
    row.append(p, n);
    row.onclick = () => {
      onPick(s.key);
      closeLineStyleMenu();
    };
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
  /** @type {any} */ (menu)._out = (/** @type {PointerEvent} */ e) => {
    if (
      menu &&
      !menu.contains(/** @type {Node} */ (e.target)) &&
      e.target !== anchor &&
      !anchor.contains(/** @type {Node} */ (e.target))
    )
      closeLineStyleMenu();
  };
  setTimeout(() => document.addEventListener('pointerdown', /** @type {any} */ (menu)._out, true), 0);
}
