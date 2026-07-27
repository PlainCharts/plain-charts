// @ts-check
// Bottom bar: Broker / UTC clocks + the chart display time in the chosen UTC
// offset, with a clickable chip that opens a small offset-input popover.
import { $ } from '../dom.js';
import { bus } from '../bus.js';
import { getActivePane, isMaximized } from '../chart/layout.js';
import { mountQuickCoords } from './quick-coords.js';

// the ACTIVE pane's display offset (minutes east of UTC); 0 when no chart is up (a surface tab)
const activeOff = () => { const p = getActivePane(); return p ? p.tzOffset() : 0; };

// corner-bracket icons (plain SVG, currentColor so they follow the theme)
const SVG_MAX = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>';
const SVG_RESTORE = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/></svg>';

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');
/** @param {number} ms */
const fmtUTC = (ms) => { const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
/** @param {number} ms @param {number} offMin */
const fmtAt = (ms, offMin) => fmtUTC(ms + offMin * 60000);
/** @param {number} offMin */
const offLabel = (offMin) => { const h = offMin / 60; return `UTC${h >= 0 ? '+' : '-'}${Number.isInteger(h) ? Math.abs(h) : Math.abs(h).toFixed(1)}`; };

let popover = /** @type {HTMLElement} */ (/** @type {unknown} */ (null));

export function initBottomBar() {
  const bar = /** @type {HTMLElement} */ ($('bottombar'));
  bar.innerHTML = '';
  const spacer = document.createElement('div'); spacer.className = 'spacer';
  const clock = document.createElement('div'); clock.className = 'bb-clock';
  const times = document.createElement('div'); times.className = 'bb-times';
  const chip = document.createElement('button'); chip.className = 'bb-tz';
  clock.append(times, chip);

  // maximize / restore the active chart pane, on the far right
  const maxBtn = document.createElement('button'); maxBtn.className = 'bb-max';
  /** @param {boolean} maxed */
  const paintMax = (maxed) => { maxBtn.innerHTML = maxed ? SVG_RESTORE : SVG_MAX; maxBtn.title = maxed ? 'Restore chart' : 'Maximize chart'; maxBtn.classList.toggle('active', !!maxed); };
  maxBtn.onclick = () => { const p = getActivePane(); if (p) bus.emit('pane:maximize', p); };
  bus.on('pane:maxchanged', paintMax);
  paintMax(isMaximized());

  // quick-coordinates editor (price for a selected hline; date+time for a selected vline),
  // sitting just left of the clock with a margin gap
  const qc = document.createElement('div'); qc.className = 'bb-qc';
  bar.append(spacer, qc, clock, maxBtn);
  mountQuickCoords(qc);

  popover = document.createElement('div'); popover.id = 'tzPopover';
  document.body.appendChild(popover);
  chip.onclick = (e) => { e.stopPropagation(); openTz(chip); };
  document.addEventListener('click', (e) => { const t = /** @type {Node} */ (e.target); if (popover && !popover.contains(t) && t !== chip) popover.classList.remove('open'); });

  const tick = () => {
    const off = activeOff();
    times.innerHTML = `<span class="bb-t bb-disp">${fmtAt(Date.now(), off)}</span>`;
    chip.textContent = offLabel(off);
  };
  tick();
  setInterval(tick, 1000);
  bus.on('pane:active', tick);    // readout follows the focused chart
  bus.on('pane:changed', tick);   // and reflects a tz change immediately
}

/** @param {HTMLElement} anchor */
function openTz(anchor) {
  popover.innerHTML = '';
  const h = document.createElement('div'); h.className = 'tz-head'; h.textContent = 'Time zone — UTC offset (hours)';

  const row = document.createElement('div'); row.className = 'tz-input';
  const inp = document.createElement('input'); inp.type = 'number'; inp.step = '1'; inp.min = '-12'; inp.max = '14';
  inp.value = /** @type {any} */ (Math.round(activeOff() / 60));
  /** @param {number} min */
  const setTz = (min) => { const p = getActivePane(); if (p) p.setTz(min); };
  /** @param {number} v */
  const setH = (v) => { v = Math.max(-12, Math.min(14, v)); setTz(v * 60); inp.value = /** @type {any} */ (v); };
  inp.onchange = () => { const v = parseInt(inp.value, 10); if (!isNaN(v)) setH(v); };
  /** @param {string} label @param {number} dir */
  const mk = (label, dir) => { const b = document.createElement('button'); b.className = 'tz-step'; b.textContent = label; b.onclick = (e) => { e.stopPropagation(); setH(Math.round(activeOff() / 60) + dir); }; return b; };
  row.append(mk('−', -1), inp, mk('+', 1));

  const presets = document.createElement('div'); presets.className = 'tz-presets';
  /** @param {string} label @param {number} min */
  const preset = (label, min) => {
    const b = document.createElement('button'); b.textContent = label;
    b.onclick = (e) => { e.stopPropagation(); setTz(min); inp.value = /** @type {any} */ (Math.round(min / 60)); };
    return b;
  };
  presets.append(preset('UTC', 0), preset('Local', -new Date().getTimezoneOffset()));

  popover.append(h, row, presets);
  popover.classList.add('open');
  const r = anchor.getBoundingClientRect();
  const w = popover.offsetWidth;
  popover.style.left = Math.max(8, r.right - w) + 'px';
  popover.style.top = (r.top - popover.offsetHeight - 8) + 'px';
  inp.focus(); inp.select();
}
