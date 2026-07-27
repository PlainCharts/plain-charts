// @ts-check
// The universal VISIBILITY + HIDE ON ENTRY frame for the order dialog. Rendered ONCE (like the quick-button bar), so it
// shows on EVERY tab without being coded into each -- the same shared behavior the position-manager addon exposes:
//   VISIBILITY     live per-category show/hide of the on-chart dots for the dialog's CURRENT (broker, symbol), via the
//                  shared plan.vis (setVis). Every primitive honours it through the overlay's filter.
//   HIDE ON ENTRY  edits the GLOBAL, persisted policy (order-visibility). The overlay applies it at the fill moment for
//                  every entry source; toggling here moves the addon's checkboxes too (one shared setting).
import { setVis, getPlan, subscribe as subscribePlan } from '../chart/order-view/plan-store.js';
import { hideOnEntry, setHideOnEntry, onHideOnEntryChange } from '../chart/order-view/order-visibility.js';
import { state } from './ticket-state.js';
import { t } from '../i18n/i18n.js';

/** @type {['entry'|'stop'|'target', string][]} */
const WHICH = [['entry', 'Entry'], ['stop', 'Stop'], ['target', 'Target']];

/** @param {() => any} getCtx @returns {HTMLElement} */
export function buildVisibilityFrame(getCtx) {
  const frame = document.createElement('div'); frame.className = 'ot-vis-frame';

  /** one titled row of the three category checkboxes. @param {string} title @param {(w: string, on: boolean) => void} onToggle @returns {{ sec: HTMLElement, boxes: Record<string, HTMLInputElement> }} */
  const sectionRow = (title, onToggle) => {
    const sec = document.createElement('div'); sec.className = 'ot-vis-sec';
    const ttl = document.createElement('span'); ttl.className = 'ot-vis-title'; ttl.textContent = t(title); sec.appendChild(ttl);
    const checks = document.createElement('div'); checks.className = 'ot-vis-checks';
    /** @type {Record<string, HTMLInputElement>} */
    const boxes = {};
    WHICH.forEach(([w, label]) => {
      const lab = document.createElement('label'); lab.className = 'ot-vis-check';
      const c = document.createElement('input'); c.type = 'checkbox'; c.onchange = () => onToggle(w, c.checked);
      const sp = document.createElement('span'); sp.textContent = t(label);
      lab.append(c, sp); checks.appendChild(lab); boxes[w] = c;
    });
    sec.appendChild(checks);
    return { sec, boxes };
  };

  const vis = sectionRow('VISIBILITY', (w, on) => { const c = getCtx(); if (c.symbol) setVis(c.broker, c.symbol, /** @type {any} */ ({ [w]: on })); });
  const hide = sectionRow('HIDE ON ENTRY', (w, on) => setHideOnEntry(/** @type {any} */ ({ [w]: on })));
  frame.append(vis.sec, hide.sec);

  // VISIBILITY reflects the CURRENT (broker, symbol)'s plan.vis (absent/true = shown); HIDE ON ENTRY reflects the global policy.
  const syncVis = () => { const c = getCtx(); const v = c.symbol ? (getPlan(c.broker, c.symbol).vis || {}) : {}; WHICH.forEach(([w]) => { vis.boxes[w].checked = v[w] !== false; }); };
  const syncHide = () => { const h = hideOnEntry(); WHICH.forEach(([w]) => { hide.boxes[w].checked = !!h[w]; }); };
  subscribePlan(syncVis);            // vis changed here / on the chart / another window
  onHideOnEntryChange(syncHide);     // policy changed in the addon / another window
  state.syncVis = () => { syncVis(); syncHide(); };   // window.js render() calls this on a tab / symbol switch (re-target to the new ctx)
  syncVis(); syncHide();
  return frame;
}
