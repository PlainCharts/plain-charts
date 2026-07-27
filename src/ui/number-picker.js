// @ts-check
// Reusable NUMBER PICKER popup:  [ − ] [ input ] [ + ]  -- anchored to an element (like the color picker), with a
// live onChange. Self-contained (inline styles + theme CSS vars), so any surface can use it: the order pill's qty
// cell today, settings/other inputs later. First brick -- stepper + typed input + clamp; more (long-press, wheel,
// presets) can layer on.

/** @type {HTMLElement|null} */
let pop = null;
/** @param {MouseEvent} e */
function onDoc(e) { if (pop && !pop.contains(/** @type {any} */ (e.target))) closeNumberPicker(); }

export function closeNumberPicker() {
  if (!pop) return;
  try { pop.remove(); } catch (_) {}
  pop = null;
  document.removeEventListener('mousedown', onDoc, true);
}

/**
 * Open the picker anchored to `anchor`. Two modes:
 *   LIVE (default): onChange fires on every step/preset/typed commit -- for editing a local value
 *     (the planning pill's qty: nothing is sent until the pill's V).
 *   CONFIRM (opts.confirm = a button label): stepping only edits the displayed value; onChange fires
 *     ONCE when the Confirm button (or Enter) is pressed, then the picker closes. For actions with a
 *     real cost (resizing a LIVE order): going back and forth is free, only Confirm sends.
 * @param {HTMLElement} anchor
 * @param {number} value
 * @param {(v: number) => void} onChange
 * @param {{ min?: number, max?: number, step?: number, decimals?: number, presets?: number[], confirm?: string }} [opts]
 *   presets = user-defined quick values shown UNDER the stepper; clicking one sets it. (Config is per-primitive; see order-primitives-config.)
 * @returns {{ close: () => void }}
 */
export function openNumberPicker(anchor, value, onChange, opts = {}) {
  closeNumberPicker();
  const min = opts.min != null ? opts.min : -Infinity;
  const max = opts.max != null ? opts.max : Infinity;
  const step = opts.step || 1;
  const dec = opts.decimals != null ? opts.decimals : 0;
  const confirmLabel = typeof opts.confirm === 'string' && opts.confirm ? opts.confirm : null;
  const clamp = (/** @type {number} */ v) => Number(Math.min(max, Math.max(min, v)).toFixed(dec));
  let val = clamp(Number(value) || 0);

  pop = document.createElement('div');
  pop.className = 'np-pop';
  pop.style.cssText = 'position:fixed;z-index:96;display:flex;flex-direction:column;gap:6px;padding:6px;'
    + 'background:var(--panel,#1b1d22);border:1px solid var(--bd,#333);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.4);';
  /** @param {string} txt */
  const btn = (txt) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.style.cssText = 'width:26px;height:26px;border:1px solid var(--bd,#333);background:var(--bg,#14161a);color:var(--tx,#ddd);border-radius:5px;cursor:pointer;font-size:16px;line-height:1;'; return b; };
  const minus = btn('−'), plus = btn('+');
  const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
  input.type = 'text'; input.inputMode = 'decimal';
  input.style.cssText = 'width:64px;height:26px;text-align:center;border:1px solid var(--bd,#333);background:var(--bg,#14161a);color:var(--tx,#ddd);border-radius:5px;font-size:13px;box-sizing:border-box;';

  const render = () => { input.value = String(val); };
  // in CONFIRM mode stepping only edits the display -- onChange waits for the Confirm button/Enter
  const commit = (/** @type {number} */ v) => { val = clamp(v); render(); if (!confirmLabel) { try { onChange(val); } catch (_) {} } };
  const confirmSend = () => { try { onChange(val); } catch (_) {} closeNumberPicker(); };
  minus.onclick = () => commit(val - step);
  plus.onclick = () => commit(val + step);
  input.onchange = () => { const nx = parseFloat(input.value); commit(isFinite(nx) ? nx : val); };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { const nx = parseFloat(input.value); if (isFinite(nx)) { val = clamp(nx); render(); } if (confirmLabel) { confirmSend(); return; } input.blur(); closeNumberPicker(); }
    else if (e.key === 'Escape') { closeNumberPicker(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); commit(val + step); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); commit(val - step); }
  };
  const stepRow = document.createElement('div');
  stepRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
  stepRow.append(minus, input, plus);
  pop.appendChild(stepRow);

  // user-defined PRESETS (per-primitive config) -- a row of quick-value buttons UNDER the stepper. ADDITIVE: each
  // click ADDS its value to the current total (pick 1, then 2 -> 3), so a total is built up from the presets.
  const presets = Array.isArray(opts.presets) ? opts.presets : [];
  if (presets.length) {
    const prow = document.createElement('div');
    prow.style.cssText = 'display:flex;gap:4px;';
    const chip = 'flex:1;min-width:28px;height:24px;border:1px solid var(--bd,#333);background:var(--bg,#14161a);color:var(--tx,#ddd);border-radius:5px;cursor:pointer;font-size:12px;line-height:1;';
    presets.forEach((pv) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = String(pv); b.style.cssText = chip;
      b.onclick = () => commit(val + pv);
      prow.appendChild(b);
    });
    // reset -> back to the base (min, or 0 if unbounded); undoes the additive presets
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '↺'; reset.title = 'Reset'; reset.style.cssText = chip + 'font-size:14px;';
    reset.onclick = () => commit(isFinite(min) ? min : 0);
    prow.appendChild(reset);
    pop.appendChild(prow);
  }
  // CONFIRM mode: the one button that actually fires onChange. Everything above it is free browsing;
  // clicking away / Esc cancels without sending.
  if (confirmLabel) {
    const ok = document.createElement('button'); ok.type = 'button'; ok.textContent = confirmLabel;
    ok.style.cssText = 'height:26px;border:1px solid var(--bd,#333);background:var(--active,#2a2d34);color:var(--tx,#ddd);border-radius:5px;cursor:pointer;font-size:12px;line-height:1;width:100%;';
    ok.onclick = confirmSend;
    pop.appendChild(ok);
  }
  document.body.appendChild(pop);
  render();

  // position just below the anchor, kept inside the viewport
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  let left = r.left, top = r.bottom + 6;
  if (left + pr.width > window.innerWidth) left = window.innerWidth - pr.width - 8;
  if (top + pr.height > window.innerHeight) top = r.top - pr.height - 6;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';

  setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
  input.focus(); input.select();
  return { close: closeNumberPicker };
}
