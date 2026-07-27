// @ts-check
// Reusable code-editor modal with a console at the bottom. Used by both the
// indicator editor and the addon editor. The shell handles the UI; the caller's
// onSave(fileName, code, api) does the save/validate and reports via api.setCon.
import { getStudy } from './registry.js';
import { reloadUserFile, studyIdForFile } from './user-loader.js';
import { getActivePane } from '../chart/layout.js';
import { log } from '../dom.js';
import { t } from '../i18n/i18n.js';   // vocabulary lookup (the code TEMPLATE stays as example source)

/**
 * The small API the shell hands to the caller's onSave.
 * @typedef {{ setCon: (text: string, kind?: string) => void, close: () => void, lockName: () => void }} EditorApi
 */
/**
 * Options for the reusable code-editor shell.
 * @typedef {{ title?: string, name?: string, code?: string, nameLabel?: string, saveLabel?: string,
 *   onSave: (fileName: string, code: string, api: EditorApi) => (void | Promise<void>) }} CodeEditorOpts
 */

/** @type {HTMLElement | null} */
let overlay = null;

export function closeEditor() { if (overlay) { overlay.remove(); overlay = null; } }

/** @param {CodeEditorOpts} opts */
export function openCodeEditor({ title = 'Editor', name = '', code = '', nameLabel = 'File name', saveLabel = 'Save & load', onSave }) {
  closeEditor();
  overlay = document.createElement('div');
  overlay.className = 'modal open'; overlay.style.zIndex = '65';
  overlay.onclick = (e) => { if (e.target === overlay) closeEditor(); };

  const dlg = document.createElement('div'); dlg.className = 'dialog editor';
  const h = document.createElement('h3'); h.textContent = t(title);

  const nameRow = document.createElement('div'); nameRow.className = 'row';
  nameRow.append(Object.assign(document.createElement('label'), { textContent: t(nameLabel) }));
  const nameInp = document.createElement('input');
  nameInp.value = name; nameInp.placeholder = t('my_name'); nameInp.autocomplete = 'off';
  if (name) nameInp.disabled = true;
  nameRow.append(nameInp);

  const ta = document.createElement('textarea'); ta.className = 'editor-code'; ta.value = code; ta.spellcheck = false;
  ta.onkeydown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 2;
    }
  };

  const conLabel = document.createElement('div'); conLabel.className = 'editor-con-label'; conLabel.textContent = t('Console');
  const con = document.createElement('div'); con.className = 'editor-console';
  /** @param {string} text @param {string} [kind] */
  const setCon = (text, kind) => { con.textContent = text; con.className = 'editor-console' + (kind ? ' ' + kind : ''); };
  setCon(t('Press') + ' ' + t(saveLabel) + ' ' + t('to save and check.'));

  const actions = document.createElement('div'); actions.className = 'dlg-actions';
  const closeBtn = document.createElement('button'); closeBtn.textContent = t('Close'); closeBtn.onclick = closeEditor;
  const save = document.createElement('button'); save.className = 'primary'; save.textContent = t(saveLabel);
  const api = { setCon, close: closeEditor, lockName: () => { nameInp.disabled = true; } };
  save.onclick = async () => {
    const fn = (name || nameInp.value).trim();
    if (!fn) { setCon(t('Enter a name.'), 'err'); return; }
    try { await onSave(fn, ta.value, api); }
    catch (/** @type {any} */ e) { setCon('✗ ' + ((e && e.message) || e), 'err'); }
  };
  actions.append(closeBtn, save);

  dlg.append(h, nameRow, ta, conLabel, con, actions);
  overlay.append(dlg);
  document.body.appendChild(overlay);
  ta.focus();
}

// ---------------------------------------------------------------------------
// Indicator editor — one consumer of the shell. Saves to user studies, loads,
// and test-runs calc() on real bars to surface syntax/runtime errors.
// ---------------------------------------------------------------------------
const TEMPLATE = `// Full JS — no DSL. Define an indicator and register it.
Studies.register({
  id: 'my_indicator',                 // unique id (also used to persist on charts)
  name: 'My Indicator',
  overlay: true,                      // true = draw on price; false = own sub-pane (oscillator)
  inputs: [                           // calculation parameters only — appearance is on the Style tab
    { key: 'length', name: 'Length', type: 'number', default: 14, min: 1 },
    { key: 'source', name: 'Source', type: 'source', default: 'close' },
  ],
  // bars: [{ time, open, high, low, close, volume }]   p = input values
  calc(bars, p) {
    const out = [];
    let sum = 0, len = Math.max(1, p.length | 0);
    for (let i = 0; i < bars.length; i++) {
      const v = Studies.priceOf(bars[i], p.source);
      sum += v;
      if (i >= len) sum -= Studies.priceOf(bars[i - len], p.source);
      if (i >= len - 1) out.push({ time: bars[i].time, value: sum / len });
    }
    // each plot: { key, name, type:'line'|'histogram'|'area'|'baseline', color, lineWidth,
    //   lineStyle:0..4, data } — these are defaults; the user restyles them on the Style tab.
    return { plots: [{ key: 'line', name: 'My Indicator', type: 'line', color: '#e0a030', lineWidth: 2, data: out }] };
  },
});
`;

const STUB_SERIES = { feed() {}, configure() {} };
const STUB_CHART = { addPlot: () => STUB_SERIES, removePlot() {} };
/** @param {StudySpec} study @returns {Record<string, any>} */
const defaultParams = (study) => { const p = /** @type {Record<string, any>} */ ({}); (study.inputs || []).forEach((i) => { p[i.key] = i.default; }); return p; };

function sampleBars() {
  const pane = getActivePane();
  const b = pane && pane.studies && pane.studies.bars;
  if (b && b.length) return b;
  const out = []; let price = 100;
  for (let i = 0; i < 200; i++) {
    price += Math.sin(i / 7) * 0.6;
    const o = price, c = price + 0.2, h = Math.max(o, c) + 0.3, l = Math.min(o, c) - 0.3;
    out.push({ time: 1700000000 + i * 60, open: o, high: h, low: l, close: c, volume: 1000 });
  }
  return out;
}

/** @param {{ name?: string, code?: string, onSaved?: () => void }} [opts] */
export function openEditor({ name = '', code = TEMPLATE, onSaved } = {}) {
  openCodeEditor({
    title: name ? t('Edit indicator') : t('New indicator'),
    name, code: code || TEMPLATE,
    onSave: async (fn, src, api) => {
      api.setCon('Saving…');
      const r = await fetch('/api/user-studies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fn, code: src }) })
        .then((x) => x.json()).catch((e) => ({ error: String(e) }));
      if (r.error) { api.setCon('✗ Could not save: ' + r.error, 'err'); return; }
      try { await reloadUserFile(r.file); }
      catch (/** @type {any} */ e) { api.setCon('✗ Load error\n' + (e.stack || e.message || e), 'err'); return; }
      const id = studyIdForFile(r.file);
      const study = id && getStudy(id);
      if (!study) { api.setCon('✗ Loaded, but nothing registered.\nDid you call Studies.register({ id, name, calc }) ?', 'err'); return; }
      if (typeof study.calc !== 'function') { api.setCon('✗ "' + (study.name || id) + '" has no calc(bars, p) function.', 'err'); return; }
      try {
        const ctx = { params: defaultParams(study), chart: STUB_CHART, decimals: 2, fetch: (/** @type {string} */ u) => fetch(u).then((x) => x.json()) };
        const out = await study.calc(sampleBars(), ctx.params, ctx);
        if (!out || !Array.isArray(out.plots)) throw new Error('calc must return { plots: [ ... ] }');
        const pts = out.plots.reduce((/** @type {number} */ n, /** @type {StudyPlot} */ pl) => n + ((pl.data && pl.data.length) || 0), 0);
        api.setCon('✓ Compiled and ran OK\n' + study.name + ' — ' + out.plots.length + ' plot(s), ' + pts + ' points. Applied to charts.', 'ok');
      } catch (/** @type {any} */ e) {
        api.setCon('✗ Runtime error in calc()\n' + (e.stack || e.message || e), 'err');
        return;
      }
      api.lockName();
      log(t('Indicator') + ' "' + r.file + '" ' + t('loaded.'));
      if (onSaved) onSaved();
    },
  });
}
