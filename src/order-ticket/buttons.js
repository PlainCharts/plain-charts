// @ts-check
// User-configurable quick-action buttons for the order ticket. Each button is a LABEL + a SCRIPT written in the
// small trading DSL (see dsl.js): e.g. "buy 5 and set stop 20 and set target 40". Buttons live in named TEMPLATES
// (templates-store.js); the user switches between them from the editor's dropdown, and the ACTIVE template's buttons
// are the ones shown on the ticket. Templates persist to settings/trading/order-buttons.json (/api/order-buttons).
import { parseScript, command } from '../../data_engine/index.js'; // pure parser (validation) + the order-worker command funnel
import { state } from './ticket-state.js'; // a bare "buy"/"sell" trigger fires the active tab's Buy/Sell (state.fire)
import { comboOf } from '../edit/combo.js'; // pure key-combo helper (no app-window deps) for the local hotkey dispatch
import { requestAppCombos, onQuickButtonForward } from '../edit/order-hotkeys.js'; // cross-window: warm the conflict cache + receive forwarded chords (global fire)
import { loadTemplates, activeTemplateId, templateButtons } from './templates-store.js'; // the active template's buttons (autosaved sets)
import { openEditor } from './buttons-editor.js'; // the gear editor modal (opens on the gear click)
import { t } from '../i18n/i18n.js'; // vocabulary lookup for the bar chrome (button labels + script text stay user data)

/** @typedef {import('./templates-store.js').ButtonDef} ButtonDef */

// --- the footer bar: the ACTIVE template's buttons + a gear (floated into the body corner) ---
/** @param {() => any} getCtx @returns {HTMLElement} */
export function buildButtonBar(getCtx) {
  /** @type {ButtonDef[]} the active template's buttons (a live read; the editor commits through the store) */
  let buttons = [];
  const bar = document.createElement('div');
  bar.className = 'ot-footer';
  const status = document.createElement('span');
  status.className = 'ot-foot-status';
  const barRow = document.createElement('div');
  barRow.className = 'ot-bar-row';
  const row = document.createElement('div');
  row.className = 'ot-qbtns';
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'ot-gear';
  gear.textContent = '⚙';
  gear.title = t('Configure buttons');

  /** @param {string} msg @param {boolean} [err] */
  const setStatus = (msg, err) => {
    status.textContent = msg;
    status.className = 'ot-foot-status' + (err ? ' err' : '');
  };
  // Send the button's script to the ORDER WORKER (order-host). This surface holds NO order logic -- it dispatches a
  // command and reflects the outcome; the book (journal + on-chart dots) updates from the worker's execution.
  /** @param {ButtonDef} b */
  const run = (b) => {
    // a bare "buy"/"sell" is a UI TRIGGER: fire the active tab's Buy/Sell exactly as set up (the tab holds the form, so
    // it can't go through the worker like other scripts). The tab's own status area shows the order ack.
    let trigger = null;
    try {
      const ops = parseScript(b.script);
      if (ops.length === 1 && ops[0].op === 'market' && ops[0].trigger) trigger = ops[0].side;
    } catch (_) {}
    if (trigger) {
      if (state.fire) {
        setStatus('');
        state.fire(trigger);
      } else setStatus('no ' + t(trigger) + ' setup on this tab', true);
      return;
    }
    setStatus('…');
    command({ type: 'script', script: b.script, ctx: getCtx() })
      .then((/** @type {any} */ r) => {
        const ok = r && r.ok;
        setStatus(ok ? 'done' : (r && r.error) || 'failed', !ok);
      })
      .catch((/** @type {any} */ e) => setStatus(e.message, true));
  };

  const fitWindow = () =>
    requestAnimationFrame(() => {
      row.style.flex = '0 0 auto';
      const natural = row.offsetWidth;
      row.style.flex = ''; // measure natural, then restore stretch
      const d = /** @type {any} */ (window).desktop;
      if (natural && d && d.orderTicketWidth) d.orderTicketWidth(natural + 16 + 16 + 8);
    });
  const renderBar = () => {
    row.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ot-btn-close';
      btn.textContent = b.label;
      btn.title = b.script;
      btn.onclick = () => run(b);
      row.appendChild(btn);
    }
    fitWindow();
    if (state.fitHeight) state.fitHeight(); // added/removed buttons change the footer height -> refit the window
  };
  // re-read the active template's buttons and repaint the bar (called after the editor closes / switches template)
  const refresh = () => {
    buttons = templateButtons(activeTemplateId());
    renderBar();
  };
  gear.onclick = () => openEditor(refresh);

  // HOTKEY DISPATCH -- this window owns the button run(), so it is the sole executor. A chord fires a button
  // whether the order ticket is focused (local keydown below) or another window is focused (that window
  // forwards the chord over the bus). Both paths funnel through fireByCombo, so a press acts exactly once.
  /** @param {string} combo */
  const fireByCombo = (combo) => {
    const b = buttons.find((x) => x.hotkey === combo);
    if (b) run(b);
  };
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey || e.altKey)) return; // button hotkeys always carry a modifier
    if (document.querySelector('.ot-editor, .ot-scripted')) return; // never fire an order while configuring buttons
    const b = buttons.find((x) => x.hotkey === comboOf(e));
    if (b) {
      e.preventDefault();
      run(b);
    }
  });
  onQuickButtonForward(fireByCombo); // a chord pressed while another window was focused

  barRow.append(row);
  bar.append(status, barRow, gear);
  requestAppCombos(); // warm the conflict cache: ask the chart window to serve its command/tool combos
  loadTemplates().then(refresh);
  renderBar();
  return bar;
}
