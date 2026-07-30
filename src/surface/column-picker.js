// @ts-check
// Shared column picker for the configurable surface tables (Accounts, Positions, ...). The gear opens a
// two-list dialog: Available (click + to add) and Shown (drag to reorder, x to remove). Order applies live
// via onSave; the caller persists it. A catalog entry only needs { key, label } for the picker.
import { t } from '../i18n/i18n.js'; // vocabulary lookup for the shown column names
/** @typedef {{ key: string, label: string }} Col */

/** @param {string} [cls] @param {string} [txt] */
const el = (cls, txt) => {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

// drag a centered dialog by its header. On first grab it switches to fixed positioning so it leaves the
// overlay's flex centering and follows the cursor.
/** @param {HTMLElement} dlg @param {HTMLElement} handle */
function dragByHandle(dlg, handle) {
  handle.style.cursor = 'move';
  handle.addEventListener('pointerdown', (e) => {
    const tgt = /** @type {Element} */ (e.target);
    if (e.button !== 0 || (tgt.closest && tgt.closest('.acct-cfg-x'))) return; // not the close button
    const r = dlg.getBoundingClientRect();
    dlg.style.position = 'fixed';
    dlg.style.margin = '0';
    dlg.style.left = r.left + 'px';
    dlg.style.top = r.top + 'px';
    const ox = e.clientX - r.left,
      oy = e.clientY - r.top;
    /** @param {PointerEvent} ev */
    const move = (ev) => {
      dlg.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - ox)) + 'px';
      dlg.style.top = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - oy)) + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (_) {}
  });
}

export const GEAR =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 5.2A2.8 2.8 0 1 0 8 10.8 2.8 2.8 0 0 0 8 5.2Zm0 1.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z"/><path d="M13.3 8c0-.3 0-.6-.1-.9l1.3-1-1.4-2.4-1.5.6a4.7 4.7 0 0 0-1.5-.9L9.8 1.2H7l-.3 1.6c-.5.2-1 .5-1.5.9l-1.5-.6L2.3 5.5l1.3 1a5 5 0 0 0 0 1.8l-1.3 1 1.4 2.4 1.5-.6c.5.4 1 .7 1.5.9l.3 1.6h2.8l.3-1.6c.5-.2 1-.5 1.5-.9l1.5.6 1.4-2.4-1.3-1c0-.3.1-.6.1-.9Z" fill="none" stroke="currentColor" stroke-width="1"/></svg>';

// catalog: [{ key, label }]  ·  current: string[] of keys  ·  onSave(keys): applied live as the user edits
/** @param {Col[]} catalog @param {string[]} current @param {(keys: string[]) => void} onSave */
export function openColumnPicker(catalog, current, onSave) {
  /** @type {Record<string, Col>} */
  const byKey = Object.fromEntries(catalog.map((c) => /** @type {[string, Col]} */ ([c.key, c])));
  const overlay = el('acct-cfg-overlay');
  const dlg = el('acct-cfg');
  const head = el('acct-cfg-head');
  head.append(el('acct-cfg-title', 'Configure columns'));
  const x = el('acct-cfg-x', '✕');
  head.appendChild(x);
  let chosen = current.filter((k) => byKey[k]);
  const cols = el('acct-cfg-cols');
  const leftBox = el('acct-cfg-box');
  const rightBox = el('acct-cfg-box');
  leftBox.append(el('acct-cfg-lbl', 'Available'));
  rightBox.append(el('acct-cfg-lbl', 'Shown (in order)'));
  const leftList = el('acct-cfg-list');
  const rightList = el('acct-cfg-list');
  leftBox.appendChild(leftList);
  rightBox.appendChild(rightList);
  cols.append(leftBox, rightBox);
  dlg.append(head, cols);
  const foot = el('acct-cfg-foot');
  const done = el('acct-cfg-done', 'Done');
  foot.appendChild(done);
  dlg.appendChild(foot);
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  dragByHandle(dlg, head); // move the dialog around by its header

  /** @type {string | null} */
  let dragKey = null; // key of the row currently being dragged in the Shown list

  const rerender = () => {
    leftList.innerHTML = '';
    rightList.innerHTML = '';
    catalog
      .filter((c) => !chosen.includes(c.key))
      .forEach((c) => {
        const it = el('acct-cfg-item', t(c.label));
        const add = el('acct-cfg-btn', '+');
        add.title = t('Add');
        it.appendChild(add);
        it.onclick = () => {
          chosen.push(c.key);
          rerender();
        };
        leftList.appendChild(it);
      });
    chosen.forEach((k) => {
      const it = el('acct-cfg-item acct-cfg-drag');
      it.draggable = true;
      it.dataset.key = k;
      it.append(el('acct-cfg-grip', '⠿'), el('acct-cfg-item-lbl', t(byKey[k].label)));
      const rm = el('acct-cfg-btn', '✕');
      rm.title = t('Remove');
      rm.onclick = (e) => {
        e.stopPropagation();
        chosen = chosen.filter((c) => c !== k);
        rerender();
      };
      const ctrls = el('acct-cfg-ctrls');
      ctrls.appendChild(rm);
      it.appendChild(ctrls);

      it.addEventListener('dragstart', (e) => {
        dragKey = k;
        it.classList.add('dragging');
        try {
          const dt = /** @type {DataTransfer} */ (e.dataTransfer);
          dt.effectAllowed = 'move';
          dt.setData('text/plain', k);
        } catch (_) {}
      });
      it.addEventListener('dragend', () => {
        dragKey = null;
        it.classList.remove('dragging');
        rightList
          .querySelectorAll('.drop-before,.drop-after')
          .forEach((n) => n.classList.remove('drop-before', 'drop-after'));
      });
      it.addEventListener('dragover', (e) => {
        if (dragKey == null || dragKey === k) return;
        e.preventDefault();
        const before = e.clientY - it.getBoundingClientRect().top < it.offsetHeight / 2;
        it.classList.toggle('drop-before', before);
        it.classList.toggle('drop-after', !before);
      });
      it.addEventListener('dragleave', () => it.classList.remove('drop-before', 'drop-after'));
      it.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragKey == null || dragKey === k) return;
        const before = e.clientY - it.getBoundingClientRect().top < it.offsetHeight / 2;
        chosen = chosen.filter((c) => c !== dragKey);
        let idx = chosen.indexOf(k);
        if (!before) idx += 1;
        chosen.splice(idx, 0, dragKey);
        rerender();
      });
      rightList.appendChild(it);
    });
    onSave(chosen.slice()); // apply live as they edit
  };
  const close = () => {
    try {
      overlay.remove();
    } catch (_) {}
  };
  x.onclick = close;
  done.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  rerender();
}
