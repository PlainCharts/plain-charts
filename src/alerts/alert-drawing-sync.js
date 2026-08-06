// @ts-check
// Alert <-> DRAWING integration -- the glue that ties engine alerts to chart drawings, kept apart from the dialog so
// non-dialog callers (the drawing menu, the interaction layer, the quick price-scale action) don't import a "dialog"
// file just to reach it. Three jobs:
//   - alertForObject / removeDrawingsWithAlerts: an alert anchored to a drawing must never outlive it (delete cascades).
//   - initAlertDrawingSync: re-snapshot a drawing-anchored alert's level when the drawing is committed (dragged).
//   - quickAlertAtPrice: the one-click "add alert at <price>" price-scale action (an object-less Value alert).
// All mutation still funnels through alertCommand (the single writer); this module only reads drawings + reflects.
import { t } from '../i18n/i18n.js';
import { getTool } from '../tools/registry.js';
import { alertCommand } from './funnel.js'; // the single mutator path to the alert-host
import { alertMirror } from './store.js'; // read the alert mirror (find the alert on an object)
import { withLevel } from './alert-record.js'; // the set-level/re-arm mutation (schema's one home)
import { compileConditions, LEVEL_TOOLS, anchorExtent } from './alert-conditions.js'; // canonical compiler + the extent-category reductions
import { confirmDialog } from '../ui/confirm.js'; // confirm before deleting a drawing that has an alert
import { bus } from '../bus.js'; // drawing-move events (keep alert level in sync)
import { roundPrice } from './dialog-controls.js'; // round a level to the instrument's decimals
import { byId as tfById } from '../workspace/timeframes.js'; // resolve the tf id -> {id,unit,n} for the headless host

/** The alert attached to a drawing on this symbol, if any. Used by the drawing menu (Edit vs Create label)
 * and by the dialog (edit mode). @param {string} symbol @param {string} objectId @returns {any|null} */
export function alertForObject(symbol, objectId) {
  for (const a of alertMirror().all()) {
    if (a && a.objectId === objectId && (!a.symbol || a.symbol === symbol)) return a;
  }
  return null;
}

/**
 * Remove drawings and any alert attached to them — the single path every user drawing-delete (menu, keyboard)
 * goes through, so an alert can never outlive its drawing. If any target has an alert, confirm first; on
 * confirm the alert is deleted with the drawing. @param {any} engine @param {string[]} ids
 */
export async function removeDrawingsWithAlerts(engine, ids) {
  if (!engine || !engine.removeDrawing || !ids || !ids.length) return;
  const sym = engine.pane && engine.pane.symbol;
  const alerts = ids.map((id) => alertForObject(sym, id)).filter(Boolean);
  if (alerts.length) {
    const ok = await confirmDialog({
      title: t('Remove drawing and its alert?'),
      message: t('This drawing has an alert. Removing it deletes the alert too.'),
      yes: t('Remove'),
      no: t('Cancel'),
    });
    if (!ok) return;
    alerts.forEach((a) => alertCommand('remove', { id: a.id }).catch(() => {}));
  }
  ids.forEach((id) => engine.removeDrawing(id));
}

/**
 * Delete an alert AND its anchored drawing — the other direction of the "alert and its drawing are one unit" rule
 * (used by the Alerts panel's delete). Removes the alert through the funnel, then removes the owning drawing (if the
 * alert is anchored to one). `panes` are the candidate panes the caller supplies (getAllPanes()), so this stays
 * cycle-free and needs no chart/layout import. The caller owns any confirm. @param {any} a @param {any[]} panes
 */
export function removeAlertAndDrawing(a, panes) {
  if (!a) return;
  alertCommand('remove', { id: a.id }).catch(() => {});
  if (a.objectId) {
    const owner = (panes || []).find(
      (/** @type {any} */ p) => p && p.drawings && p.drawings.get && p.drawings.get(a.objectId),
    );
    if (owner && owner.drawings.removeDrawing) owner.drawings.removeDrawing(a.objectId);
  }
}

// Keep drawing-ANCHORED alerts in sync with their drawing. The alert-host can't read live drawing geometry, so
// the chart window (which owns the drawings) re-snapshots the level whenever a drawing is committed (e.g. after
// a drag) and pushes it to the alert. Only alerts whose condition targets the DRAWING (its tool name), not a
// literal Value, follow. Call once per window at boot.
let _drawingSyncInited = false;
export function initAlertDrawingSync() {
  if (_drawingSyncInited) return;
  _drawingSyncInited = true;
  bus.on('drawings:committed', (/** @type {any} */ pane) => {
    try {
      if (!pane || !pane.drawings || !pane.drawings.get) return;
      const sym = pane.symbol;
      for (const a of alertMirror().all()) {
        if (!a || !a.objectId || (a.symbol && a.symbol !== sym)) continue;
        const d = pane.drawings.get(a.objectId);
        if (!d || !d.points || !d.points.length) continue;
        const objName = /** @type {any} */ (getTool(d.tool) || {}).name || d.tool;
        const rows = (a.conditions && a.conditions.conditions) || [];
        if (!rows.some((/** @type {any} */ c) => c && (c.left === objName || c.right === objName))) continue; // Value alerts don't track
        if (LEVEL_TOOLS.indexOf(d.tool) >= 0) {
          const newLevel = roundPrice(d.points[0].price, pane.priceDecimals); // instrument decimals
          if (!Number.isFinite(newLevel) || newLevel === (a.anchor && a.anchor.level)) continue;
          // withLevel owns the compiled-term rewrite + rt re-arm; the anchor (drawing geometry) is rebuilt here.
          const anchor = {
            ...(a.anchor || {}),
            tool: d.tool,
            level: newLevel,
            points: [{ time: d.points[0].time, price: newLevel }],
          };
          alertCommand('update', { id: a.id, patch: { ...withLevel(a, newLevel), anchor } }).catch(() => {});
        } else {
          // SEGMENTS/REGION: geometry moved -> re-snapshot the extent and RECOMPILE the stored rows with it
          // (there is no single level to patch; the compiler is the one home for row -> term). rt resets so
          // the moved drawing re-arms, same rule as a level move. anchorExtent is null for any other tool.
          const ext = anchorExtent(d);
          if (!ext) continue;
          const prev = a.anchor || {};
          if (JSON.stringify(prev.points) === JSON.stringify(ext.points) && prev.extend === ext.extend) continue;
          const anchor = { tool: d.tool, points: ext.points, level: null, extend: ext.extend };
          const compiled = compileConditions(a.conditions, t('Price'), objName, null, ext);
          alertCommand('update', { id: a.id, patch: { anchor, compiled, rt: {} } }).catch(() => {});
        }
      }
    } catch (_) {}
  });
}

/**
 * Quick alert (the one-click "Add alert at <price>" price-scale action, no dialog): create a basic engine alert
 * at `price` — Price CROSSING (both directions) the literal Value = price, Once only, with a Toast. It is an
 * OBJECT-LESS (Value) alert — NO drawing — marked on the chart by the alert primitive (dashed line + bell badge
 * + price tag), draggable to move. @param {any} pane @param {number} price @returns {boolean} created
 */
export function quickAlertAtPrice(pane, price) {
  const lvl = roundPrice(price, /** @type {any} */ (pane).priceDecimals); // to the instrument's decimals
  if (!pane || !Number.isFinite(lvl)) return false;
  const symbol = pane.symbol || '';
  const tf = pane.tfId || '';
  // Object-less: the condition is Price crossing the literal Value = price (no drawing to anchor to).
  const uiConds = { match: 'All', conditions: [{ left: t('Price'), op: 'Crossing', right: t('Value'), value: lvl }] };
  alertCommand('create', {
    symbol,
    tf,
    tfObj: tfById(tf) || null,
    broker: /** @type {any} */ (pane).broker || null,
    objectId: null,
    tool: null,
    anchor: null,
    name: symbol + (tf ? ', ' + tf : '') + ' ' + t('alert'),
    enabled: true,
    trigger: 'Once only',
    cadence: 'once',
    expiration: 'Open-ended',
    expiryMs: null,
    conditions: uiConds,
    compiled: compileConditions(uiConds, t('Price'), '', lvl), // canonical compiler (not a hand-built term)
    message: '',
    actions: ['Toast notification'],
  }).catch((err) => console.error('[alert] quick create failed', err));
  return true;
}
