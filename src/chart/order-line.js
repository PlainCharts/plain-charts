// @ts-check
// Horizontal ORDER LINE primitive -- the "spaghetti" style (a full-width line across the chart with a right-axis price
// label + a left-edge tag), the horizontal counterpart to the vertical string+beads (thread.js / position-view.js).
// Built in small layers:
//
//   TASK 1  the bones: a full-width price line (reuses createPriceLine -> line + right axis label + optional drag)
//           with a friendly lineStyle ('solid'|'dashed'|'dotted') and a role colour.
//   TASK 2  a LEFT-EDGE tag [qty | Label] pinned at x=0, riding the line's y each frame (the beads' y-tracking pattern).
//   TASK 3  an [X] cell on the tag -> onCancel (wire to the cancel command); shown only when a handler is supplied.
//   next    stretch/extend config, inline editable fields, and a TP/SL bracket row.
//
// DISPLAY-ONLY, like position-view: you hand it a price + role and it reflects it; a handler turns it into a trigger.
import { createPriceLine } from './thread.js';

/** @type {Record<string, number>} */
const STROKE = { solid: 0, dotted: 1, dashed: 2 };   // kapelka Stroke enum (Solid/Dotted/Dashed)

/**
 * @param {any} pane   a kapelka pane
 * @param {{ price?: number|string, color?: string, lineWidth?: number, lineStyle?: 'solid'|'dashed'|'dotted', label?: string, qty?: number|string|null, draggable?: boolean, onMove?: (px: number) => void, onCommit?: (px: number) => void, onCancel?: () => void }} [opts]
 *   label = both the RIGHT axis label and the LEFT tag name; qty = the small cell in the left tag (null/undefined hides it).
 *   onCancel = when set, an [X] cell appears on the tag; clicking it fires this (the caller cancels the order).
 * @returns {{ price: () => number, update: (o?: { price?: number|string, color?: string, label?: string, qty?: number|string|null, lineStyle?: string, [k: string]: any }) => void, setVisible: (on: boolean) => void, remove: () => void } | null}
 */
export function createOrderLine(pane, opts = {}) {
  if (!pane) return null;
  const line = createPriceLine(pane, {
    price: opts.price,
    color: opts.color || '#2962ff',
    lineWidth: opts.lineWidth || 1,
    title: opts.label || '',            // the right-axis label
    showAxisLabel: true,
    draggable: !!opts.draggable,
    onDrag: opts.onMove,
    onCommit: opts.onCommit,
  });
  if (!line) return null;
  /** @param {string} [s] */
  const applyStyle = (s) => { const v = STROKE[String(s || 'solid')]; try { line.update({ lineStyle: v == null ? 0 : v }); } catch (_) {} };
  applyStyle(opts.lineStyle);

  // ---- TASK 2: the LEFT-EDGE tag (a light DOM overlay tracking the line's y each frame) ----
  const state = { price: Number(opts.price) || 0, color: opts.color || '#2962ff', label: opts.label || '', qty: opts.qty != null ? opts.qty : null, hidden: false };
  const host = pane.chart.rootEl();
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5;';
  host.appendChild(layer);

  const tag = document.createElement('div');
  tag.style.cssText = 'position:absolute;left:6px;display:inline-flex;align-items:center;transform:translateY(-50%);'
    + 'background:var(--bg,#14161a);border-radius:4px;overflow:hidden;font:600 11px system-ui,sans-serif;white-space:nowrap;pointer-events:auto;';
  const qtyEl = document.createElement('span'); qtyEl.style.cssText = 'padding:2px 6px;';
  const labelEl = document.createElement('span'); labelEl.style.cssText = 'padding:2px 8px;';
  const xEl = document.createElement('span'); xEl.textContent = '✕'; xEl.title = 'Cancel order'; xEl.style.cssText = 'padding:2px 7px;cursor:pointer;';
  tag.append(qtyEl, labelEl, xEl);
  layer.appendChild(tag);

  // TASK 3: the [X] cell -- present only when onCancel is supplied; hover fills, click fires onCancel.
  xEl.onmouseenter = () => { xEl.style.background = state.color; xEl.style.color = '#fff'; };
  xEl.onmouseleave = () => { xEl.style.background = 'none'; xEl.style.color = state.color; };
  xEl.onclick = (e) => { e.stopPropagation(); e.preventDefault(); try { opts.onCancel && opts.onCancel(); } catch (_) {} };

  const paintTag = () => {
    const c = state.color;
    tag.style.border = '1px solid ' + c;
    qtyEl.textContent = state.qty != null ? String(state.qty) : '';
    qtyEl.style.display = state.qty != null ? '' : 'none';
    qtyEl.style.borderRight = state.qty != null ? '1px solid ' + c : 'none';
    qtyEl.style.color = c;
    labelEl.textContent = state.label;
    labelEl.style.color = c;
    xEl.style.display = opts.onCancel ? '' : 'none';
    xEl.style.borderLeft = opts.onCancel ? '1px solid ' + c : 'none';
    xEl.style.color = c;
  };
  paintTag();

  /** @param {number} pr @returns {number|null} */
  const p2y = (pr) => { try { return pane.series.priceToY(pr); } catch (_) { return null; } };
  let raf = 0, dead = false;
  const layout = () => {
    const y = p2y(state.price);
    if (y == null || state.hidden || !state.label && state.qty == null) { tag.style.display = 'none'; return; }
    tag.style.display = ''; tag.style.top = y + 'px';
  };
  const tick = () => { if (dead) return; layout(); raf = requestAnimationFrame(tick); };
  tick();

  return {
    price: () => line.price(),
    update: (o = {}) => {
      const { label, lineStyle, qty, ...rest } = o;
      if (rest.price != null) state.price = Number(rest.price);
      if (rest.color) state.color = rest.color;
      if (label != null) { state.label = label; /** @type {any} */ (rest).title = label; }   // 'label' feeds both the axis title and the tag
      if (qty !== undefined) state.qty = qty;
      line.update(rest);
      if (lineStyle != null) applyStyle(lineStyle);
      paintTag(); layout();
    },
    setVisible: (on) => { state.hidden = !on; line.setVisible(on); layout(); },
    remove: () => { dead = true; if (raf) cancelAnimationFrame(raf); try { layer.remove(); } catch (_) {} line.remove(); },
  };
}
