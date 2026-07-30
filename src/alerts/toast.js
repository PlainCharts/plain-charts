// @ts-check
// In-app VISIBLE sinks for a fired alert. Loaded once per visible window (src/main.js); the headless alert-host
// can't show UI, so on fire it BROADCASTS (IPC.ALERT_FIRED, tagged by kind) and this renders it. Two kinds,
// each a separate user-chosen action -- independent of the OS 'System notification' the host emits itself:
//   kind 'toast' -> a small auto-dismissing corner toast.
//   kind 'popup' -> a center-of-workspace dialog that STAYS until the user dismisses it.
// Themed via CSS vars (never hardcode a theme color).
import { IPC } from '../ipc-contract.js';

// One channel for the whole module: receives fired alerts from the host, and posts a `dismiss` back so the
// host can stop the notification sound when the user clears the alert.
/** @type {BroadcastChannel|null} */
let firedChan = null;
try {
  firedChan = new BroadcastChannel(IPC.ALERT_FIRED);
} catch (_) {}
const postDismiss = () => {
  if (firedChan) {
    try {
      firedChan.postMessage({ kind: 'dismiss' });
    } catch (_) {}
  }
};

/** @type {HTMLElement|null} */
let toastWrap = null;
function ensureToastWrap() {
  if (toastWrap) return toastWrap;
  toastWrap = document.createElement('div');
  toastWrap.className = 'alert-toasts';
  document.body.appendChild(toastWrap);
  return toastWrap;
}

/** small auto-dismissing corner toast. @param {{ title?: string, body?: string }} msg */
function showToast(msg) {
  const c = ensureToastWrap();
  const toast = document.createElement('div');
  toast.className = 'alert-toast';
  const bell = document.createElement('span');
  bell.className = 'alert-toast-bell';
  bell.textContent = '🔔';
  const txt = document.createElement('div');
  txt.className = 'alert-toast-txt';
  const title = document.createElement('div');
  title.className = 'alert-toast-title';
  title.textContent = msg.title || 'Alert';
  const body = document.createElement('div');
  body.className = 'alert-toast-body';
  body.textContent = msg.body || '';
  txt.append(title, body);
  const x = document.createElement('span');
  x.className = 'alert-toast-x';
  x.textContent = '✕';
  toast.append(bell, txt, x);
  c.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 200);
  };
  x.onclick = () => {
    dismiss();
    postDismiss();
  }; // user ✕ also stops the sound (auto-timeout does not)
  const timer = setTimeout(dismiss, 8000); // auto-dismiss
  toast.addEventListener('mouseenter', () => clearTimeout(timer)); // keep it while hovered
  requestAnimationFrame(() => toast.classList.add('in'));
}

/** center-of-workspace dialog; persists until dismissed. @param {{ title?: string, body?: string }} msg */
function showPopup(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'alert-popup-wrap';
  const card = document.createElement('div');
  card.className = 'alert-popup';
  const head = document.createElement('div');
  head.className = 'alert-popup-head';
  const bell = document.createElement('span');
  bell.className = 'alert-popup-bell';
  bell.textContent = '🔔';
  const title = document.createElement('div');
  title.className = 'alert-popup-title';
  title.textContent = msg.title || 'Alert';
  head.append(bell, title);
  const body = document.createElement('div');
  body.className = 'alert-popup-body';
  body.textContent = msg.body || '';
  const foot = document.createElement('div');
  foot.className = 'alert-popup-foot';
  const ok = document.createElement('button');
  ok.className = 'primary';
  ok.textContent = 'Dismiss';
  foot.appendChild(ok);
  card.append(head, body, foot);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  ok.onclick = () => {
    wrap.remove();
    postDismiss();
  }; // dismiss -> also stops the host's sound
  ok.focus();
}

let inited = false;
// Start listening for fired alerts. Idempotent; safe to call once at boot.
export function initAlertToasts() {
  if (inited) return;
  inited = true;
  if (!firedChan) return;
  firedChan.onmessage = (e) => {
    const m = e && e.data;
    if (!m) return;
    if (m.kind === 'popup') showPopup(m);
    else if (m.kind === 'toast') showToast(m); // ignore our own 'dismiss' posts + anything else
  };
}
