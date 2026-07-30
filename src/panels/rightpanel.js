// @ts-check
// Shared right-side panel coordinator. Several views (object tree, watchlist, …)
// each register a rail button + a content element; exactly one view shows at a
// time in the single slide-out #rightpanel. Emits 'rightpanel:shown' with the id.
import { $ } from '../dom.js';
import { bus } from '../bus.js';
import { getSetting, setSetting } from '../settings/settings.js';

/**
 * @param {string} tag
 * @param {string=} cls
 * @param {string=} txt
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

// A registered slide-out view: an id, its content element, the panel width it needs,
// and its rail button (null for a dockView that has no button of its own).
/**
 * @typedef {Object} View
 * @property {string} id
 * @property {HTMLButtonElement|null} btn
 * @property {HTMLElement} content
 * @property {number} width
 */

// A plain rail action button descriptor (addRailAction).
/**
 * @typedef {Object} RailAction
 * @property {string|Node} icon                        a glyph string, or an icon Node to append
 * @property {string} title                            the button's tooltip
 * @property {(btn: HTMLButtonElement, e: MouseEvent) => void} onClick
 * @property {boolean=} bottom                          pin below the flex spacer at the rail's foot
 */

/** @type {View[]} */
const views = [];
/** @type {View|null} */
let current = null;

// ---- resizable width (drag the panel's left edge; persisted per view id) ----
const MIN_W = 200;
const maxW = () => Math.min(900, Math.floor(window.innerWidth * 0.8));
/** @param {string} id @returns {number|null} */
function savedWidth(id) {
  const m = getSetting('rightPanelWidths') || {};
  const w = m[id];
  return typeof w === 'number' ? w : null;
}
/** @param {string} id @param {number} w */
function saveWidth(id, w) {
  const m = getSetting('rightPanelWidths') || {};
  m[id] = w;
  setSetting('rightPanelWidths', m);
}

// One grip on the panel's LEFT edge serves whichever view is current (the panel is docked on the right, so
// dragging left widens it). Created once, on the first registered view.
let gripDone = false;
/** @param {HTMLElement} panel */
function ensureGrip(panel) {
  if (gripDone) return;
  gripDone = true;
  const grip = el('div', 'rp-resize');
  panel.appendChild(grip);
  let startX = 0,
    startW = 0,
    dragging = false;
  grip.addEventListener('pointerdown', (e) => {
    if (!current) return;
    dragging = true;
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    panel.classList.add('rp-resizing'); // kill the width transition while dragging
    try {
      grip.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging || !current) return;
    const w = Math.max(MIN_W, Math.min(maxW(), startW + (startX - e.clientX)));
    panel.style.width = w + 'px';
    current.content.style.width = w + 'px';
    current.width = w;
  });
  /** @param {PointerEvent} e */
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('rp-resizing');
    try {
      grip.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (current) saveWidth(current.id, current.width);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

/**
 * @param {{ id: string, icon: string|Node, title: string, content: HTMLElement, width?: number }} opts
 * @returns {{ id: string }|null}
 */
export function addView({ id, icon, title, content, width = 260 }) {
  const rail = $('rightrail'),
    panel = $('rightpanel');
  if (!rail || !panel) return null;
  const w = savedWidth(id) ?? width;
  content.style.display = 'none';
  content.style.width = w + 'px';
  panel.appendChild(content);
  ensureGrip(panel);
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'rail-btn'));
  btn.title = title;
  if (icon instanceof Node) btn.appendChild(icon);
  else btn.textContent = icon;
  btn.onclick = () => toggle(id);
  rail.appendChild(btn);
  views.push({ id, btn, content, width: w });
  return { id };
}

/**
 * @param {string} id
 * @param {boolean=} force
 */
export function toggle(id, force) {
  const v = views.find((x) => x.id === id);
  if (!v) return;
  const panel = /** @type {HTMLElement} */ ($('rightpanel'));
  const willOpen = force == null ? current !== v : !!force;
  if (!willOpen) {
    v.content.style.display = 'none';
    if (v.btn) v.btn.classList.remove('active');
    if (current === v) {
      current = null;
      panel.classList.remove('open');
      panel.style.width = '';
    }
    return;
  }
  views.forEach((x) => {
    const on = x === v;
    x.content.style.display = on ? '' : 'none';
    if (x.btn) x.btn.classList.toggle('active', on);
  });
  panel.classList.add('open');
  panel.style.width = v.width + 'px'; // each view sets the panel width it needs
  current = v;
  bus.emit('rightpanel:shown', id);
}

/** @param {string} id */
export const isShown = (id) => !!current && current.id === id;

// Set (or clear) a small count badge on a rail view's button -- a reusable unread/unseen indicator. A falsy or
// zero `text` removes the badge. No-op for a view with no button (dockView) or an unknown id.
/** @param {string} id @param {number|string} [text] */
export function setRailBadge(id, text) {
  const v = views.find((x) => x.id === id);
  if (!v || !v.btn) return;
  let b = /** @type {HTMLElement|null} */ (v.btn.querySelector('.rail-badge'));
  const n = Number(text);
  if (!text || (Number.isFinite(n) && n === 0)) {
    if (b) b.remove();
    return;
  }
  if (!b) {
    b = el('span', 'rail-badge');
    v.btn.appendChild(b);
  }
  b.textContent = String(text);
}

// register a slide-out view WITHOUT its own rail button — the caller already has a trigger
// (e.g. an addon's rail icon). Same docked panel the watchlist uses; toggle()/removeView() apply.
/**
 * @param {{ id: string, content: HTMLElement, width?: number }} opts
 * @returns {{ id: string }|null}
 */
export function dockView({ id, content, width = 300 }) {
  const panel = $('rightpanel');
  if (!panel) return null;
  if (views.find((v) => v.id === id)) return { id };
  const w = savedWidth(id) ?? width;
  content.style.display = 'none';
  content.style.width = w + 'px';
  panel.appendChild(content);
  ensureGrip(panel);
  views.push({ id, btn: null, content, width: w });
  return { id };
}
/** @param {string} id */
export function removeView(id) {
  const i = views.findIndex((v) => v.id === id);
  if (i < 0) return;
  if (current === views[i]) toggle(id, false);
  try {
    views[i].content.remove();
  } catch (_) {}
  if (views[i].btn)
    try {
      views[i].btn.remove();
    } catch (_) {}
  views.splice(i, 1);
}

// add a plain ACTION button to the rail (not a panel view) — e.g. snapshot, settings.
// `bottom: true` pins it below a flex spacer at the foot of the rail. Returns the button.
/**
 * @param {RailAction} opts
 * @returns {HTMLButtonElement|null}
 */
export function addRailAction({ icon, title, onClick, bottom }) {
  const rail = $('rightrail');
  if (!rail) return null;
  if (bottom && !rail.querySelector('.rail-spacer')) rail.appendChild(el('div', 'rail-spacer'));
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'rail-btn'));
  btn.title = title;
  if (icon instanceof Node) btn.appendChild(icon);
  else btn.textContent = icon;
  btn.onclick = (e) => {
    e.stopPropagation();
    onClick(btn, e);
  };
  rail.appendChild(btn);
  return btn;
}
