// @ts-check
// Settings -> Layout section (Tier 3 of the chart-dialog de-monolith). What NEW tabs/windows open
// with: a default layout (from the ones you have built) + a default chart template. Global app
// setting, no chart context. Imports its own domain deps directly.
import { getSetting, setSetting } from '../settings.js';
import { listTemplates } from '../templates.js';
import { layoutSig } from '../sd-format.js';
import { t } from '../../i18n/i18n.js';   // vocabulary lookup

const SINGLE_LAYOUT = { type: 'custom', count: 1, cols: '1fr', rows: '1fr', areas: '"p0"', cells: ['p0'], colFr: [1], rowFr: [1] };
/** @param {any} def @param {string} title @param {boolean} active @param {() => void} onClick */
function layoutThumb(def, title, active, onClick) {
  const opt = document.createElement('div'); opt.className = 'layout-opt' + (active ? ' active' : '');
  opt.style.gridTemplateColumns = def.cols; opt.style.gridTemplateRows = def.rows; opt.style.gridTemplateAreas = def.areas;
  opt.title = title;
  def.cells.forEach((/** @type {string} */ area) => { const c = document.createElement('div'); c.style.gridArea = area; opt.appendChild(c); });
  opt.onclick = onClick;
  return opt;
}

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section, renderContent } = ctx;
  section('DEFAULT LAYOUT FOR NEW TABS');
  const hint = document.createElement('div');
  hint.style.cssText = 'color:var(--tx-dim);font-size:12px;line-height:1.6;margin:6px 0 12px;';
  hint.textContent = t('New tabs and windows open with this arrangement.');
  content.appendChild(hint);

  const cur = getSetting('defaultLayout');
  const curSig = layoutSig(cur);
  const wrap = document.createElement('div'); wrap.className = 'layout-opts recent-opts';
  wrap.appendChild(layoutThumb(SINGLE_LAYOUT, t('Single chart'), !cur, () => { setSetting('defaultLayout', null); renderContent(); }));
  (getSetting('recentLayouts') || []).filter((/** @type {any} */ d) => d && d.areas).forEach((/** @type {any} */ def) => {
    wrap.appendChild(layoutThumb(def, def.count + (def.count === 1 ? ' ' + t('pane') : ' ' + t('panes')), curSig === layoutSig(def), () => { setSetting('defaultLayout', def); renderContent(); }));
  });
  content.appendChild(wrap);

  section('DEFAULT CHART TEMPLATE');
  const tmpls = listTemplates() || [];
  const r = document.createElement('div'); r.className = 'sd-row';
  const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t('Template');
  const sel = document.createElement('select');
  const none = document.createElement('option'); none.value = ''; none.textContent = t('None (built-in look)'); sel.appendChild(none);
  tmpls.forEach((tp) => { const o = document.createElement('option'); o.value = tp.name; o.textContent = tp.name; sel.appendChild(o); });
  sel.value = getSetting('defaultTemplate') || '';
  sel.onchange = () => setSetting('defaultTemplate', sel.value);
  r.append(l, sel);
  content.appendChild(r);
  if (!tmpls.length) {
    const e = document.createElement('div'); e.className = 'sd-placeholder'; e.style.marginTop = '8px';
    e.textContent = t('No saved templates yet — save one from a chart’s settings dialog (Template ▾ → Save as…).');
    content.appendChild(e);
  }
}
