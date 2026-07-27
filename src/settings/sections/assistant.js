// @ts-check
// Settings -> App -> Assistant. User-configurable rules that gate what an AI assistant may do in the app.
// The toggles here are the policy; the intended MCP surface and the data-host order boundary read it (see
// assistant-policy.js). Grouped Access / Authoring / Execution -- execution is off by default, and its
// "confirm every order" modifier is greyed until execution is enabled.
import { ASSISTANT_RULES, getAssistantPolicy, setAssistantRule, isAssistantServerEnabled, setAssistantServerEnabled } from '../assistant-policy.js';
import { t } from '../../i18n/i18n.js';   // vocabulary lookup

/** @param {import('../sd-controls.js').SettingsCtx} ctx */
export function render(ctx) {
  const { content, section } = ctx;

  const intro = document.createElement('div');
  intro.className = 'sd-placeholder';
  intro.style.marginBottom = '8px';
  intro.textContent = t('What an AI assistant is allowed to do in this app. The server is off until enabled, and order execution is off by default.');
  content.appendChild(intro);

  // Master switch -- the MCP server (a localhost endpoint an AI client connects to) does not run until this
  // is on. Everything below is still separately gated. Starts/stops within a couple of seconds.
  section('SERVER');
  const srow = document.createElement('div'); srow.className = 'sd-row';
  const schk = document.createElement('input'); schk.type = 'checkbox'; schk.checked = isAssistantServerEnabled();
  schk.onchange = () => setAssistantServerEnabled(schk.checked);
  const sl = document.createElement('span'); sl.className = 'sd-label'; sl.textContent = t('Enable assistant server (local MCP endpoint)');
  srow.append(schk, sl);
  content.appendChild(srow);

  const policy = getAssistantPolicy();
  /** @type {Record<string, HTMLInputElement>} */
  const boxes = {};

  // "Confirm every order" only applies while order execution is allowed -- disable + dim it otherwise.
  const sync = () => {
    const on = !!(boxes['execute.orders'] && boxes['execute.orders'].checked);
    const c = boxes['execute.confirm'];
    if (c) { c.disabled = !on; const row = c.parentElement; if (row) row.style.opacity = on ? '' : '0.45'; }
  };

  /** @type {string[]} */
  const groups = [];
  ASSISTANT_RULES.forEach((r) => { if (!groups.includes(r.group)) groups.push(r.group); });

  groups.forEach((g) => {
    section(g.toUpperCase());
    ASSISTANT_RULES.filter((r) => r.group === g).forEach((r) => {
      const row = document.createElement('div'); row.className = 'sd-row';
      const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!policy[r.key];
      chk.onchange = () => { setAssistantRule(r.key, chk.checked); sync(); };
      const l = document.createElement('span'); l.className = 'sd-label'; l.textContent = t(r.label);
      row.append(chk, l);
      content.appendChild(row);
      boxes[r.key] = chk;
    });
  });

  sync();
}
