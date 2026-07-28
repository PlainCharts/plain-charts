// @ts-check
// Per-pane chart settings: a gear-opened menu with flyout submenus.
//   Lines ›   Price line / Bid line / Ask line   (checkable)
//   Labels ›  (filled next)
// Data-driven — add a category or item and it just shows up.
import { $ } from '../dom.js';
import { PRICE_SCALE_MODES } from '../chart/scale-modes.js';

const MENU = [
  { label: 'Labels', items: [
    { label: 'Symbol last price label', key: 'lastPriceLabel' },
    { label: 'Bid label', key: 'bidLabel' },
    { label: 'Ask label', key: 'askLabel' },
    { label: 'Bid/Ask tags', key: 'priceTags' },
    { label: 'Countdown to bar close', key: 'countdown' },
  ] },
  { label: 'Lines', items: [
    { label: 'Price line', key: 'priceLine' },
    { label: 'Bid line', key: 'bidLine' },
    { label: 'Ask line', key: 'askLine' },
  ] },
  { label: 'Placement', items: [
    { radio: 'scaleLeft', options: [['Right', false], ['Left', true]] },
  ] },
  { label: 'Visibility', items: [
    { label: 'Price scale', key: 'priceScale' },
    { label: 'Time scale', key: 'timeScale' },
  ] },
  { label: 'Scaling', items: [
    { radio: 'priceScaleMode', options: PRICE_SCALE_MODES },
  ] },
];

let panel = /** @type {HTMLElement} */ (/** @type {unknown} */ (null));
let submenu = /** @type {HTMLElement} */ (/** @type {unknown} */ (null));
/** @type {any} */
let current = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let hideTimer = null;

export function initChartSettings() {
  panel = /** @type {HTMLElement} */ ($('chartSettings'));
  submenu = document.createElement('div');
  submenu.id = 'chartSubmenu';
  document.body.appendChild(submenu);
  document.addEventListener('click', (e) => {
    const t = /** @type {Node} */ (e.target);
    if (!panel.contains(t) && !submenu.contains(t)) closeAll();
  });
  panel.onmouseenter = cancelClose;
  panel.onmouseleave = scheduleClose;
  submenu.onmouseenter = cancelClose;
  submenu.onmouseleave = scheduleClose;
}

/** @param {any} pane @param {DOMRect} rect */
export function openChartSettings(pane, rect) {
  current = pane;
  renderMain();
  panel.classList.add('open');
  const h = panel.offsetHeight;
  panel.style.left = Math.min(Math.max(8, rect.left - 80), window.innerWidth - 220) + 'px';
  panel.style.top = Math.max(50, rect.top - h - 8) + 'px';
}

function renderMain() {
  panel.innerHTML = '';
  submenu.classList.remove('open');
  MENU.forEach((cat) => {
    const row = document.createElement('div');
    row.className = 'cs-cat';
    row.innerHTML = `<span>${cat.label}</span><span class="cs-caret">›</span>`;
    row.onmouseenter = () => openSubmenu(cat, row.getBoundingClientRect());
    panel.appendChild(row);
  });

  // standalone toggle (no submenu group) — flip the price scale
  const sep = document.createElement('div'); sep.className = 'cs-sep'; panel.appendChild(sep);
  const inv = document.createElement('div'); inv.className = 'cs-item';
  const on = !!current.settings.invertScale;
  inv.innerHTML = `<span class="cs-check">${on ? '✓' : ''}</span><span>Invert scale</span>`;
  inv.onmouseenter = () => submenu.classList.remove('open');   // not a category — close any open submenu
  inv.onclick = (e) => {
    e.stopPropagation();
    const v = !current.settings.invertScale;
    current.setLineSetting('invertScale', v);
    /** @type {HTMLElement} */ (inv.querySelector('.cs-check')).textContent = v ? '✓' : '';
  };
  panel.appendChild(inv);
}

/** @param {any} cat @param {DOMRect} rowRect */
function openSubmenu(cat, rowRect) {
  cancelClose();
  submenu.innerHTML = '';
  if (!cat.items.length) {
    const e = document.createElement('div'); e.className = 'cs-empty'; e.textContent = '(none yet)';
    submenu.appendChild(e);
  }
  cat.items.forEach((/** @type {any} */ it) => {
    if (it.sep) {
      const d = document.createElement('div'); d.className = 'cs-sep';
      submenu.appendChild(d);
      return;
    }
    if (it.radio) {                                   // mutually-exclusive options (e.g. price scale mode)
      it.options.forEach((/** @type {[string, any]} */ [label, value]) => {
        const row = document.createElement('div'); row.className = 'cs-item';
        const on = current.settings[it.radio] === value;
        row.innerHTML = `<span class="cs-check">${on ? '✓' : ''}</span><span>${label}</span>`;
        row.onclick = (e) => {
          e.stopPropagation();
          current.setLineSetting(it.radio, value);
          openSubmenu(cat, rowRect);                  // re-render to move the check
        };
        submenu.appendChild(row);
      });
      return;
    }
    const row = document.createElement('div'); row.className = 'cs-item';
    const on = !!current.settings[it.key];
    row.innerHTML = `<span class="cs-check">${on ? '✓' : ''}</span><span>${it.label}</span>`;
    row.onclick = (e) => {
      e.stopPropagation();
      const v = !current.settings[it.key];
      current.setLineSetting(it.key, v);
      /** @type {HTMLElement} */ (row.querySelector('.cs-check')).textContent = v ? '✓' : '';
    };
    submenu.appendChild(row);
  });
  submenu.classList.add('open');
  const w = submenu.offsetWidth;
  let left = rowRect.right + 2;
  if (left + w > window.innerWidth) left = rowRect.left - w - 2;   // flip left if no room
  submenu.style.left = Math.max(8, left) + 'px';
  submenu.style.top = rowRect.top + 'px';
}

function scheduleClose() { hideTimer = setTimeout(closeAll, 250); }
function cancelClose() { clearTimeout(/** @type {any} */ (hideTimer)); }
function closeAll() { panel.classList.remove('open'); submenu.classList.remove('open'); current = null; }
