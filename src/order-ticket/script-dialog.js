// @ts-check
// The quick-button SCRIPT DIALOG -- a 3-row textarea + the clickable command reference (tabbed by family) + Cancel/Save.
// A self-contained modal the button editor opens to author one button's DSL script; validates live against the parser.
// The script SYNTAX is the English trading DSL (see dsl.js) and is NOT
// translated -- only the dialog chrome (Edit script / Cancel / Save) goes through t().
import { parseScript } from '../../data_engine/index.js';   // pure parser -- live validation of the authored script
import { t } from '../i18n/i18n.js';   // vocabulary lookup for the dialog chrome (the DSL keywords themselves stay English)

// clickable vocabulary shown in the script dialog, GROUPED into tabs (buy/sell, set, move, close) so the reference stays
// short as the command set grows. Each item is [snippet, description]; clicking a snippet appends it with an "and" connector.
/** @type {{ tab: string, items: [string, string][] }[]} */
const VOCAB_GROUPS = [
  { tab: 'buy/sell', items: [
    ['buy', 'fire this tab as set up (like the Buy button)'],
    ['sell', 'fire this tab as set up (like the Sell button)'],
    ['buy 5', 'market buy N lots'],
    ['sell 2', 'market sell N lots'],
    ['buy stake 100', 'buy sized so $N is at risk to the stop (needs "set stop")'],
    ['sell stake 100', 'sell sized so $N is at risk to the stop (needs "set stop")'],
  ] },
  { tab: 'set', items: [
    ['set stop 10', 'stop-loss N away (pips on forex, pts on index)'],
    ['set target 20', 'take-profit N away (pips on forex, pts on index)'],
  ] },
  { tab: 'move', items: [
    ['move stop be', 'move stop to break-even (entry)'],
    ['move stop be +2', 'break-even plus a buffer (locks N in profit)'],
    ['move stop 5', 'nudge stop N (pips/pts) toward entry'],
  ] },
  { tab: 'close', items: [
    ['close all', 'flatten: cancel all orders + close all positions'],
    ['close symbol', 'close all of this symbol'],
    ['close buy', 'close this symbol long positions'],
    ['close sell', 'close this symbol short positions'],
    ['close partial 2', 'reduce the position by N lots/contracts/shares'],
  ] },
];

// --- the script dialog: a 3-row textarea + the clickable command list + Cancel/Save ---
/** @param {string} current @param {(val: string) => void} onSave */
export function openScriptDialog(current, onSave) {
  const rootEl = /** @type {HTMLElement} */ (document.getElementById('order-root'));
  const ov = document.createElement('div'); ov.className = 'ot-scripted';

  const head = document.createElement('div'); head.className = 'ot-ed-head';
  const title = document.createElement('span'); title.textContent = t('Edit script');
  const x = document.createElement('button'); x.type = 'button'; x.className = 'ot-ed-x'; x.textContent = '✕'; x.title = t('Cancel'); x.onclick = () => ov.remove();
  head.append(title, x);

  const ta = document.createElement('textarea'); ta.className = 'ot-scripted-ta'; ta.rows = 3; ta.value = current || ''; ta.placeholder = 'buy 5 and set stop 20 and set target 40';
  const err = document.createElement('div'); err.className = 'ot-scripted-err';
  const validate = () => { try { if (ta.value.trim()) parseScript(ta.value); err.textContent = ''; ta.classList.remove('invalid'); return true; } catch (e) { err.textContent = (/** @type {any} */ (e)).message; ta.classList.add('invalid'); return false; } };
  ta.oninput = validate;

  // command reference, TABBED by family (buy/sell, set, move, close) so the list stays short as commands grow. The tab bar
  // sits above a scrolling list; clicking a tab shows only that family. Clicking a command appends it to the textarea.
  const tabsBar = document.createElement('div'); tabsBar.className = 'ot-cmd-tabs';
  const cmds = document.createElement('div'); cmds.className = 'ot-scripted-cmds';
  const append = (/** @type {string} */ snippet) => { const v = ta.value.trim(); ta.value = v ? (v + ' and ' + snippet) : snippet; validate(); ta.focus(); };
  /** @param {number} gi */
  const renderCmds = (gi) => {
    cmds.innerHTML = '';
    for (const [snippet, desc] of VOCAB_GROUPS[gi].items) {
      const c = document.createElement('div'); c.className = 'ot-cmd';
      const sp = document.createElement('span'); sp.className = 'ot-cmd-t'; sp.textContent = snippet;   // script SYNTAX (English DSL keywords) -- not translated
      const d = document.createElement('span'); d.className = 'ot-cmd-d'; d.textContent = desc;
      c.append(sp, d);
      c.onclick = () => append(snippet);
      cmds.appendChild(c);
    }
  };
  VOCAB_GROUPS.forEach((g, gi) => {
    const tb = document.createElement('button'); tb.type = 'button'; tb.className = 'ot-cmd-tab'; tb.textContent = g.tab;   // family names are DSL keywords, not translated
    tb.onclick = () => { [...tabsBar.children].forEach((c) => c.classList.remove('active')); tb.classList.add('active'); renderCmds(gi); };
    tabsBar.appendChild(tb);
  });
  /** @type {HTMLElement} */ (tabsBar.firstElementChild).classList.add('active');
  renderCmds(0);

  const foot = document.createElement('div'); foot.className = 'ot-scripted-foot';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'ot-btn-close'; cancel.textContent = t('Cancel'); cancel.onclick = () => ov.remove();
  const save = document.createElement('button'); save.type = 'button'; save.className = 'ot-btn-primary'; save.textContent = t('Save'); save.onclick = () => { if (validate()) { onSave(ta.value.trim()); ov.remove(); } };
  foot.append(cancel, save);

  ov.append(head, ta, err, tabsBar, cmds, foot);
  validate();
  rootEl.appendChild(ov);
  ta.focus();
}
