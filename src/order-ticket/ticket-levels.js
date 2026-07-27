// @ts-check
// Shared protective-LEVEL helpers for the order ticket: the price<->distance link used by Stop / Target on every tab.
// A level is an ABSOLUTE price (the source of truth that feeds the bracket / plan); the Dist box is a live readout of
// how far that price sits from a REFERENCE (the position entry on Modify, the live market on Market, the order Price on
// Limit/Stop), and typing a distance sets the price from the reference. Kept here so ticket-entry and ticket-modify
// share ONE implementation without importing each other (no cycle).
import { t } from '../i18n/i18n.js';

// The distance UNIT for an instrument: forex quotes (3-decimal JPY / 4-5-decimal majors) trade in PIPS, an index/future
// in POINTS. size = price move per 1 unit (pip = 0.01 for JPY else 0.0001; point = 1.0).
/** @param {number} decimals @returns {{ label: string, size: number }} */
export function unitInfo(decimals) {
  const d = Number(decimals);
  if (Number.isFinite(d) && d >= 3) return { label: t('pips'), size: d >= 4 ? 0.0001 : 0.01 };
  return { label: t('points'), size: 1 };
}
export const round1 = (/** @type {number} */ n) => Math.round(Number(n) * 10) / 10;

// Build a Dist row ([ Dist: | <distance> | pips ]) two-way LINKED to an existing price input. The price stays the source
// of truth: editing the price recomputes the distance; editing the distance sets the price from the reference; and when
// the reference moves (a quote tick, the Price field), recompute() refreshes the distance (the price holds). Direction
// is preserved -- the distance keeps whichever side of the reference the price is on (Stop defaults below, Target above).
/**
 * @param {HTMLInputElement} priceInput
 * @param {{ kind: 'sl'|'tp', getRef: () => number, getDec: () => number, onPriceSet?: (p: number) => void }} opts
 * @returns {{ row: HTMLElement, dist: HTMLInputElement, recompute: () => void }}
 */
export function attachDist(priceInput, opts) {
  const row = document.createElement('div'); row.className = 'ot-mod-row'; row.style.justifyContent = 'flex-end'; row.style.gap = '6px';
  const lbl = document.createElement('label'); lbl.className = 'ot-mod-label'; lbl.style.flex = '0 0 auto'; lbl.textContent = t('Dist:');
  const group = document.createElement('div'); group.style.cssText = 'flex:0 0 120px;display:flex;align-items:center;gap:6px;min-width:0;';
  const dist = /** @type {HTMLInputElement} */ (document.createElement('input')); dist.type = 'number'; dist.className = 'ot-mod-dist'; dist.step = '1'; dist.min = '0'; dist.style.flex = '1 1 auto'; dist.style.minWidth = '0';
  const unitEl = document.createElement('span'); unitEl.className = 'ot-mod-unit';
  group.append(dist, unitEl);
  row.append(lbl, group);
  let guard = false;
  const recompute = () => {
    if (guard || dist === document.activeElement) return;   // never overwrite the Dist box while the user is typing in it
    const u = unitInfo(opts.getDec()); unitEl.textContent = u.label;
    const ref = Number(opts.getRef()) || 0, price = Number(priceInput.value) || 0;
    dist.value = (price > 0 && ref > 0) ? String(round1(Math.abs(ref - price) / u.size)) : '0';
  };
  dist.oninput = () => {
    const dec = opts.getDec(), u = unitInfo(dec);
    const ref = Number(opts.getRef()) || 0, dv = Number(dist.value) || 0;
    if (!(ref > 0)) return;   // no reference yet -> can't place a price from a distance
    const cur = Number(priceInput.value) || 0;
    const below = cur > 0 ? cur <= ref : opts.kind === 'sl';   // keep the side the price is on; unset -> Stop below / Target above
    const p = below ? ref - dv * u.size : ref + dv * u.size;
    guard = true;
    priceInput.value = p > 0 ? p.toFixed(dec) : '0';   // keep the instrument's decimals (1.15300, not 1.153)
    guard = false;
    if (opts.onPriceSet) opts.onPriceSet(Number(priceInput.value) || 0);
  };
  priceInput.addEventListener('input', recompute);   // typing in the price box refreshes the distance (in addition to the box's own oninput)
  return { row, dist, recompute };
}
