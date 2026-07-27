// @ts-check
// "Shift end of chart from right border" toolbar toggle. Flips the ACTIVE chart's right
// margin: on -> keep the configured marginRight gap (rightOffset), off -> last bar flush to the right
// border (rightOffset 0). Per-chart; the button reflects the active pane's state and follows focus.
import { $ } from '../dom.js';
import { bus } from '../bus.js';
import { getActivePane } from '../chart/layout.js';

export function initShiftEnd() {
  const btn = $('btnShiftEnd');
  if (!btn) return;
  const sync = () => { const p = getActivePane(); btn.classList.toggle('active', !!(p && p.shiftEndOn && p.shiftEndOn())); };
  btn.onclick = () => { const p = getActivePane(); if (p && p.toggleShiftEnd) { p.toggleShiftEnd(); sync(); } };
  bus.on('pane:active', sync);   // follow the focused chart
  sync();
}

// auto-scroll toggle (next to shift-end): follow the latest bar as new bars arrive.
export function initAutoScroll() {
  const btn = $('btnAutoScroll');
  if (!btn) return;
  const sync = () => { const p = getActivePane(); btn.classList.toggle('active', !!(p && p.autoScrollOn && p.autoScrollOn())); };
  btn.onclick = () => { const p = getActivePane(); if (p && p.toggleAutoScroll) { p.toggleAutoScroll(); sync(); } };
  bus.on('pane:active', sync);
  sync();
}
