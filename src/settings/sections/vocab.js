// @ts-check
// Settings -> Vocabulary section (Tier 3 of the chart-dialog de-monolith). Choose the words the app
// uses -- translation/vocabulary packs. Receives the shared `ctx` (content container + helpers) from
// the shell and imports its own domain deps directly.
import { listVocabPacks, getActiveVocab, setActiveVocab, openVocabFolder, importVocabPack } from '../../i18n/i18n.js';

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section, renderContent } = ctx;
  section('VOCABULARY');
  const hint = document.createElement('div');
  hint.style.cssText = 'color: var(--tx-dim); font-size: 12px; padding: 4px 0 10px; line-height: 1.45;';
  hint.textContent = 'Choose the words the app uses.';
  content.appendChild(hint);

  const bar = document.createElement('div'); bar.className = 'theme-bar';
  const sel = document.createElement('select');
  const none = document.createElement('option'); none.value = ''; none.textContent = '(default words)'; sel.appendChild(none);
  listVocabPacks().forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  sel.value = getActiveVocab();
  sel.onchange = () => { setActiveVocab(sel.value); };
  const btn = (/** @type {string} */ label, /** @type {() => void} */ fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; return b; };
  bar.append(sel,
    btn('Folder', () => openVocabFolder()),
    btn('Import', () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { let d; try { d = JSON.parse(/** @type {string} */ (r.result)); } catch (_) { alert('That file is not valid JSON.'); return; } if (!importVocabPack(d)) { alert('That file is not a vocabulary pack (needs name + words).'); return; } renderContent(); };
        r.readAsText(f);
      };
      inp.click();
    }));
  content.appendChild(bar);
}
