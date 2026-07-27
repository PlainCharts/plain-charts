// @ts-check
// Object Manager context menus -- the shared positioned-menu infrastructure and the two
// right-click menus (drawing / multi-selection, and folder), plus "Go to" (scroll/frame
// the chart to a drawing). On load the
// module registers closeObjMenu into the state slot so actions can close an open menu
// without importing this module (keeps the module graph a DAG).
import { intervalPreset, matchesPreset } from '../tools/engine/visibility.js';
import { openSettingsDialog } from '../tools/engine/settings-dialog.js';
import { buildTemplateItem } from '../tools/engine/template-menu.js';
import { state, eng, engineOf, setMenuCloser } from './objects-state.js';
import { createFolder, deleteFolder, removeFolderDeep, removeSelection, startRename } from './objects-actions.js';
import { t } from '../i18n/i18n.js';

/** @typedef {any} Engine */
/** @typedef {import('./objects-tree-ops.js').TreeNode} TreeNode */
// Context-menu builder plumbing (see menu()): item(label, fn) makes a clickable row.
/**
 * @typedef {(label: string, fn: () => void) => HTMLElement} MenuItemFactory
 * @typedef {(m: HTMLElement, item: MenuItemFactory) => void} MenuBuilder
 */

/**
 * @param {string} tag
 * @param {(string|null)=} cls
 * @param {(string|null)=} txt
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };

/** @type {HTMLElement|null} */
let objMenu = null;
/** @type {((ev: PointerEvent) => void)|null} */
let objAway = null;
export function closeObjMenu() { if (objAway) { document.removeEventListener('pointerdown', /** @type {any} */ (objAway), true); objAway = null; } if (objMenu) { objMenu.remove(); objMenu = null; } }
setMenuCloser(closeObjMenu);
/** @param {number} x @param {number} y @param {MenuBuilder} build */
export function menu(x, y, build) {
  closeObjMenu();
  const m = el('div', 'dwg-menu'); objMenu = m;
  build(m, (label, fn) => { const r = el('div', 'dwg-item'); r.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', label)); r.onclick = () => { closeObjMenu(); fn(); }; return r; });
  document.body.appendChild(m);
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 6) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 6) + 'px';
  objAway = (ev) => { if (objMenu && !objMenu.contains(/** @type {Node} */ (ev.target))) closeObjMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', /** @type {any} */ (objAway), true), 0);
}

// "Go to": bring a drawing into view no matter where it is. Horizontal -- if its time extent is
// scrolled out of the visible window, centre it (keep the current span, widen only if the drawing is
// wider than the view). Vertical -- for a drawing already in view horizontally (e.g. a horizontal
// line) whose price is off-screen, centre its price extent. Anchors are in data space {time (sec),
// price}; e._plotH is the current plot height the drawing primitive records each frame.
/** @param {Engine} e @param {string} id */
function goToDrawing(e, id) {
  const d = e && e.get(id); if (!d || !d.points || !d.points.length) return;
  const chart = e.pane && e.pane.chart; if (!chart) return;
  const ts = chart.timeAxis();
  e.select(id);   // select it so it highlights once revealed
  const times = d.points.map((/** @type {any} */ p) => p.time).filter((/** @type {any} */ tm) => tm != null);
  const prices = d.points.map((/** @type {any} */ p) => p.price).filter((/** @type {any} */ p) => p != null);

  let scrolledH = false;
  const cur = ts.timeWindow();
  if (times.length && cur) {
    const t0 = Math.min(...times), t1 = Math.max(...times);
    if (t1 < cur.from || t0 > cur.to) {   // no overlap with the visible window -> off-screen in time
      const tc = (t0 + t1) / 2; let span = cur.to - cur.from;
      const need = (t1 - t0) * 1.2; if (need > span) span = need;
      try { ts.setTimeWindow({ from: tc - span / 2, to: tc + span / 2 }); scrolledH = true; } catch (_) {}
      try { if (e.series && e.series.priceAxis) e.series.priceAxis().configure({ autoScale: true }); } catch (_) {}   // re-fit price to the drawing's neighbourhood
    }
  }

  const H = e._plotH || 0;
  if (!scrolledH && prices.length && H > 0 && e.series && e.series.priceToY) {
    const pLo = Math.min(...prices), pHi = Math.max(...prices), pc = (pLo + pHi) / 2;
    const yHi = e.series.priceToY(pHi), yLo = e.series.priceToY(pLo);
    if (yHi != null && yLo != null) {
      const top = Math.min(yHi, yLo), bot = Math.max(yHi, yLo);
      if (top < 0 || bot > H) {   // any part of the drawing is off-screen vertically -> frame it
        const curTop = e.series.yToPrice(0), curBot = e.series.yToPrice(H);
        let pSpan = Math.abs((curTop || 0) - (curBot || 0));
        const need = (pHi - pLo) * 1.3; if (need > pSpan) pSpan = need;
        if (pSpan > 0) { try { e.series.priceAxis().configure({ range: [pc + pSpan / 2, pc - pSpan / 2] }); } catch (_) {} }
      }
    }
  }
}

/** @param {string} id @param {number} x @param {number} y @param {Engine=} engine */
export function openObjMenu(id, x, y, engine) {
  const e = engine || eng(); if (!e) return;
  const iso = !!e.isolated;   // sub-pane engine: folders OK, but no cross-chart sync
  const multi = state.selectedIds.has(id) && state.selectedIds.size > 1;
  const ids = multi ? [...state.selectedIds] : [id];
  const suffix = multi ? ' ' + ids.length + ' ' + t('objects') : '';
  const anyVisible = ids.some((i) => { const x = e.get(i); return x && !x.hidden; });
  const anyUnlocked = ids.some((i) => { const x = e.get(i); return x && !x.locked; });
  menu(x, y, (m, item) => {
    // Go to — scroll/frame the chart so this drawing is in view, wherever it is (single selection)
    if (!multi) { m.appendChild(item(t('Go to'), () => goToDrawing(e, id))); m.appendChild(el('div', 'dwg-div')); }
    // Template (top, single selection only) — apply/save per-tool style presets
    if (!multi) m.appendChild(buildTemplateItem(e, id, { flyLeft: true, onClose: closeObjMenu }));

    // Visual order — z-order / stacking. Submenu flies LEFT (right-docked panel).
    const voItem = el('div', 'dwg-item dwg-sub');
    voItem.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', t('Visual order')), el('span', 'dwg-arrow', '▸'));
    const voSub = el('div', 'dwg-menu dwg-submenu dwg-submenu-left');
    [
      { where: 'front', label: 'Bring to front' },
      { where: 'back', label: 'Send to back' },
      { where: 'forward', label: 'Bring forward' },
      { where: 'backward', label: 'Send backward' },
    ].forEach((o) => {
      const r = el('div', 'dwg-item');
      r.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', t(o.label)));
      r.onclick = () => { closeObjMenu(); ids.forEach((i) => e.reorder(i, o.where)); };
      voSub.appendChild(r);
    });
    voItem.appendChild(voSub);
    m.appendChild(voItem);

    // Visibility on intervals — quick presets for the per-TF visibility model.
    // Submenu flies LEFT because the object tree is docked at the right edge.
    const tf = e.pane.tf && e.pane.tf();
    const visItem = el('div', 'dwg-item dwg-sub');
    visItem.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', t('Visibility on intervals')), el('span', 'dwg-arrow', '▸'));
    const visSub = el('div', 'dwg-menu dwg-submenu dwg-submenu-left');
    [
      { mode: 'above', label: 'Current interval and above' },
      { mode: 'below', label: 'Current interval and below' },
      { mode: 'only', label: 'Current interval only' },
      { mode: 'all', label: 'All intervals' },
    ].forEach((p) => {
      const allMatch = ids.every((i) => matchesPreset((e.get(i) || {}).visibility, tf, p.mode));
      const r = el('div', 'dwg-item');
      r.append(el('span', 'dwg-check', allMatch ? '✓' : ''), el('span', 'dwg-label', t(p.label)));
      r.onclick = () => {
        closeObjMenu();
        const v = intervalPreset(tf, p.mode);
        ids.forEach((i) => { const d = e.get(i); if (!d) return; if (v) d.visibility = v; else delete d.visibility; e.liveUpdate(d); });
        e.persist();
      };
      visSub.appendChild(r);
    });
    visItem.appendChild(visSub);
    m.appendChild(visItem);
    m.appendChild(el('div', 'dwg-div'));

    // Organization
    m.appendChild(item(t('New folder') + (multi ? ' ' + t('from') + ' ' + ids.length : ''), () => createFolder(ids, e)));
    m.appendChild(item(t('Clone') + suffix, () => ids.forEach((i) => e.clone(i))));
    if (!multi) m.appendChild(item(t('Rename'), () => startRename(id)));

    // Sync scope — radio of the current scope (ticked when the whole selection agrees).
    // Sub-pane drawings can't sync (isolated), so the section is omitted there.
    if (!iso) {
      const scopes = ids.map((i) => (e.get(i) || {}).sync || 'none');
      const curScope = scopes.every((s) => s === scopes[0]) ? scopes[0] : null;
      m.appendChild(el('div', 'dwg-div'));
      [['none', 'No sync'], ['layout', 'Sync in layout'], ['global', 'Sync globally']].forEach(([key, label]) => {
        const r = el('div', 'dwg-item');
        r.append(el('span', 'dwg-check', curScope === key ? '✓' : ''), el('span', 'dwg-label', t(label)));
        r.onclick = () => { closeObjMenu(); ids.forEach((i) => e.setSync(i, key)); };
        m.appendChild(r);
      });
    }

    // Lock / Hide / Remove
    m.appendChild(el('div', 'dwg-div'));
    m.appendChild(item((anyUnlocked ? t('Lock') : t('Unlock')) + suffix, () => ids.forEach((i) => e.setLocked(i, anyUnlocked))));
    m.appendChild(item((anyVisible ? t('Hide') : t('Show')) + suffix, () => ids.forEach((i) => e.setHidden(i, anyVisible))));
    m.appendChild(item(t('Remove') + suffix, () => removeSelection()));

    // Settings (per-drawing → single selection only)
    if (!multi) {
      m.appendChild(el('div', 'dwg-div'));
      m.appendChild(item(t('Settings…'), () => { e.select(id); openSettingsDialog(e, id); }));
    }
  });
}

/** @param {TreeNode} node @param {number} x @param {number} y @param {Engine=} engine */
export function openFolderMenu(node, x, y, engine) {
  const e = engine || engineOf(node.id);
  menu(x, y, (m, item) => {
    m.appendChild(item(t('Rename'), () => startRename(node.id)));
    m.appendChild(item(t('New folder inside'), () => { (node.children || (node.children = [])).unshift({ type: 'folder', id: 'f' + Date.now().toString(36) + (state.seq++).toString(36), name: 'New folder', expanded: true, children: [] }); node.expanded = true; e.saveTree(); }));
    m.appendChild(el('div', 'dwg-div'));
    m.appendChild(item(t('Ungroup (keep drawings)'), () => deleteFolder(node.id, e)));
    m.appendChild(item(t('Remove folder & contents'), () => { removeFolderDeep(e, node); e.saveTree(); }));
  });
}
