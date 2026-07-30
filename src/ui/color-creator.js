// @ts-check
// Custom colour creator: SV square + hue slider + hex, then Pick (apply the colour) or Add (save it to
// the active palette). One instance at a time; the colour picker's outside-click handler asks
// creatorContains() so a click inside the creator never closes the picker under it.
import { clamp, normHex, hsvToHex, hexToHsv } from './color-math.js';

/** @type {any} */
let creator = null;
/** @returns {void} */
export function closeCreator() {
  if (!creator) return;
  document.removeEventListener('pointerdown', creator._out, true);
  creator.remove(); creator = null;
}
/** is this event target inside the open creator? @param {any} target @returns {boolean} */
export const creatorContains = (target) => !!(creator && creator.contains(target));

/** @param {HTMLElement} anchor @param {string} initialHex @param {{ onPick?: (v: string) => void, onAdd?: (v: string) => void }} [handlers] @returns {void} */
export function openCustomCreator(anchor, initialHex, handlers) {
  closeCreator();
  const onPick = (handlers && handlers.onPick) || (() => {});
  const onAdd = (handlers && handlers.onAdd) || (() => {});
  let [h, s, v] = hexToHsv(initialHex || '#2962ff');
  creator = document.createElement('div'); creator.className = 'cc-pop';

  // Left = SV square (fills the space) + hue slider. Right column = preview swatch, hex field, then the
  // action buttons: Paste (fills the hex field from the clipboard), Pick (apply) and Add (save to palette).
  const body = document.createElement('div'); body.className = 'cc-body';
  const sv = document.createElement('div'); sv.className = 'cc-sv';
  const svDot = document.createElement('div'); svDot.className = 'cc-dot'; sv.appendChild(svDot);
  const hue = document.createElement('div'); hue.className = 'cc-hue';
  const hueDot = document.createElement('div'); hueDot.className = 'cc-huedot'; hue.appendChild(hueDot);
  const side = document.createElement('div'); side.className = 'cc-side';
  const preview = document.createElement('span'); preview.className = 'cc-preview';
  const hexI = document.createElement('input'); hexI.className = 'cc-hex'; hexI.spellcheck = false;
  const pasteBtn = document.createElement('button'); pasteBtn.type = 'button'; pasteBtn.className = 'cc-paste'; pasteBtn.textContent = 'Paste';
  const pickBtn = document.createElement('button'); pickBtn.type = 'button'; pickBtn.className = 'cc-pick'; pickBtn.textContent = 'Pick';
  const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'cc-add'; addBtn.textContent = 'Add';
  side.append(preview, hexI, pasteBtn, pickBtn, addBtn);
  body.append(sv, hue, side);
  creator.append(body);

  const sync = () => {
    const hx = hsvToHex(h, s, v);
    preview.style.background = hx;
    if (document.activeElement !== hexI) hexI.value = hx;
    sv.style.setProperty('--hue', hsvToHex(h, 1, 1));
    svDot.style.left = (s * 100) + '%';
    svDot.style.top = ((1 - v) * 100) + '%';
    hueDot.style.top = (h / 360 * 100) + '%';
  };
  const applyHexInput = () => { const nv = normHex(hexI.value); if (nv) [h, s, v] = hexToHsv(nv); sync(); };
  hexI.onchange = applyHexInput;
  // Paste: drop the clipboard text into the hex field (and update the picker if it is a valid colour). It
  // only fills the field -- the user then chooses Pick or Add.
  pasteBtn.onclick = async () => { try { const t = await navigator.clipboard.readText(); if (t != null) { hexI.value = t.trim(); applyHexInput(); } } catch (_) {} };
  pickBtn.onclick = () => onPick(hsvToHex(h, s, v));   // apply the colour (this closes the whole picker)
  addBtn.onclick = () => onAdd(hsvToHex(h, s, v));      // save to the palette; creator stays open to add more

  const dragSV = (/** @type {PointerEvent} */ e) => { const r = sv.getBoundingClientRect(); s = clamp((e.clientX - r.left) / r.width, 0, 1); v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); sync(); };
  const dragHue = (/** @type {PointerEvent} */ e) => { const r = hue.getBoundingClientRect(); h = clamp((e.clientY - r.top) / r.height, 0, 1) * 360; sync(); };
  bindDrag(sv, dragSV);
  bindDrag(hue, dragHue);

  document.body.appendChild(creator);
  const r = anchor.getBoundingClientRect();
  creator.style.left = clamp(r.left, 8, window.innerWidth - creator.offsetWidth - 8) + 'px';
  creator.style.top = clamp(r.bottom + 6, 8, window.innerHeight - creator.offsetHeight - 8) + 'px';
  creator._out = (/** @type {PointerEvent} */ e) => { if (creator && !creator.contains(e.target) && e.target !== anchor) closeCreator(); };
  setTimeout(() => document.addEventListener('pointerdown', creator._out, true), 0);
  sync();
}

/** @param {HTMLElement} el @param {(e: PointerEvent) => void} onMove @returns {void} */
function bindDrag(el, onMove) {
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    onMove(e);
    const mv = (/** @type {PointerEvent} */ ev) => onMove(ev);
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
}
