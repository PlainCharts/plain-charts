// @ts-check
// PillView -- the PILL order primitive (primitive-contract.js): the same declarative order picture the
// string-and-beads draws, rendered as floating PILLS out of the price scale (order-pill.js) instead of dots on
// a vline. One pill per element -- entry, hedge SL/TP, every working order, the plan projection + ladder --
// reconciled from OrderViewState by key, so set() is idempotent. DISPLAY-ONLY: gestures call back through the
// handlers (drag a pill = drop-semantics reprice -> onOrderCommit/onHedge*/onPlan*; tap = onOrderClick/onEntry;
// the X cell = onOrderCancel). Colours/abbreviations come from THIS primitive's config (per order TYPE,
// primitives.pill.orderTypes -- editable in Settings > Trading > Primitives). No time anchor (not a string).
import { createOrderPill } from '../order-pill.js';
import { registerPrimitive } from './primitive-registry.js';
import {
  pillColor,
  typeLabel,
  qtyPicker,
  pillLayout,
  pillLine,
  QTY_PRESET_DEFAULTS,
  PILL_COLOR_DEFAULTS,
} from '../order-primitives-config.js';
import { colorSwatch, strokeSwatch } from '../../ui/colorpicker.js';
import { openNumberPicker } from '../../ui/number-picker.js';
import { t } from '../../i18n/i18n.js'; // vocabulary lookup -- every glyph on the pill is an overridable word

// EVERY entry-role pill reads its SIDE by colour -- buy = blue, sell = violet -- so the pill keeps its colour
// through the whole lifecycle: projecting, armed, placed position, working entry orders. All colours come from
// the pill's SIX-swatch config (primitives.pill.colors): planning stop/target + live buy/sell/stop/target.
/** @param {string} side @returns {string} */
const sideColor = (side) => pillColor(side === 'sell' ? 'sell' : 'buy');

/**
 * @param {any} pane   a kapelka pane
 * @param {import('./primitive-contract.js').OrderViewHandlers} [opts]
 * @returns {import('./primitive-contract.js').OrderViewInstance | null}
 */
export function createPillView(pane, opts = {}) {
  if (!pane) return null;
  /** @type {Map<string, { h: NonNullable<ReturnType<typeof createOrderPill>> }>} */
  const pills = new Map();
  let projQty = 1; // latest planned entry volume -- cell handlers are bound once, so they read these live values
  let projType = 'market'; // latest planned entry type
  let projSide = 'buy'; // latest planned entry side
  /** latest qty per working order id (same bound-once reason: the picker must open on the CURRENT size) @type {Map<string, number>} */
  const ordQty = new Map();

  /** @param {any} v @returns {number|null} */
  const num = (v) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : null);

  // build/refresh the pill set from the wanted descriptors. An existing key is UPDATED (price/colour/cell
  // texts -- handlers were bound at creation and stay valid because the key embeds the identity: order id,
  // rung index); a missing one is created; a stale one removed. Never two elements for one key.
  /** @param {Map<string, any>} want */
  const reconcile = (want) => {
    for (const [key, d] of want) {
      const cur = pills.get(key);
      const sidesVis = d.sides
        ? {
            left: d.sides.left ? d.sides.left.visible !== false : undefined,
            right: d.sides.right ? d.sides.right.visible !== false : undefined,
          }
        : undefined;
      if (cur) {
        cur.h.update({ price: d.price, color: d.color, segments: d.segs, sides: sidesVis });
        continue;
      }
      const h = createOrderPill(pane, {
        price: d.price,
        color: d.color,
        width: d.width,
        sides: d.sides,
        layout: pillLayout(),
        line: pillLine(),
        segments: d.segs.map((/** @type {string} */ t, /** @type {number} */ i) => ({
          text: t,
          onClick: d.cellClicks && d.cellClicks[i],
        })),
        onClick: d.onClick,
        onCommit: d.onCommit,
      });
      if (h) pills.set(key, { h });
    }
    for (const [key, v] of [...pills]) {
      if (!want.has(key)) {
        v.h.remove();
        pills.delete(key);
      }
    }
  };

  /** @param {import('./primitive-contract.js').OrderViewState} [s] */
  const set = (s = {}) => {
    /** @type {Map<string, any>} */
    const want = new Map();

    // LIVE -- the position entry (tap opens the ticket; not draggable, an average price is not a level).
    // PLACED pills are the compact 100px (the 140px is the projection CONTROLLER's, with its 5 cells).
    // X = CLOSE the position at market (the worker's closePosition -- same as the Modify tab's Close).
    // The KEBAB stays through the whole lifecycle: with no hedge SL/TP the [S]/[T] pieces sit on the entry pill
    // -- drag one off to SET that level on the position (onHedgeStop/onHedgeTarget at the drop price); removing
    // a level (its pill's X) puts the piece back. Exactly the planning behaviour, on the live position.
    const entry = num(s.entry);
    if (entry != null) {
      const entryKebab = {
        left: opts.onHedgeStop
          ? {
              text: t('S'),
              color: pillColor('stop'),
              visible: s.hedgeStop == null,
              onDetach: (/** @type {number} */ px) => /** @type {any} */ (opts.onHedgeStop)(px),
            }
          : undefined,
        right: opts.onHedgeTarget
          ? {
              text: t('T'),
              color: pillColor('target'),
              visible: s.hedgeTarget == null,
              onDetach: (/** @type {number} */ px) => /** @type {any} */ (opts.onHedgeTarget)(px),
            }
          : undefined,
      };
      want.set('entry', {
        price: entry,
        sides: entryKebab,
        color: sideColor(s.side === 'short' ? 'sell' : 'buy'),
        width: 100,
        segs: [String(s.qty != null ? s.qty : ''), s.side === 'short' ? t('SHORT') : t('LONG'), t('X')],
        cellClicks: [null, null, opts.onPositionClose && (() => /** @type {any} */ (opts.onPositionClose)())],
        onClick: opts.onEntry && (() => /** @type {any} */ (opts.onEntry)({ price: entry })),
      });
    }
    // LIVE -- hedging position SL/TP (drag = position modify; tap opens the ticket; X = REMOVE the level from
    // the position, the other leg untouched -- same [ qty | SL/TP | X ] read as every placed pill)
    const hs = num(s.hedgeStop);
    if (hs != null) {
      want.set('hedgeStop', {
        price: hs,
        color: pillColor('stop'),
        width: 100,
        segs: [
          String(s.hedgeStopQty != null ? s.hedgeStopQty : s.qty != null ? s.qty : ''),
          typeLabel('stopLoss'),
          t('X'),
        ],
        cellClicks: [null, null, opts.onHedgeStopClear && (() => /** @type {any} */ (opts.onHedgeStopClear)())],
        onCommit: opts.onHedgeStop,
        onClick: opts.onEntry && (() => /** @type {any} */ (opts.onEntry)({ price: hs })),
      });
    }
    const ht = num(s.hedgeTarget);
    if (ht != null) {
      want.set('hedgeTarget', {
        price: ht,
        color: pillColor('target'),
        width: 100,
        segs: [
          String(s.hedgeTargetQty != null ? s.hedgeTargetQty : s.qty != null ? s.qty : ''),
          typeLabel('takeProfit'),
          t('X'),
        ],
        cellClicks: [null, null, opts.onHedgeTargetClear && (() => /** @type {any} */ (opts.onHedgeTargetClear)())],
        onCommit: opts.onHedgeTarget,
        onClick: opts.onEntry && (() => /** @type {any} */ (opts.onEntry)({ price: ht })),
      });
    }
    // LIVE -- one pill per working order: [ qty | ABBREV | X ]; drag repriced by id, tap opens it, X cancels it.
    // The qty cell opens the number picker in CONFIRM mode: browsing the steppers/presets is free, ONLY the
    // Confirm button sends -- then the worker RESIZES the resting order (modifyOrder by id; the book confirms
    // the new size). Contrast the planning pill below: its picker edits plan.qty live, because nothing is
    // sent until the pill's V.
    ordQty.clear();
    for (const o of s.orders || []) {
      const ot = o.type === 'stop' ? 'stop' : o.type === 'limit' ? 'limit' : 'market';
      const id = o.id;
      ordQty.set(String(id), num(o.qty) || 1);
      // KEBAB on the order pill -- EXACTLY the position entry pill: the [S]/[T] pieces sit on the order while that leg is
      // unset; drag one off to SET it on the pending order (onOrderStop/TargetCommit at the drop price); the leg's X puts
      // the piece back (its ordStop/ordTarget pill drops and the circle returns here). visible bound to the order's legs.
      const ordKebab = {
        left: opts.onOrderStopCommit
          ? {
              text: t('S'),
              color: pillColor('stop'),
              visible: o.stopLoss == null,
              onDetach: (/** @type {number} */ px) => /** @type {any} */ (opts.onOrderStopCommit)(id, px),
            }
          : undefined,
        right: opts.onOrderTargetCommit
          ? {
              text: t('T'),
              color: pillColor('target'),
              visible: o.takeProfit == null,
              onDetach: (/** @type {number} */ px) => /** @type {any} */ (opts.onOrderTargetCommit)(id, px),
            }
          : undefined,
      };
      want.set('ord:' + id, {
        price: o.price,
        sides: ordKebab,
        color: sideColor(o.side),
        width: 100,
        segs: [String(o.qty != null ? o.qty : ''), typeLabel(ot), t('X')],
        cellClicks: [
          opts.onOrderQty &&
            ((/** @type {HTMLElement} */ cell) => {
              openNumberPicker(cell, ordQty.get(String(id)) || 1, (v) => /** @type {any} */ (opts.onOrderQty)(id, v), {
                ...qtyPicker(),
                confirm: 'Confirm',
              });
            }),
          null,
          opts.onOrderCancel && (() => /** @type {any} */ (opts.onOrderCancel)(id)),
        ],
        onClick: opts.onOrderClick && (() => /** @type {any} */ (opts.onOrderClick)(id)),
        onCommit: opts.onOrderCommit && ((/** @type {number} */ px) => /** @type {any} */ (opts.onOrderCommit)(id, px)),
      });
      // the SL/TP ATTACHED to this resting order (a pending-order bracket): its own stop/target pill, [ qty | SL/TP | X ]
      // -- the SAME read as the position's hedge pill. Drag = reprice that leg, tap opens the order, X removes the leg.
      const osl = num(o.stopLoss);
      if (osl != null) {
        want.set('ordStop:' + id, {
          price: osl,
          color: pillColor('stop'),
          width: 100,
          segs: [String(o.qty != null ? o.qty : ''), typeLabel('stopLoss'), t('X')],
          cellClicks: [null, null, opts.onOrderStopClear && (() => /** @type {any} */ (opts.onOrderStopClear)(id))],
          onClick: opts.onOrderClick && (() => /** @type {any} */ (opts.onOrderClick)(id)),
          onCommit:
            opts.onOrderStopCommit &&
            ((/** @type {number} */ px) => /** @type {any} */ (opts.onOrderStopCommit)(id, px)),
        });
      }
      const otp = num(o.takeProfit);
      if (otp != null) {
        want.set('ordTarget:' + id, {
          price: otp,
          color: pillColor('target'),
          width: 100,
          segs: [String(o.qty != null ? o.qty : ''), typeLabel('takeProfit'), t('X')],
          cellClicks: [null, null, opts.onOrderTargetClear && (() => /** @type {any} */ (opts.onOrderTargetClear)(id))],
          onClick: opts.onOrderClick && (() => /** @type {any} */ (opts.onOrderClick)(id)),
          onCommit:
            opts.onOrderTargetCommit &&
            ((/** @type {number} */ px) => /** @type {any} */ (opts.onOrderTargetCommit)(id, px)),
        });
      }
    }

    // PLANNING -- the projection entry (only while flat; armed reads as a live entry) + the stop/target ladder.
    // The projection pill is a CONTROLLER, not a dot: [ qty | B/S | type ] so far. The qty cell opens the number
    // picker and edits plan.qty (the dialog's Volume shows the same value); the B/S cell is a click-SWITCH that
    // flips plan.side buy<->sell (what the confirm will place); the type cell is a click-CYCLE through
    // market -> limit -> stop editing plan.orderType (the dialog's Market/Limit/Stop tabs mirror it); the X cell
    // DISMISSES the projection (Project off -- the dialog's checkbox unticks); the V cell PLACES the planned
    // order (the overlay sends the worker `place` and consumes the projection). Config from this primitive's JSON.
    const proj = entry == null ? num(s.projection) : null;
    if (proj != null) {
      projQty = num(s.projectionQty) || 1;
      projType = s.projectionType === 'limit' || s.projectionType === 'stop' ? s.projectionType : 'market';
      projSide = s.projectionSide === 'sell' ? 'sell' : 'buy';
      // the KEBAB pieces: [S] pill [T]. Drag one OFF the pill -> that leg becomes its own plan level (rung 0
      // stop/target -- the same detached pill the bracket draws, and V sends it natively with the order). A
      // piece shows only while its leg is UNSET; once detached it lives on the chart, not on the stick.
      const l0 = (Array.isArray(s.planLevels) && s.planLevels[0]) || {};
      const kebab = {
        left: opts.onPlanStop
          ? {
              text: t('S'),
              color: pillColor('planStop'),
              visible: l0.stop == null,
              onDetach: (/** @type {number} */ px) => /** @type {any} */ (opts.onPlanStop)(0, px),
            }
          : undefined,
        right: opts.onPlanTarget
          ? {
              text: t('T'),
              color: pillColor('planTarget'),
              visible: l0.target == null,
              onDetach: (/** @type {number} */ px) => /** @type {any} */ (opts.onPlanTarget)(0, px),
            }
          : undefined,
      };
      want.set('proj', {
        price: proj,
        sides: kebab,
        color: sideColor(projSide),
        segs: [
          String(projQty),
          projSide === 'sell' ? t('S') : t('B'),
          s.planArmed ? t('ENTRY') : typeLabel(projType),
          t('X'),
          t('V'),
        ],
        cellClicks: [
          opts.onProjectionQty &&
            ((/** @type {HTMLElement} */ cell) => {
              openNumberPicker(cell, projQty, (v) => /** @type {any} */ (opts.onProjectionQty)(v), qtyPicker());
            }),
          opts.onProjectionSide &&
            (() => /** @type {any} */ (opts.onProjectionSide)(projSide === 'sell' ? 'buy' : 'sell')),
          opts.onProjectionType &&
            (() => {
              const cycle = ['market', 'limit', 'stop'];
              /** @type {any} */ (opts.onProjectionType)(cycle[(cycle.indexOf(projType) + 1) % cycle.length]);
            }),
          opts.onProjectionCancel && (() => /** @type {any} */ (opts.onProjectionCancel)()),
          opts.onProjectionConfirm && (() => /** @type {any} */ (opts.onProjectionConfirm)()),
        ],
        onClick: opts.onProjection && (() => /** @type {any} */ (opts.onProjection)({ price: proj })),
        onCommit: opts.onProjectionMove,
      });
    }
    // rung pills read like working orders: [ qty | STP/TGT | X ]. Qty is DISPLAY-only. A TARGET shows its rung's
    // own exit qty (a partial) when the caller sized it; a STOP always shows the POSITION/planned size -- a stop
    // hit closes the WHOLE position (the addon's teardown, the app's full-qty OCO leg), never the rung partial,
    // so the rung's qty must not appear on it. X CLEARS the leg (the piece goes back on the kebab). ARMED rungs
    // are the LIVE automation's exits: no X (drag still works), and the key re-keys on arm so the pill rebuilds
    // with the right cells.
    const levels = s.planLevels || [];
    const multi = levels.length > 1;
    const armed = !!s.planArmed;
    const fullQty = entry != null ? (s.qty != null ? String(s.qty) : '') : String(num(s.projectionQty) || 1);
    levels.forEach((lv, i) => {
      const st = num(lv && lv.stop),
        tg = num(lv && lv.target);
      const n = multi ? ' ' + (i + 1) : '';
      // an armed (live) rung reads in the LIVE exit colours; a pre-trade rung in the PLANNING colours
      const stopC = armed ? pillColor('stop') : pillColor('planStop');
      const tgtC = armed ? pillColor('target') : pillColor('planTarget');
      /** @param {'stop'|'target'} kind @param {number} price @param {string} color @param {string} label @param {string} qtyText @param {any} onCommitFn @param {any} onClearFn */
      const rung = (kind, price, color, label, qtyText, onCommitFn, onClearFn) => {
        const canClear = !armed && !!onClearFn;
        want.set('plan:' + kind + ':' + i + (armed ? ':a' : ''), {
          price,
          color,
          width: 100,
          segs: canClear ? [qtyText, label, t('X')] : [qtyText, label],
          cellClicks: canClear ? [null, null, () => onClearFn(i)] : undefined,
          onCommit: onCommitFn && ((/** @type {number} */ px) => onCommitFn(i, px)),
        });
      };
      if (st != null) rung('stop', st, stopC, t('STP') + n, fullQty, opts.onPlanStop, opts.onPlanStopClear);
      if (tg != null)
        rung(
          'target',
          tg,
          tgtC,
          t('TGT') + n,
          lv && lv.qty != null ? String(lv.qty) : fullQty,
          opts.onPlanTarget,
          opts.onPlanTargetClear,
        );
    });

    reconcile(want);
  };

  return {
    set,
    remove: () => {
      for (const v of pills.values()) v.h.remove();
      pills.clear();
    },
  };
}

// this primitive's OWN settings (Settings > Trading > Primitives): the SIX colours -- planning stop/target,
// live buy/sell/stop/target -- plus placement/line/qty-picker config. The pill's abbreviations are NOT fixed:
// they are words routed through the vocabulary runtime (typeLabel + t()), so a pack can neutralize the loaded
// terms. Edits cfg.colors (primitives.pill) and save()s; live views rebuild on the change.
/** @param {HTMLElement} host @param {any} cfg @param {() => void} save */
function renderSettings(host, cfg, save) {
  host.textContent = '';
  const colors = cfg.colors || (cfg.colors = {});
  // colours in a 2-column grid: PLANNING [Stop|Target], LIVE [Buy|Sell] + [Stop|Target] (the trading tab's grid look)
  /** @param {string} label @param {string} key */
  const cell = (label, key) => {
    const c = document.createElement('div');
    c.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const l = document.createElement('span');
    l.style.cssText = 'font-size:13px;flex:1;';
    l.textContent = t(label);
    c.append(
      l,
      colorSwatch(colors[key] || PILL_COLOR_DEFAULTS[key], (/** @type {string} */ v) => {
        colors[key] = v;
        save();
      }),
    );
    return c;
  };
  /** @param {HTMLElement[]} cells */
  const grid = (...cells) => {
    const g = document.createElement('div');
    g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;align-items:center;';
    g.append(...cells);
    host.appendChild(g);
  };
  /** @param {string} txt @param {boolean} [first] */
  const head = (txt, first) => {
    const h = document.createElement('div');
    h.style.cssText =
      'margin:' + (first ? '0' : '14px') + ' 0 8px;font-size:11px;letter-spacing:.08em;color:var(--tx-dim);';
    h.textContent = t(txt);
    host.appendChild(h);
  };
  head('PLANNING', true);
  grid(cell('Stop', 'planStop'), cell('Target', 'planTarget'));
  head('LIVE');
  grid(cell('Buy', 'buy'), cell('Sell', 'sell'), cell('Stop', 'stop'), cell('Target', 'target'));
  head('PLACEMENT');
  const lay = cfg.layout || (cfg.layout = {});
  /** @param {string} label @param {HTMLElement} ctrl */
  const prow = (label, ctrl) => {
    const r2 = document.createElement('div');
    r2.className = 'sd-row';
    const l2 = document.createElement('span');
    l2.className = 'sd-label';
    l2.textContent = t(label);
    r2.append(l2, ctrl);
    host.appendChild(r2);
  };
  const sideSel = document.createElement('select');
  [
    ['right', 'Right'],
    ['left', 'Left'],
  ].forEach(([v, lbl]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t(lbl);
    sideSel.appendChild(o);
  });
  sideSel.value = lay.side === 'left' ? 'left' : 'right';
  sideSel.onchange = () => {
    lay.side = sideSel.value;
    save();
  };
  prow('Position', sideSel);
  const off = document.createElement('input');
  off.type = 'number';
  off.min = '0';
  off.style.width = '60px';
  off.value = String(Number.isFinite(Number(lay.offset)) ? lay.offset : 50);
  off.title = t('0 = flush to the price scale (or the left edge)');
  off.oninput = () => {
    const n = Number(off.value);
    lay.offset = Number.isFinite(n) && n >= 0 ? n : 0;
    save();
  };
  prow('Offset (px)', off);

  head('LINE');
  // ONE control: the app's stroke picker (swatch + live line sample; the popup carries colour + thickness +
  // line style together). Colour stays "match the pill's role colour" until the user PICKS one -- thickness/
  // style edits alone never fix the colour.
  const ln = cfg.line || (cfg.line = {});
  prow(
    'Line',
    strokeSwatch({
      color: {
        get: () => ln.color || PILL_COLOR_DEFAULTS.buy,
        set: (/** @type {any} */ v) => {
          ln.color = v;
          save();
        },
      },
      width: {
        get: () => (Number.isFinite(Number(ln.width)) && Number(ln.width) >= 1 ? Number(ln.width) : 1),
        set: (/** @type {any} */ v) => {
          ln.width = Number(v) || 1;
          save();
        },
      },
      lineStyle: {
        get: () => (ln.style === 'dashed' || ln.style === 'dotted' ? ln.style : 'solid'),
        set: (/** @type {any} */ v) => {
          ln.style = v;
          save();
        },
      },
    }),
  );
  const ext = document.createElement('input');
  ext.type = 'checkbox';
  ext.checked = !!lay.extend;
  ext.onchange = () => {
    lay.extend = ext.checked;
    save();
  };
  prow('Extend line', ext);

  head('QTY PICKER');
  const r = document.createElement('div');
  r.className = 'sd-row';
  const l = document.createElement('span');
  l.className = 'sd-label';
  l.textContent = t('Presets');
  const i = document.createElement('input');
  i.type = 'text';
  i.style.width = '110px';
  i.value = (Array.isArray(cfg.qtyPresets) && cfg.qtyPresets.length ? cfg.qtyPresets : QTY_PRESET_DEFAULTS).join(', ');
  i.oninput = () => {
    cfg.qtyPresets = i.value
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((x) => isFinite(x));
    save();
  };
  r.append(l, i);
  host.appendChild(r);
}

// PRIMITIVE #2 -- the pill registers itself (primitive-contract.js): pick it in Settings > Trading > Primitives.
registerPrimitive({
  id: 'pill',
  name: 'Pill',
  description: 'The built-in order view: a compact pill anchored to the price scale.',
  capabilities: { plan: true },
  create: createPillView,
  renderSettings,
});
