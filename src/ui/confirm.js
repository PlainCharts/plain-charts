// @ts-check
// Small themed confirmation dialog. Returns a Promise that resolves true (Yes) or
// false (No / dismiss). Stacks above other modals.
import { t } from '../i18n/i18n.js'; // vocabulary lookup (callers pass English; translated at render)
/** @param {string} tag @param {string|null} [cls] @param {string} [txt] @returns {HTMLElement} */
const el = (tag, cls, txt) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
};

/**
 * @typedef {Object} ConfirmOptions
 * @property {string} [title]
 * @property {string} [message]
 * @property {string} [yes]
 * @property {string} [no]
 * @property {AbortSignal} [signal] dismiss the dialog externally (resolves false) -- e.g. another window
 *   already answered, or a timeout elapsed
 */
/** @param {ConfirmOptions} [opts] @returns {Promise<boolean>} */
export function confirmDialog({ title = 'Confirmation', message = '', yes = 'Yes', no = 'No', signal } = {}) {
  return new Promise((resolve) => {
    const overlay = el('div', 'modal open');
    overlay.style.zIndex = '110';
    const dlg = el('div', 'dialog confirm-dlg');
    const x = el('span', 'lib-x', '✕');
    const head = el('div', 'set-head');
    head.append(el('span', 'set-title', t(title)), x);
    const body = el('div', 'confirm-body', t(message));
    const foot = el('div', 'dlg-actions');
    const noBtn = el('button', null, t(no));
    const yesBtn = el('button', 'primary', t(yes));
    foot.append(noBtn, yesBtn);
    dlg.append(head, body, foot);
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);

    let settled = false;
    /** @param {boolean} v */
    const done = (v) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      overlay.remove();
      resolve(v);
    };
    const onAbort = () => done(false);
    x.onclick = () => done(false);
    noBtn.onclick = () => done(false);
    yesBtn.onclick = () => done(true);
    overlay.onclick = (e) => {
      if (e.target === overlay) done(false);
    };
    if (signal) {
      if (signal.aborted) return done(false);
      signal.addEventListener('abort', onAbort);
    }
    setTimeout(() => yesBtn.focus(), 0);
  });
}
