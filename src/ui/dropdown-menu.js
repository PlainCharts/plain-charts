// @ts-check
// Reusable DROPDOWN menu popup: a list of items anchored to an element; onSelect(value) fires on click. Closes on
// select / outside-click / Escape. Self-contained (inline styles + theme CSS vars), like number-picker / colorpicker,
// so any surface can use it (the order pill's type cell today, others later).

/** @type {HTMLElement|null} */
let pop = null;
/** @param {MouseEvent} e */
function onDoc(e) {
  if (pop && !pop.contains(/** @type {any} */ (e.target))) closeDropdown();
}
/** @param {KeyboardEvent} e */
function onKey(e) {
  if (e.key === 'Escape') closeDropdown();
}

export function closeDropdown() {
  if (!pop) return;
  try {
    pop.remove();
  } catch (_) {}
  pop = null;
  document.removeEventListener('mousedown', onDoc, true);
  document.removeEventListener('keydown', onKey, true);
}

/**
 * @param {HTMLElement} anchor
 * @param {{ value: string, text: string }[]} items
 * @param {(value: string) => void} onSelect
 * @param {{ selected?: string }} [opts]
 * @returns {{ close: () => void }}
 */
export function openDropdown(anchor, items, onSelect, opts = {}) {
  closeDropdown();
  const menu = document.createElement('div');
  pop = menu;
  menu.className = 'dd-pop';
  menu.style.cssText =
    'position:fixed;z-index:96;min-width:110px;padding:4px;' +
    'background:var(--panel,#1b1d22);border:1px solid var(--bd,#333);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.4);';
  items.forEach((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.text;
    const sel = it.value === opts.selected;
    b.style.cssText =
      'display:block;width:100%;text-align:left;padding:7px 12px;border:none;border-radius:5px;font-size:13px;cursor:pointer;' +
      'color:var(--tx,#ddd);background:' +
      (sel ? 'var(--bg,#14161a)' : 'transparent') +
      ';';
    b.onmouseenter = () => {
      if (!sel) b.style.background = 'rgba(255,255,255,.08)';
    };
    b.onmouseleave = () => {
      if (!sel) b.style.background = 'transparent';
    };
    b.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeDropdown();
      try {
        onSelect(it.value);
      } catch (_) {}
    };
    menu.appendChild(b);
  });
  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect(),
    pr = menu.getBoundingClientRect();
  let left = r.left,
    top = r.bottom + 4;
  if (left + pr.width > window.innerWidth) left = window.innerWidth - pr.width - 8;
  if (top + pr.height > window.innerHeight) top = r.top - pr.height - 4;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  return { close: closeDropdown };
}
