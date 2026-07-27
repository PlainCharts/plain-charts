// @ts-check
// Settings -> Chart Theme section (under the CHART group). Make / load / manage sharable chart-style
// presets, the chart-side parallel of app themes: a management bar (select + New / Delete / Folder /
// Import) over the theme's editable colours -- candles, background, grid, crosshair and scale style.
// Selecting a theme loads it onto the active chart; edits preview live and autosave to the theme file.
// Edits go through the dialog draft (like Instrument/Canvas), so Ok commits and Cancel reverts the pane.
import { makeAppearanceControls } from '../sd-controls.js';
import { strokeSwatch } from '../../ui/colorpicker.js';
import { namePrompt } from '../../ui/name-prompt.js';
import { t } from '../../i18n/i18n.js';
import { listChartThemes, getChartTheme, currentChartThemeName, selectChartTheme, saveChartTheme,
         deleteChartTheme, openChartThemesFolder, importChartTheme, themeFromDraft, mergeThemeIntoDraft } from '../chart-theme.js';

// grid line-style choices (engine style enum) and crosshair stroke-style map, matching Canvas/Scales.
const CROSS_LS = { solid: 0, dotted: 1, dashed: 2 };
/** @type {[any, string][]} */
const FONTS = [
  ['', 'Default'],
  ['Helvetica, Arial, sans-serif', 'Sans-serif'],
  ['Georgia, "Times New Roman", serif', 'Serif'],
  ['"Courier New", monospace', 'Monospace'],
  ['"Trebuchet MS", system-ui, sans-serif', 'Trebuchet'],
];

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, draft, pane, preview, section, row, inlineRow, labeled, renderContent } = ctx;
  const c = draft.canvas;
  const cd = draft.candles;
  const sl = draft.statusLine || (draft.statusLine = {});

  // autosave the selected theme (debounced) whenever a colour changes; a no-op until a theme exists
  /** @type {ReturnType<typeof setTimeout> | null} */
  let saveT = null;
  const scheduleSave = () => {
    const name = currentChartThemeName();
    if (!name) return;
    clearTimeout(/** @type {any} */ (saveT));
    saveT = setTimeout(() => saveChartTheme(name, themeFromDraft(draft, pane)), 250);
  };
  const onEdit = () => { preview(); scheduleSave(); };
  // our OWN control set: edits mutate the draft, preview live AND autosave the theme file
  const { colorPicker, textPicker, selectControl, visColorRow } = makeAppearanceControls(onEdit);

  // ---- management bar: select + New / Delete / Folder / Import ----
  section('CHART THEME');
  const names = listChartThemes();
  const bar = document.createElement('div'); bar.className = 'theme-bar';
  const sel = document.createElement('select');
  if (!names.length) { const o = document.createElement('option'); o.value = ''; o.textContent = t('(no themes)'); sel.appendChild(o); }
  names.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  sel.value = currentChartThemeName();
  sel.onchange = () => {   // load the chosen theme onto the active chart (preview; commits on Ok)
    selectChartTheme(sel.value);
    const th = getChartTheme(sel.value); if (th) mergeThemeIntoDraft(draft, pane, th);
    renderContent(); preview();
  };
  /** @param {string} label @param {(e?: any) => void} fn @param {boolean} [dis] */
  const btn = (label, fn, dis) => { const b = document.createElement('button'); b.textContent = t(label); b.disabled = !!dis; b.onclick = fn; return b; };
  bar.append(sel,
    btn('New', async () => {
      const name = await namePrompt({
        title: t('New chart theme'), label: t('Theme name'), placeholder: t('Theme name'),
        existing: listChartThemes(), replaceMessage: (n) => `Chart theme '${n}' already exists. Replace it?`,
      });
      if (name) { saveChartTheme(name, themeFromDraft(draft, pane)); renderContent(); }
    }),
    btn('Delete', () => {
      const n = currentChartThemeName(); if (!n) return;
      deleteChartTheme(n);
      const cur = getChartTheme(currentChartThemeName()); if (cur) { mergeThemeIntoDraft(draft, pane, cur); preview(); }
      renderContent();
    }, !names.length),
    btn('Folder', () => openChartThemesFolder()),
    btn('Import', () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          let d; try { d = JSON.parse(/** @type {string} */ (r.result)); } catch (_) { alert(t('That file is not valid JSON.')); return; }
          if (!importChartTheme(d)) { alert(t('That file is not a chart theme (needs name + candles or canvas).')); return; }
          renderContent();
        };
        r.readAsText(f);
      };
      inp.click();
    }));
  content.appendChild(bar);

  // ---- editable colours (same controls as Instrument / Canvas / Scales) ----
  section('CANDLES');
  content.appendChild(visColorRow(cd, 'Body', 'bodyVisible', 'upColor', 'downColor'));
  content.appendChild(visColorRow(cd, 'Borders', 'borderVisible', 'borderUpColor', 'borderDownColor'));
  content.appendChild(visColorRow(cd, 'Wick', 'wickVisible', 'wickUpColor', 'wickDownColor'));

  section('CHART');
  content.appendChild(row('Background', colorPicker(c, 'background')));

  section('GRID');
  content.appendChild(row('Lines',
    selectControl(c, 'gridMode', [['both', 'Vert and horz'], ['vert', 'Vert only'], ['horz', 'Horz only'], ['none', 'None']]),
    colorPicker(c, 'gridColor')));
  content.appendChild(inlineRow(
    labeled('Style:', selectControl(c, 'gridStyle', [[0, 'Solid'], [4, 'Sparse dotted'], [3, 'Large dashed']], true))));

  section('CROSSHAIR');
  content.appendChild(row('Line', strokeSwatch({
    color: { get: () => c.crosshairColor, set: (/** @type {string} */ v) => { c.crosshairColor = v; onEdit(); } },
    width: { get: () => c.crosshairWidth, set: (/** @type {number} */ v) => { c.crosshairWidth = v; onEdit(); } },
    lineStyle: { get: () => c.crosshairStyle, set: (/** @type {'solid'|'dotted'|'dashed'} */ v) => { c.crosshairStyle = (CROSS_LS[v] != null ? CROSS_LS[v] : 0); onEdit(); } },
  })));

  section('SCALE STYLE');
  content.appendChild(row('Text', textPicker(c, 'scaleTextColor', 'scaleFontSize')));
  content.appendChild(row('Font', selectControl(c, 'scaleFontFamily', FONTS)));
  content.appendChild(row('Borders', colorPicker(c, 'scaleLineColor')));

  // status line: the on-chart instrument/values readout -- its text (colour + size) and background.
  // Same controls as Settings > Status; captured into the theme so they travel with it.
  section('STATUS');
  content.appendChild(row('Text', textPicker(sl, 'color', 'fontSize')));
  content.appendChild(row('Background', colorPicker(sl, 'bgColor')));

  // price / bid / ask lines: visibility + stroke. These are LIVE on pane.settings (not the draft), so
  // they apply immediately; scheduleSave persists them into the theme file.
  section('LINES');
  /** @param {string} label @param {string} prefix */
  const lineRow = (label, prefix) => {
    const r = document.createElement('div'); r.className = 'sd-row';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!(pane && pane.settings[prefix]);
    chk.onchange = () => { if (pane) pane.setLineSetting(prefix, chk.checked); scheduleSave(); };
    const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(label);
    const stroke = strokeSwatch({
      color: { get: () => pane.settings[prefix + 'Color'], set: (/** @type {string} */ v) => { pane.setLineSetting(prefix + 'Color', v); scheduleSave(); } },
      width: { get: () => pane.settings[prefix + 'Width'], set: (/** @type {number} */ v) => { pane.setLineSetting(prefix + 'Width', v); scheduleSave(); } },
      lineStyle: { get: () => pane.settings[prefix + 'Dash'], set: (/** @type {'solid'|'dotted'|'dashed'} */ v) => { pane.setLineSetting(prefix + 'Dash', v); scheduleSave(); } },
    });
    stroke.style.marginLeft = 'auto';
    r.append(chk, l, stroke);
    return r;
  };
  content.appendChild(lineRow('Price line', 'priceLine'));
  content.appendChild(lineRow('Bid line', 'bidLine'));
  content.appendChild(lineRow('Ask line', 'askLine'));
}
