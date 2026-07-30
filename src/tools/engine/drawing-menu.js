// @ts-check
// Right-click context menu for a drawing. Operates on the whole canvas selection when
// the right-clicked drawing is part of a multi-selection (Visual order / Visibility /
// sync / Clone / Copy / Lock / Hide / Remove apply to all); single-only items
// (Template, Slice, Extend, Settings) are omitted for a multi-selection.
import { openSettingsDialog } from './settings-dialog.js';
import { openCreateAlertDialog } from '../../alerts/create-alert-dialog.js';
import { alertForObject, removeDrawingsWithAlerts } from '../../alerts/alert-drawing-sync.js';
import { getTool } from '../registry.js';
import { intervalPreset, matchesPreset } from './visibility.js';
import { buildTemplateItem } from './template-menu.js';
import { copyDrawings } from '../../edit/clip-buffer.js'; // the pure buffer (leaf) -- importing clipboard.js would cycle via layout
import { IPC } from '../../ipc-contract.js'; // "Send to AI" injects the selection's context into the AI Workspace
import { t } from '../../i18n/i18n.js'; // vocabulary lookup for the menu labels

/** @type {any} */
let _injectChan = null;
// Broadcast the selected drawing(s) + chart context to the AI Workspace terminal (types into the prompt, no submit).
/** @param {any} engine @param {string[]} ids */
function sendDrawingToAi(engine, ids) {
  try {
    const p = engine.pane || {};
    const dec = p.priceDecimals || 2;
    /** @type {string[]} */
    const bits = ['On ' + (p.symbol || '?') + ' ' + (p.tfId || '?')];
    const sel = ids.map((/** @type {string} */ i) => engine.get(i)).filter(Boolean);
    if (sel.length)
      bits.push(
        'selected ' +
          sel
            .map(
              (/** @type {any} */ d) =>
                d.tool +
                ' [' +
                (d.points || []).map((/** @type {any} */ pt) => Number(pt.price).toFixed(dec)).join(', ') +
                ']',
            )
            .join('; '),
      );
    if (!_injectChan) _injectChan = new BroadcastChannel(IPC.ASSISTANT_INJECT);
    _injectChan.postMessage({ text: bits.join('; ') + ' -- ' });
  } catch (_) {}
}

/** One drawing object, as this menu reads it. */
/** @typedef {{ id: string, tool: string, points?: any[], visibility?: any, sync?: string, locked?: boolean, hidden?: boolean }} Drawing */

/** @type {HTMLElement | null} */
let menu = null;
/** @type {((e: PointerEvent) => void) | null} */
let away = null;

export function closeDrawingMenu() {
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
 * @param {string} tag @param {string | null} [cls] @param {string} [txt]
 * @returns {HTMLElement}
 */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/**
 * @param {any} engine   the pane's DrawingEngine (opaque handle; not typed here)
 * @param {string} id
 * @param {number} clientX
 * @param {number} clientY
 */
export function openDrawingMenu(engine, id, clientX, clientY) {
  closeDrawingMenu();
  const d = /** @type {Drawing | undefined} */ (engine.get(id));
  if (!d) return;
  // act on the whole selection when the clicked drawing is part of a multi-selection
  /** @type {string[]} */
  const ids =
    engine.isSelected && engine.isSelected(id) && engine.selection && engine.selection.size > 1
      ? engine.selectedIds().filter((/** @type {string} */ i) => engine.get(i))
      : [id];
  const multi = ids.length > 1;
  const suffix = multi ? ` ${ids.length} ${t('objects')}` : '';
  const iso = !!engine.isolated;
  // tool carries open, author-defined extras (sliceable, …) beyond the shared ToolDef
  const tool = /** @type {any} */ (getTool(d.tool));
  menu = el('div', 'dwg-menu');

  // ---- Create/Edit alert (single only) — anchors a price-crossing alert to this drawing. If an alert is
  // already attached, the item becomes "Edit alert on <tool>…" and the dialog opens prefilled.
  if (!multi) {
    const objName = (tool && tool.name) || d.tool;
    const hasAlert = alertForObject((engine.pane && engine.pane.symbol) || '', id);
    const al = el('div', 'dwg-item');
    al.append(
      el('span', 'dwg-check', ''),
      el('span', 'dwg-label', t(hasAlert ? 'Edit alert on' : 'Create alert on') + ' ' + objName + '…'),
    );
    al.onclick = () => {
      closeDrawingMenu();
      engine.select(id);
      openCreateAlertDialog(engine, id);
    };
    menu.appendChild(al);
    menu.appendChild(el('div', 'dwg-div'));
  }

  // ---- Template (single only)
  if (!multi) menu.appendChild(buildTemplateItem(engine, id, { onClose: closeDrawingMenu }));

  // ---- Visual order — z-order / stacking (applies to all selected)
  const voItem = el('div', 'dwg-item dwg-sub');
  voItem.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', t('Visual order')), el('span', 'dwg-arrow', '▸'));
  const voSub = el('div', 'dwg-menu dwg-submenu');
  [
    { where: 'front', label: 'Bring to front' },
    { where: 'back', label: 'Send to back' },
    { where: 'forward', label: 'Bring forward' },
    { where: 'backward', label: 'Send backward' },
  ].forEach((o) => {
    const r = el('div', 'dwg-item');
    r.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', t(o.label)));
    r.onclick = () => {
      closeDrawingMenu();
      ids.forEach((i) => engine.reorder(i, o.where));
    };
    voSub.appendChild(r);
  });
  voItem.appendChild(voSub);
  menu.appendChild(voItem);

  // ---- Visibility on intervals — quick presets for the per-TF visibility model
  const tf = (engine.pane.tf && engine.pane.tf()) || null;
  const visItem = el('div', 'dwg-item dwg-sub');
  visItem.append(
    el('span', 'dwg-check', ''),
    el('span', 'dwg-label', t('Visibility on intervals')),
    el('span', 'dwg-arrow', '▸'),
  );
  const visSub = el('div', 'dwg-menu dwg-submenu');
  [
    { mode: 'above', label: 'Current interval and above' },
    { mode: 'below', label: 'Current interval and below' },
    { mode: 'only', label: 'Current interval only' },
    { mode: 'all', label: 'All intervals' },
  ].forEach((p) => {
    const allMatch = ids.every((i) => matchesPreset((engine.get(i) || {}).visibility, tf, p.mode));
    const r = el('div', 'dwg-item');
    r.append(el('span', 'dwg-check', allMatch ? '✓' : ''), el('span', 'dwg-label', t(p.label)));
    r.onclick = () => {
      closeDrawingMenu();
      const v = intervalPreset(tf, p.mode);
      ids.forEach((i) => {
        const dd = engine.get(i);
        if (!dd) return;
        if (v) dd.visibility = v;
        else delete dd.visibility;
        engine.liveUpdate(dd);
      });
      engine.persist();
    };
    visSub.appendChild(r);
  });
  visItem.appendChild(visSub);
  menu.appendChild(visItem);

  // ---- sync state (skipped for isolated sub-pane engines, which cannot sync)
  if (!iso) {
    menu.appendChild(el('div', 'dwg-div'));
    const scopes = ids.map((i) => (engine.get(i) || {}).sync || 'none');
    const curScope = scopes.every((s) => s === scopes[0]) ? scopes[0] : null;
    [
      { key: 'none', label: 'No sync' },
      { key: 'layout', label: 'Sync in layout' },
      { key: 'global', label: 'Sync globally' },
    ].forEach((o) => {
      const row = el('div', 'dwg-item');
      row.append(el('span', 'dwg-check', curScope === o.key ? '✓' : ''), el('span', 'dwg-label', t(o.label)));
      row.onclick = () => {
        closeDrawingMenu();
        ids.forEach((i) => engine.setSync(i, o.key));
      };
      /** @type {HTMLElement} */ (menu).appendChild(row);
    });
  }
  menu.appendChild(el('div', 'dwg-div'));

  // ---- Modification tools (Slice/Extend are single-line; Clone/Copy apply to all)
  /** @param {string} label @param {() => void} fn */
  const mod = (label, fn) => {
    const r = el('div', 'dwg-item');
    r.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', label));
    r.onclick = () => {
      closeDrawingMenu();
      fn();
    };
    /** @type {HTMLElement} */ (menu).appendChild(r);
  };
  if (!multi && tool && tool.sliceable && d.points && d.points.length >= 1)
    mod(t('Slice'), () => engine.startSlice(id));
  if (!multi && tool && tool.sliceable && d.points && d.points.length === 2)
    mod(t('Extend'), () => engine.extendToRay(id));
  mod(t('Clone') + suffix, () => ids.forEach((i) => engine.clone(i)));
  mod(t('Copy') + suffix, () => copyDrawings(engine, ids));
  mod(t('Send to AI') + suffix, () => sendDrawingToAi(engine, ids));
  menu.appendChild(el('div', 'dwg-div'));

  // ---- Lock / Hide / Remove — unified state across the whole selection
  const anyUnlocked = ids.some((i) => {
    const x = engine.get(i);
    return x && !x.locked;
  });
  const anyVisible = ids.some((i) => {
    const x = engine.get(i);
    return x && !x.hidden;
  });
  /** @param {string} label @param {() => void} fn */
  const item = (label, fn) => {
    const r = el('div', 'dwg-item');
    r.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', label));
    r.onclick = () => {
      closeDrawingMenu();
      fn();
    };
    /** @type {HTMLElement} */ (menu).appendChild(r);
  };
  item((anyUnlocked ? t('Lock') : t('Unlock')) + suffix, () => ids.forEach((i) => engine.setLocked(i, anyUnlocked)));
  item((anyVisible ? t('Hide') : t('Show')) + suffix, () => ids.forEach((i) => engine.setHidden(i, anyVisible)));
  item(t('Remove') + suffix, () => removeDrawingsWithAlerts(engine, ids)); // also deletes any attached alert (with confirm)

  // ---- Settings (single only), divider above
  if (!multi) {
    menu.appendChild(el('div', 'dwg-div'));
    const settings = el('div', 'dwg-item');
    settings.append(el('span', 'dwg-check', ''), el('span', 'dwg-label', t('Settings…')));
    settings.onclick = () => {
      closeDrawingMenu();
      engine.select(id);
      openSettingsDialog(engine, id);
    };
    menu.appendChild(settings);
  }

  document.body.appendChild(menu);
  menu.style.left = Math.min(clientX, window.innerWidth - menu.offsetWidth - 6) + 'px';
  menu.style.top = Math.min(clientY, window.innerHeight - menu.offsetHeight - 6) + 'px';
  away = (e) => {
    if (menu && !menu.contains(/** @type {Node | null} */ (e.target))) closeDrawingMenu();
  };
  setTimeout(() => document.addEventListener('pointerdown', /** @type {(e: PointerEvent) => void} */ (away), true), 0);
}
