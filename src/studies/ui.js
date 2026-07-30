// @ts-check
// ƒx button — direct access to the Indicator library (no dropdown). Managing what's already
// on the chart (settings / hide / remove) lives in the on-chart study legend (top-left of the
// pane). Browsing, favorites, and organizing live in the Library modal.
import { openLibrary } from './library.js';
import { $ } from '../dom.js';

export function initStudies() {
  const btn = $('btnStudies');
  if (!btn) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    openLibrary();
  };
}
