// @ts-check
// Reusable "name this thing" dialog: a themed text input with autocomplete over
// existing names and an overwrite confirmation — the same UX as the drawing-template
// Save dialog, so anything that needs a name (chart-style templates, saved layouts…)
// can drop window.prompt and get the nice dialog instead.
//
// Resolves to the chosen (trimmed) name, or null if the user cancelled. When the name
// matches an existing one, the user is asked to confirm the replacement first.
import { confirmDialog } from './confirm.js';
import { t } from '../i18n/i18n.js'; // vocabulary lookup

/** @param {string} tag @param {string|null} [cls] @param {string|null} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/** @type {HTMLElement|null} */
let overlay = null;
export function closeNamePrompt() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

/**
 * @param {{ title?: string, label?: string, placeholder?: string, value?: string,
 *   existing?: string[], save?: string, replaceMessage?: (n: string) => string }} [opts]
 * @returns {Promise<string|null>}
 */
export function namePrompt({
  title = 'Save',
  label = 'Name',
  placeholder = 'Name',
  value = '',
  existing = [],
  save = 'Save',
  replaceMessage,
} = {}) {
  closeNamePrompt();
  return new Promise((resolve) => {
    // 100: above the Settings dialog (50) but below confirmDialog (110), so the
    // overwrite confirmation stacks on top of this prompt instead of behind it.
    overlay = el('div', 'modal open');
    overlay.style.zIndex = '100';
    const dlg = el('div', 'dialog tmpl-save');

    const head = el('div', 'set-head');
    const x = el('span', 'lib-x', '✕');
    head.append(el('span', 'set-title', t(title)), x);
    dlg.appendChild(head);

    const body = el('div', 'tmpl-save-body');
    body.appendChild(el('label', 'tmpl-save-lbl', t(label)));
    const combo = el('div', 'tmpl-combo');
    const inp = /** @type {HTMLInputElement} */ (el('input', 'tmpl-save-input'));
    inp.type = 'text';
    inp.placeholder = t(placeholder);
    inp.value = value;
    const suggest = el('div', 'tmpl-suggest');
    combo.append(inp, suggest);
    body.appendChild(combo);
    dlg.appendChild(body);

    const foot = el('div', 'dlg-actions');
    const cancelBtn = el('button', null, t('Cancel'));
    const saveBtn = el('button', 'primary', t(save));
    foot.append(cancelBtn, saveBtn);
    dlg.appendChild(foot);

    overlay.appendChild(dlg);
    document.body.appendChild(overlay);

    const done = (/** @type {string|null} */ v) => {
      closeNamePrompt();
      resolve(v);
    };
    const submit = async () => {
      const name = inp.value.trim();
      if (!name) {
        inp.focus();
        return;
      }
      if (existing.some((n) => n === name)) {
        // overwrite → confirm first
        const ok = await confirmDialog({
          message: replaceMessage ? replaceMessage(name) : `'${name}' ` + t('already exists. Replace it?'),
        });
        if (!ok) {
          inp.focus();
          return;
        }
      }
      done(name);
    };

    const renderSuggest = () => {
      const q = inp.value.trim().toLowerCase();
      // names that START WITH the query but aren't an exact match (narrows as you type)
      const names = !q
        ? []
        : existing.filter((n) => {
            const nl = n.toLowerCase();
            return nl.startsWith(q) && nl !== q;
          });
      suggest.innerHTML = '';
      names.forEach((n) => {
        const r = el('div', 'tmpl-suggest-row', n);
        r.onmousedown = (e) => {
          e.preventDefault();
          inp.value = n;
          renderSuggest();
          inp.focus();
        };
        suggest.appendChild(r);
      });
      suggest.style.display = names.length ? 'block' : 'none';
    };

    x.onclick = () => done(null);
    cancelBtn.onclick = () => done(null);
    saveBtn.onclick = submit;
    overlay.onclick = (e) => {
      if (e.target === overlay) done(null);
    };
    inp.oninput = renderSuggest;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') done(null);
    };
    renderSuggest();
    setTimeout(() => inp.focus(), 0);
  });
}
