// @ts-check
// Right-click context menu + the full chart Settings dialog (category sidebar +
// content). Symbol ▸ Candles colors, Canvas ▸ background/grid/crosshair. Edits a
// draft {candles, canvas}, previews live, commits on Ok. Templates → templates.json.
import { $ } from '../dom.js';
import { bus } from '../bus.js';
import { getAllPanes, getActivePane } from '../chart/layout.js';
import { CANDLES_DEFAULT, CANVAS_DEFAULT, STATUS_DEFAULT, INDICATORS_DEFAULT, LINE_DEFAULTS, DATE_FMT_EXAMPLES } from '../chart/pane.js';
import { pasteClipboard, hasClipboard } from '../edit/clipboard.js';
import { listTemplates, saveTemplate, deleteTemplate, openTemplatesFolder } from './templates.js';
import { snapshotFromDraft, applySnapshotToDraft, applyChartSettings, isChartSnapshot } from './chart-snapshot.js';
import { confirmDialog } from '../ui/confirm.js';
import { namePrompt } from '../ui/name-prompt.js';
import { addRailAction } from '../panels/rightpanel.js';
import { closeColorPicker } from '../ui/colorpicker.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup for the settings nav + chart context menu
import { importJsonFile } from '../ui/import-json.js';   // the shared Import… file flow
import { themeIcon } from '../ui/icon.js';
import { row, inlineRow, labeled, unit, helpDot, makeAppearanceControls, makeLiveControls } from './sd-controls.js';
import { IPC } from '../ipc-contract.js';   // "Send to AI" injects chart context into the AI Workspace terminal
import { executeCommand } from '../commands/registry.js';
import { keyFor } from '../commands/keybindings.js';
import { prettyCombo } from '../edit/hotkeys.js';
import * as generalSection from './sections/general.js';   // Tabs + Layout + Vocabulary, consolidated
import * as aboutSection from './sections/about.js';
import * as advancedSection from './sections/advanced.js';   // Optimization + Development, consolidated
import * as assistantSection from './sections/assistant.js';
import * as hotkeysSection from './sections/hotkeys.js';
import * as statusSection from './sections/status.js';
import * as alertsSection from './sections/alerts.js';
import * as scalesSection from './sections/scales.js';
import * as tradingSection from './sections/trading.js';
import * as canvasSection from './sections/canvas.js';
import * as instrumentSection from './sections/instrument.js';
import * as themeSection from './sections/theme.js';
import * as chartThemeSection from './sections/chart-theme.js';
import * as dataSection from './sections/data.js';
import * as timeSection from './sections/time.js';
import * as notificationsSection from './sections/notifications.js';

// Two groups: per-chart settings (act on the active chart — Apply to all / Template apply)
// and global App settings (no chart context — the footer's Apply/Template hide).
const GROUPS = [
  // Chart = the PER-CHART (per-pane) group. Two panes in one layout can each have their own
  // values here -- e.g. different display timezones (-4 on one, +0 on the other).
  { title: 'Chart', cats: ['Instrument', 'Canvas', 'Scales', 'Status', 'Trading', 'Time', 'Chart Theme'] },
  // Global = app-wide settings (Data cache and Alerts are app-level, not per-chart).
  { title: 'Global', cats: ['General', 'Data', 'App Theme', 'Hotkeys', 'Notifications', 'Alerts', 'Advanced', 'Assistant', 'About'] },
];
// the Global group has no per-chart appearance to apply/templatize (footer Apply-to-all / Template hide)
const GLOBAL_CATS = new Set(GROUPS[1].cats);

/** @type {HTMLElement} */ let dialog;
/** @type {HTMLElement} */ let nav;
/** @type {HTMLElement} */ let content;
/** @type {HTMLElement} */ let ctxMenu;
/** @type {HTMLElement} */ let box;
/** @type {any} */ let pane = null;
/** @type {any} */ let draft = null;       // { candles, canvas }
let activeCat = 'Instrument';

export function initChartDialog() {
  dialog = /** @type {HTMLElement} */ ($('settingsDialog')); nav = /** @type {HTMLElement} */ ($('sd-nav')); content = /** @type {HTMLElement} */ ($('sd-content')); ctxMenu = /** @type {HTMLElement} */ ($('chartContextMenu'));
  /** @type {HTMLElement} */ ($('sd-close')).onclick = cancel;
  /** @type {HTMLElement} */ ($('sd-cancel')).onclick = cancel;
  /** @type {HTMLElement} */ ($('sd-ok')).onclick = ok;
  /** @type {HTMLElement} */ ($('sd-applyall')).onclick = applyAll;
  dialog.classList.add('modal-passthru');   // floating, non-modal: chart stays interactive; no click-away close
  initTemplateMenu();

  // make the dialog movable: fixed-position the box, drag it by the header
  box = /** @type {HTMLElement} */ (dialog.querySelector('.settings-dialog'));
  const head = /** @type {HTMLElement} */ (box && box.querySelector('.sd-head'));
  if (box && head) {
    box.style.position = 'fixed'; box.style.margin = '0';
    head.style.cursor = 'move';
    /** @type {{ dx: number, dy: number } | null} */
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (t.closest('#sd-close')) return;   // let the close button work
      drag = { dx: e.clientX - box.offsetLeft, dy: e.clientY - box.offsetTop };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      box.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx)) + 'px';
      box.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy)) + 'px';
    });
    head.addEventListener('pointerup', () => { drag = null; });
  }

  bus.on('pane:contextmenu', ({ event, pane: p }) => openContextMenu(event, p));
  document.addEventListener('click', (e) => { if (!ctxMenu.contains(/** @type {Node} */ (e.target))) hideCtx(); });

  const gear = themeIcon('/images/settings.png', 18);
  addRailAction({ icon: gear, title: t('Chart settings'), bottom: true, onClick: () => openChartSettings() });
}

// open the full chart Settings dialog for the active pane (strip button)
/** @param {string} [cat] optional starting category (defaults to Canvas) */
export function openChartSettings(cat) { const p = getActivePane(); if (p) openDialog(p, cat); }

// ---- context menu ----
/** @param {MouseEvent} event @param {any} p */
function openContextMenu(event, p) {
  pane = p;
  ctxMenu.innerHTML = '';
  /** @type {any[]} */
  const items = [];
  // routed through the command registry: this menu item and the Alt+R hotkey are two triggers of the
  // same 'pane.resetView' command. `key` shows its LIVE binding, so rebinding the hotkey updates here too.
  const resetKey = keyFor('pane.resetView');
  items.push({ icon: '↺', label: t('Reset chart view'), key: resetKey ? prettyCombo(resetKey) : '', fn: () => executeCommand('pane.resetView', { pane: p }) });
  items.push({ divider: true });
  // price under the cursor (right-click Y -> price via the series mapping)
  let price = null;
  try { price = p.series.yToPrice(event.clientY - p.el.getBoundingClientRect().top); } catch (_) {}
  if (price != null) {
    const dec = p.priceDecimals || 2;
    const shown = Number(price).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    items.push({ icon: '⧉', label: t('Copy price') + ' ' + shown, fn: () => copyText(Number(price).toFixed(dec)) });
  }
  items.push({ icon: '✦', label: t('Send to AI'), fn: () => sendToAi(p, price) });
  items.push({ icon: '⎘', label: t('Paste'), key: 'Ctrl + V', disabled: !hasClipboard(), fn: () => pasteClipboard() });
  // per-chart removal (this view only): local + layout-synced drawings shown on the
  // current timeframe, and this pane's indicators. NOT global — that's the toolbar Trash.
  const nD = p.drawings ? p.drawings.viewDrawings().length : 0;
  const nI = p.studies ? p.studies.count() : 0;
  /** @param {number} n @param {string} w */
  const plur = (n, w) => `${n} ${t(w)}${n === 1 ? '' : 's'}`;
  if (nD || nI) items.push({ divider: true });
  if (nD) items.push({ icon: '✕', label: t('Remove') + ' ' + plur(nD, 'drawing'), fn: () => executeCommand('drawing.removeInView', { pane: p }) });
  if (nI) items.push({ icon: '✕', label: t('Remove') + ' ' + plur(nI, 'indicator'), fn: () => executeCommand('study.clearAll', { pane: p }) });
  items.push({ divider: true }, { icon: '⚙', label: t('Settings…'), fn: () => openDialog(p) });
  items.forEach((it) => {
    if (it.divider) { const d = document.createElement('div'); d.className = 'ctx-div'; ctxMenu.appendChild(d); return; }
    const row = document.createElement('div'); row.className = 'ctx-item' + (it.disabled ? ' disabled' : '');
    row.innerHTML = `<span class="ctx-ico">${it.icon}</span><span class="ctx-label">${it.label}</span>` + (it.key ? `<span class="ctx-key">${it.key}</span>` : '');
    if (!it.disabled) row.onclick = () => { hideCtx(); it.fn(); };
    ctxMenu.appendChild(row);
  });
  ctxMenu.style.left = Math.min(event.clientX, window.innerWidth - 190) + 'px';
  ctxMenu.style.top = Math.min(event.clientY, window.innerHeight - 110) + 'px';
  ctxMenu.classList.add('open');
}
const hideCtx = () => ctxMenu.classList.remove('open');

// "Send to AI": broadcast the chart's live context to the AI Workspace terminal, which types it into the
// prompt (no submit -- you add your question). Reaches the AI tab even when it's detached to another window.
/** @type {any} */
let _injectChan = null;
/** @param {any} p @param {number|null} cursorPrice */
function sendToAi(p, cursorPrice) {
  try {
    if (!_injectChan) _injectChan = new BroadcastChannel(IPC.ASSISTANT_INJECT);
    _injectChan.postMessage({ text: aiContext(p, cursorPrice) });
  } catch (_) {}
}
/** @param {any} p @param {number|null} cursorPrice @returns {string} */
function aiContext(p, cursorPrice) {
  const dec = (p && p.priceDecimals) || 2;
  /** @type {string[]} */
  const bits = ['On ' + (p.symbol || '?') + ' ' + (p.tfId || '?')];
  const last = p.lastBar && p.lastBar.close;
  if (last != null) bits.push('last ' + Number(last).toFixed(dec));
  if (cursorPrice != null) bits.push('cursor ' + Number(cursorPrice).toFixed(dec));
  try {
    const dr = p.drawings;
    const ids = (dr && dr.selection) ? [...dr.selection] : [];
    const sel = ids.map((/** @type {any} */ id) => dr.get(id)).filter(Boolean);
    if (sel.length) {
      const desc = sel.map((/** @type {any} */ d) => d.tool + ' [' + (d.points || []).map((/** @type {any} */ pt) => Number(pt.price).toFixed(dec)).join(', ') + ']').join('; ');
      bits.push('selected ' + desc);
    }
  } catch (_) {}
  return bits.join('; ') + ' -- ';
}
/** @param {string} text */
function copyText(text) {
  try { navigator.clipboard.writeText(text); }
  catch (_) {
    const ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
}

// ---- dialog lifecycle ----
/** @param {any} p @param {string} [cat] */
function openDialog(p, cat) {
  pane = p;
  draft = p.getAppearance();
  activeCat = cat || 'Instrument';
  renderNav(); renderContent(); updateFooter();
  dialog.classList.add('open');
  // re-center each open (the box is fixed-positioned, so flex no longer centers it)
  if (box) { box.style.left = Math.max(8, (window.innerWidth - box.offsetWidth) / 2) + 'px'; box.style.top = Math.max(8, (window.innerHeight - box.offsetHeight) / 2) + 'px'; }
}
const close = () => { closeColorPicker(); timeSection.stop(); dialog.classList.remove('open'); };
function cancel() { if (pane) pane.applyAppearance(); close(); }     // revert preview
function ok() { if (pane) pane.commitAppearance(draft); close(); }
function applyAll() {
  // capture the WHOLE current chart setup (draft appearance + live lines) once, then apply it to
  // every pane through the canonical snapshot module -- no hand-rolled field list to drift.
  if (pane) { const snap = snapshotFromDraft(draft, pane); getAllPanes().forEach((p) => applyChartSettings(p, snap)); }
  close();
}
const preview = () => { if (pane) pane.previewAppearance(draft); };
// appearance controls (colorPicker / checkControl / ...) bound to the live-preview callback; destructured
// into the same names the section renderers call, so their call sites are unchanged. See sd-controls.js.
const { colorPicker, textPicker, checkControl, selectControl, numberControl, opacitySlider, checkRow, visColorRow } = makeAppearanceControls(preview);
// live-settings controls (liveCheck / lineStroke / liveColor / ...) bound to the active pane; getPane
// reads it dynamically since it's reassigned each open. Destructured into the same names. See sd-controls.js.
const { liveCheck, lineStroke, liveColor, liveText, liveNum, liveSelect, dateFmtHelp } = makeLiveControls({ getPane: () => pane, renderContent, dateFmtExamples: DATE_FMT_EXAMPLES });

// Shared context handed to each extracted section module (Tier 3): the content container + section/
// control helpers, with dynamic getters for the per-open state (pane/draft). Sections destructure
// what they use and import their own domain deps directly.
/** @type {import('./sd-controls.js').SettingsCtx} */
const ctx = {
  get content() { return content; },
  get pane() { return pane; },
  get draft() { return draft; },
  get activeCat() { return activeCat; },
  section, preview, renderContent,
  row, inlineRow, labeled, unit, helpDot,
  colorPicker, textPicker, checkControl, selectControl, numberControl, opacitySlider, checkRow, visColorRow,
  liveCheck, lineStroke, liveColor, liveText, liveNum, liveSelect, dateFmtHelp,
};

function renderNav() {
  nav.innerHTML = '';
  GROUPS.forEach((g) => {
    const h = document.createElement('div'); h.className = 'sd-nav-group'; h.textContent = t(g.title);
    nav.appendChild(h);
    g.cats.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'sd-nav-item' + (c === activeCat ? ' active' : '');
      row.textContent = t(c);
      row.onclick = () => { activeCat = c; renderNav(); renderContent(); updateFooter(); };
      nav.appendChild(row);
    });
  });
}

// chart-only footer actions (Apply to all / Template) make no sense for Global settings
function updateFooter() {
  const hide = GLOBAL_CATS.has(activeCat);
  const apply = $('sd-applyall'); if (apply) apply.style.display = hide ? 'none' : '';
  const tmplBtn = $('sd-tmpl-btn'); const tmpl = /** @type {HTMLElement | null} */ (tmplBtn && tmplBtn.closest('.sd-template'));
  if (tmpl) tmpl.style.display = hide ? 'none' : '';
}

// ---- content ----
function renderContent() {
  content.innerHTML = '';
  timeSection.stop();   // leaving any category clears the Time section's live clock interval
  if (activeCat === 'Data') return dataSection.render(ctx);
  if (activeCat === 'Time') return timeSection.render(ctx);
  if (activeCat === 'General') return generalSection.render(ctx);   // Tabs + Layout + Vocabulary
  if (activeCat === 'Status') return statusSection.render(ctx);
  if (activeCat === 'Scales') return scalesSection.render(ctx);
  if (activeCat === 'Alerts') return alertsSection.render(ctx);
  if (activeCat === 'Trading') return tradingSection.render(ctx);
  if (activeCat === 'Instrument') return instrumentSection.render(ctx);
  if (activeCat === 'Canvas') return canvasSection.render(ctx);
  if (activeCat === 'Chart Theme') return chartThemeSection.render(ctx);
  if (activeCat === 'App Theme') return themeSection.render(ctx);
  if (activeCat === 'Hotkeys') return hotkeysSection.render(ctx);
  if (activeCat === 'Notifications') return notificationsSection.render(ctx);
  if (activeCat === 'Advanced') return advancedSection.render(ctx);   // Optimization + Development
  if (activeCat === 'Assistant') return assistantSection.render(ctx);
  if (activeCat === 'About') return aboutSection.render(ctx);
  const e = document.createElement('div'); e.className = 'sd-placeholder'; e.textContent = '(coming soon)';
  content.appendChild(e);
}

// ---- controls ----
/** @param {string} label */
function section(label) { const h = document.createElement('div'); h.className = 'sd-section'; h.textContent = t(label); content.appendChild(h); }

// ---- templates ----
function initTemplateMenu() {
  const btn = /** @type {HTMLElement} */ ($('sd-tmpl-btn')), menu = /** @type {HTMLElement} */ ($('sd-tmpl-menu'));
  /** @param {string} label @param {() => void} fn */
  const add = (label, fn) => {
    const r = document.createElement('div'); r.className = 'tmpl-item'; r.textContent = label;
    r.onclick = (e) => { e.stopPropagation(); fn(); menu.classList.remove('open'); };
    menu.appendChild(r);
  };
  const render = () => {
    menu.innerHTML = '';
    add('Apply defaults', () => {
      draft = { candles: structuredClone(CANDLES_DEFAULT), canvas: structuredClone(CANVAS_DEFAULT), statusLine: structuredClone(STATUS_DEFAULT), indicators: structuredClone(INDICATORS_DEFAULT) };
      if (pane) pane.applyLineSettings(structuredClone(LINE_DEFAULTS));   // "Scales and lines" reset live
      renderContent(); preview();
    });
    add('Save as…', async () => {
      const name = await namePrompt({
        title: 'Save chart template', label: 'New template name', placeholder: 'Template name',
        existing: listTemplates().map((t) => t.name),
        replaceMessage: (n) => `Chart Template '${n}' already exists. Do you really want to replace it?`,
      });
      // a template is the WHOLE CHART-group setup -- captured once by the snapshot module, so it can
      // never drift from what Apply/Import restore.
      if (name && pane) saveTemplate(name, snapshotFromDraft(draft, pane));
    });
    add('Open folder', () => openTemplatesFolder());
    add('Import…', () => importJsonFile((d) => {
      if (!d || !d.name || !isChartSnapshot(d)) return false;
      const { name, ...rest } = d;   // store the WHOLE snapshot (every section), not a truncated subset
      saveTemplate(name, rest);
      render();
      return true;
    }, t('That file is not a chart template.')));
    const list = listTemplates();
    if (list.length) { const d = document.createElement('div'); d.className = 'tmpl-div'; menu.appendChild(d); }
    list.forEach((t) => {
      const row = document.createElement('div'); row.className = 'tmpl-item tmpl-row';
      const lbl = document.createElement('span'); lbl.className = 'tmpl-label'; lbl.textContent = t.name;
      lbl.onclick = (e) => {
        e.stopPropagation();
        applySnapshotToDraft(draft, pane, t);   // load the WHOLE snapshot into the draft + lines (previewed; commits on Ok)
        renderContent(); preview(); menu.classList.remove('open');
      };
      const x = document.createElement('span'); x.className = 'tmpl-x'; x.textContent = '✕'; x.title = 'Delete template';
      x.onclick = async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({ title: 'Delete template', message: `Delete the template '${t.name}'? This cannot be undone.`, yes: 'Delete', no: 'Cancel' });
        if (ok) { deleteTemplate(t.name); render(); }
      };
      row.append(lbl, x);
      menu.appendChild(row);
    });
  };
  btn.onclick = (e) => { e.stopPropagation(); render(); menu.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!menu.contains(/** @type {Node} */ (e.target)) && e.target !== btn) menu.classList.remove('open'); });
}
