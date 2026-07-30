// @ts-check
// Settings -> Theme section (Tier 3 of the chart-dialog de-monolith). Icon masking, the Light/Dark
// mode manager (2x2 grid), and the theme editor/creator (per-palette color rows, autosaved). Global
// app setting, no chart context. Imports its own domain deps directly.
import { getSetting, setSetting } from '../settings.js';
import { bus } from '../../bus.js';
import { namePrompt } from '../../ui/name-prompt.js';
import { colorSwatch } from '../../ui/colorpicker.js';
import { listThemes, getCurrentName, getLivePalette, selectTheme,
         previewPalette, saveUserTheme, deleteUserTheme, openThemesFolder, importTheme,
         PALETTE_APP, PALETTE_CONTROLS, PALETTE_SIGN } from '../theme.js';
import { getThemeModes, setThemeModeField, getActiveMode, applyThemeMode } from '../theme-modes.js';
import { applyIconMode } from '../../ui/icon.js';
import { t } from '../../i18n/i18n.js';   // vocabulary lookup
import { importJsonFile } from '../../ui/import-json.js';   // the shared Import… file flow

// Light/Dark theme modes: pick an app theme per mode. Clicking a row applies that mode (app theme,
// cross-window). The rail toggle (by the camera) does the same. The active mode is highlighted.
// Chart appearance is a separate, personal concern (chart templates) and is not set here.
/** @param {import('../sd-controls.js').SettingsCtx} ctx */
function renderThemeModes(ctx) {
  const { content, section, renderContent } = ctx;
  section('LIGHT / DARK MODES');
  const themes = listThemes();
  const modes = getThemeModes();
  const active = getActiveMode();

  /**
   * @param {string[]} opts
   * @param {string | null | undefined} value
   * @param {(v: string) => void} onChange
   */
  const mkSel = (opts, value, onChange) => {
    const s = document.createElement('select');
    opts.forEach((o) => { const op = document.createElement('option'); op.value = o; op.textContent = o; s.appendChild(op); });
    s.value = value != null ? value : '';
    s.onchange = () => onChange(s.value);
    return s;
  };
  const hdr = (/** @type {string} */ txt) => { const d = document.createElement('div'); d.className = 'tmode-h'; d.textContent = t(txt); return d; };

  const grid = document.createElement('div'); grid.className = 'tmode-grid';
  grid.append(document.createElement('div'), hdr('App theme'));
  ['light', 'dark'].forEach((/** @type {any} */ mode) => {
    const lbl = document.createElement('button');
    lbl.className = 'tmode-row' + (mode === active ? ' active' : '');
    lbl.textContent = mode === 'light' ? t('Light') : t('Dark');
    lbl.title = t('Apply this mode');
    lbl.onclick = () => { applyThemeMode(mode); renderContent(); };
    grid.append(lbl, mkSel(themes, /** @type {any} */ (modes)[mode].app, (v) => setThemeModeField(mode, 'app', v)));
  });
  content.appendChild(grid);
}

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section, renderContent } = ctx;
  section('ICONS');
  const ir = document.createElement('div'); ir.className = 'sd-row';
  const ichk = document.createElement('input'); ichk.type = 'checkbox'; ichk.checked = getSetting('maskIcons') === true;
  ichk.onchange = () => { setSetting('maskIcons', ichk.checked); applyIconMode(); bus.emit('icons:mask'); };
  const il = document.createElement('span'); il.className = 'sd-label';
  il.textContent = t('Adapt icons to theme (recolour every app icon)');
  ir.append(ichk, il);
  content.appendChild(ir);
  const divIc = document.createElement('div'); divIc.className = 'sd-divider'; content.appendChild(divIc);

  renderThemeModes(ctx);   // Light/Dark mode manager (2x2 grid), above the theme editor
  const divTh = document.createElement('div'); divTh.className = 'sd-divider'; content.appendChild(divTh);
  section('THEMES');    // the theme editor/creator below the divider
  const palette = getLivePalette();   // edit live; previewed on change
  // Autosave: theme edits persist immediately (no separate Save button -- OK just closes). Debounced
  // so dragging a colour picker coalesces into one write.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let saveT = null;
  const autosave = () => { clearTimeout(/** @type {any} */ (saveT)); saveT = setTimeout(() => saveUserTheme(getCurrentName(), getLivePalette()), 250); };

  // theme selector + New / Save / Delete — every theme is editable & saveable
  const bar = document.createElement('div'); bar.className = 'theme-bar';
  const sel = document.createElement('select');
  listThemes().forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  sel.value = getCurrentName();
  sel.onchange = () => { selectTheme(sel.value); renderContent(); };
  /**
   * @param {string} label
   * @param {(e?: any) => void} fn
   * @param {boolean} [dis]
   */
  const btn = (label, fn, dis) => { const b = document.createElement('button'); b.textContent = label; b.disabled = !!dis; b.onclick = fn; return b; };
  bar.append(sel,
    btn(t('New'), async () => {
      const name = await namePrompt({
        title: t('New theme'), label: t('Theme name'), placeholder: t('Theme name'),
        existing: listThemes(), replaceMessage: (n) => `Theme '${n}' already exists. Replace it?`,
      });
      if (name) { saveUserTheme(name, getLivePalette()); renderContent(); }
    }),
    btn(t('Delete'), () => { deleteUserTheme(getCurrentName()); renderContent(); }, listThemes().length <= 1),
    btn(t('Folder'), () => openThemesFolder()),
    btn(t('Import'), () => importJsonFile((d) => {
      if (!importTheme(d)) return false;
      renderContent();
      return true;
    }, t('That file is not a theme (needs name + palette).'))));
  content.appendChild(bar);

  const colorRowT = (/** @type {string} */ label, /** @type {string} */ key) => {
    const r = document.createElement('div'); r.className = 'sd-row';
    const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(label);
    const sw = colorSwatch(/** @type {any} */ (palette)[key] || '#888888', (/** @type {string} */ v) => { /** @type {any} */ (palette)[key] = v; previewPalette(palette); autosave(); });
    r.append(l, sw); return r;
  };
  PALETTE_APP.forEach(([title, rows]) => { section(/** @type {string} */ (title).toUpperCase()); /** @type {string[][]} */ (rows).forEach(([k, label]) => content.appendChild(colorRowT(label, k))); });

  section('ON-CHART CONTROLS');
  PALETTE_CONTROLS.forEach(([k, label]) => content.appendChild(colorRowT(label, k)));

  section('POSITIVE / NEGATIVE');
  PALETTE_SIGN.forEach(([k, label]) => content.appendChild(colorRowT(label, k)));

  section('ACTIVE PANE');
  content.appendChild(colorRowT('Frame color', 'frameColor'));
  const paneRow = document.createElement('div'); paneRow.className = 'sd-row';
  const tl = document.createElement('span'); tl.className = 'sd-label'; tl.textContent = t('Frame thickness');
  const ti = document.createElement('input'); ti.type = 'number'; ti.min = '1'; ti.max = '5'; ti.value = /** @type {any} */ (palette.frameWidth || 1); ti.style.width = '54px';
  ti.oninput = () => { const v = parseInt(ti.value, 10); if (!isNaN(v)) { palette.frameWidth = Math.max(1, Math.min(5, v)); previewPalette(palette); autosave(); } };
  paneRow.append(tl, ti);
  content.appendChild(paneRow);
}
