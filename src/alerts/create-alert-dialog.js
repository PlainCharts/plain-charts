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
import { studyLabel } from '../../lib/kapelka/skin/legend.js'; // label attached indicators like the chart legend
import {
  el,
  roundPrice,
  section,
  field,
  selectOf,
  enableToggle,
  expirationControl,
  conditionsListControl,
  actionsControl,
  messageControl,
  intervalControl,
} from './dialog-controls.js'; // pure DOM form-control builders (view leaf)
import { openConditionDialog } from './condition-dialog.js'; // the progressive Add/Edit-condition dialog
import {
  anchorLevel,
  anchorExtent,
  compileConditions,
  isRelativeConds,
  condsUseTf,
  isMoveOp,
  alertablePlots,
  declaredConditions,
  TIME_TOOLS,
} from './alert-conditions.js'; // pure UI-conditions -> compiled host terms + the condition-semantics rules (leaf, no DOM)
import { openCreateTimeAlertDialog } from './create-time-alert-dialog.js'; // a TIME-category drawing (vline) routes there
import { studyUrlFor } from '../studies/user-loader.js'; // a study's module URL, snapshotted for the headless runner
import { priceDecimalsOf } from './alert-record.js'; // a record's Value precision (schema's one home)
import { cadenceOf, conditionEvaluable } from './eval.js'; // stable cadence key + the can-this-ever-fire predicate (live validation)
import { alertForObject } from './alert-drawing-sync.js'; // edit mode: the existing alert on this drawing (drawing<->alert glue lives there)
import { alertCommand } from './funnel.js'; // the single mutator path to the alert-host
import { byId as tfById, listIntervals, favTimeframes, firstTf } from '../workspace/timeframes.js'; // the alert's own interval picker + tf id -> {id,unit,n}
import { getJSON } from '../api.js'; // read the persisted watchlists to list in "Apply to" (placeholder, no logic yet)

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
  if (panel) {
    panel.remove();
    panel = null;
  }
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
 * Assemble the AlertDraft from the gathered form state -- no DOM, exported so the schema assembly is
 * testable apart from the dialog. Owns the scope denormalization (a watchlist option 'wl:<id>' applies the
 * rule across a list; the list NAME rides on the scope so the panel/log display "List, tf" without a store
 * lookup), the anchored-geometry snapshot, and the compiled host terms.
 * @param {{ symbol: string, applyVal: string, applyText: string, chosenTf: string, brokerId: string|null,
 *   dec: any, drawing: any|null, level: number|null, extent?: any, seriesByLabel?: any, objectName: string, name: string, enabled: boolean,
 *   trigger: string, expiration: string, expiryMs: number|null, uiConds: any, message: string, actions: string[] }} f
 * @returns {AlertDraft & { cadence: any, priceDecimals: any }}
 */
export function buildDraft(f) {
  const d = f.drawing;
  const listName = f.applyText.replace(/\s*\(\d+\)\s*$/, '').trim();
  const apply = /** @type {{ kind:'symbol', symbol:string } | { kind:'watchlist', listId:string, name:string }} */ (
    f.applyVal.indexOf('wl:') === 0
      ? { kind: 'watchlist', listId: f.applyVal.slice(3), name: listName }
      : { kind: 'symbol', symbol: f.symbol }
  );
  return {
    symbol: apply.kind === 'watchlist' ? '' : f.symbol,
    tf: f.chosenTf,
    tfObj: tfById(f.chosenTf) || null,
    broker: f.brokerId,
    priceDecimals: f.dec,
    apply,
    objectId: d ? d.id : null,
    tool: d ? d.tool : null,
    anchor: d
      ? {
          tool: d.tool,
          points: (d.points || []).map((/** @type {any} */ p) => ({ time: p.time, price: p.price })),
          level: f.level,
        }
      : null,
    name: f.name,
    enabled: f.enabled,
    trigger: f.trigger,
    cadence: cadenceOf(f.trigger),
    expiration: f.expiration,
    expiryMs: f.expiryMs,
    conditions: f.uiConds,
    compiled: compileConditions(
      f.uiConds,
      t('Price'),
      f.objectName,
      f.level,
      f.extent || null,
      f.seriesByLabel || null,
    ),
    message: f.message,
    actions: f.actions,
  };
}

/**
 * The condition-authoring CONTEXT for a pane + optional anchored drawing: the drawing's label and its
 * data-space reductions, plus the attached-studies snapshot (the SERIES category) -- everything the
 * condition dialog and the compiler read. One builder, shared by the alert dialog AND the drawing entry
 * flow (which opens the condition dialog before any alert dialog exists).
 * @param {any} pane @param {any|null} d
 */
function condContext(pane, d) {
  const objectName = d ? /** @type {any} */ (getTool(d.tool) || {}).name || d.tool : '';
  // the anchored drawing's data-space reduction -- compile input + live validation input: a fixed price
  // (LEVEL category) or a polyline snapshot (SEGMENTS category); both null for other tools / Value alerts
  const level = d ? anchorLevel(d) : null;
  const extent = d ? anchorExtent(d) : null;
  // Attached studies become condition OBJECTS (the SERIES category). Each entry snapshots everything the
  // headless runner needs (id / module URL / merged params / plots); duplicate labels dedupe with a #N
  // suffix. Multi-plot studies drive the plot/band picker.
  /** @type {Record<string, { studyId:string, studyUrl:(string|null), params:any, plots:{key:string,name:string}[], conditions:{key:string,name:string}[], overlay:boolean, headless:boolean, uid:(string|null) }>} */
  const seriesByLabel = {};
  const attached = (pane.studies && /** @type {any} */ (pane.studies).attached) || [];
  /** @type {Record<string, number>} */
  const seen = {};
  for (const a of attached) {
    let label;
    try {
      label = studyLabel(a);
    } catch (_) {
      label = (a.study && a.study.name) || 'Study';
    }
    seen[label] = (seen[label] || 0) + 1;
    if (seen[label] > 1) label += ' #' + seen[label];
    // live plot meta when the study has computed; a step study's static plots() declaration otherwise.
    // legend:false plots are DECORATION (RSI's 70/30 guides, band edges a study grays out) -- not curves
    // anyone alerts on; filtering them also keeps a single-curve study picker-free.
    const metaPlots =
      (a.plotMeta && a.plotMeta.length ? a.plotMeta : typeof a.study.plots === 'function' ? a.study.plots() : []) || [];
    // headless: can the alert-host's study runner actually compute this? Inline-only studies
    // (worker:false / frame-clock), intrabar studies (need sub-bar feeds), and viewport-reactive ones
    // (no viewport exists headless) cannot -- the compiler refuses them so no dead alert is ever created.
    const st = /** @type {any} */ (a.study);
    const headless = !(st.worker === false || st.requestFrames || st.intrabar || st.lowerTimeframe || st.viewport);
    seriesByLabel[label] = {
      studyId: a.study.id,
      studyUrl: studyUrlFor(a.study.id),
      params: { ...a.params },
      plots: alertablePlots(metaPlots),
      conditions: declaredConditions(st.alertConditions), // the study's own named moments ("Bullish FVG")
      overlay: a.study.overlay !== false,
      headless,
      uid: /** @type {any} */ (a).uid || null, // instance identity: the alert binds to THIS attachment
    };
  }
  return { objectName, level, extent, seriesByLabel };
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
 * Route a drawing's Create/Edit-alert action to the RIGHT dialog -- the one entry both the right-click menu
 * and the price-scale quick editor call. A TIME-category drawing (vline: a pure time marker) opens the
 * time-alert dialog, prefilled to a one-shot at the line's instant and anchored to the drawing (so the
 * badge, the drag re-schedule, and the delete cascade all bind); an existing alert opens the alert dialog
 * in edit mode. A NEW alert on any other drawing opens the ADD-CONDITION dialog first -- the user crafts
 * the condition (prefilled Price Crossing the drawing), and Add lands it in the alert dialog's list;
 * Cancel creates nothing. @param {any} engine @param {string} id
 */
export function openDrawingAlertDialog(engine, id) {
  const d = engine.get(id);
  if (!d) return;
  const pane = engine.pane || {};
  if (TIME_TOOLS.indexOf(d.tool) >= 0) {
    const existing = alertForObject(pane.symbol || '', id);
    const atMs = Math.round(Number(d.points && d.points[0] && d.points[0].time) * 1000); // anchors are epoch SECONDS
    openCreateTimeAlertDialog(
      existing,
      existing ? undefined : { atMs, objectId: id, tool: d.tool, symbol: pane.symbol || '' },
    );
    return;
  }
  const existing = alertForObject(pane.symbol || '', id);
  if (existing) {
    openAlertDialog({ pane, drawing: d, existing });
    return;
  }
  const cc = condContext(pane, d);
  openConditionDialog({
    prefill: { left: t('Price'), op: 'Crossing', right: cc.objectName, value: null, plot: null },
    ctx: { objectName: cc.objectName, seriesByLabel: cc.seriesByLabel, dec: pane.priceDecimals },
    level: cc.level,
    extent: cc.extent,
    onDone: (row) => openAlertDialog({ pane, drawing: d, existing: null, firstRow: row }),
  });
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
 * Shared dialog builder. `drawing` null => a Value-based alert (objectId/tool/anchor = null on the draft).
 * `watchlist` set => the alert applies to a whole list and opens pre-set to a Moving % condition.
 * `firstRow` = the condition the drawing ENTRY FLOW just crafted, seeding the list.
 * @param {{ pane: any, drawing: any|null, existing: any|null, watchlist?: { id:string, name:string }, firstRow?: any }} ctx
 */
function openAlertDialog(ctx) {
  closeCreateAlertDialog();
  const pane = ctx.pane || {};
  const d = ctx.drawing; // null => Value-based alert (no chart object)
  const wl = ctx.watchlist || null; // set => a whole-watchlist alert (Moving % preset)
  const isWatch = !!wl;
  const isValue = !d;
  const existing = ctx.existing || null;
  const editing = !!existing;
  // EDITING keeps the alert's OWN symbol/tf -- never re-point it at whatever chart happens to be open; CREATION
  // takes them from the pane (the current chart). Fix for "editing an alert changed its symbol to the open chart's".
  const symbol = editing ? existing.symbol || '' : pane.symbol || '';
  const tf = editing ? existing.tf || '' : pane.tfId || '';
  // A watchlist alert's SUBJECT is the list name (its scope is the whole list, not a symbol); the record's own
  // symbol is left blank and the display reads the list. A plain alert's subject is its symbol.
  const scopeLabel = isWatch ? wl.name : symbol;

  // Floating (non-modal) panel so the chart stays interactive while it's open — no click-away close.
  const dlg = el('div', 'dialog alert-dlg');
  panel = dlg;
  dlg.style.zIndex = '72';

  // ---- header: "Create/Edit alert on SYMBOL, TF"  ✕
  const head = el('div', 'aldlg-head');
  const title = el('div', 'aldlg-title');
  const symSpan = el('span', 'aldlg-sym', scopeLabel);
  title.append(document.createTextNode(t(editing ? 'Edit alert on' : 'Create alert on') + ' '), symSpan);
  // the title tracks the live scope (Apply to) + interval; the real implementation is wired once both exist.
  let refreshTitle = () => {};
  const x = el('span', 'lib-x', '✕');
  x.onclick = closeCreateAlertDialog;
  head.append(title, x);
  dlg.appendChild(head);

  // ---- General fields (prefilled from the existing alert in edit mode)
  const nameIn = /** @type {HTMLInputElement} */ (el('input', 'aldlg-in'));
  nameIn.type = 'text';
  nameIn.value = editing ? existing.name || '' : scopeLabel + ' ' + t('alert');
  const enable = enableToggle(editing ? !!existing.enabled : true);
  // "Apply to" -- the alert's SCOPE: the single symbol it watches, or every symbol in one of the user's
  // watchlists. A watchlist scope applies the condition to each list member with its own per-symbol latch. It's
  // only meaningful for a symbol-RELATIVE condition (Moving %) -- an absolute level/Value doesn't generalize
  // across a list -- so the watchlist options are gated by applyGuard: enabled only while every condition row is
  // relative, reverting to the single symbol otherwise. Watchlists are fetched async so this stays decoupled
  // from the panel and always current.
  const applySel = /** @type {HTMLSelectElement} */ (el('select', 'aldlg-sel'));
  const symOpt = /** @type {HTMLOptionElement} */ (el('option', null, symbol + (tf ? ', ' + tf : '')));
  symOpt.value = 'symbol';
  applySel.appendChild(symOpt);
  applySel.value = 'symbol';
  applySel.addEventListener('change', () => refreshTitle()); // scope change -> live title
  /** enable watchlist scope only when the conditions are symbol-relative (isRelativeConds, the rule's one
   * home beside the compiler); revert a stale pick. @param {any} uiConds */
  const applyGuard = (uiConds) => {
    const rel = isRelativeConds(uiConds);
    applySel.querySelectorAll('optgroup option').forEach((o) => {
      /** @type {HTMLOptionElement} */ (o).disabled = !rel;
    });
    if (!rel && applySel.value.indexOf('wl:') === 0) applySel.value = 'symbol';
  };
  getJSON('/api/watchlist').then((doc) => {
    const lists = (doc && doc.lists) || [];
    if (!lists.length || !applySel.isConnected) return;
    const grp = document.createElement('optgroup');
    grp.label = t('Watchlists');
    lists.forEach((/** @type {any} */ l) => {
      const n = (l.items || []).filter((/** @type {any} */ it) => it && it.type === 'symbol').length;
      const o = /** @type {HTMLOptionElement} */ (el('option', null, (l.name || 'Watchlist') + '  (' + n + ')'));
      o.value = 'wl:' + l.id;
      grp.appendChild(o);
    });
    applySel.appendChild(grp);
    applyGuard(conds.get()); // set the initial enabled state from the current conditions
    // preselect the list: edit mode restores a saved watchlist scope; the "Add alert on the list" flow selects
    // the list it was opened from. Both keep the option enabled (their conditions are relative).
    const wantId =
      editing && existing.apply && existing.apply.kind === 'watchlist' ? existing.apply.listId : isWatch ? wl.id : null;
    if (wantId) {
      const want = 'wl:' + wantId;
      if ([...applySel.options].some((o) => o.value === want)) applySel.value = want;
    }
    refreshTitle(); // the preselected scope is now known -> reflect it in the title
  });
  const trigSel = selectOf(TRIGGERS);
  if (editing && existing.trigger) trigSel.value = existing.trigger;
  const exp = expirationControl(editing ? existing.expiration : undefined, editing ? existing.expiryMs : undefined);
  const cc = condContext(pane, isValue ? null : d);
  const objectName = cc.objectName;
  const level = cc.level;
  const extent = cc.extent;
  const seriesByLabel = cc.seriesByLabel;
  // Prefills: an edit shows the record's rows; a watchlist alert opens relative (Moving %); a Value alert
  // opens at the live price; a drawing alert opens with the condition the ENTRY FLOW just crafted
  // (ctx.firstRow, from the condition dialog), or seeds Price Crossing the drawing.
  const initRows =
    editing && existing.conditions
      ? existing.conditions.conditions
      : isWatch
        ? [{ left: t('Price'), op: 'Moving Up %', right: '', value: null, percent: 1, lookback: 1 }]
        : isValue
          ? [{ left: t('Price'), op: 'Crossing', right: t('Value'), value: lastPrice(pane) }]
          : ctx.firstRow
            ? [ctx.firstRow]
            : [{ left: t('Price'), op: 'Crossing', right: objectName, value: null }];
  // decimals for rounding the Value: the current chart's for a NEW alert; for an EDIT, the record's own
  // precision (priceDecimalsOf: stamped at creation, legacy fallback to the stored values' precision).
  const dec = editing ? priceDecimalsOf(existing) : pane.priceDecimals;
  const initMatch = editing && existing.conditions ? existing.conditions.match : undefined;
  // One condition = one SENTENCE in the list ("Price Crossing 7700", "RSI 14 Greater Than 70 · RSI").
  // The Value side reads as its number; a multi-plot study appends its chosen band's name.
  const sentence = (/** @type {any} */ r) => {
    if (!r) return '';
    // a study-declared condition: subject-only, the declared name IS the condition ("Fair Value Gap: Bullish FVG")
    if (r.event) return [r.left, r.op].filter(Boolean).join(': ');
    if (isMoveOp(r.op)) {
      const isPct = /%\s*$/.test(String(r.op));
      const base = t(String(r.op).replace(/\s*%\s*$/, ''));
      const mag = isPct ? (r.percent != null ? r.percent + '%' : '') : r.amount != null ? String(r.amount) : '';
      const n = Number(r.lookback);
      const bars = Number.isFinite(n) ? t('in') + ' ' + n + ' ' + t('bar') : '';
      return [r.left, base, mag, bars].filter(Boolean).join(' ');
    }
    const side = (/** @type {string} */ sd) => (sd === t('Value') && r.value != null ? String(r.value) : sd);
    let txt = [side(r.left), t(r.op), side(r.right)].filter(Boolean).join(' ');
    const studySide = seriesByLabel[r.right] ? r.right : seriesByLabel[r.left] ? r.left : null;
    if (r.plot && studySide && (seriesByLabel[studySide].plots || []).length > 1) {
      const p = seriesByLabel[studySide].plots.find((/** @type {any} */ x) => x.key === r.plot);
      txt += ' · ' + ((p && p.name) || r.plot);
    }
    return txt;
  };
  // condition changes drive the watchlist-scope guard, the interval picker's visibility (TF only matters for the
  // Moving family), and the live title. Extended once the interval control exists.
  let onCondsChange = (/** @type {any} */ ui) => applyGuard(ui);
  const conds = conditionsListControl(initRows, initMatch, {
    sentence,
    openEditor: (row, done) =>
      openConditionDialog({
        row: row || undefined,
        ctx: { objectName, seriesByLabel, dec },
        level,
        extent,
        onDone: done,
      }),
    onChange: (/** @type {any} */ ui) => onCondsChange(ui),
  });
  // The alert's OWN interval (the bar granularity it watches) -- set here, defaulting to the chart's current tf,
  // never silently bound to it. This is the alert's tf/tfObj; a Moving % window is measured over bars at it.
  // The segment row is a SHORT few; the full list lives under "Other" (never dump every interval as a segment).
  const interval = intervalControl(
    tf || firstTf() || '',
    favTimeframes()
      .slice(0, 4)
      .map((tf2) => tf2.id),
    listIntervals(),
    () => refreshTitle(),
  );
  // TF matters for the Moving family (condsUseTf, beside the compiler), for a segments-anchored drawing
  // (its line evaluates on the alert-interval bar grid), and for any row targeting a STUDY (it computes on
  // the alert's own bars). Pure fixed-level conditions hide the picker.
  const rowsUseSeries = (/** @type {any} */ ui) =>
    !!(
      ui &&
      ui.conditions &&
      ui.conditions.some((/** @type {any} */ r) => seriesByLabel[r.left] || seriesByLabel[r.right])
    );
  const usesTf = () => {
    const ui = conds.get();
    return condsUseTf(ui) || !!extent || rowsUseSeries(ui);
  };
  const syncTf = () => {
    interval.el.style.display = usesTf() ? '' : 'none';
  };
  // Live dialog title: "<verb> alert on <scope>[, <interval>]" -- scope from Apply to, interval from the picker
  // (only when the condition uses one), updating as either changes.
  const scopeText = () => {
    if (applySel.value.indexOf('wl:') === 0) {
      const o = applySel.options[applySel.selectedIndex];
      return (o ? o.text : t('Watchlists')).replace(/\s*\(\d+\)\s*$/, '').trim();
    }
    return symbol || '';
  };
  refreshTitle = () => {
    const iv = usesTf() ? interval.get() : '';
    symSpan.textContent = scopeText() + (iv ? ', ' + iv : '');
  };
  // LIVE validation: compile the current rows exactly as Create would and test the shared can-ever-fire
  // predicate. An unsupported condition (e.g. anchored to a drawing the engine can't evaluate yet) shows the
  // warning and disables Create -- the dialog must never save an alert that silently never fires. The real
  // implementation is bound after the footer exists (it needs the Create button); this stub covers the
  // construction-time onChange, same idiom as refreshTitle.
  let validate = (/** @type {any} */ _ui) => {};
  onCondsChange = (/** @type {any} */ ui) => {
    applyGuard(ui);
    syncTf();
    refreshTitle();
    validate(ui);
  };
  syncTf();
  refreshTitle();
  const msg = messageControl(editing ? existing.message || '' : '');
  const actions = actionsControl(editing ? existing.actions : undefined);

  // ---- body: two columns — General + Message (left) | Conditions + Actions (right)
  const body = el('div', 'aldlg-body aldlg-split-body');
  const colL = el('div', 'aldlg-col');
  const colR = el('div', 'aldlg-col');
  colL.append(
    section(
      t('General'),
      (b) => {
        b.append(
          field(t('Name'), nameIn),
          field(t('Apply to'), applySel),
          field(t('Trigger'), trigSel),
          field(t('Expiration'), exp.el),
        );
      },
      enable.el,
    ),
    section(t('Message'), (b) => {
      b.appendChild(msg.el);
    }),
  );
  const warn = el('div', 'aldlg-warn', t('This condition is not supported yet, so the alert would never fire.'));
  warn.style.display = 'none';
  colR.append(
    section(t('Conditions'), (b) => {
      b.append(interval.el, conds.el, warn);
    }),
    section(t('Actions'), (b) => {
      b.appendChild(actions.el);
    }),
  );
  body.append(colL, colR);
  dlg.appendChild(body);

  // ---- footer: Cancel · Create
  const foot = el('div', 'aldlg-foot');
  const cancel = el('button', null, t('Cancel'));
  cancel.onclick = closeCreateAlertDialog;
  const create = /** @type {HTMLButtonElement} */ (el('button', 'primary', t(editing ? 'Save' : 'Create')));
  const brokerId = editing ? (existing && existing.broker) || null : /** @type {any} */ (pane).broker || null;
  // bind the real validation now that the button exists, and run it once so an edit of a dead alert opens honest
  validate = (ui) => {
    const ok = conditionEvaluable(compileConditions(ui, t('Price'), objectName, level, extent, seriesByLabel));
    warn.style.display = ok ? 'none' : '';
    create.disabled = !ok;
  };
  validate(conds.get());
  create.onclick = () => {
    // gather the form and dispatch; the draft schema itself is buildDraft's (module level, testable)
    const draft = buildDraft({
      symbol,
      applyVal: applySel.value,
      applyText: applySel.options[applySel.selectedIndex] ? applySel.options[applySel.selectedIndex].text : '',
      chosenTf: interval.get(), // the alert's own interval (from the picker), not the chart's
      brokerId,
      dec,
      drawing: d,
      level,
      extent,
      seriesByLabel,
      objectName,
      name: nameIn.value,
      enabled: enable.get(),
      trigger: trigSel.value,
      expiration: exp.kind(),
      expiryMs: exp.ms(),
      uiConds: conds.get(),
      message: msg.get(),
      actions: actions.get(),
    });
    if (editing) {
      // UPDATE the existing alert; reset the fired latch (rt) so an edited alert re-arms.
      alertCommand('update', { id: existing.id, patch: { ...draft, rt: {} } }).catch((err) =>
        console.error('[alert] update failed', err),
      );
      closeCreateAlertDialog();
    } else {
      onCreate(draft);
    }
  };
  foot.append(cancel, create);
  dlg.appendChild(foot);

  document.body.appendChild(dlg);

  // float + drag by the header (same gesture as the drawing settings dialog)
  dlg.style.position = 'fixed';
  dlg.style.margin = '0';
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
  head.addEventListener('pointerup', () => {
    drag = null;
  });

  nameIn.focus();
  nameIn.select();
}
