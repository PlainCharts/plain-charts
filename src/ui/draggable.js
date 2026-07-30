// @ts-check
// Make a dialog draggable by a handle element (e.g. its header). The dialog stays
// centered by its overlay's flex layout until the first drag, then switches to fixed
// left/top positioning. Drags that start on an interactive control are ignored, so
// buttons/inputs in the handle still work.
/** @param {HTMLElement} dialog @param {HTMLElement} handle @returns {void} */
export function makeDraggable(dialog, handle) {
  handle.style.cursor = 'move';
  handle.style.userSelect = 'none';
  let sx = 0,
    sy = 0,
    ox = 0,
    oy = 0,
    dragging = false;

  /** @param {number} v @param {number} lo @param {number} hi @returns {number} */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  /** @param {PointerEvent} e */
  const onMove = (e) => {
    if (!dragging) return;
    const r = dialog.getBoundingClientRect();
    const maxL = window.innerWidth - 60,
      maxT = window.innerHeight - 40;
    dialog.style.left = clamp(ox + e.clientX - sx, 60 - r.width, maxL) + 'px';
    dialog.style.top = clamp(oy + e.clientY - sy, 0, maxT) + 'px';
  };
  const onUp = () => {
    dragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  handle.addEventListener('pointerdown', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('input, select, button, textarea, a')) return;
    const r = dialog.getBoundingClientRect();
    dialog.style.position = 'fixed';
    dialog.style.margin = '0';
    dialog.style.left = r.left + 'px';
    dialog.style.top = r.top + 'px';
    ox = r.left;
    oy = r.top;
    sx = e.clientX;
    sy = e.clientY;
    dragging = true;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  });
}
