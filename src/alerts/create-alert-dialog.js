// @ts-check
// The create/edit-alert DIALOG — assembly + openers only. It composes the extracted pieces into a floating,
// draggable, properties-panel-style panel (four collapsible sections: General · Conditions · Message · Actions) and
// sends the result through the alert funnel. The building blocks live in their own modules:
//   - form-control builders (the section widgets) come from dialog-controls.js (view leaf)
//   - the pure UI-conditions -> compiled-terms logic from alert-conditions.js (DOM-free leaf)
//   - the alert<->drawing glue (edit-mode lookup, quick alerts, delete cascade) from alert-drawing-sync.js
// Opened from a drawing's right-click menu (drawing-menu.js), the price-scale quick editor (quick-coords.js), and the
// Alerts manager's "+"/Edit (openValueAlertDialog). Create/Save funnels a draft to the alert-host via alertCommand
// (the ONLY writer); the host persists + broadcasts to every window's read-only mirror.
import { t } from '../i18n/i18n.js';
import { getTool } from '../tools/registry.js';
import { studyLabel } from '../../lib/kapelka/skin/legend.js';   // label attached indicators like the chart legend
import { el, roundPrice, section, field, selectOf, enableToggle, expirationControl, conditionsControl, actionsControl, messageControl, isMoveOp, intervalControl } from './dialog-controls.js';   // pure DOM form-control builders (view leaf)
import { anchorLevel, compileConditions } from './alert-conditions.js';   // pure UI-conditions -> compiled host terms (leaf, no DOM)
import { cadenceOf } from './eval.js';   // compile the Trigger label -> stable cadence key (host reads the field, not the label)
import { alertForObject } from './alert-drawing-sync.js';   // edit mode: the existing alert on this drawing (drawing<->alert glue lives there)
import { alertCommand } from './funnel.js';   // the single mutator path to the alert-host
import { byId as tfById, listIntervals, favTimeframes, firstTf } from '../workspace/timeframes.js';   // the alert's own interval picker + tf id -> {id,unit,n}
import { getJSON } from '../api.js';   // read the persisted watchlists to list in "Apply to" (placeholder, no logic yet)

/** the active chart's current price (last bar close), rounded to instrument decimals; null if unknown. @param {any} pane */
function lastPrice(pane) {
  const bars = (pane && pane.barArr) || [];
  const last = bars.length ? bars[bars.length - 1] : null;
  const c = last && Number(last.close);
  return Number.isFinite(c) ? roundPrice(c, pane && pane.priceDecimals) : null;
}

// Trigger cadences — LABELS ONLY (no sub-text). The dialog picks from these via selectOf; the
// other option lists (expiration/conditions/actions/placeholders) live with their controls in dialog-controls.js.
const TRIGGERS = ['Once only', 'Once per bar', 'Once per bar close', 'Once per minute'];

/** @type {HTMLElement | null} */
let panel = null;

export function closeCreateAlertDialog() {
  if (panel) { panel.remove(); panel = null; }
}

/**
 * The alert descriptor this dialog produces. The engine grows on this shape later.
 * @typedef {Object} AlertDraft
 * @property {string} symbol
 * @property {{ kind:'symbol', symbol:string } | { kind:'watchlist', listId:string, name:string }} apply  scope: one symbol, or every symbol in a watchlist
 * @property {string} tf
 * @property {{ id: string, unit: string, n: number }|null} tfObj  resolved timeframe (the headless host can't resolve an id)
 * @property {string|null} broker  broker id the symbol belongs to (null = the host's active broker)
 * @property {string|null} objectId    the drawing this alert is anchored to (null = a Value-based alert, no chart object)
 * @property {string|null} tool         the drawing's tool id (hline, trendline, rect, …); null for a Value alert
 * @property {{ tool: string, points: { time: any, price: any }[], level: number|null }|null} anchor  snapshot of the anchored geometry (null for a Value alert)
 * @property {string} name
 * @property {boolean} enabled
 * @property {string} trigger     one of TRIGGERS
 * @property {string} expiration  an expiration preset (labels in dialog-controls.js)
 * @property {number|null} expiryMs  resolved expiry epoch ms (local); null for "Open-ended"
 * @property {{ match: string, conditions: { left: string, op: string, right: string }[] }} conditions  the UI form (for editing/display)
 * @property {{ match: 'all'|'any', terms: { op: string, level?: number }[] }} compiled  host-friendly terms the eval loop reads
 * @property {string} message   free text; may embed placeholder tokens (#symbol, #price, …)
 * @property {string[]} actions  actions to run when the alert fires
 */

// The seam into the engine: send the draft as a 'create' command to the alert-host (the ONLY writer). Fire
// and close -- never await, so a slow/absent host can't wedge the dialog open; the host persists + broadcasts
// to every window's mirror.
/** @param {AlertDraft} draft */
function onCreate(draft) {
  alertCommand('create', draft).catch((err) => console.error('[alert] create failed', err));
  closeCreateAlertDialog();
}

/**
 * Open the Create-alert dialog anchored to one drawing (right-click menu, or Edit from the manager).
 * @param {any} engine   the pane's DrawingEngine (opaque handle)
 * @param {string} id    the drawing id the alert is anchored to
 */
export function openCreateAlertDialog(engine, id) {
  const d = engine.get(id);
  if (!d) return;
  const pane = engine.pane || {};
  openAlertDialog({ pane, drawing: d, existing: alertForObject(pane.symbol || '', id) });
}

/**
 * Open the Create-alert dialog with NO chart object — a Value-based alert added from the manager's "+".
 * The Object columns offer only Price and Value (you're not on the chart, so nothing to anchor to); the
 * alert is created with objectId/anchor null. `pane` supplies the symbol/tf/decimals to watch (the active
 * chart). `existing` prefills edit mode. @param {any} pane @param {any} [existing]
 */
export function openValueAlertDialog(pane, existing) {
  openAlertDialog({ pane: pane || {}, drawing: null, existing: existing || null });
}

/**
 * Open the Create-alert dialog scoped to a WHOLE WATCHLIST -- the "Add alert on the list" flow,
 * reached from the watchlist dropdown. It opens pre-set to a symbol-RELATIVE condition (Price · Moving Up % ·
 * 1% in 1 bar) so the watchlist scope is valid from the first frame -- no disabled dropdown to puzzle over. The
 * interval/broker come from the active chart. @param {{ id:string, name:string }} list @param {any} pane
 */
export function openWatchlistAlertDialog(list, pane) {
  openAlertDialog({ pane: pane || {}, drawing: null, existing: null, watchlist: list });
}

/**
 * Shared dialog builder. `drawing` null => a Value-based alert: Object columns are Price + Value only and
 * the draft carries objectId/tool/anchor = null. `watchlist` set => the alert applies to a whole list and
 * opens pre-set to a Moving % condition. Otherwise the alert is anchored to the drawing.
 * @param {{ pane: any, drawing: any|null, existing: any|null, watchlist?: { id:string, name:string } }} ctx
 */
function openAlertDialog(ctx) {
  closeCreateAlertDialog();
  const pane = ctx.pane || {};
  const d = ctx.drawing;                     // null => Value-based alert (no chart object)
  const wl = ctx.watchlist || null;          // set => a whole-watchlist alert (Moving % preset)
  const isWatch = !!wl;
  const isValue = !d;
  const existing = ctx.existing || null;
  const editing = !!existing;
  // EDITING keeps the alert's OWN symbol/tf -- never re-point it at whatever chart happens to be open; CREATION
  // takes them from the pane (the current chart). Fix for "editing an alert changed its symbol to the open chart's".
  const symbol = editing ? (existing.symbol || '') : (pane.symbol || '');
  const tf = editing ? (existing.tf || '') : (pane.tfId || '');
  // A watchlist alert's SUBJECT is the list name (its scope is the whole list, not a symbol); the record's own
  // symbol is left blank and the display reads the list. A plain alert's subject is its symbol.
  const scopeLabel = isWatch ? wl.name : symbol;

  // Floating (non-modal) panel so the chart stays interactive while it's open — no click-away close.
  const dlg = el('div', 'dialog alert-dlg'); panel = dlg; dlg.style.zIndex = '72';

  // ---- header: "Create/Edit alert on SYMBOL, TF"  ✕
  const head = el('div', 'aldlg-head');
  const title = el('div', 'aldlg-title');
  const symSpan = el('span', 'aldlg-sym', scopeLabel);
  title.append(document.createTextNode(t(editing ? 'Edit alert on' : 'Create alert on') + ' '), symSpan);
  // the title tracks the live scope (Apply to) + interval; the real implementation is wired once both exist.
  let refreshTitle = () => {};
  const x = el('span', 'lib-x', '✕'); x.onclick = closeCreateAlertDialog;
  head.append(title, x);
  dlg.appendChild(head);

  // ---- General fields (prefilled from the existing alert in edit mode)
  const nameIn = /** @type {HTMLInputElement} */ (el('input', 'aldlg-in')); nameIn.type = 'text';
  nameIn.value = editing ? (existing.name || '') : scopeLabel + ' ' + t('alert');
  const enable = enableToggle(editing ? !!existing.enabled : true);
  // "Apply to" -- the alert's SCOPE: the single symbol it watches, or every symbol in one of the user's
  // watchlists. A watchlist scope applies the condition to each list member with its own per-symbol latch. It's
  // only meaningful for a symbol-RELATIVE condition (Moving %) -- an absolute level/Value doesn't generalize
  // across a list -- so the watchlist options are gated by applyGuard: enabled only while every condition row is
  // relative, reverting to the single symbol otherwise. Watchlists are fetched async so this stays decoupled
  // from the panel and always current.
  const applySel = /** @type {HTMLSelectElement} */ (el('select', 'aldlg-sel'));
  const symOpt = /** @type {HTMLOptionElement} */ (el('option', null, symbol + (tf ? ', ' + tf : '')));
  symOpt.value = 'symbol'; applySel.appendChild(symOpt); applySel.value = 'symbol';
  applySel.addEventListener('change', () => refreshTitle());   // scope change -> live title
  /** enable watchlist scope only when every condition row is symbol-relative; revert a stale pick. @param {any} uiConds */
  const applyGuard = (uiConds) => {
    const rel = !!(uiConds && uiConds.conditions && uiConds.conditions.length && uiConds.conditions.every((/** @type {any} */ r) => isMoveOp(r.op)));
    applySel.querySelectorAll('optgroup option').forEach((o) => { /** @type {HTMLOptionElement} */ (o).disabled = !rel; });
    if (!rel && applySel.value.indexOf('wl:') === 0) applySel.value = 'symbol';
  };
  getJSON('/api/watchlist').then((doc) => {
    const lists = (doc && doc.lists) || [];
    if (!lists.length || !applySel.isConnected) return;
    const grp = document.createElement('optgroup'); grp.label = t('Watchlists');
    lists.forEach((/** @type {any} */ l) => {
      const n = ((l.items || []).filter((/** @type {any} */ it) => it && it.type === 'symbol')).length;
      const o = /** @type {HTMLOptionElement} */ (el('option', null, (l.name || 'Watchlist') + '  (' + n + ')'));
      o.value = 'wl:' + l.id;
      grp.appendChild(o);
    });
    applySel.appendChild(grp);
    applyGuard(conds.get());   // set the initial enabled state from the current conditions
    // preselect the list: edit mode restores a saved watchlist scope; the "Add alert on the list" flow selects
    // the list it was opened from. Both keep the option enabled (their conditions are relative).
    const wantId = (editing && existing.apply && existing.apply.kind === 'watchlist') ? existing.apply.listId : (isWatch ? wl.id : null);
    if (wantId) { const want = 'wl:' + wantId; if ([...applySel.options].some((o) => o.value === want)) applySel.value = want; }
    refreshTitle();   // the preselected scope is now known -> reflect it in the title
  });
  const trigSel = selectOf(TRIGGERS); if (editing && existing.trigger) trigSel.value = existing.trigger;
  const exp = expirationControl(editing ? existing.expiration : undefined, editing ? existing.expiryMs : undefined);
  const objectName = isValue ? '' : (/** @type {any} */ (getTool(d.tool)) || {}).name || d.tool;
  // Object dropdown options. Drawing alert: Price, the drawing, attached indicators (SMA, FVG, …), Value.
  // Value alert (from the manager, no chart object): just Price and Value.
  let objects;
  if (isValue) {
    objects = [t('Price'), t('Value')];
  } else {
    const attached = (pane.studies && /** @type {any} */ (pane.studies).attached) || [];
    const studyLabels = attached.map((/** @type {any} */ a) => { try { return studyLabel(a); } catch (_) { return (a.study && a.study.name) || 'Study'; } });
    objects = [t('Price'), objectName, ...studyLabels, t('Value')];
  }
  // A new Value alert prefills the Value column with the symbol's current price (last bar close on the active
  // chart), rounded to the instrument's decimals — so the user tweaks a number instead of starting from blank.
  const initRows = (editing && existing.conditions) ? existing.conditions.conditions
    : isWatch ? [{ left: t('Price'), op: 'Moving Up %', right: '', value: null, percent: 1, lookback: 1 }]
    : (isValue ? [{ left: t('Price'), op: 'Crossing', right: t('Value'), value: lastPrice(pane) }] : undefined);
  // decimals for rounding the Value: the current chart's for a NEW alert; for an EDIT, the alert's OWN precision
  // (stamped on the record at creation; legacy alerts fall back to their stored value's precision) -- so editing
  // never truncates a value whose instrument differs from whatever chart is open (a forex alert edited on an index).
  const decimalsOf = (/** @type {any} */ v) => { if (v == null) return 0; const i = String(v).indexOf('.'); return i < 0 ? 0 : String(v).length - i - 1; };
  const storedDec = (editing && existing.conditions) ? Math.max(0, ...((existing.conditions.conditions || []).map((/** @type {any} */ r) => decimalsOf(r.value)))) : 0;
  const dec = editing ? (existing.priceDecimals != null ? existing.priceDecimals : storedDec) : pane.priceDecimals;
  const initMatch = (editing && existing.conditions) ? existing.conditions.match : undefined;
  // condition changes drive the watchlist-scope guard, the interval picker's visibility (TF only matters for the
  // Moving family), and the live title. Extended once the interval control exists.
  let onCondsChange = (/** @type {any} */ ui) => applyGuard(ui);
  const conds = conditionsControl(objects, initRows, dec, initMatch, (/** @type {any} */ ui) => onCondsChange(ui));
  // The alert's OWN interval (the bar granularity it watches) -- set here, defaulting to the chart's current tf,
  // never silently bound to it. This is the alert's tf/tfObj; a Moving % window is measured over bars at it.
  // The segment row is a SHORT few; the full list lives under "Other" (never dump every interval as a segment).
  const interval = intervalControl(tf || firstTf() || '', favTimeframes().slice(0, 4).map((tf2) => tf2.id), listIntervals(), () => refreshTitle());
  // TF only matters for the Moving family (price over time) -- hide the interval picker, and drop it from the
  // title, for pure price-level conditions (Crossing / Greater / Less).
  const condsUseTf = () => conds.get().conditions.some((/** @type {any} */ r) => isMoveOp(r.op));
  const syncTf = () => { interval.el.style.display = condsUseTf() ? '' : 'none'; };
  // Live dialog title: "<verb> alert on <scope>[, <interval>]" -- scope from Apply to, interval from the picker
  // (only when the condition uses one), updating as either changes.
  const scopeText = () => {
    if (applySel.value.indexOf('wl:') === 0) { const o = applySel.options[applySel.selectedIndex]; return (o ? o.text : t('Watchlists')).replace(/\s*\(\d+\)\s*$/, '').trim(); }
    return symbol || '';
  };
  refreshTitle = () => { const iv = condsUseTf() ? interval.get() : ''; symSpan.textContent = scopeText() + (iv ? ', ' + iv : ''); };
  onCondsChange = (/** @type {any} */ ui) => { applyGuard(ui); syncTf(); refreshTitle(); };
  syncTf();
  refreshTitle();
  const msg = messageControl(editing ? (existing.message || '') : '');
  const actions = actionsControl(editing ? existing.actions : undefined);

  // ---- body: two columns — General + Message (left) | Conditions + Actions (right)
  const body = el('div', 'aldlg-body aldlg-split-body');
  const colL = el('div', 'aldlg-col');
  const colR = el('div', 'aldlg-col');
  colL.append(
    section(t('General'), (b) => {
      b.append(
        field(t('Name'), nameIn),
        field(t('Apply to'), applySel),
        field(t('Trigger'), trigSel),
        field(t('Expiration'), exp.el),
      );
    }, enable.el),
    section(t('Message'), (b) => { b.appendChild(msg.el); }),
  );
  colR.append(
    section(t('Conditions'), (b) => { b.append(interval.el, conds.el); }),
    section(t('Actions'), (b) => { b.appendChild(actions.el); }),
  );
  body.append(colL, colR);
  dlg.appendChild(body);

  // ---- footer: Cancel · Create
  const foot = el('div', 'aldlg-foot');
  const cancel = el('button', null, t('Cancel')); cancel.onclick = closeCreateAlertDialog;
  const create = el('button', 'primary', t(editing ? 'Save' : 'Create'));
  const brokerId = editing ? ((existing && existing.broker) || null) : (/** @type {any} */ (pane).broker || null);
  const level = d ? anchorLevel(d) : null;
  create.onclick = () => {
    const uiConds = conds.get();
    const applyVal = applySel.value;
    // scope: a watchlist option ('wl:<id>') applies the rule across a list; anything else is the single symbol.
    // Denormalize the list NAME onto the scope for display (the panel/log show "List, tf" without a store lookup).
    const selText = applySel.options[applySel.selectedIndex] ? applySel.options[applySel.selectedIndex].text : '';
    const listName = selText.replace(/\s*\(\d+\)\s*$/, '').trim();
    const apply = /** @type {{ kind:'symbol', symbol:string } | { kind:'watchlist', listId:string, name:string }} */ (
      applyVal.indexOf('wl:') === 0 ? { kind: 'watchlist', listId: applyVal.slice(3), name: listName } : { kind: 'symbol', symbol });
    const chosenTf = interval.get();   // the alert's own interval (from the picker), not the chart's
    const draft = {
      symbol: apply.kind === 'watchlist' ? '' : symbol, tf: chosenTf, tfObj: tfById(chosenTf) || null, broker: brokerId, priceDecimals: dec, apply,
      objectId: d ? d.id : null, tool: d ? d.tool : null,
      anchor: d ? { tool: d.tool, points: (d.points || []).map((/** @type {any} */ p) => ({ time: p.time, price: p.price })), level } : null,
      name: nameIn.value, enabled: enable.get(), trigger: trigSel.value, cadence: cadenceOf(trigSel.value), expiration: exp.kind(),
      expiryMs: exp.ms(), conditions: uiConds, compiled: compileConditions(uiConds, t('Price'), objectName, level),
      message: msg.get(), actions: actions.get(),
    };
    if (editing) {
      // UPDATE the existing alert; reset the fired latch (rt) so an edited alert re-arms.
      alertCommand('update', { id: existing.id, patch: { ...draft, rt: {} } }).catch((err) => console.error('[alert] update failed', err));
      closeCreateAlertDialog();
    } else {
      onCreate(draft);
    }
  };
  foot.append(cancel, create);
  dlg.appendChild(foot);

  document.body.appendChild(dlg);

  // float + drag by the header (same gesture as the drawing settings dialog)
  dlg.style.position = 'fixed'; dlg.style.margin = '0';
  dlg.style.left = Math.max(8, (window.innerWidth - dlg.offsetWidth) / 2) + 'px';
  dlg.style.top = Math.max(8, (window.innerHeight - dlg.offsetHeight) / 3) + 'px';
  /** @type {{ dx: number, dy: number } | null} */
  let drag = null;
  head.style.cursor = 'move';
  head.addEventListener('pointerdown', (e) => {
    if (/** @type {Element} */ (e.target).closest('.lib-x')) return;
    drag = { dx: e.clientX - dlg.offsetLeft, dy: e.clientY - dlg.offsetTop };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dlg.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx)) + 'px';
    dlg.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy)) + 'px';
  });
  head.addEventListener('pointerup', () => { drag = null; });

  nameIn.focus(); nameIn.select();
}
