// @ts-check
// Layout PICKER -- the toolbar layout button's dropdown: the "Build layout" launcher,
// the recent custom layouts (most-recently-used thumbnails with forget), and the
// per-tab SYNC toggles. Also owns the recent-layouts history (persisted globally in
// settings) and the mini grid-preview styler shared with the toolbar icon. The
// layout's live state is reached through
// the context passed to initLayoutMenu (dependency inversion -- this module never
// imports layout.js).
import { $ } from '../dom.js';
import { getSetting, setSetting } from '../settings/settings.js';
import { t } from '../i18n/i18n.js';

/** @typedef {import('./layout.js').LayoutDef} LayoutDef */
/** @typedef {import('./layout.js').SyncPrefs} SyncPrefs */
/**
 * @typedef {Object} MenuCtx
 * @property {SyncPrefs} sync                          the tab's live sync prefs (shared object)
 * @property {() => void} persist
 * @property {(key: keyof SyncPrefs) => void} applySync    a sync toggled ON -> match the active pane
 * @property {() => void} clearCrosshairs              crosshair sync toggled OFF -> clear mirrored crosshairs
 * @property {(def: LayoutDef) => void} applyCustomLayout
 * @property {() => LayoutDef|null} currentCustomDef   the applied custom grid (null when a preset is active)
 */

/** @param {HTMLElement} el @param {LayoutDef} def */
export const applyGrid = (el, def) => {
  // fixed equal grid (used for the toolbar mini-preview icon)
  el.style.gridTemplateColumns = def.cols;
  el.style.gridTemplateRows = def.rows;
  el.style.gridTemplateAreas = def.areas;
};

// ---- recent layouts: the custom arrangements the user actually built + applied (NOT presets
// or favourites — a most-recently-used history). Persisted globally in settings. ----
const RECENT_MAX = 12;
/** @param {LayoutDef|null|undefined} d @returns {string} */
export const layoutSig = (d) =>
  d && d.areas ? d.areas + '|' + (d.colFr || []).join(',') + '|' + (d.rowFr || []).join(',') : '';
/** @returns {LayoutDef[]} */
const recentLayouts = () =>
  (Array.isArray(getSetting('recentLayouts')) ? getSetting('recentLayouts') : []).filter(
    (/** @type {LayoutDef} */ d) => d && d.areas,
  );
/** @param {LayoutDef} def */
export function addRecentLayout(def) {
  if (!def || def.type !== 'custom') return;
  const slim = {
    type: 'custom',
    count: def.count,
    cols: def.cols,
    rows: def.rows,
    areas: def.areas,
    cells: def.cells,
    colFr: def.colFr,
    rowFr: def.rowFr,
  };
  const sig = layoutSig(slim);
  const list = [slim, ...recentLayouts().filter((d) => layoutSig(d) !== sig)].slice(0, RECENT_MAX);
  setSetting('recentLayouts', list);
}

// ---- layout picker button + grouped dropdown ----
/** @param {MenuCtx} ctx */
export function initLayoutMenu(ctx) {
  const btn = /** @type {HTMLElement} */ ($('btnLayout'));
  const menu = /** @type {HTMLElement} */ ($('layoutMenu'));
  const close = () => menu.classList.remove('open');

  const render = () => {
    menu.innerHTML = '';
    // demand-driven layout builder: slice a blank canvas into any arrangement, then Apply
    const build = document.createElement('div');
    build.className = 'layout-build';
    build.textContent = '⊞  ' + t('Build layout…');
    build.onclick = async () => {
      close();
      try {
        const m = await import('../settings/layout-builder.js');
        m.openLayoutBuilder();
      } catch (_) {}
    };
    menu.appendChild(build);

    // recent layouts: the custom arrangements the user built + used (most-recent first).
    // Click a thumbnail to re-apply it; hover ✕ to forget it.
    const recents = recentLayouts();
    if (recents.length) {
      const rh = document.createElement('div');
      rh.className = 'sync-header';
      rh.style.borderTop = 'none';
      rh.style.marginTop = '8px';
      rh.textContent = t('RECENT LAYOUTS');
      menu.appendChild(rh);
      const wrap = document.createElement('div');
      wrap.className = 'layout-opts recent-opts';
      const curSig = layoutSig(ctx.currentCustomDef());
      recents.forEach((def) => {
        const opt = document.createElement('div');
        opt.className = 'layout-opt' + (layoutSig(def) === curSig ? ' active' : '');
        applyGrid(opt, def);
        opt.title = def.count + ' ' + t(def.count === 1 ? 'pane' : 'panes');
        def.cells.forEach((area) => {
          const c = document.createElement('div');
          c.style.gridArea = area;
          opt.appendChild(c);
        });
        const rm = document.createElement('span');
        rm.className = 'recent-x';
        rm.textContent = '✕';
        rm.title = t('Forget this layout');
        rm.onclick = (e) => {
          e.stopPropagation();
          setSetting(
            'recentLayouts',
            recentLayouts().filter((d) => layoutSig(d) !== layoutSig(def)),
          );
          render();
        };
        opt.appendChild(rm);
        opt.onclick = () => {
          ctx.applyCustomLayout(def);
          render();
          close();
        };
        wrap.appendChild(opt);
      });
      menu.appendChild(wrap);
    }

    // sync section
    const h = document.createElement('div');
    h.className = 'sync-header';
    h.textContent = t('SYNC IN LAYOUT');
    menu.appendChild(h);
    menu.appendChild(syncRow('Symbol', 'syncSymbol'));
    menu.appendChild(syncRow('Interval', 'syncInterval'));
    menu.appendChild(syncRow('Crosshair', 'syncCrosshair'));
    menu.appendChild(syncRow('Range (scroll & zoom)', 'syncRange'));
  };

  /** @param {string} label @param {keyof SyncPrefs} key */
  const syncRow = (label, key) => {
    const row = document.createElement('div');
    row.className = 'sync-row';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = t(label);
    const tog = document.createElement('div');
    tog.className = 'toggle' + (ctx.sync[key] ? ' on' : '');
    tog.onclick = (e) => {
      e.stopPropagation();
      ctx.sync[key] = !ctx.sync[key];
      tog.classList.toggle('on', ctx.sync[key]);
      ctx.persist();
      if (ctx.sync[key])
        ctx.applySync(key); // on -> match the active pane
      else if (key === 'syncCrosshair') ctx.clearCrosshairs();
    };
    row.append(lbl, tog);
    return row;
  };

  const open = () => {
    render();
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - 360) + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    menu.classList.add('open');
  };

  btn.onclick = (e) => {
    e.stopPropagation();
    menu.classList.contains('open') ? close() : open();
  };
  document.addEventListener('click', (e) => {
    if (!menu.contains(/** @type {Node} */ (e.target)) && !btn.contains(/** @type {Node} */ (e.target))) close();
  });
}
