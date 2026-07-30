// @ts-check
// Indicator-templates dropdown (next to the ƒx Indicators button). Save the active
// chart's indicators as a named template, and apply a saved template to the active
// chart. Templates are a global library (settings/indicator-templates.json); each
// chart keeps its own indicators — Save captures them, Apply replaces them.
import { $ } from '../dom.js';
import { getActivePane } from '../chart/layout.js';
import { getStudy } from './registry.js';
import { namePrompt } from '../ui/name-prompt.js';
import { listStudyTemplates, saveStudyTemplate, deleteStudyTemplate, touchStudyTemplate } from './templates.js';
import { t } from '../i18n/i18n.js';

export function initStudyTemplates() {
  const btn = $('btnStudyTpl');
  const menu = $('studyTplMenu');
  if (!btn || !menu) return;
  const close = () => menu.classList.remove('open');
  /** @param {string} [cls] @param {string} [txt] @returns {HTMLDivElement} */
  const el = (cls, txt) => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    if (txt != null) d.textContent = txt;
    return d;
  };

  /** @param {{ id: string, [k: string]: any }} s @returns {string} */
  const nameOf = (s) => {
    const st = getStudy(s.id);
    return st ? st.name : s.id;
  };
  /** @param {import('./templates.js').StudyTemplate} tpl @returns {string} */
  const subtitle = (tpl) => (tpl.studies || []).map(nameOf).join(', ') || t('No indicators');

  const render = () => {
    menu.innerHTML = '';
    const pane = getActivePane();

    // Save the current chart's indicators as a template
    const saveRow = el('study-row');
    saveRow.append(
      el('stpl-lico', '⬆'),
      (() => {
        const s = el('lbl', t('Save indicator template…'));
        return s;
      })(),
    );
    saveRow.onclick = async () => {
      close();
      if (!pane) return;
      const studies = pane.studies.serialize();
      const name = await namePrompt({
        title: t('Save indicator template'),
        label: t('Template name'),
        placeholder: t('Template name'),
        existing: listStudyTemplates().map((tpl) => tpl.name),
        replaceMessage: (n) =>
          t("Indicator template '{n}' already exists. Do you really want to replace it?").replace('{n}', n),
      });
      if (name) saveStudyTemplate(name, studies);
    };
    menu.appendChild(saveRow);

    const list = listStudyTemplates();
    if (list.length) {
      menu.appendChild(el('stpl-div'));
      menu.appendChild(el('study-head', t('Recently used')));
      list.forEach((tpl) => {
        const row = el('stpl-row');
        const col = el('stpl-col');
        col.append(el('stpl-name', tpl.name), el('stpl-sub', subtitle(tpl)));
        const del = el('stpl-del', '✕');
        del.title = t('Delete template');
        del.onclick = (e) => {
          e.stopPropagation();
          deleteStudyTemplate(tpl.name);
          render();
        };
        row.append(col, del);
        row.onclick = () => {
          close();
          if (pane) {
            pane.studies.applyTemplate(tpl.studies);
            touchStudyTemplate(tpl.name);
          }
        };
        menu.appendChild(row);
      });
    }
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
    const tgt = /** @type {Node} */ (e.target);
    if (!menu.contains(tgt) && e.target !== btn && !btn.contains(tgt)) close();
  });
}
